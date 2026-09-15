# ---------------------------------------------------------------------------
# OllamaLocloud — Ollama + interface web dans un seul conteneur
# Pour auto-hébergement : VPS, NAS, Oracle Cloud Always Free (ARM), etc.
# (Pour un Hugging Face Space gratuit, utilisez plutôt space_app.py — SDK Gradio)
#
# Multi-architecture : amd64 et arm64 sont gérés automatiquement (BuildKit).
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# Version d'Ollama à installer (modifiable au build : --build-arg OLLAMA_VERSION=vX.Y.Z)
ARG OLLAMA_VERSION=v0.34.0
# amd64 (défaut) ou arm64 — fourni automatiquement par BuildKit
ARG TARGETARCH

ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl zstd \
    && rm -rf /var/lib/apt/lists/*

# --- Installation d'Ollama (méthode officielle du script install.sh) -------
RUN set -eux; \
    arch="${TARGETARCH:-amd64}"; \
    if curl -fsSI --max-time 20 "https://ollama.com/download/ollama-linux-${arch}.tar.zst?version=${OLLAMA_VERSION}" >/dev/null 2>&1; then \
        curl -fsSL "https://ollama.com/download/ollama-linux-${arch}.tar.zst?version=${OLLAMA_VERSION}" \
          | zstd -d | tar -x -C /usr; \
    else \
        curl -fsSL "https://ollama.com/download/ollama-linux-${arch}.tgz?version=${OLLAMA_VERSION}" \
          | tar -xz -C /usr; \
    fi; \
    /usr/bin/ollama --version

# --- Application web -------------------------------------------------------
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py proxy.py start.sh ./
COPY static ./static

# Utilisateur non-root (convention Hugging Face Spaces : uid 1000)
RUN useradd -m -u 1000 appuser \
    && mkdir -p /home/appuser \
    && chown -R appuser:appuser /app /home/appuser
USER appuser
ENV HOME=/home/appuser

# Modèles téléchargés au démarrage (séparés par des virgules) — modifiable
# par variable d'environnement au moment du run.
ENV MODEL_LIST="llama3.2:1b" \
    OLLAMA_HOST="127.0.0.1:11434"

EXPOSE 7860
CMD ["bash", "/app/start.sh"]
