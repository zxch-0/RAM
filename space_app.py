"""
OllamaLocloud — point d'entrée pour Hugging Face Spaces (SDK Gradio).

★★★ DÉPLOIEMENT GRATUIT ★★★
Sur un Space Gradio avec le hardware « ZeroGPU » (hébergeable gratuitement,
2 Spaces max par compte gratuit) : le quota GPU quotidien n'est consommé que
par les fonctions décorées @spaces.GPU. Ollama tourne ici en CPU et n'en
consomme donc pas — le GPU n'est même pas utilisé.

Au démarrage (pendant que l'interface répond déjà) :
  1. télécharge le binaire Ollama (~5 Go extraits, une fois par démarrage à froid)
  2. lance `ollama serve` en arrière-plan (127.0.0.1:11434)
  3. télécharge les modèles listés dans MODEL_LIST
  4. sert l'interface à /chat et proxyfie /api/* + /v1/* vers Ollama

Variables d'environnement (Space → Settings → Variables and secrets) :
  MODEL_LIST      modèles à télécharger, séparés par des virgules (défaut llama3.2:1b)
  APP_TOKEN       clé d'accès optionnelle (à définir en Secret)
  OLLAMA_VERSION  version du binaire Ollama (défaut v0.34.0)
  SKIP_OLLAMA_SETUP  =1 pour dev local avec un Ollama/simulateur déjà lancé
"""

import json
import os
import platform
import signal
import subprocess
import tarfile
import threading
import time

import gradio as gr
import httpx
import zstandard
from fastapi import Request
from fastapi.responses import FileResponse

import proxy

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
RUNTIME_DIR = os.environ.get("OLLAMA_RUNTIME_DIR", os.path.join(HOME, "ollama-runtime"))
MODELS_DIR = os.environ.get("OLLAMA_MODELS", os.path.join(HOME, "ollama-models"))
STATIC_DIR = os.path.join(BASE_DIR, "static")

OLLAMA_VERSION = os.environ.get("OLLAMA_VERSION", "v0.34.0")
MODEL_LIST = [m.strip() for m in os.environ.get("MODEL_LIST", "llama3.2:1b").split(",") if m.strip()]


def log(msg: str):
    print(f">>> [OllamaLocloud] {msg}", flush=True)


# ============================================================================
# 1. Installation et lancement d'Ollama (thread de fond)
# ============================================================================

def _arch() -> str:
    machine = platform.machine().lower()
    return {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(machine, "amd64")


def download_ollama() -> str:
    """Télécharge et extrait le binaire Ollama. Retourne le chemin de l'exécutable."""
    bin_path = os.path.join(RUNTIME_DIR, "bin", "ollama")
    if os.path.exists(bin_path):
        return bin_path

    arch = _arch()
    urls = [
        f"https://ollama.com/download/ollama-linux-{arch}.tar.zst?version={OLLAMA_VERSION}",
        f"https://github.com/ollama/ollama/releases/download/{OLLAMA_VERSION}/ollama-linux-{arch}.tar.zst",
    ]
    os.makedirs(RUNTIME_DIR, exist_ok=True)
    archive = os.path.join(RUNTIME_DIR, "ollama.tar.zst")
    t0 = time.time()

    for url in urls:
        try:
            log(f"Téléchargement d'Ollama ({arch}) : {url}")
            with httpx.stream("GET", url, follow_redirects=True,
                              timeout=httpx.Timeout(connect=15.0, read=None, write=60.0, pool=60.0)) as r:
                if r.status_code != 200:
                    log(f"  HTTP {r.status_code} — essai de l'URL suivante")
                    continue
                total = int(r.headers.get("content-length") or 0)
                done = 0
                next_log = 0
                with open(archive, "wb") as f:
                    for chunk in r.iter_bytes(1024 * 1024):
                        f.write(chunk)
                        done += len(chunk)
                        pct = int(done * 100 / total) if total else 0
                        if total and pct >= next_log:
                            next_log = pct + 10
                            log(f"  {pct} % ({done / 1e9:.1f} Go)")
                break
        except Exception as e:  # noqa: BLE001
            log(f"  échec : {e}")
    else:
        raise RuntimeError("Impossible de télécharger Ollama (réseau ?)")

    log("Extraction…")
    with open(archive, "rb") as compressed:
        with zstandard.ZstdDecompressor().stream_reader(compressed) as zstream:
            with tarfile.open(fileobj=zstream, mode="r|") as tar:
                try:
                    tar.extractall(RUNTIME_DIR, filter="data")
                except TypeError:  # Python < 3.11.4 : pas de filter=
                    tar.extractall(RUNTIME_DIR)
    os.remove(archive)
    os.chmod(bin_path, 0o755)
    log(f"Ollama installé en {time.time() - t0:.0f} s")
    return bin_path


def start_ollama() -> None:
    bin_path = download_ollama()
    os.makedirs(MODELS_DIR, exist_ok=True)
    env = dict(os.environ)
    env["OLLAMA_HOST"] = "127.0.0.1:11434"
    env["OLLAMA_MODELS"] = MODELS_DIR
    log(f"Démarrage d'ollama serve (modèles : {MODELS_DIR})")
    server_log = open(os.path.join(RUNTIME_DIR, "ollama-server.log"), "ab")
    subprocess.Popen(  # noqa: S603
        [bin_path, "serve"],
        env=env,
        stdout=server_log,
        stderr=server_log,
    )


def wait_for_ollama(timeout: float = 180.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if httpx.get(f"{proxy.OLLAMA_URL}/api/version", timeout=2.0).status_code == 200:
                return True
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2.0)
    return False


def pull_models() -> None:
    for name in MODEL_LIST:
        log(f"Téléchargement du modèle {name}…")
        try:
            with httpx.stream("POST", f"{proxy.OLLAMA_URL}/api/pull",
                              json={"name": name, "stream": True},
                              timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=30.0)) as r:
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except ValueError:
                        continue
                    if ev.get("total"):
                        pct = int(ev.get("completed", 0) * 100 / ev["total"])
                        if pct % 10 == 0:
                            log(f"  {name} : {pct} %")
                    elif ev.get("status"):
                        log(f"  {name} : {ev['status']}")
            log(f"Modèle {name} prêt ✔")
        except Exception as e:  # noqa: BLE001
            log(f"!! Échec du téléchargement de {name} : {e}")


def setup_worker() -> None:
    try:
        if os.environ.get("SKIP_OLLAMA_SETUP") == "1":
            log("SKIP_OLLAMA_SETUP=1 → utilisation du serveur Ollama existant")
            return
        start_ollama()
        if not wait_for_ollama():
            log("!! Ollama n'a pas répondu dans les délais (voir logs du Space)")
            return
        pull_models()
        log("Configuration terminée — Ollama tourne dans le cloud ☁️")
    except Exception as e:  # noqa: BLE001
        log(f"!! Erreur pendant la configuration : {e}")


# ============================================================================
# 2. Application Gradio (page racine → redirection vers /chat)
# ============================================================================

with gr.Blocks(title="OllamaLocloud") as demo:
    gr.HTML(
        '<div style="font-family: system-ui, sans-serif; padding: 3rem; text-align: center;">'
        '<div style="font-size: 3rem">☁️</div>'
        '<h2>OllamaLocloud</h2>'
        '<p>Ouverture du <a href="/chat">chat</a>…</p>'
        "</div>"
    )


# ============================================================================
# 3. Interface (static/) + proxy API, montés sur l'app FastAPI de Gradio
# ============================================================================

def _mount_routes() -> None:
    app = demo.app  # application FastAPI créée par launch()

    # --- pages de l'interface (les liens relatifs de index.html fonctionnent
    #     car elle est servie sous /chat) ---
    @app.get("/chat", include_in_schema=False)
    def chat_page():
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    @app.get("/chat/style.css", include_in_schema=False)
    def chat_css():
        return FileResponse(os.path.join(STATIC_DIR, "style.css"), media_type="text/css")

    @app.get("/chat/app.js", include_in_schema=False)
    def chat_js():
        return FileResponse(os.path.join(STATIC_DIR, "app.js"), media_type="text/javascript")

    # --- proxy Ollama (aucune collision : Gradio 6 sert tout sous /gradio_api) ---
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "OPTIONS"],
                   include_in_schema=False)
    async def proxy_api(path: str, request: Request):
        return await proxy.proxy_response(request, "/api/" + path)

    @app.api_route("/v1/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "OPTIONS"],
                   include_in_schema=False)
    async def proxy_v1(path: str, request: Request):
        return await proxy.proxy_response(request, "/v1/" + path)

    @app.get("/status", include_in_schema=False)
    async def status():
        return await proxy.status_payload()


# ============================================================================
# 4. Lancement
# ============================================================================

if __name__ == "__main__":
    # La configuration d'Ollama démarre en arrière-plan : l'interface répond
    # immédiatement et affiche la progression (écran « Démarrage du service… »).
    threading.Thread(target=setup_worker, daemon=True).start()

    port = int(os.environ.get("PORT", "7860"))
    log(f"Lancement de l'interface sur le port {port} (chat : /chat)")
    demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        ssr_mode=False,          # c'est FastAPI qui sert tout, y compris nos routes
        quiet=True,
        show_error=True,
        prevent_thread_lock=True,
        # Redirection immédiate de la racine vers le chat
        head='<script>if(!location.pathname.endsWith("/chat"))location.replace("/chat")</script>',
        js='() => { if (!location.pathname.endsWith("/chat")) location.replace("/chat"); }',
    )
    _mount_routes()

    # Maintient le processus vivant et s'arrête proprement
    stop = threading.Event()

    def _stop(_sig, _frame):
        stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    log("Prêt. Interface : /chat — API : /api (Ollama), /status (état)")
    stop.wait()
    log("Arrêt…")
