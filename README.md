# Bluecom AI Record — 녹취록 테스트 API

Railway에 배포하여 Soniox AI로 음성→텍스트 변환을 테스트하는 FastAPI 백엔드입니다.

## 로컬 실행

```powershell
cd D:\record
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# .env 에 SONIOX_API_KEY 입력
uvicorn app.main:app --reload
```

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/health` | 서버 상태 확인 |
| POST | `/api/test/transcribe` | 음성 파일 업로드 → 녹취록 변환 |

### 녹취 테스트 (curl)

```powershell
curl -X POST "http://localhost:8000/api/test/transcribe" `
  -F "file=@sample.wav"
```

응답 예시:

```json
{
  "status": "AI_DONE",
  "transcript_json": {
    "transcription_id": "...",
    "filename": "sample.wav",
    "text": "변환된 전체 텍스트",
    "tokens": [
      {"text": "안녕", "start_ms": 0, "end_ms": 500, "speaker": null}
    ]
  }
}
```

## Railway 배포

1. [Soniox Console](https://console.soniox.com)에서 API Key 발급
2. Railway → **New Project** → GitHub `record` repo 연결
3. **Variables** 설정:
   - `SONIOX_API_KEY` — 필수
   - `SONIOX_MODEL` — 기본값 `stt-async-v4`
   - `LANGUAGE_HINTS` — 기본값 `ko`
4. Deploy 후 `/health` 로 상태 확인
5. `/api/test/transcribe` 로 음성 파일 테스트

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `SONIOX_API_KEY` | O | Soniox API 키 |
| `SONIOX_MODEL` | X | STT 모델 (기본: stt-async-v4) |
| `LANGUAGE_HINTS` | X | 언어 힌트, 쉼표 구분 (기본: ko) |

## 지원 파일 형식

wav, mp3, m4a, flac, ogg, webm, mp4
