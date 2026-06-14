from __future__ import annotations

import json
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from typing import Literal

from app.config import settings
from app.models.admin_models import Job, Member, Transcriber
from app.services.job_inquiries import THREAD_CLIENT_ADMIN, THREAD_TRANSCRIBER_ADMIN

logger = logging.getLogger(__name__)
CHANNEL_TALK_API_BASE = "https://api.channel.io/open/v5"

ThreadType = Literal["client_admin", "transcriber_admin"]
SenderRole = Literal["client", "transcriber", "admin"]


def inquiry_notifications_enabled() -> bool:
    return settings.channel_talk_notifications_enabled


def channel_talk_api_configured() -> bool:
    return bool(settings.channel_talk_api_key.strip() and settings.channel_talk_api_secret.strip())


def member_channel_talk_id(member: Member) -> str:
    return f"member-{member.id}"


def _trim_preview(message: str) -> str:
    text = " ".join((message or "").split())
    limit = max(20, int(settings.channel_talk_message_preview_limit or 120))
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _admin_deep_link(job_id: str) -> str:
    base = settings.public_admin_url.rstrip("/")
    return f"{base}?job_id={job_id}&panel=inquiry" if base else ""


def _client_deep_link(job_id: str) -> str:
    base = settings.public_client_url.rstrip("/")
    return f"{base}?job_id={job_id}&panel=inquiry" if base else ""


def _transcriber_deep_link(job_id: str) -> str:
    base = settings.public_transcriber_url.rstrip("/")
    return f"{base}?job_id={job_id}&panel=inquiry" if base else ""


def _status_deep_link(job_id: str) -> str:
    base = settings.public_client_url.rstrip("/")
    return f"{base}?job_id={job_id}" if base else ""


def _target_descriptor(
    *,
    thread_type: ThreadType,
    sender_role: SenderRole,
    member: Member | None,
    transcriber: Transcriber | None,
) -> tuple[str, str]:
    if thread_type == THREAD_CLIENT_ADMIN:
        if sender_role == "client":
            return "admin", _admin_deep_link
        return "client", _client_deep_link
    if sender_role == "transcriber":
        return "admin", _admin_deep_link
    return "transcriber", _transcriber_deep_link


def build_inquiry_notification_payload(
    *,
    job: Job,
    thread_type: ThreadType,
    sender_role: SenderRole,
    sender_name: str,
    message: str,
    member: Member | None = None,
    transcriber: Transcriber | None = None,
) -> dict:
    target_role, link_factory = _target_descriptor(
        thread_type=thread_type,
        sender_role=sender_role,
        member=member,
        transcriber=transcriber,
    )
    if thread_type == THREAD_CLIENT_ADMIN:
        title = "의뢰인 문의 도착" if sender_role == "client" else "문의 답변 도착"
    else:
        title = "속기사 문의 도착" if sender_role == "transcriber" else "문의 답변 도착"

    return {
        "title": title,
        "target_role": target_role,
        "job_id": job.job_id,
        "project_id": job.project_id,
        "project_title": job.project.title if job.project else None,
        "file_name": job.original_filename,
        "thread_type": thread_type,
        "sender_role": sender_role,
        "sender_name": sender_name,
        "message_preview": _trim_preview(message),
        "deep_link_url": link_factory(job.job_id),
        "admin_inbox_id": settings.channel_talk_admin_inbox_id.strip(),
        "admin_user_id": settings.channel_talk_admin_user_id.strip(),
        "admin_tag": settings.channel_talk_admin_tag.strip(),
    }


def _channel_talk_request(method: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        url=f"{CHANNEL_TALK_API_BASE}{path}",
        data=body,
        method=method,
        headers={
            "x-access-key": settings.channel_talk_api_key.strip(),
            "x-access-secret": settings.channel_talk_api_secret.strip(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Channel Talk API {method} {path} failed: {exc.code} {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Channel Talk API {method} {path} failed: {exc.reason}") from exc

    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Channel Talk API {method} {path} returned invalid JSON") from exc


def _extract_id(payload: dict, *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            nested = value.get("id")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
    return ""


def _upsert_channel_talk_user(member: Member) -> str:
    response = _channel_talk_request(
        "PUT",
        f"/users/@{quote(member_channel_talk_id(member), safe='')}",
        {
            "profile": {
                "name": member.name.strip(),
                "email": member.email.strip(),
            }
        },
    )
    user_id = _extract_id(response, "user", "id")
    if not user_id:
        raise RuntimeError("Channel Talk user upsert did not return a user id")
    return user_id


def _list_user_chats(user_id: str) -> list[dict]:
    response = _channel_talk_request("GET", f"/users/{quote(user_id, safe='')}/user-chats?sortOrder=desc&limit=1")
    chats = response.get("userChats")
    return chats if isinstance(chats, list) else []


def _create_user_chat(user_id: str) -> str:
    response = _channel_talk_request("POST", f"/users/{quote(user_id, safe='')}/user-chats", {})
    chat_id = _extract_id(response, "userChat", "id")
    if not chat_id:
        raise RuntimeError("Channel Talk user chat creation did not return a chat id")
    return chat_id


def _ensure_user_chat(member: Member) -> str:
    user_id = _upsert_channel_talk_user(member)
    chats = _list_user_chats(user_id)
    if chats:
        chat_id = _extract_id(chats[0], "id")
        if chat_id:
            return chat_id
    return _create_user_chat(user_id)


def _send_user_chat_message(user_chat_id: str, message: str) -> None:
    _channel_talk_request(
        "POST",
        f"/user-chats/{quote(user_chat_id, safe='')}/messages",
        {"message": message},
    )


def _compose_notification_message(title: str, lines: list[str], deep_link_url: str = "") -> str:
    body = [title.strip()]
    body.extend(line.strip() for line in lines if line and line.strip())
    if deep_link_url.strip():
        body.extend(["", deep_link_url.strip()])
    return "\n".join(body)


def send_member_channel_talk_notification(*, member: Member, title: str, lines: list[str], deep_link_url: str = "") -> None:
    if not inquiry_notifications_enabled() or not channel_talk_api_configured():
        return
    message = _compose_notification_message(title, lines, deep_link_url=deep_link_url)
    user_chat_id = _ensure_user_chat(member)
    _send_user_chat_message(user_chat_id, message)


def send_client_status_notification(*, job: Job, member: Member, status: str, note: str | None = None) -> None:
    status_text = {
        "assigned": "작업이 배정되었습니다.",
        "working": "작업이 시작되었습니다.",
        "first_done": "초벌본이 도착했습니다.",
        "review_waiting": "속기사 재검토가 진행 중입니다.",
        "final_done": "최종본이 확정되었습니다.",
        "pdf_sent": "PDF가 전달되었습니다.",
    }.get(status)
    if not status_text:
        return
    title = "작업 상태 안내"
    project_title = job.project.title if job.project and job.project.title else None
    lines = [
        f"문서: {job.original_filename}",
        f"상태: {status_text}",
    ]
    if project_title:
        lines.insert(0, f"프로젝트: {project_title}")
    if note and note.strip():
        lines.append(f"안내: {note.strip()}")
    send_member_channel_talk_notification(
        member=member,
        title=title,
        lines=lines,
        deep_link_url=_status_deep_link(job.job_id),
    )


def send_client_pdf_delivery_notification(*, job: Job, member: Member, delivery_mode: str) -> None:
    mode_text = "통합본" if delivery_mode == "bundle" else "개별본"
    lines = [
        f"문서: {job.original_filename}",
        f"전달 형식: {mode_text} PDF",
        "보관함에서 바로 확인하고 다운로드할 수 있습니다.",
    ]
    if job.project and job.project.title:
        lines.insert(0, f"프로젝트: {job.project.title}")
    send_member_channel_talk_notification(
        member=member,
        title="PDF 전달 안내",
        lines=lines,
        deep_link_url=_status_deep_link(job.job_id),
    )


def send_inquiry_notification(
    *,
    job: Job,
    thread_type: ThreadType,
    sender_role: SenderRole,
    sender_name: str,
    message: str,
    member: Member | None = None,
    transcriber: Transcriber | None = None,
) -> None:
    if not inquiry_notifications_enabled():
        return

    payload = build_inquiry_notification_payload(
        job=job,
        thread_type=thread_type,
        sender_role=sender_role,
        sender_name=sender_name,
        message=message,
        member=member,
        transcriber=transcriber,
    )

    if payload["target_role"] != "client" or member is None or not channel_talk_api_configured():
        logger.info("Channel Talk inquiry notification queued: %s", payload)
        return

    send_member_channel_talk_notification(
        member=member,
        title=payload["title"],
        lines=[
            f"문서: {job.original_filename}",
            f"{sender_name}: {payload['message_preview']}",
            "의뢰인 화면에서 문의 내용을 확인해 주세요.",
        ],
        deep_link_url=payload["deep_link_url"],
    )
