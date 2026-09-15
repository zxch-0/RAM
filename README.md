---
title: OllamaLocloud
emoji: ☁️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# ☁️ OllamaLocloud — Ollama tourne dans le cloud, pas sur votre PC

Une interface de discussion complète + **le serveur Ollama**, packagés dans un
seul conteneur Docker. Déployez-le gratuitement sur **Hugging Face Spaces** :
le modèle tourne sur les serveurs de Hugging Face (CPU offert : 2 vCPU,
16 Go de RAM), et votre navigateur discute avec lui. Votre PC ne calcule rien.

```
┌────────────┐        ┌───────────────────────────────────┐
│  Votre PC  │  HTTPS │   Hugging Face Space (gratuit)    │
│  navigateur│ ─────► │  interface web  ──►  Ollama serve │
└────────────┘        └───────────────────────────────────┘
```

- 💬 Chat en streaming, rendu Markdown, blocs de code copiables
- 🧩 Gestion des modèles depuis l'interface (téléchargement avec progression, suppression)
- 🗂️ Conversations sauvegardées dans le navigateur (localStorage)
- ⚙️ Instructions système + température réglables
- 🔐 Protection optionnelle par clé d'accès (`APP_TOKEN`)
- 🐳 Un seul `Dockerfile`, aucun service externe payant

---

## 🚀 Déployer gratuitement (≈ 5 minutes)

### 1. Créez le Space

1. Créez un compte sur [huggingface.co](https://huggingface.co) (gratuit).
2. Allez sur [huggingface.co/new-space](https://huggingface.co/new-space).
3. Choisissez :
   - **Space name** : `ollamalocloud` (ou ce que vous voulez)
   - **License** : MIT
   - **Select the Space SDK** : **Docker** → **Blank**
   - **Space hardware** : **CPU basic** — **Free** ✅
4. Cliquez sur **Create Space**.

### 2. Envoyez ce dépôt dans le Space

Avec git (recommandé) :

```bash
cd OllamaLocloud
git remote add space https://huggingface.co/spaces/VOTRE_PSEUDO/ollamalocloud
git push space main
```

> À l'invite du mot de passe, collez un **jeton d'accès Hugging Face**
> (créable sur *Settings → Access Tokens*, droit **Write**).

Sans git : dans l'onglet **Files** du Space, téléversez simplement tous les
fichiers de ce dépôt (`Dockerfile`, `start.sh`, `app.py`, `requirements.txt`,
dossier `static/`). *(Le README.md contient déjà les métadonnées du Space.)*

### 3. Attendez et discutez

Le build dure ~5-10 minutes (téléchargement d'Ollama). Au premier démarrage,
le modèle par défaut (`llama3.2:1b`, 1,3 Go) est téléchargé : l'interface
affiche la progression. C'est fait — vous avez un **Ollama dans le cloud**. 🎉

---

## ⚙️ Configuration (variables d'environnement)

À régler dans *Settings → Variables and secrets* du Space :

| Variable      | Défaut          | Rôle                                                                                                   |
|---------------|-----------------|--------------------------------------------------------------------------------------------------------|
| `MODEL_LIST`  | `llama3.2:1b`   | Modèles téléchargés au démarrage, séparés par des virgules (ex. `llama3.2:1b,gemma2:2b`)                |
| `APP_TOKEN`   | *(désactivé)*   | Si définie (⚠️ **en tant que Secret**), chaque visiteur devra saisir cette clé pour utiliser le service |
| `OLLAMA_VERSION` | `v0.34.0`    | Version d'Ollama installée (argument de build)                                                          |

### Quel modèle choisir ? (offre gratuite : 2 vCPU, 16 Go)

| Modèle             | Taille | Remarque                                    |
|--------------------|--------|---------------------------------------------|
| `qwen2.5:0.5b`     | 0,4 Go | Ultra rapide, qualité basique               |
| `llama3.2:1b`      | 1,3 Go | **Défaut** — bon compromis                  |
| `gemma2:2b`        | 1,6 Go | Très bon en français                        |
| `qwen2.5:3b`       | 1,9 Go | Meilleure qualité, plus lent                |
| `mistral:7b`       | 4,1 Go | Excellente qualité, mais lent sur CPU       |

> Vous pouvez ajouter/supprimer des modèles à tout moment depuis le bouton
> **🧩 Modèles** de l'interface — n'importe quel tag du
> [catalogue Ollama](https://ollama.com/library) fonctionne.

---

## 💡 Bon à savoir

- **Redémarrages** : sans stockage persistant, le Space redémarre de zéro après
  une mise à jour ou ~48 h d'inactivité → le modèle est re-téléchargé (quelques
  minutes). Pour l'éviter, ajoutez le *Persistent Storage* à votre Space
  (payant, ~5 $/mois pour 20 Go) : les modèles seront conservés dans `/data`.
- **Confidentialité** : l'URL d'un Space public est accessible à tous. Définissez
  le Secret `APP_TOKEN` pour réserver l'usage à vous seul.
- **Performances** : c'est du CPU partagé gratuit — comptez ~5-15 tokens/s pour
  un modèle 1B. Pour du GPU, il faut passer sur le hardware payant de HF
  (Ollama détecte automatiquement le CUDA fourni).
- **API compatible OpenAI** : le proxy expose aussi `/v1/*`, vous pouvez donc
  brancher n'importe quel client OpenAI sur `https://VOTRE-SPACE.hf.space/v1`.

---

## 🖥️ Lancer en local (développement ou auto-hébergement)

Avec Docker (n'importe quel serveur/VPS) :

```bash
docker build -t ollamalocloud .
docker run -p 7860:7860 -e MODEL_LIST="llama3.2:1b" ollamalocloud
# puis http://localhost:7860
```

Ou avec `docker compose up -d` (voir `docker-compose.yml`).

Sans Docker (développement de l'interface, avec un vrai Ollama local) :

```bash
pip install -r requirements.txt
ollama serve &                       # votre Ollama habituel
uvicorn app:app --port 7860
```

Sans aucun Ollama (interface seule, réponses simulées) :

```bash
pip install -r requirements.txt
python3 mock_ollama.py &             # simulateur d'Ollama sur :11434
uvicorn app:app --port 7860
```

---

## 📁 Structure du projet

```
OllamaLocloud/
├── Dockerfile           # Image : Ollama + serveur web (prête pour HF Spaces)
├── start.sh             # Démarre Ollama, télécharge les modèles, lance le site
├── app.py               # Serveur web FastAPI + reverse-proxy vers Ollama
├── requirements.txt     # Dépendances Python (3 paquets)
├── docker-compose.yml   # (Optionnel) auto-hébergement
├── mock_ollama.py       # Simulateur d'Ollama pour développer sans modèle
└── static/              # Interface web (HTML/CSS/JS, zéro dépendance)
    ├── index.html
    ├── style.css
    └── app.js
```

## 🗺️ Alternatives gratuites

- **Google Colab** : GPU gratuit mais sessions éphémères de quelques heures —
  bon pour tester un gros modèle, pas pour un service permanent.
- **Kaggle Notebooks** : 30 h de GPU/semaine, même limite d'éphémérité.
- **Offres gratuites type Render/Koyeb** : trop de RAM limitée pour Ollama ;
  Hugging Face Spaces reste le meilleur rapport simplicité/gratuité.

---

MIT — fait avec ☁️ et un peu de 🦙
