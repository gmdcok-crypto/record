from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import transcribe, upload

STATIC_DIR = Path(__file__).resolve().parent.parent / "client" / "dist"

app = FastAPI(
    title="Bluecom AI Record API",
    description="음성 파일 녹취록 테스트 API",
    version="0.1.0",
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


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "soniox_configured": bool(settings.soniox_api_key),
        "r2_configured": settings.r2_configured,
        "model": settings.soniox_model,
        "bucket": settings.r2_bucket_name,
    }


if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
