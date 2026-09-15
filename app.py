"""
OllamaLocloud — serveur web pour déploiement Docker / auto-hébergement.

(Pour Hugging Face Spaces gratuit, utilisez plutôt space_app.py.)

Lancement :  uvicorn app:app --host 0.0.0.0 --port 7860
             (ou simplement : python app.py)
"""

import os

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import proxy

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="OllamaLocloud", docs_url=None, redoc_url=None)


# --- Proxy API Ollama -------------------------------------------------------

@app.api_route("/api/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "OPTIONS"])
async def proxy_api(path: str, request: Request):
    return await proxy.proxy_response(request, "/api/" + path)


@app.api_route("/v1/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "OPTIONS"])
async def proxy_v1(path: str, request: Request):
    return await proxy.proxy_response(request, "/v1/" + path)


# --- État du service ---------------------------------------------------------

@app.get("/status")
async def status():
    return await proxy.status_payload()


# --- Fichiers statiques (déclaré en dernier : /api et /v1 passent avant) -----

@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
