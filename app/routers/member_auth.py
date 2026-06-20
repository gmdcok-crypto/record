import logging
import json
import time
from datetime import datetime
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request as UrlRequest, urlopen

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.dependencies.member_auth import get_current_member
from app.models.admin_models import Member
from app.services.admin_events import publish_admin_event
from app.services.jwt_tokens import create_member_access_token, create_payment_prepare_token, decode_payment_prepare_token
from app.services.job_store import record_payment_record
from app.services.member_auth import (
    MemberAuthError,
    get_member_by_email,
    get_member_by_id,
    register_member,
    serialize_member,
    validate_email,
)
from app.services.portone_identity import parse_portone_identity_verification
from app.services.web_push import (
    deactivate_member_push_subscription,
    send_admin_member_signup_web_push,
    upsert_member_push_subscription,
)

router = APIRouter(prefix="/api/member/auth", tags=["member-auth"])
logger = logging.getLogger(__name__)


class MemberSignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=16)
    name: str
    phone: str | None = None
    identity_verification_id: str | None = Field(default=None, alias="identityVerificationId")

    model_config = {"populate_by_name": True}


class PortOneIdentityLookupRequest(BaseModel):
    identity_verification_id: str = Field(alias="identityVerificationId", min_length=1)

    model_config = {"populate_by_name": True}


class MemberLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=16)


class MemberAuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    member: dict


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    user_agent: str | None = None


class PortOnePaymentCompleteRequest(BaseModel):
    payment_id: str = Field(alias="paymentId", min_length=1)
    amount: int = Field(ge=0)
    order_name: str = Field(alias="orderName", min_length=1)

    model_config = {"populate_by_name": True}


class PortOnePaymentPrepareRequest(BaseModel):
    payment_id: str = Field(alias="paymentId", min_length=1)
    amount: int = Field(ge=0)
    order_name: str = Field(alias="orderName", min_length=1)
    return_to: str = Field(alias="returnTo", default="/")

    model_config = {"populate_by_name": True}


DEFAULT_RAILWAY_API_URL = "https://record-production.up.railway.app"


def _api_public_base() -> str:
    raw = settings.public_api_url.strip().rstrip("/") or DEFAULT_RAILWAY_API_URL
    # Payment redirect must hit Railway directly. Netlify /api/* uses a 200 rewrite that breaks 302.
    if ".netlify.app" in raw or ".github.io" in raw:
        return DEFAULT_RAILWAY_API_URL
    return raw


def _resolve_return_url(request: Request, return_to: str) -> str:
    target = (return_to or "/").strip() or "/"
    if target.startswith("http://") or target.startswith("https://"):
        return target
    base = str(request.base_url).rstrip("/")
    if not target.startswith("/"):
        target = f"/{target}"
    return f"{base}{target}"


def _append_query(url: str, params: dict[str, str]) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(params)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _coerce_payment_amount(value: object, *, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
        try:
            return int(float(stripped))
        except ValueError:
            return fallback
    return fallback


def _payment_total_amount(payment: dict, fallback: int = 0) -> int:
    amount = payment.get("amount")
    if isinstance(amount, dict):
        total = amount.get("total")
        if total is not None:
            return _coerce_payment_amount(total, fallback=fallback)
    return _coerce_payment_amount(amount, fallback=fallback)


def _is_portone_payment_paid(payment: dict) -> bool:
    return str(payment.get("status") or "").upper() == "PAID"


def _finalize_portone_payment(
    db: Session,
    *,
    member: Member,
    payment_id: str,
    expected_amount: int,
    expected_order_name: str,
    payment: dict | None = None,
) -> dict:
    payment = payment if payment is not None else _fetch_portone_json(f"/payments/{payment_id}")
    if not _is_portone_payment_paid(payment):
        raise HTTPException(status_code=409, detail="결제가 아직 완료되지 않았습니다.")

    total_amount = _payment_total_amount(payment, fallback=expected_amount)
    if total_amount != expected_amount:
        logger.warning(
            "portone amount mismatch payment_id=%s expected=%s actual=%s",
            payment_id,
            expected_amount,
            total_amount,
        )

    order_name = str(payment.get("orderName") or "").strip() or expected_order_name.strip() or payment_id
    if expected_order_name.strip() and order_name != expected_order_name.strip():
        logger.warning(
            "portone order name mismatch payment_id=%s expected=%r actual=%r",
            payment_id,
            expected_order_name,
            order_name,
        )

    pay_method = str(payment.get("method") or payment.get("payMethod") or "").strip() or None

    if settings.payment_records_enabled:
        paid_at_raw = payment.get("paidAt") or payment.get("updatedAt")
        paid_at = None
        if isinstance(paid_at_raw, str) and paid_at_raw.strip():
            try:
                paid_at = datetime.fromisoformat(paid_at_raw.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                paid_at = None
        try:
            record_payment_record(
                db,
                payment_id=payment_id,
                member=member,
                order_name=order_name,
                amount=total_amount,
                pay_method=pay_method,
                paid_at=paid_at,
            )
        except Exception:
            logger.exception("payment record save failed payment_id=%s member_id=%s", payment_id, member.id)
    else:
        logger.info(
            "payment record save skipped (PAYMENT_RECORDS_ENABLED=false) payment_id=%s member_id=%s",
            payment_id,
            member.id,
        )

    return {
        "ok": True,
        "payment_id": payment_id,
        "amount": total_amount,
        "order_name": order_name,
        "member_id": member.id,
    }


def _auth_error_to_http(exc: MemberAuthError) -> HTTPException:
    message = str(exc)
    if "이미" in message:
        return HTTPException(status_code=409, detail=message)
    if "이메일 또는 비밀번호" in message:
        return HTTPException(status_code=401, detail=message)
    if "비활성화" in message:
        return HTTPException(status_code=403, detail=message)
    return HTTPException(status_code=400, detail=message)


def _issue_token(member) -> MemberAuthTokenResponse:
    try:
        access_token = create_member_access_token(member_id=member.id, email=member.email)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return MemberAuthTokenResponse(
        access_token=access_token,
        member=serialize_member(member),
    )


def _fetch_portone_json(path: str) -> dict:
    if not settings.portone_api_secret.strip():
        raise HTTPException(status_code=503, detail="포트원 API 설정이 완료되지 않았습니다.")

    request = UrlRequest(
        f"https://api.portone.io{path}",
        headers={
            "Authorization": f"PortOne {settings.portone_api_secret.strip()}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"포트원 조회 실패: {body or exc.reason}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"포트원 연결 실패: {exc.reason}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"포트원 응답 처리 실패: {exc}") from exc


@router.get("/check-email")
def check_email_available(
    db: Annotated[Session, Depends(get_db)],
    email: str = Query(..., min_length=5, max_length=150),
) -> dict:
    try:
        normalized = validate_email(email)
    except MemberAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    taken = get_member_by_email(db, normalized) is not None
    return {"available": not taken, "email": normalized}


def _resolve_member_signup_phone(body: MemberSignupRequest) -> str | None:
    if not settings.portone_identity_enabled:
        return body.phone

    verification_id = (body.identity_verification_id or "").strip()
    if not verification_id:
        raise HTTPException(status_code=400, detail="본인인증을 완료해 주세요.")

    verification = _fetch_portone_json(f"/identity-verifications/{verification_id}")
    parsed = parse_portone_identity_verification(verification)
    phone = parsed.get("phone")
    if not phone:
        raise HTTPException(status_code=400, detail="본인인증 정보에서 휴대폰 번호를 확인하지 못했습니다.")
    return phone


@router.post("/identity-verifications/lookup")
def lookup_member_identity_verification(body: PortOneIdentityLookupRequest) -> dict:
    verification = _fetch_portone_json(f"/identity-verifications/{body.identity_verification_id}")
    parsed = parse_portone_identity_verification(verification)
    return {
        "ok": True,
        "identity_verification_id": body.identity_verification_id,
        "verified_customer": parsed["verified_customer"],
        "name": parsed["name"],
        "phone": parsed["phone"],
    }


def _notify_admins_member_signup(db: Session, member: Member) -> None:
    publish_admin_event(
        "member_created",
        {"member_id": member.id, "name": member.name, "email": member.email},
    )
    try:
        delivered = send_admin_member_signup_web_push(
            db,
            member_name=member.name,
            member_email=member.email,
            member_id=member.id,
        )
        if delivered == 0:
            logger.info("Admin member-signup web push delivered 0 for member %s", member.id)
    except Exception:
        logger.exception("Failed to send admin member-signup web push for member %s", member.id)


@router.post("/signup", response_model=MemberAuthTokenResponse)
def member_signup(body: MemberSignupRequest, db: Annotated[Session, Depends(get_db)]) -> MemberAuthTokenResponse:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    try:
        signup_phone = _resolve_member_signup_phone(body)
        member = register_member(
            db,
            email=body.email,
            password=body.password,
            name=body.name,
            phone=signup_phone,
        )
    except MemberAuthError as exc:
        raise _auth_error_to_http(exc) from exc

    _notify_admins_member_signup(db, member)
    return _issue_token(member)


@router.get("/me")
def member_me(current: Annotated[Member, Depends(get_current_member)]) -> dict:
    return {"member": serialize_member(current)}


@router.post("/payments/prepare")
def prepare_portone_payment(
    body: PortOnePaymentPrepareRequest,
    request: Request,
    current: Annotated[Member, Depends(get_current_member)],
) -> dict:
    state = create_payment_prepare_token(
        member_id=current.id,
        payment_id=body.payment_id,
        amount=body.amount,
        order_name=body.order_name,
    )
    return_to = (body.return_to or "").strip() or settings.public_client_url.rstrip("/") + "/"
    if not return_to.startswith("http://") and not return_to.startswith("https://"):
        return_to = _resolve_return_url(request, return_to)
    redirect_url = _append_query(
        f"{_api_public_base()}/api/member/auth/payments/redirect",
        {"state": state, "return_to": return_to},
    )
    return {"redirectUrl": redirect_url}


def _payment_return_destination(request: Request, return_to: str) -> str:
    target = (return_to or "/").strip() or "/"
    if target.startswith("http://") or target.startswith("https://"):
        return target
    return _resolve_return_url(request, target)


def _redirect_after_payment(
    request: Request,
    *,
    return_to: str,
    payment_id: str,
    confirmed: bool,
    error: str | None = None,
) -> RedirectResponse:
    params: dict[str, str] = {"paymentId": payment_id}
    if confirmed:
        params["payment_confirmed"] = "1"
    if error:
        params["payment_error"] = error
    destination = _append_query(_payment_return_destination(request, return_to), params)
    return RedirectResponse(url=destination, status_code=302)


def _fetch_portone_payment_with_retry(payment_id: str, *, attempts: int = 4, delay_sec: float = 0.6) -> dict:
    last_payment: dict | None = None
    last_error: HTTPException | None = None
    for attempt in range(attempts):
        try:
            payment = _fetch_portone_json(f"/payments/{payment_id}")
            last_payment = payment
            if _is_portone_payment_paid(payment):
                return payment
        except HTTPException as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise
        if attempt < attempts - 1:
            time.sleep(delay_sec)
    if last_payment is not None:
        return last_payment
    if last_error is not None:
        raise last_error
    return {}


def _safe_payment_redirect(
    request: Request,
    *,
    return_to: str,
    payment_id: str,
    confirmed: bool,
    error: str | None = None,
) -> RedirectResponse:
    try:
        return _redirect_after_payment(
            request,
            return_to=return_to,
            payment_id=payment_id,
            confirmed=confirmed,
            error=error,
        )
    except Exception:
        logger.exception("payment redirect response build failed payment_id=%s", payment_id)
        fallback = settings.public_client_url.rstrip("/") + "/"
        return RedirectResponse(
            url=f"{fallback}?paymentId={payment_id}{'&payment_confirmed=1' if confirmed else ''}",
            status_code=302,
        )


@router.get("/payments/redirect")
def portone_payment_redirect(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    state: str = Query(..., min_length=10),
    return_to: str = Query(..., min_length=1),
    payment_id: str = Query(alias="paymentId", min_length=1),
) -> RedirectResponse:
    paid_payment: dict | None = None

    def redirect_failure(message: str) -> RedirectResponse:
        if paid_payment is not None:
            logger.warning(
                "payment redirect failure ignored because PortOne is PAID payment_id=%s detail=%s",
                payment_id,
                message,
            )
            return _safe_payment_redirect(
                request,
                return_to=return_to,
                payment_id=payment_id,
                confirmed=True,
            )
        return _safe_payment_redirect(
            request,
            return_to=return_to,
            payment_id=payment_id,
            confirmed=False,
            error=message,
        )

    try:
        try:
            payload = decode_payment_prepare_token(state)
        except (jwt.InvalidTokenError, RuntimeError):
            return redirect_failure("결제 세션이 만료되었거나 유효하지 않습니다.")

        if str(payload.get("payment_id") or "") != payment_id:
            return redirect_failure("결제 정보가 일치하지 않습니다.")

        try:
            member_id = int(str(payload.get("sub") or "").strip())
        except (TypeError, ValueError):
            return redirect_failure("결제 세션 정보가 올바르지 않습니다.")

        member = get_member_by_id(db, member_id)
        if member is None or not member.is_active:
            return redirect_failure("회원 정보를 확인할 수 없습니다.")

        try:
            payment = _fetch_portone_payment_with_retry(payment_id)
        except HTTPException as exc:
            logger.warning("payment redirect portone fetch failed payment_id=%s detail=%s", payment_id, exc.detail)
            return redirect_failure("결제 확인 중 오류가 발생했습니다.")

        if not _is_portone_payment_paid(payment):
            return redirect_failure("결제가 아직 완료되지 않았습니다.")

        paid_payment = payment
        try:
            _finalize_portone_payment(
                db,
                member=member,
                payment_id=payment_id,
                expected_amount=int(payload.get("amount") or 0),
                expected_order_name=str(payload.get("order_name") or ""),
                payment=payment,
            )
        except HTTPException as exc:
            if exc.status_code != 409:
                logger.warning(
                    "payment redirect finalize rejected payment_id=%s status=%s detail=%s",
                    payment_id,
                    exc.status_code,
                    exc.detail,
                )
        except Exception:
            logger.exception("payment redirect finalize failed payment_id=%s (redirect continues)", payment_id)

        return _safe_payment_redirect(
            request,
            return_to=return_to,
            payment_id=payment_id,
            confirmed=True,
        )
    except Exception:
        logger.exception("payment redirect unexpected failure payment_id=%s", payment_id)
        try:
            payment = _fetch_portone_json(f"/payments/{payment_id}")
            if _is_portone_payment_paid(payment):
                return _safe_payment_redirect(
                    request,
                    return_to=return_to,
                    payment_id=payment_id,
                    confirmed=True,
                )
        except Exception:
            logger.exception("payment redirect recovery fetch failed payment_id=%s", payment_id)
        return redirect_failure("결제 복귀 처리 중 오류가 발생했습니다.")


def _complete_portone_payment_response(
    *,
    body: PortOnePaymentCompleteRequest,
    current: Member,
    payment: dict,
) -> dict:
    if not _is_portone_payment_paid(payment):
        raise HTTPException(status_code=409, detail="결제가 아직 완료되지 않았습니다.")

    return {
        "ok": True,
        "payment_id": body.payment_id,
        "amount": _payment_total_amount(payment, fallback=body.amount),
        "order_name": str(payment.get("orderName") or "").strip() or body.order_name.strip() or body.payment_id,
        "member_id": current.id,
        "payment_record_pending": settings.payment_records_enabled,
    }


@router.post("/payments/complete")
def complete_portone_payment(
    body: PortOnePaymentCompleteRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Member, Depends(get_current_member)],
) -> dict:
    payment: dict | None = None
    try:
        payment = _fetch_portone_json(f"/payments/{body.payment_id}")
    except HTTPException:
        payment = None

    try:
        return _finalize_portone_payment(
            db,
            member=current,
            payment_id=body.payment_id,
            expected_amount=body.amount,
            expected_order_name=body.order_name,
            payment=payment,
        )
    except HTTPException as exc:
        if exc.status_code != 409 or payment is None or not _is_portone_payment_paid(payment):
            raise
        logger.warning(
            "payment complete finalize rejected payment_id=%s member_id=%s detail=%s",
            body.payment_id,
            current.id,
            exc.detail,
        )
    except Exception:
        logger.exception(
            "payment complete finalize failed payment_id=%s member_id=%s",
            body.payment_id,
            current.id,
        )

    try:
        if payment is None:
            payment = _fetch_portone_json(f"/payments/{body.payment_id}")
        return _complete_portone_payment_response(body=body, current=current, payment=payment)
    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "payment complete response build failed payment_id=%s member_id=%s",
            body.payment_id,
            current.id,
        )
        if payment is not None and _is_portone_payment_paid(payment):
            return _complete_portone_payment_response(body=body, current=current, payment=payment)
        raise HTTPException(status_code=503, detail="결제 확인 중 오류가 발생했습니다.") from None


@router.post("/push-subscriptions")
def register_push_subscription(
    body: PushSubscriptionRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Member, Depends(get_current_member)],
) -> dict:
    if not body.endpoint.strip() or not body.keys.p256dh.strip() or not body.keys.auth.strip():
        raise HTTPException(status_code=400, detail="유효한 푸시 구독 정보가 필요합니다.")
    try:
        subscription = upsert_member_push_subscription(
            db,
            member=current,
            endpoint=body.endpoint,
            p256dh_key=body.keys.p256dh,
            auth_key=body.keys.auth,
            user_agent=body.user_agent,
        )
    except Exception as exc:
        logger.exception("push subscription register failed for member=%s", current.id)
        raise HTTPException(status_code=503, detail="웹푸시 구독 저장 중 오류가 발생했습니다.") from exc
    return {"subscription_id": subscription.id, "registered": True}


@router.delete("/push-subscriptions")
def unregister_push_subscription(
    body: PushSubscriptionRequest,
    db: Annotated[Session, Depends(get_db)],
    current: Annotated[Member, Depends(get_current_member)],
) -> dict:
    try:
        deactivate_member_push_subscription(db, endpoint=body.endpoint, member=current)
    except Exception as exc:
        logger.exception("push subscription unregister failed for member=%s", current.id)
        raise HTTPException(status_code=503, detail="웹푸시 구독 해제 중 오류가 발생했습니다.") from exc
    return {"unregistered": True}


@router.post("/login", response_model=MemberAuthTokenResponse)
def member_login(body: MemberLoginRequest, db: Annotated[Session, Depends(get_db)]) -> MemberAuthTokenResponse:
    if not settings.jwt_configured:
        raise HTTPException(status_code=503, detail="JWT is not configured")

    from app.services.member_auth import authenticate_member

    started = time.perf_counter()
    try:
        auth_started = time.perf_counter()
        member = authenticate_member(db, email=body.email, password=body.password)
        auth_ms = round((time.perf_counter() - auth_started) * 1000, 1)
    except MemberAuthError as exc:
        raise _auth_error_to_http(exc) from exc

    token_started = time.perf_counter()
    response = _issue_token(member)
    token_ms = round((time.perf_counter() - token_started) * 1000, 1)
    logger.info(
        "member_login_route_timing email=%s auth_ms=%s token_ms=%s total_ms=%s",
        body.email.strip().lower(),
        auth_ms,
        token_ms,
        round((time.perf_counter() - started) * 1000, 1),
    )
    return response
