# ---------------------------------------------------------------------------
# OllamaLocloud — Ollama + interface web dans un seul conteneur
# Prêt pour Hugging Face Spaces (Docker, CPU basic gratuit, port 7860)
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# Version d'Ollama à installer (modifiable au build : --build-arg OLLAMA_VERSION=vX.Y.Z)
ARG OLLAMA_VERSION=v0.34.0
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl zstd \
    && rm -rf /var/lib/apt/lists/*

# --- Installation d'Ollama (méthode officielle du script install.sh) -------
RUN set -eux; \
    if curl -fsSI --max-time 20 "https://ollama.com/download/ollama-linux-amd64.tar.zst?version=${OLLAMA_VERSION}" >/dev/null 2>&1; then \
        curl -fsSL "https://ollama.com/download/ollama-linux-amd64.tar.zst?version=${OLLAMA_VERSION}" \
          | zstd -d | tar -x -C /usr; \
    else \
        curl -fsSL "https://ollama.com/download/ollama-linux-amd64.tgz?version=${OLLAMA_VERSION}" \
          | tar -xz -C /usr; \
    fi; \
    /usr/bin/ollama --version

# --- Application web -------------------------------------------------------
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py start.sh ./
COPY static ./static

# Utilisateur non-root (convention Hugging Face Spaces : uid 1000)
RUN useradd -m -u 1000 appuser \
    && mkdir -p /home/appuser \
    && chown -R appuser:appuser /app /home/appuser
USER appuser
ENV HOME=/home/appuser

# Modèles téléchargés au démarrage (séparés par des virgules) — modifiable
# dans les variables d'environnement du Space.
ENV MODEL_LIST="llama3.2:1b" \
    OLLAMA_HOST="127.0.0.1:11434"

EXPOSE 7860
CMD ["bash", "/app/start.sh"]
