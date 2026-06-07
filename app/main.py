import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import SessionLocal, create_tables, get_engine, init_db
from app.services.database_migrate import run_startup_migrations
from app.services.database_reset import purge_all_data
from app.routers import jobs, transcribe, transcriber_auth, upload

STATIC_DIR = Path(__file__).resolve().parent.parent / "client" / "dist"
ADMIN_DIR = Path(__file__).resolve().parent.parent / "admin" / "dist"
TRANSCRIBER_DIR = Path(__file__).resolve().parent.parent / "transcriber" / "dist"
INTRO_DIR = Path(__file__).resolve().parent.parent / "intro"

logger = logging.getLogger(__name__)


def _bootstrap_database() -> None:
    if not settings.database_configured:
        return
    try:
        init_db(settings.resolved_database_url)
        create_tables()
        db_engine = get_engine()
        if db_engine is not None:
            if settings.purge_db_on_startup.lower() in {"1", "true", "yes"}:
                purge_all_data(db_engine)
            run_startup_migrations(db_engine)
    except Exception:
        logger.exception("Database startup tasks failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap_task = asyncio.create_task(asyncio.to_thread(_bootstrap_database))
    yield
    bootstrap_task.cancel()
    with suppress(asyncio.CancelledError):
        await bootstrap_task


app = FastAPI(
    title="Bluecom AI Record API",
    description="음성 파일 녹취록 테스트 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transcribe.router)
app.include_router(upload.router)
app.include_router(transcriber_auth.router)
app.include_router(jobs.router)


@app.get("/health", include_in_schema=False)
def health() -> dict:
    return {
        "status": "ok",
        "soniox_configured": bool(settings.soniox_api_key),
        "r2_configured": settings.r2_configured,
        "model": settings.soniox_model,
        "speaker_diarization": settings.soniox_enable_speaker_diarization,
        "bucket": settings.r2_bucket_name,
        "database_configured": settings.database_configured,
        "database_ready": SessionLocal is not None,
    }


@app.get("/admin")
def admin_root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/admin/")


@app.get("/transcriber")
def transcriber_root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/transcriber/")


if ADMIN_DIR.is_dir():
    app.mount("/admin", StaticFiles(directory=ADMIN_DIR, html=True), name="admin")

if TRANSCRIBER_DIR.is_dir():
    app.mount("/transcriber", StaticFiles(directory=TRANSCRIBER_DIR, html=True), name="transcriber")

if INTRO_DIR.is_dir():
    app.mount("/intro", StaticFiles(directory=INTRO_DIR, html=True), name="intro")

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
