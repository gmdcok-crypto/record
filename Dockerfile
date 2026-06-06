# PWA build
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS admin-build
WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM node:20-alpine AS transcriber-build
WORKDIR /app/transcriber
COPY transcriber/package.json transcriber/package-lock.json ./
RUN npm ci
COPY transcriber/ ./
RUN npm run build

# API + static files
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY --from=client-build /app/client/dist ./client/dist
COPY --from=admin-build /app/admin/dist ./admin/dist
COPY --from=transcriber-build /app/transcriber/dist ./transcriber/dist

RUN mkdir -p /app/app/assets/fonts \
    && curl -fsSL -o /app/app/assets/fonts/NotoSansKR-Regular.ttf \
        "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@5.2.9/korean-400-normal.ttf" \
    && curl -fsSL -o /app/app/assets/fonts/NotoSansKR-Bold.ttf \
        "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@5.2.9/korean-700-normal.ttf"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
