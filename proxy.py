"""
OllamaLocloud — logique de proxy vers Ollama, partagée entre :
  - app.py      (déploiement Docker / auto-hébergement, serveur FastAPI)
  - space_app.py (Hugging Face Spaces SDK Gradio, hardware ZeroGPU gratuit)

Tout le trafic /api/* (API native Ollama) et /v1/* (API compatible OpenAI)
est transmis tel quel à Ollama, y compris le streaming NDJSON.

Variables d'environnement :
  OLLAMA_URL  — URL d'Ollama (défaut : http://127.0.0.1:11434)
  APP_TOKEN   — si définie, requiert l'en-tête « X-App-Token: <valeur> »
  BANNER_TEXT — bandeau d'information affiché par l'interface
"""

import os

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
BANNER_TEXT = os.environ.get("BANNER_TEXT", "").strip()

# Client HTTP réutilisé — pas de timeout de lecture : une longue génération
# peut durer plusieurs minutes.
client = httpx.AsyncClient(
    base_url=OLLAMA_URL,
    timeout=httpx.Timeout(connect=10.0, read=None, write=120.0, pool=10.0),
)

# En-têtes à ne pas retransmettre (hop-by-hop / encodage géré par le proxy)
HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "content-encoding", "content-length", "host",
}


def authorized(request: Request) -> bool:
    """Vrai si APP_TOKEN est désactivée ou si le jeton fourni est correct."""
    if not APP_TOKEN:
        return True
    token = request.headers.get("x-app-token", "").strip()
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    return token == APP_TOKEN


async def proxy_response(request: Request, path: str):
    """Transmet la requête à Ollama et retourne sa réponse (streaming inclus)."""
    if not authorized(request):
        return JSONResponse(
            {"error": "Clé d'accès absente ou invalide."},
            status_code=401,
        )

    body = await request.body()
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}

    req = client.build_request(
        request.method, path, params=request.query_params,
        content=body, headers=headers,
    )
    try:
        resp = await client.send(req, stream=True)
    except httpx.ConnectError:
        return JSONResponse(
            {"error": "Ollama n'est pas encore démarré. Réessayez dans quelques secondes."},
            status_code=503,
        )

    resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in HOP_HEADERS}
    return StreamingResponse(
        resp.aiter_raw(),
        status_code=resp.status_code,
        headers=resp_headers,
        background=BackgroundTask(resp.aclose),
    )


async def status_payload() -> dict:
    """État du service, consommé par l'interface (page de démarrage, badge…)."""
    version = None
    try:
        r = await client.get("/api/version", timeout=3.0)
        if r.status_code == 200:
            version = r.json().get("version")
    except Exception:
        pass
    return {
        "ollama_up": version is not None,
        "ollama_version": version,
        "token_required": bool(APP_TOKEN),
        "banner": BANNER_TEXT,
    }
