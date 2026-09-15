#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Démarre Ollama en arrière-plan, télécharge les modèles demandés,
# puis lance le serveur web sur 0.0.0.0:${PORT:-7860}.
# ---------------------------------------------------------------------------
set -e

PORT="${PORT:-7860}"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"

# Stockage persistant Hugging Face (option payante) : si /data existe, on l'utilise.
if [ -d /data ]; then
  export OLLAMA_MODELS="/data/ollama"
fi
export OLLAMA_MODELS="${OLLAMA_MODELS:-$HOME/.ollama/models}"
mkdir -p "$OLLAMA_MODELS"

echo ">>> [OllamaLocloud] Démarrage d'Ollama (modèles : $OLLAMA_MODELS)"
ollama serve &
OLLAMA_PID=$!

# On attend qu'Ollama réponde (max ~2 min)
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:11434/api/version" >/dev/null 2>&1; then
  echo "!!! [OllamaLocloud] Ollama n'a pas démarré — le serveur web démarre quand même."
fi
echo ">>> [OllamaLocloud] Ollama est prêt."

# Téléchargement des modèles en arrière-plan : le site répond immédiatement,
# l'interface affiche la progression.
if [ -n "$MODEL_LIST" ]; then
  (
    for m in ${MODEL_LIST//,/ }; do
      m=$(echo "$m" | xargs)
      [ -z "$m" ] && continue
      echo ">>> [OllamaLocloud] Téléchargement du modèle : $m"
      ollama pull "$m" || echo "!!! [OllamaLocloud] Échec du téléchargement de $m"
    done
    echo ">>> [OllamaLocloud] Téléchargement des modèles terminé."
  ) &
fi

echo ">>> [OllamaLocloud] Serveur web sur http://0.0.0.0:$PORT"
exec uvicorn app:app --host 0.0.0.0 --port "$PORT"
