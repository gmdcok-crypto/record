from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.config import settings

ALGORITHM = "HS256"


def create_transcriber_access_token(
    *,
    transcriber_id: int,
    login_id: str,
    transcriber_code: str,
) -> str:
    if not settings.jwt_configured:
        raise RuntimeError("JWT is not configured")

    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(transcriber_id),
        "login_id": login_id,
        "transcriber_code": transcriber_code,
        "role": "transcriber",
        "iat": now,
    }
    if settings.jwt_expire_minutes > 0:
        payload["exp"] = now + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_transcriber_access_token(token: str) -> dict[str, Any]:
    if not settings.jwt_configured:
        raise RuntimeError("JWT is not configured")

    payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    if payload.get("role") != "transcriber":
        raise jwt.InvalidTokenError("Invalid token role")
    return payload


def create_member_access_token(*, member_id: int, email: str) -> str:
    if not settings.jwt_configured:
        raise RuntimeError("JWT is not configured")

    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(member_id),
        "email": email,
        "role": "member",
        "iat": now,
    }
    if settings.jwt_expire_minutes > 0:
        payload["exp"] = now + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_member_access_token(token: str) -> dict[str, Any]:
    if not settings.jwt_configured:
        raise RuntimeError("JWT is not configured")

    payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    if payload.get("role") != "member":
        raise jwt.InvalidTokenError("Invalid token role")
    return payload


def create_payment_prepare_token(
    *,
    member_id: int,
    payment_id: str,
    amount: int,
    order_name: str,
) -> str:
    if not settings.jwt_configured:
        raise RuntimeError("JWT is not configured")

    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(member_id),
        "role": "payment_prepare",
        "payment_id": payment_id,
        "amount": amount,
        "order_name": order_name,
        "iat": now,
        "exp": now + timedelta(minutes=30),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_payment_prepare_token(token: str) -> dict[str, Any]:
    if not settings.jwt_configured:
        raise RuntimeError("JWT is not configured")

    payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    if payload.get("role") != "payment_prepare":
        raise jwt.InvalidTokenError("Invalid token role")
    return payload
