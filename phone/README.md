# TelWork — 전화상담 PWA

모바일에서 전화 상담을 빠르게 등록·저장하는 Progressive Web App입니다.
데이터는 우선 브라우저 IndexedDB에 저장되며, 이후 서버 DB로 확장하기 쉬운 스키마로 구성되어 있습니다.

## 빠른 시작

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 을 연 뒤, 모바일 화면으로 확인하세요.

PWA 설치(홈 화면 추가)는 **HTTPS** 또는 `localhost`에서 가능합니다.

```bash
npm run build
npm run preview
```

## GitHub `tel_work` 연동

로컬 프로젝트를 이미 만든 GitHub 저장소에 연결합니다.

1. GitHub에서 저장소 URL 확인 (예: `https://github.com/<username>/tel_work.git`)
2. 아래 명령 실행:

```bash
git init
git add .
git commit -m "Initial commit: TelWork phone consultation PWA"
git branch -M main
git remote add origin https://github.com/<username>/tel_work.git
git push -u origin main
```

`gh` CLI가 있다면:

```bash
gh auth login
gh repo view <username>/tel_work
git remote add origin https://github.com/<username>/tel_work.git
git push -u origin main
```

> 저장소가 비어 있지 않다면 `git pull origin main --allow-unrelated-histories` 후 push 하세요.

## 화면 구성

| 화면 | 경로 | 설명 |
|------|------|------|
| 상담 목록 | `/` | 전체/저장중/완료/긴급 필터, 요약 카드 |
| 고객 등록 | `/new` | 와이어프레임 기반 등록 폼 |
| 상담 수정 | `/consultations/:id` | 기존 건 수정 |

### UX 설계 포인트 (모바일)

- **라벨 위 / 입력 아래** 스택 레이아웃 — 한 손 타이핑 폭 확보
- **섹션 분리** — 고객 정보 → 의뢰 내용 → 일정·우선도 → 메모
- **세그먼트 버튼** — 작업 범위 / 파일 형태 / 우선도 (드롭다운보다 탭 비용↓)
- **하단 고정 CTA** — `상담 저장`(임시) / `상담 완료` + safe-area
- **터치 타겟 48px**, `type="tel"` / `datetime-local` 로 모바일 키보드 최적화
- **긴급·우선** 선택 시 색으로 즉시 인지

## 데이터 스키마 (consultations)

| 필드 | 타입 | 설명 |
|------|------|------|
| id | number | PK (auto) |
| customerName | string | 고객 이름 |
| phone | string | 전화번호 |
| inquiryType | string | 문의 유형 |
| purpose | string | 제출 목적 |
| estimatedDuration | string | 예상 분량/시간 |
| workScope | full \| partial \| undecided | 작업 범위 |
| region | string | 지역 |
| deadline | string | 희망 마감일시 |
| fileFormat | audio \| video \| document | 파일 형태 |
| inflowChannel | string | 유입경로 |
| priority | normal \| priority \| urgent | 우선도 |
| memo | string | 상담 메모 |
| status | draft \| completed | 저장 상태 |
| createdAt / updatedAt | ISO string | 타임스탬프 |

현재 저장소: **Dexie (IndexedDB)**. 서버 DB(PostgreSQL 등) 연동 시 동일 필드명을 API로 옮기면 됩니다.

## 스택

- Vite + React + TypeScript
- React Router
- Dexie (IndexedDB)
- vite-plugin-pwa (manifest + service worker)

## 다음 단계 제안

1. GitHub Pages / Vercel / Cloudflare Pages에 배포 (HTTPS → 실기기 설치)
2. Supabase / Firebase / 자체 API로 상담 데이터 동기화
3. 녹음 파일 첨부·업로드 연동
