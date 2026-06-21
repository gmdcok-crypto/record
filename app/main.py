import asyncio
import hashlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.db import SessionLocal, ensure_db_initialized, get_engine
from app.services.database_migrate import ensure_expense_tables_on_engine, ensure_jobs_status_column, run_startup_migrations
from app.services.database_reset import purge_all_data
from app.routers import admin_auth, admin_users, expenses, jobs, member_auth, projects, transcribe, transcriber_auth, upload

STATIC_DIR = Path(__file__).resolve().parent.parent / "client" / "dist"
ADMIN_DIR = Path(__file__).resolve().parent.parent / "admin" / "dist"
TRANSCRIBER_DIR = Path(__file__).resolve().parent.parent / "transcriber" / "dist"
INTRO_DIR = Path(__file__).resolve().parent.parent / "intro"

logger = logging.getLogger(__name__)


class RailwayHealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health":
            return JSONResponse(
                {
                    "status": "ok",
                    "database_configured": settings.database_configured,
                    "database_ready": SessionLocal is not None,
                }
            )
        return await call_next(request)


class NoCacheHtmlStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        content_type = response.headers.get("content-type", "")
        should_disable_cache = "text/html" in content_type or path in {
            "sw.js",
            "registerSW.js",
            "manifest.webmanifest",
        }
        if should_disable_cache:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


def _bootstrap_database() -> None:
    if not settings.database_configured:
        return
    try:
        ensure_db_initialized()
    except Exception:
        logger.exception("Database initialization failed")

    db_engine = get_engine()
    if db_engine is None:
        return

    try:
        ensure_jobs_status_column(db_engine)
        if settings.purge_db_on_startup.lower() in {"1", "true", "yes"}:
            purge_all_data(db_engine)
        run_startup_migrations(db_engine)
        ensure_expense_tables_on_engine(db_engine)
        ensure_jobs_status_column(db_engine)
    except Exception:
        logger.exception("Database startup tasks failed")

    if SessionLocal is None:
        return

    try:
        db = SessionLocal()
        try:
            from app.services.admin_auth import ensure_admin_bootstrap_password
            from app.services.expense_store import ensure_default_expense_data, ensure_expense_storage

            ensure_admin_bootstrap_password(db)
            ensure_default_expense_data(db)
            ensure_expense_storage(db)
        finally:
            db.close()
    except Exception:
        logger.exception("Default admin bootstrap failed")


def _frontend_version(directory: Path) -> str | None:
    index_path = directory / "index.html"
    if not index_path.is_file():
        return None
    try:
        return hashlib.sha256(index_path.read_bytes()).hexdigest()[:16]
    except OSError:
        logger.exception("Failed to compute frontend version for %s", directory)
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(_bootstrap_database)
    yield


app = FastAPI(
    title="Bluecom AI Record API",
    description="음성 파일 녹취록 테스트 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RailwayHealthMiddleware)

app.include_router(transcribe.router)
app.include_router(upload.router)
app.include_router(transcriber_auth.router)
app.include_router(admin_auth.router)
app.include_router(admin_users.router)
app.include_router(member_auth.router)
app.include_router(jobs.router)
app.include_router(projects.router)
app.include_router(expenses.router)


@app.get("/health", include_in_schema=False)
def health() -> dict:
    db_ready = SessionLocal is not None
    return {
        "status": "ok",
        "soniox_configured": bool(settings.soniox_api_key),
        "r2_configured": settings.r2_configured,
        "model": settings.soniox_model,
        "speaker_diarization": settings.soniox_enable_speaker_diarization,
        "bucket": settings.r2_bucket_name,
        "database_configured": settings.database_configured,
        "database_ready": db_ready,
    }


@app.get("/admin")
def admin_root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/admin/")


@app.get("/transcriber")
def transcriber_root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/transcriber/")


@app.get("/api/transcriber/version")
def transcriber_frontend_version() -> dict[str, str | None]:
    return {"version": _frontend_version(TRANSCRIBER_DIR)}


@app.get("/api/client/version")
def client_frontend_version() -> dict[str, str | None]:
    return {"version": _frontend_version(STATIC_DIR)}


@app.get("/api/public-config")
def public_config() -> dict[str, str | bool]:
    return {
        "channelTalkPluginKey": settings.channel_talk_plugin_key.strip(),
        "webPushEnabled": bool(
            settings.web_push_enabled
            and settings.web_push_vapid_public_key.strip()
            and settings.web_push_vapid_private_key.strip()
            and settings.web_push_subject.strip()
        ),
        "webPushVapidPublicKey": settings.web_push_vapid_public_key.strip(),
        "portoneStoreId": settings.portone_store_id.strip(),
        "portonePaymentChannelKey": settings.portone_payment_channel_key.strip(),
        "portoneIdentityChannelKey": settings.portone_identity_channel_key.strip(),
        "portoneEnv": settings.portone_env.strip(),
        "portonePaymentEnabled": settings.portone_payment_enabled,
        "portoneIdentityEnabled": settings.portone_identity_enabled,
    }


if ADMIN_DIR.is_dir():
    app.mount("/admin", NoCacheHtmlStaticFiles(directory=ADMIN_DIR, html=True), name="admin")

if TRANSCRIBER_DIR.is_dir():
    app.mount("/transcriber", NoCacheHtmlStaticFiles(directory=TRANSCRIBER_DIR, html=True), name="transcriber")

if INTRO_DIR.is_dir():
    app.mount("/intro", NoCacheHtmlStaticFiles(directory=INTRO_DIR, html=True), name="intro")

if STATIC_DIR.is_dir():
    app.mount("/", NoCacheHtmlStaticFiles(directory=STATIC_DIR, html=True), name="frontend")
