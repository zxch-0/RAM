#!/usr/bin/env python3
"""
Simulateur d'Ollama — UNIQUEMENT pour le développement et les démos.

Imite l'API HTTP d'Ollama (/api/version, /api/tags, /api/pull, /api/chat,
/api/generate, /api/delete) avec des réponses simulées, afin de tester
l'interface sans télécharger de vrai modèle.

Usage :  python3 mock_ollama.py [port]   (défaut : 11434)
Puis :   OLLAMA_URL=http://127.0.0.1:11434 uvicorn app:app --port 7860
"""

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.34.0-simulated"

_lock = threading.Lock()
_installed = ["llama3.2:1b"]  # modèles "présents" au départ


# --- Génération des fausses réponses ----------------------------------------

def _short(text, n=60):
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def make_reply(messages, model):
    user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")

    if any(w in user.lower() for w in ("bonjour", "salut", "hello", "coucou", "hey", "yo")):
        return (
            "Bonjour ! 👋\n\n"
            "Je suis la **réponse simulée** d'OllamaLocloud : ce sandbox de démo n'a pas "
            "accès au registre de modèles d'Ollama, donc aucun vrai modèle n'a pu être "
            "téléchargé ici.\n\n"
            "Une fois déployé sur **Hugging Face Spaces**, cette même interface discutera "
            "avec un vrai modèle (`llama3.2:1b` par défaut) qui tournera *dans le cloud*, "
            "sans utiliser les ressources de votre PC.\n\n"
            "- ✅ Le streaming des réponses fonctionne déjà\n"
            "- ✅ Le rendu **Markdown** aussi\n"
            "- ✅ Et les blocs de code :\n\n"
            "```python\nprint(\"Bonjour depuis le cloud !\")\n```"
        )

    if "qui es-tu" in user.lower() or "présente" in user.lower() or "t'es qui" in user.lower():
        return (
            "Je suis un **simulateur** d'Ollama, pas un vrai modèle de langage. 🎭\n\n"
            "Mon rôle : vous montrer à quoi ressemble OllamaLocloud — l'interface, le "
            "streaming, la gestion des modèles et des conversations — pendant que tout "
            "tourne dans ce sandbox isolé du réseau.\n\n"
            "Pour de vraies réponses : déployez le projet sur Hugging Face Spaces "
            "(gratuit, ~5 minutes, voir le README)."
        )

    if "docker" in user.lower():
        return (
            "Bonne question ! Voici l'idée en trois points :\n\n"
            "1. **Un conteneur** embarque Ollama + le serveur web dans une seule image.\n"
            "2. **Hugging Face Spaces** exécute ce conteneur gratuitement (2 vCPU, 16 Go de RAM).\n"
            "3. **Votre navigateur** dialogue avec le modèle via un reverse-proxy — votre PC "
            "ne calcule rien.\n\n"
            "```bash\n# C'est tout ce qu'il faut faire :\ngit push space main\n```\n\n"
            "*(Réponse simulée, fournie à titre d'illustration.)*"
        )

    if "?" in user:
        return (
            f"Excellente question concernant « {_short(user)} » !\n\n"
            "En mode démo simulée, je ne peux pas vraiment y répondre — mais voici ce qui "
            "se passera avec un vrai modèle déployé sur Hugging Face :\n\n"
            "- une réponse rédigée par le modèle choisi,\n"
            "- en streaming, token par token,\n"
            "- avec le même rendu Markdown que ces lignes.\n\n"
            "Pour lancer la vraie version, suivez le guide du **README.md** 😉"
        )

    return (
        f"Noté : « {_short(user)} ».\n\n"
        "Je ne suis qu'une simulation, mais l'interface, elle, est bien réelle : "
        "essayez le bouton **🧩 Modèles** ou le menu ⚙️ **Réglages** pour voir les "
        "autres fonctionnalités. Le déploiement sur Hugging Face Spaces activera le "
        "vrai Ollama."
    )


# --- Serveur HTTP ------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # silence

    # -- utilitaires ----------------------------------------------------------

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _stream(self, events, delay=0.03):
        """Envoie une suite d'objets JSON en NDJSON (comme Ollama)."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        for ev in events:
            data = (json.dumps(ev, ensure_ascii=False) + "\n").encode("utf-8")
            self.wfile.write(("%x\r\n" % len(data)).encode() + data + b"\r\n")
            self.wfile.flush()
            time.sleep(delay)
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    # -- routes ---------------------------------------------------------------

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/version":
            self._json({"version": VERSION})
        elif path == "/api/tags":
            with _lock:
                models = [
                    {"name": m, "model": m, "size": 1_312_000_000,
                     "digest": "simulated", "modified_at": "2026-01-01T00:00:00Z",
                     "details": {"family": "simulated", "parameter_size": "1B"}}
                    for m in _installed
                ]
            self._json({"models": models})
        else:
            self._json({"error": f"route inconnue : {path}"}, 404)

    def do_POST(self):
        path = self.path.split("?")[0]
        data = self._read_body()

        if path == "/api/pull":
            name = data.get("name", "inconnu")
            total = 1_312_000_000
            events = [{"status": "pulling manifest"}]
            for pct in (2, 11, 23, 37, 52, 68, 83, 94, 100):
                events.append({
                    "status": f"downloading {name}",
                    "digest": "sha256:simulated",
                    "total": total,
                    "completed": int(total * pct / 100),
                })
            events.append({"status": "verifying sha256 digest"})
            events.append({"status": "writing manifest"})
            events.append({"status": "success"})
            with _lock:
                if name not in _installed:
                    _installed.append(name)
            self._stream(events, delay=0.35)
            return

        if path == "/api/chat":
            model = data.get("model", "simulé")
            reply = make_reply(data.get("messages", []), model)
            events = []
            # On découpe mot par mot pour imiter le streaming d'un vrai modèle
            words = reply.split(" ")
            for i, w in enumerate(words):
                sep = " " if i < len(words) - 1 else ""
                events.append({"model": model, "created_at": "2026-01-01T00:00:00Z",
                               "message": {"role": "assistant", "content": w + sep},
                               "done": False})
            events.append({"model": model, "created_at": "2026-01-01T00:00:00Z",
                           "message": {"role": "assistant", "content": ""},
                           "done": True,
                           "done_reason": "stop",
                           "eval_count": len(words), "eval_duration": 1_000_000_000})
            self._stream(events, delay=0.045)
            return

        if path == "/api/generate":
            model = data.get("model", "simulé")
            reply = make_reply([{"role": "user", "content": data.get("prompt", "")}], model)
            events = []
            words = reply.split(" ")
            for i, w in enumerate(words):
                sep = " " if i < len(words) - 1 else ""
                events.append({"model": model, "response": w + sep, "done": False})
            events.append({"model": model, "response": "", "done": True, "done_reason": "stop"})
            self._stream(events, delay=0.045)
            return

        self._json({"error": f"route inconnue : {path}"}, 404)

    def do_DELETE(self):
        path = self.path.split("?")[0]
        if path == "/api/delete":
            name = self._read_body().get("name", "")
            with _lock:
                if name in _installed:
                    _installed.remove(name)
            self._json({"status": "ok"})
            return
        self._json({"error": "route inconnue"}, 404)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11434
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f">>> [mock_ollama] Simulateur Ollama sur http://127.0.0.1:{port}")
    server.serve_forever()
