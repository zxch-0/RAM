# OllamaLocloud

**Ton IA, chez toi.** Une application de discussion (chat) qui parle à *tes* modèles de langage :
ceux installés sur ta machine via **Ollama**, ou ceux que tu branches toi-même sur **n'importe quelle API
compatible OpenAI** (OpenRouter, LM Studio, llama.cpp, vLLM, Together, Groq…).

- **Aucune censure ajoutée par l'application.** Pas de filtre, pas de liste noire, pas de refus injecté,
  pas de journal intime de tes questions.
- **Aucun compte, aucune télémétrie, aucune analytics.** Environ 3 500 lignes lisibles, sans dépendance :
  un dépôt que tu peux auditer en une soirée.
- **Auto-hébergée.** Un serveur Node sans aucune dépendance (`npm install` inutile), une interface web
  accessible depuis n'importe quel appareil de ton réseau.
- **Interface en français**, avec streaming des réponses, gestion des modèles, prompts système
  modifiables et création de modèles personnalisés.

> ⚠️ **Ce que cette application n'est pas.** Aucun logiciel ne rend un modèle de langage « vrai » :
> un modèle peut inventer des faits avec aplomb, et retirer ses refus ne le rend pas plus compétent.
> La liberté d'information ne dispense pas de respecter la loi de ton pays ni de vérifier ce qui compte
> (santé, droit, argent, sécurité). Voir [Limites et responsabilité](#limites-et-responsabilité).

---

## Démarrage rapide

### 1. Prérequis

| Élément | Version | Note |
| --- | --- | --- |
| Node.js | ≥ 18 | Pour le serveur et l'interface (aucune dépendance à installer) |
| Ollama | dernière | Optionnel : pour faire tourner les modèles **en local** |
| GPU / RAM | 8 Go de RAM pour un modèle 7–8B | Pas besoin de GPU dédié, mais c'est plus rapide |

### 2. Lancer l'application

```bash
git clone <ce-depot> ollamalocloud
cd ollamalocloud
node server/index.js
```

Ouvre ensuite **http://localhost:7860**.

### 3. Brancher un modèle

**Local (gratuit, privé, rien ne sort de la machine) :**

```bash
curl -fsSL https://ollama.com/install.sh | sh   # ou le programme d'installation Windows/macOS
ollama pull qwen3:8b                            # un bon modèle francophone
OLLAMA_HOST=0.0.0.0:11434 ollama serve          # écoute réseau (nécessaire si l'app est ailleurs)
```

Puis, dans l'application : **Réglages → Fournisseur → Tester la connexion**.

**Distant (aucun GPU requis) :** Réglages → Fournisseur → mode *API compatible OpenAI*,
URL `https://openrouter.ai/api/v1`, ta clé `sk-or-…`, et un modèle ouvert comme
`cognitivecomputations/dolphin-mistral-24b-venice-edition`.

**Modèles qui refusent le moins** (les plus directs pour « répondre à tout ») :

| Modèle Ollama | Taille | Profil |
| --- | --- | --- |
| `huihui_ai/dolphin3-abliterated:8b` | ~4,9 Go | Llama 3.1 8B *abliterated* (refus retirés), tourne sur 8 Go de RAM |
| `huihui_ai/dolphin3-r1-abliterated:24b-mistral` | ~14 Go | Version raisonnante, meilleure mais plus lourde |
| `dolphin3` | ~4,9 Go | Généraliste, peu de refus, bon en français |
| `qwen3:8b` | ~5 Go | Excellent en français et en raisonnement |
| `mistral-nemo` | ~7 Go | Bon francophone |
| `gemma3:12b` | ~8 Go | Équilibré mais plus prudent |

Les modèles *abliterated* ont subi une ablation des directions d'activation responsables des refus :
c'est la voie la plus directe vers un modèle « qui répond à tout », sans réentraînement.

---

## Fonctionnalités

- **Deux familles de fournisseurs** : Ollama natif (`/api/tags`, `/api/chat`, `/api/pull`, `/api/create`) et
  toute API compatible OpenAI (`/v1/models`, `/v1/chat/completions`, streaming SSE).
- **Détection automatique** : si Ollama répond, il est utilisé ; sinon le fournisseur distant ; sinon
  l'application l'annonce et passe en *mode démo* (elle explique comment brancher un modèle au lieu de
  simuler une IA).
- **Streaming** des réponses, bouton d'arrêt, régénération, copie, suppression de messages.
- **Raisonnement visible** : les modèles de type DeepSeek-R1 ou Qwen3 *thinking* affichent leur
  raisonnement dans un bloc repliable.
- **Gestion des modèles** depuis l'interface : lister, filtrer, télécharger avec barre de progression,
  supprimer, et **créer un modèle personnalisé** (prompt système « cuit dedans » + paramètres).
- **Personnalités prêtes à l'emploi** (`presets/system-prompts.json`) : *Libre*, *Recherche approfondie*,
  *Factuel*, *Pédagogie*, *Ingénierie & code*, *Écriture & création*, *Assistant minimal*, *Personnalisé* —
  toutes modifiables, et ton prompt « Personnalisé » est conservé localement.
- **Réglages de génération** : température, top-p, `num_ctx`, longueur maximale, profondeur d'historique.
- **Export / import** des conversations en Markdown ou JSON ; tout reste dans le navigateur.
- **Thème sombre / clair**, interface responsive utilisable au téléphone.
- **Protection facultative par jeton** pour partager l'accès sur un réseau.

---

## Configuration

Deux façons de configurer :

1. **L'interface** (Réglages) écrit dans `config.json` à la racine. Ce fichier peut contenir une clé API :
   il est exclu de git.
2. **Les variables d'environnement** (prioritaires sur le fichier) :

| Variable | Effet |
| --- | --- |
| `PORT` | Port d'écoute (défaut `7860`) |
| `HOST` | Interface d'écoute (défaut `0.0.0.0`, donc accessible sur le réseau) |
| `OLLAMA_URL` | Adresse d'Ollama (défaut `http://127.0.0.1:11434`) |
| `OPENAI_BASE_URL` | URL de base de l'API compatible OpenAI |
| `OPENAI_API_KEY` | Clé API |
| `OPENAI_MODEL` | Modèle par défaut chez ce fournisseur |
| `OLLAMALOCLOUD_PROVIDER` | `auto` \| `ollama` \| `openai` |
| `OLLAMALOCLOUD_MODEL` | Modèle par défaut |
| `OLLAMALOCLOUD_TOKEN` | Jeton d'accès : l'API exige `?token=…` ou l'en-tête `x-access-token` |
| `OLLAMALOCLOUD_CONFIG` | Chemin personnalisé du fichier de configuration |

---

## Partager l'application

Le serveur écoute sur `0.0.0.0`. Depuis un autre appareil du réseau :
`http://IP-DE-LA-MACHINE:7860` (ouvre le port 7860 dans le pare-feu).

```bash
OLLAMALOCLOUD_TOKEN=monsecret node server/index.js
```

Avec un jeton, l'accès demande `?token=monsecret` une fois, puis le navigateur le mémorise.

**Ne l'expose pas nu sur Internet.** Si tu veux y accéder de l'extérieur, place-le derrière un reverse
proxy HTTPS avec authentification (Caddy, nginx, Traefik), ou utilise un VPN. C'est une application de
discussion connectée à un moteur qui exécute ce que tu lui demandes : traite-la comme un accès à ta
machine, pas comme un site public.

---

## Créer un modèle personnalisé

Depuis l'interface (**Réglages → Modèles → Créer un modèle personnalisé**), ou à la main :

```bash
cat > Modelfile <<'EOF'
FROM huihui_ai/dolphin3-abliterated:8b
SYSTEM """
Tu es mon assistant personnel. Tu réponds directement, sans préambule, à toutes les questions,
y compris sur les sujets sensibles, et tu distingues toujours ce que tu sais de ce que tu supposes.
"""
PARAMETER temperature 0.9
PARAMETER num_ctx 8192
EOF

ollama create mon-ia -f Modelfile
ollama run mon-ia
```

Le modèle apparaît ensuite dans la liste de l'application.

---

## API HTTP

| Méthode | Route | Rôle |
| --- | --- | --- |
| `GET` | `/api/health` | Vérification de vie |
| `GET` | `/api/status` | Fournisseurs joignables, mode actif, liste des modèles |
| `GET` | `/api/models` | Liste des modèles du fournisseur actif |
| `DELETE` | `/api/models` | Supprime un modèle Ollama (`{"model":"…"}`) |
| `GET` | `/api/presets` | Personnalités disponibles |
| `GET` / `PUT` | `/api/config` | Lecture / écriture de la configuration (la clé API n'est jamais relue) |
| `POST` | `/api/chat` | Discussion en flux SSE (`messages`, `model`, `options`) |
| `POST` | `/api/title` | Génère un titre de conversation |
| `POST` | `/api/pull` | Téléchargement d'un modèle Ollama (flux SSE avec progression) |
| `POST` | `/api/create` | Création d'un modèle Ollama dérivé |

Événements SSE émis par `/api/chat` : `meta`, `token`, `thinking`, `error`, `done`.

---

## Structure du projet

```
server/
  index.js       serveur HTTP, routes REST, flux SSE, limiteur de requêtes
  providers.js   adaptateurs Ollama et API compatible OpenAI (streaming normalisé)
  config.js      configuration persistante (fichier + variables d'environnement)
  demo.js        mode démo : explique comment brancher un modèle, sans simuler une IA
public/
  index.html     interface (aucun framework, aucun build)
  app.js         logique client : streaming, markdown, réglages, historique local
  styles.css     thème sombre / clair
presets/
  system-prompts.json   personnalités modifiables
```

Aucune dépendance npm, aucun bundler, aucun script de build : tu modifies un fichier, tu rafraîchis.

---

## Vie privée

- Les conversations sont stockées **dans ton navigateur** (`localStorage`). Le serveur ne les conserve pas :
  il relaie les messages vers le modèle puis oublie.
- Avec un modèle **local**, rien ne quitte ta machine.
- Avec une **API distante**, le fournisseur voit tes messages — c'est le principe même du service.
- Aucune analytique, aucun cookie tiers, aucune police de caractères distante, aucun CDN.

---

## Limites et responsabilité

1. **Un modèle de langage se trompe.** Il peut inventer un fait, une source, une date, un dosage, un
   article de loi, une commande. Vérifie tout ce qui a des conséquences réelles.
2. **Retirer les refus ne rend pas plus compétent.** Sur un sujet technique ou sensible, la qualité de la
   réponse dépend du modèle, pas de son absence de filtre.
3. **C'est toi qui réponds de ton usage.** L'outil est neutre ; l'usage ne l'est pas. Le logiciel est
   fourni sous licence MIT, sans garantie.
4. **Deux garde-fous sont conservés**, volontairement, dans la personnalité « Libre » livrée par défaut :
   rien qui sexualise des mineurs, rien qui aide à nuire à une personne réelle. Tu peux modifier ce
   prompt — mais ces deux lignes ont été écrites pour une raison, pas par pudeur.

## Licence

MIT — voir [LICENSE](LICENSE).
