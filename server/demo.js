'use strict';

/**
 * Mode demo : aucun moteur de langage n'est joignable.
 * On ne simule pas un modele (ce serait malhonnete) : on explique precisement
 * comment brancher un vrai modele, en repondant dans la langue de l'utilisateur.
 */

const MODELES_RECOMMANDES = [
  ['huihui_ai/dolphin3-abliterated:8b', 'Llama 3.1 8B sans refus (abliterated), ~4,9 Go, tourne sur 8 Go de RAM'],
  ['dolphin3', 'Dolphin 3.0 8B, generaliste, peu de refus, ~4,9 Go'],
  ['qwen3:8b', 'Qwen3 8B : tres bon francais, raisonnement, ~5 Go'],
  ['mistral-nemo', 'Mistral NeMo 12B, bon en francais, ~7 Go'],
  ['dolphin-mistral', 'Dolphin Mistral 7B sans filtre, ~4 Go (machines modestes)'],
  ['gemma3:12b', 'Gemma 3 12B, eclaire mais plus prudent, ~8 Go'],
];

function extraitDerrierMessage(messages) {
  const dernier = [...messages].reverse().find((m) => m.role === 'user');
  const texte = (dernier?.content || '').trim();
  if (!texte) return '';
  return texte.length > 220 ? `${texte.slice(0, 220)}…` : texte;
}

function reponseDemo(messages, config) {
  const question = extraitDerrierMessage(messages);
  const urlOllama = config?.ollama?.url || 'http://127.0.0.1:11434';
  const liste = MODELES_RECOMMANDES.map(([nom, desc]) => `| \`${nom}\` | ${desc} |`).join('\n');

  return `## ⚠️ Mode démo — aucun modèle n'est branché

Cette application fonctionne, mais elle n'a **encore aucun moteur de langage** à qui transmettre ta question. Les réponses que tu vois ici sont écrites à l'avance : je ne vais donc pas faire semblant de réfléchir.

${question ? `> **Ta question :** ${question}\n\n` : ''}Voici les trois façons de passer en mode réel (2 minutes) :

### 1. Modèle local, gratuit et privé (recommandé)

Rien ne quitte ta machine, personne ne peut filtrer tes questions.

\`\`\`bash
# 1. Installer Ollama : https://ollama.com/download  (Windows, macOS, Linux)
# 2. Télécharger un modèle
ollama pull qwen3:8b

# 3. Autoriser l'accès depuis le réseau (utile si tu partages l'app)
OLLAMA_HOST=0.0.0.0:11434 ollama serve
\`\`\`

Puis, ici : **Réglages → Fournisseur → Ollama**, adresse \`${urlOllama}\`, et clique sur **Tester la connexion**.

### 2. Modèle distant (cloud), sans installer de GPU

**Réglages → Fournisseur → API compatible OpenAI**, puis une URL de base et une clé :
OpenRouter, Groq, Together, ou ton propre serveur llama.cpp / LM Studio / vLLM.
Sur OpenRouter, le modèle \`cognitivecomputations/dolphin-mistral-24b-venice-edition\` est ouvert et sans filtre de refus.

### 3. Un modèle vraiment peu bavard sur les refus

Les modèles dits *abliterated* ont subi une ablation des directions d'activation responsables des refus. C'est la voie la plus directe pour « répondre à tout » :

| Modèle | Notes |
| --- | --- |
${liste}

Tu peux aussi empiler ton propre prompt système (Réglages → Personnalité) sur n'importe quel modèle : c'est ce qui change le plus le comportement, bien plus que le choix du modèle.

---

**Ensuite, cette même question recevra une vraie réponse.** Pose-la de nouveau une fois un modèle branché — et si tu veux, ouvre le **Guide** pour le reste (partage sur le réseau, sécurité, création d'un modèle personnalisé).`;
}

/** Decoupe un texte en fragments pour simuler un flux de tokens. */
function tokenize(text) {
  return text.match(/\s*\S+|\s+|\n/g) || [text];
}

module.exports = { reponseDemo, tokenize, MODELES_RECOMMANDES };
