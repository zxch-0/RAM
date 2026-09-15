---
title: OllamaLocloud
emoji: ☁️
colorFrom: indigo
colorTo: purple
sdk: gradio
app_file: space_app.py
pinned: false
license: mit
---

# ☁️ OllamaLocloud — Ollama tourne dans le cloud, pas sur votre PC

Une interface de discussion complète + **le serveur Ollama**, livrés dans un
seul projet. Déployé sur un **Hugging Face Space ZeroGPU (gratuit)**, le modèle
tourne sur les serveurs de Hugging Face et votre navigateur discute avec lui :
**votre PC ne calcule rien**.

```
┌────────────┐         ┌─────────────────────────────────────────┐
│  Votre PC  │  HTTPS  │   Hugging Face Space (ZeroGPU gratuit)  │
│  navigateur│ ──────► │   interface web  ──►  ollama serve      │
└────────────┘         └─────────────────────────────────────────┘
```

- 💬 Chat en streaming, rendu Markdown, blocs de code copiables
- 🧩 Gestion des modèles depuis l'interface (téléchargement avec progression, suppression)
- 🗂️ Conversations sauvegardées dans le navigateur (localStorage)
- ⚙️ Instructions système + température réglables
- 🔐 Protection optionnelle par clé d'accès (`APP_TOKEN`)
- 🔌 API compatible OpenAI exposée (`/v1`)

---

## 💸 Le contexte (2026) : ce qui est gratuit sur Hugging Face

Depuis le passage à la facturation 2026 de Hugging Face :

| Type de Space | Gratuit ? |
|---|---|
| **Static** | ✅ oui (mais ne peut pas exécuter Ollama) |
| **Gradio / Docker sur CPU basic** | ❌ réservé aux comptes PRO/Team (9 $/mois) |
| **Gradio sur ZeroGPU** | ✅ **oui — jusqu'à 2 Spaces par compte gratuit** |

C'est cette dernière ligne que nous utilisons. Le quota GPU quotidien
(5 min en compte gratuit) n'est consommé **que** par les fonctions décorées
`@spaces.GPU` — Ollama tourne ici **en CPU** et n'en consomme donc pas.

> ⚠️ Conditions HF pour héberger un Space ZeroGPU gratuit : compte personnel
> avec e-mail vérifié et âgé de plus de 30 jours, 2 Spaces ZeroGPU maximum.

---

## 🚀 Déployer gratuitement (≈ 5 minutes + démarrage)

### 1. Créez le Space

1. Créez un compte sur [huggingface.co](https://huggingface.co) (vérifiez l'e-mail).
2. Allez sur [huggingface.co/new-space](https://huggingface.co/new-space).
3. Choisissez :
   - **Space name** : `ollamalocloud`
   - **License** : MIT
   - **SDK** : **Gradio**
   - **Space hardware** : **ZeroGPU** — *Free* ✅
     *(si le choix n'est pas proposé à la création, prenez le défaut puis
     changez dans Settings → Space Hardware → ZeroGPU)*
4. Cliquez sur **Create Space**.

### 2. Envoyez les fichiers du projet

Avec git (recommandé) :

```bash
cd OllamaLocloud
git remote add space https://huggingface.co/spaces/VOTRE_PSEUDO/ollamalocloud
git push space main
```

> À l'invite du mot de passe, collez un **jeton d'accès Hugging Face**
> (*Settings → Access Tokens*, droit **Write**).

Sans git : onglet **Files** du Space → *Add file → Upload files* → déposez
`space_app.py`, `proxy.py`, `requirements.txt`, `README.md` et le dossier
`static/` (avec `index.html`, `style.css`, `app.js`).

### 3. Attendez le premier démarrage (~3-6 min)

Le Space démarre immédiatement, mais au premier lancement (et après chaque
redémarrage à froid) il doit :

1. télécharger le binaire Ollama (~1,4 Go, 1-3 min) — suivi dans l'onglet *Logs* ;
2. télécharger le modèle par défaut `llama3.2:1b` (1,3 Go, 1-2 min).

L'interface (`https://votre-space.hf.space` → `/chat`) affiche l'écran
« Démarrage du service… » puis le chat s'ouvre tout seul. **C'est fini** :
vous avez un Ollama dans le cloud. 🎉

---

## ⚙️ Configuration (Space → Settings → Variables and secrets)

| Variable | Défaut | Rôle |
|---|---|---|
| `MODEL_LIST` | `llama3.2:1b` | Modèles téléchargés au démarrage, séparés par des virgules (ex. `llama3.2:1b,gemma2:2b`) |
| `APP_TOKEN` | *(désactivé)* | Si définie (⚠️ **en Secret**), chaque visiteur devra saisir cette clé |
| `OLLAMA_VERSION` | `v0.34.0` | Version du binaire Ollama téléchargé |

### Quel modèle choisir ? (CPU partagé, RAM non garantie)

| Modèle | Taille | Remarque |
|---|---|---|
| `qwen2.5:0.5b` | 0,4 Go | Ultra rapide, qualité basique |
| `llama3.2:1b` | 1,3 Go | **Défaut** — bon compromis |
| `gemma2:2b` | 1,6 Go | Très bon en français |
| `qwen2.5:3b` | 1,9 Go | Meilleure qualité, plus lent |

> Ajoutez/supprimez des modèles à tout moment depuis le bouton **🧩 Modèles**
> de l'interface — n'importe quel tag du [catalogue Ollama](https://ollama.com/library)
> fonctionne (`mistral:7b`, `deepseek-r1:8b`…). Au-delà de ~4 Go, un modèle
> reste *téléchargeable* mais risque d'être trop gros pour la RAM du Space.

---

## 💡 Bon à savoir (limitations de l'offre gratuite)

- **Démarrage à froid** : sans stockage persistant (payant), chaque
  redémarrage du Space retélécharge Ollama + les modèles (3-6 min). Le Space
  s'endort aussi après **48 h sans visiteur** — la visite suivante relance
  tout automatiquement, patientez quelques minutes.
- **Vitesse** : c'est du CPU partagé — comptez ~5-15 tokens/s pour un modèle
  1B. Pour du GPU, il faut du hardware payant.
- **Confidentialité** : l'URL d'un Space public est accessible à tous.
  Définissez le Secret `APP_TOKEN` pour réserver l'usage à vous seul.
- **API compatible OpenAI** : branchez n'importe quel client sur
  `https://VOTRE-SPACE.hf.space/v1` (ou `/api` pour l'API native Ollama).

---

## 🖥️ Alternative : auto-hébergement (Docker)

Pour un service toujours allumé, plus de RAM et de vrais gros modèles, le même
projet fonctionne en conteneur Docker sur n'importe quelle machine
(VPS, NAS, serveur perso…) :

```bash
docker build -t ollamalocloud .
docker run -p 7860:7860 -e MODEL_LIST="mistral:7b" ollamalocloud
# ou : docker compose up -d  (voir docker-compose.yml, modèles conservés)
```

- **Oracle Cloud Always Free** : 4 cœurs ARM + 24 Go de RAM gratuits à vie —
  le `Dockerfile` gère l'architecture ARM automatiquement. C'est l'option
  gratuite la plus puissante pour faire tourner des modèles 7B+ en continu
  (inscription avec carte bancaire requise, sans facturation dans les limites).
- **Hugging Face PRO** (9 $/mois) : le `Dockerfile` fonctionne tel quel en
  Space Docker (mettez `sdk: docker` dans le README du Space).

---

## 🛠️ Développer en local

Avec un vrai Ollama local :

```bash
pip install -r requirements.txt gradio
ollama serve &                                   # votre Ollama habituel
SKIP_OLLAMA_SETUP=1 OLLAMA_URL=http://127.0.0.1:11434 python space_app.py
# → http://localhost:7860/chat
```

Sans aucun modèle (interface seule, réponses simulées) :

```bash
pip install -r requirements.txt gradio
python mock_ollama.py &                          # simulateur sur :11434
SKIP_OLLAMA_SETUP=1 python space_app.py
```

Variante FastAPI pure (même comportement, sans Gradio) :

```bash
python app.py          # sert l'interface sur http://localhost:7860
```

---

## 📁 Structure du projet

```
OllamaLocloud/
├── space_app.py         # ★ Point d'entrée Hugging Face Space (Gradio/ZeroGPU) :
│                        #   télécharge Ollama, le lance, sert l'interface + le proxy
├── app.py               # Variante FastAPI/uvicorn (Docker, auto-hébergement)
├── proxy.py             # Proxy streaming vers Ollama (partagé par les 2 variantes)
├── requirements.txt     # fastapi, uvicorn, httpx, zstandard
├── Dockerfile           # Image Docker multi-arch (amd64/arm64) pour auto-hébergement
├── docker-compose.yml   # Auto-hébergement avec conservation des modèles
├── mock_ollama.py       # Simulateur d'Ollama pour développer sans modèle
└── static/              # Interface web (HTML/CSS/JS, zéro dépendance)
    ├── index.html
    ├── style.css
    └── app.js
```

## 🗺️ Récap des options « cloud gratuit » (2026)

| Option | Ce que c'est | Verdict |
|---|---|---|
| **HF Space Gradio + ZeroGPU** *(ce projet)* | CPU partagé, 2 Spaces, cold starts | ✅ Le plus simple pour discuter avec des petits modèles |
| **Oracle Cloud Always Free** *(via ce projet en Docker)* | 4 cœurs ARM + 24 Go RAM à vie | ✅ Le plus puissant, inscription carte requise |
| Google Colab / Kaggle | GPU gratuit par sessions | ⚠️ Éphémère (quelques heures) — bon pour tester, pas pour un site |
| Render / Koyeb gratuits | 512 Mo de RAM | ❌ Trop peu pour Ollama |

---

MIT — fait avec ☁️ et un peu de 🦙
