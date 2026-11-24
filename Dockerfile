# ---- web UI ----
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- runtime ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SERVICEHUB_DATA=/data \
    SERVICEHUB_PORT=8080 \
    TZ=America/Chicago

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates tzdata git curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/servicehub ./servicehub
COPY --from=web /backend/servicehub/static ./servicehub/static

ARG VERSION=dev
ENV SERVICEHUB_VERSION=${VERSION}

VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["python", "-m", "servicehub.main"]
