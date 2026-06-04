# Bluecom AI Record — 녹취록 테스트 API

Railway에 배포하여 Soniox AI로 음성→텍스트 변환을 테스트하는 FastAPI 백엔드 + 의뢰인 / 관리자 / 속기사 화면입니다.

## 구조

```
record/
├── app/          # FastAPI 백엔드
├── client/       # 의뢰인 화면
├── admin/        # 관리자 화면
└── transcriber/  # 속기사 화면
```

## 백엔드 로컬 실행

```powershell
cd D:\record
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# .env 에 SONIOX_API_KEY, R2 설정 입력
uvicorn app.main:app --reload
```

## 프론트 로컬 실행

```powershell
cd D:\record\client
npm install
copy .env.example .env
# .env 에 VITE_API_URL=https://your-app.up.railway.app
npm run dev
```

브라우저에서 `http://localhost:5173` 접속

관리자 화면:

```powershell
cd D:\record\admin
npm install
copy .env.example .env
npm run dev
```

속기사 화면:

```powershell
cd D:\record\transcriber
npm install
copy .env.example .env
npm run dev
```

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/health` | 서버·R2 상태 확인 |
| POST | `/api/upload/presign` | R2 Pre-signed URL 발급 |
| POST | `/api/test/transcribe` | 음성 파일 직접 업로드 → Soniox 변환 |

## SQL 초안

- 관리자 기능용 MySQL 스키마 초안: `scripts/init_admin_schema.sql`
- 예전 녹취 이력 테이블 참고용 스크립트: `scripts/init_transcript_history.sql`

### Pre-signed URL 발급

```json
POST /api/upload/presign
{ "filename": "sample.wav", "content_type": "audio/wav" }
```

응답:

```json
{
  "job_id": "uuid",
  "object_key": "voice/uuid/sample.wav",
  "upload_url": "https://...",
  "expires_in": 3600,
  "bucket": "record"
}
```

클라이언트는 `upload_url`로 **PUT** 업로드합니다.

## R2 CORS 설정 (필수)

PWA가 R2에 직접 업로드하려면 Cloudflare R2 버킷 CORS를 설정해야 합니다.

Cloudflare Dashboard → R2 → `record` 버킷 → Settings → CORS:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://your-pwa-domain.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Railway 배포 (백엔드)

1. [Soniox Console](https://console.soniox.com)에서 API Key 발급
2. Cloudflare R2 API Token 발급 (Account ID, Access Key, Secret Key)
3. Railway → GitHub `record` repo 연결
4. **Variables** 설정:

| 변수 | 설명 |
|------|------|
| `SONIOX_API_KEY` | Soniox API 키 |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Key |
| `R2_BUCKET_NAME` | `record` |
| `R2_VOICE_PREFIX` | `voice/` |
| `R2_TEXT_PREFIX` | `text/` |

5. Deploy 후 `/health` → `r2_configured: true` 확인

## PWA 배포 (선택)

`client/`, `admin/`, `transcriber/` 각각 빌드 후 Cloudflare Pages, Vercel, Netlify 등에 배포:

```powershell
cd client
npm run build
# dist/ 폴더 배포, VITE_API_URL 은 빌드 시 Railway URL로 설정
```

## 지원 파일 형식

wav, mp3, m4a, flac, ogg, webm, mp4
