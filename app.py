"""
OllamaLocloud — serveur web.

- Sert l'interface de discussion (dossier ./static)
- Reverse-proxy transparent vers Ollama (http://127.0.0.1:11434)
  pour les routes /api/* (API native Ollama) et /v1/* (API compatible OpenAI)
- /status : état du service (utilisé par l'interface)

Le streaming (NDJSON) est transmis tel quel : les réponses du modèle
s'affichent en direct dans le navigateur.

Variable d'environnement optionnelle :
  APP_TOKEN   — si définie, toute requête API doit porter l'en-tête
                « X-App-Token: <valeur> » (ou « Authorization: Bearer <valeur> »).
                Permet de protéger un Space public.
  OLLAMA_URL  — URL d'Ollama (défaut : http://127.0.0.1:11434).
  BANNER_TEXT — bandeau d'information affiché en haut de l'interface.
"""

import os

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.background import BackgroundTask
from starlette.staticfiles import StaticFiles

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
APP_TOKEN = os.environ.get("APP_TOKEN", "").strip()
BANNER_TEXT = os.environ.get("BANNER_TEXT", "").strip()
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="OllamaLocloud", docs_url=None, redoc_url=None)

# Client HTTP réutilisé vers Ollama — pas de timeout de lecture :
# la génération d'une longue réponse peut prendre du temps.
client = httpx.AsyncClient(
    base_url=OLLAMA_URL,
    timeout=httpx.Timeout(connect=10.0, read=None, write=120.0, pool=10.0),
)

# En-têtes à ne pas retransmettre (hop-by-hop / encodage géré par nous)
HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "content-encoding", "content-length", "host",
}


def _authorized(request: Request) -> bool:
    """Vrai si APP_TOKEN est désactivée ou si le jeton fourni est correct."""
    if not APP_TOKEN:
        return True
    token = request.headers.get("x-app-token", "").strip()
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    return token == APP_TOKEN


async def _proxy(path: str, request: Request):
    if not _authorized(request):
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


# --- Proxy API Ollama -------------------------------------------------------

@app.api_route("/api/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "OPTIONS"])
async def proxy_api(path: str, request: Request):
    return await _proxy("/api/" + path, request)


@app.api_route("/v1/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "OPTIONS"])
async def proxy_v1(path: str, request: Request):
    return await _proxy("/v1/" + path, request)


# --- État du service ---------------------------------------------------------

@app.get("/status")
async def status():
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


# --- Fichiers statiques (déclaré en dernier : /api et /v1 passent avant) -----

@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
