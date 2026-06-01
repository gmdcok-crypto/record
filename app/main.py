from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import transcribe

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


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "soniox_configured": bool(settings.soniox_api_key),
        "model": settings.soniox_model,
    }
