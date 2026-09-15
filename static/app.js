/* ==========================================================================
   OllamaLocloud — logique de l'interface
   Vanilla JS, aucune dépendance externe.
   ========================================================================== */
"use strict";

/* ---------- constantes & état ---------- */

const LS = { convs: "olc.conversations", settings: "olc.settings", token: "olc.token" };

const DEFAULT_MODEL = "llama3.2:1b";

const CATALOG = [
  { tag: "llama3.2:1b",     size: "1.3 Go", desc: "Rapide, correct en français — le choix par défaut" },
  { tag: "llama3.2:3b",     size: "2.0 Go", desc: "Même famille, meilleure qualité, un peu plus lent" },
  { tag: "qwen2.5:0.5b",    size: "0.4 Go", desc: "Ultra rapide, qualité basique" },
  { tag: "qwen2.5:1.5b",    size: "1.0 Go", desc: "Bon compromis multilingue" },
  { tag: "qwen2.5:3b",      size: "1.9 Go", desc: "Très bon multilingue, plus lent" },
  { tag: "gemma2:2b",       size: "1.6 Go", desc: "Google — très bon en français" },
  { tag: "smollm2:1.7b",    size: "1.8 Go", desc: "Compact et efficace (Hugging Face)" },
  { tag: "deepseek-r1:1.5b",size: "1.1 Go", desc: "Petit modèle « raisonnement »" },
  { tag: "phi3.5:3.8b",     size: "2.2 Go", desc: "Microsoft — bon raisonnement" },
  { tag: "mistral:7b",      size: "4.1 Go", desc: "Excellente qualité, lent sur CPU gratuit" },
];

const state = {
  conversations: [],            // [{id, title, model, messages:[{role, content}]}]
  currentId: null,
  models: [],                   // modèles installés côté serveur
  model: null,                  // modèle sélectionné
  generating: false,
  controller: null,
  settings: { systemPrompt: "", temperature: 0.7, model: null },
  token: null,
  status: { ollama_up: false, token_required: false, banner: "" },
};

/* ---------- utilitaires ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fmtBytes(n) {
  if (!n || n <= 0) return "—";
  const u = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) ?? fallback);
  } catch { return fallback; }
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* stockage indisponible */ }
}

function authHeaders() {
  return state.token ? { "X-App-Token": state.token } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers || {}) },
  });
  if (res.status === 401) { openTokenModal(); throw new Error("Clé d'accès requise"); }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res;
}

/* ---------- mini moteur Markdown (sans dépendance) ---------- */

function codeBlockHTML(lang, code) {
  return `<div class="codeblock"><div class="codehead"><span>${esc(lang || "code")}</span>` +
         `<button class="copy-btn" type="button">Copier</button></div>` +
         `<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre></div>`;
}

function md(src) {
  if (!src) return "";
  const blocks = [];
  // 1. extraire les blocs de code avant tout
  let text = String(src).replace(/```([\w+-]*)\r?\n?([\s\S]*?)```/g, (_m, lang, code) => {
    blocks.push({ lang, code });
    return `\x00B${blocks.length - 1}\x00`;
  });
  // 2. échapper le HTML
  text = esc(text);
  // 3. mises en forme en ligne
  text = text
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
             '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // 4. construction bloc par bloc
  const lines = text.split(/\r?\n/);
  let html = "", para = [], inUl = false, inOl = false;
  const flushPara = () => { if (para.length) { html += `<p>${para.join("<br>")}</p>`; para = []; } };
  const closeLists = () => {
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }
  };
  for (const raw of lines) {
    const t = raw.trim();
    let m;
    if ((m = t.match(/^\x00B(\d+)\x00$/))) {
      flushPara(); closeLists();
      const b = blocks[+m[1]];
      html += codeBlockHTML(b.lang, b.code);
      continue;
    }
    if (!t) { flushPara(); closeLists(); continue; }
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); closeLists();
      const lvl = Math.min(m[1].length + 2, 6); // # -> h3 dans le chat
      html += `<h${lvl}>${m[2]}</h${lvl}>`;
      continue;
    }
    if ((m = t.match(/^[-*•]\s+(.*)$/))) {
      flushPara();
      if (inOl) { html += "</ol>"; inOl = false; }
      if (!inUl) { html += "<ul>"; inUl = true; }
      html += `<li>${m[1]}</li>`;
      continue;
    }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (inUl) { html += "</ul>"; inUl = false; }
      if (!inOl) { html += "<ol>"; inOl = true; }
      html += `<li>${m[1]}</li>`;
      continue;
    }
    if (/^(-{3,}|={3,})$/.test(t)) { flushPara(); closeLists(); html += "<hr>"; continue; }
    closeLists();
    para.push(t);
  }
  flushPara(); closeLists();
  // bloc de code resté au milieu d'un paragraphe
  html = html.replace(/\x00B(\d+)\x00/g, (_m, i) => codeBlockHTML(blocks[+i].lang, blocks[+i].code));
  return html;
}

/* ---------- statut & modèles ---------- */

function setStatus(up, label) {
  const dot = $("#status-dot");
  dot.className = `dot ${up ? "ok" : "warn"}`;
  $("#status-label").textContent = label;
}

async function fetchStatus() {
  try {
    const r = await fetch("/status");
    const s = await r.json();
    state.status = s;
    if (s.banner) {
      $("#banner").textContent = s.banner;
      $("#banner").classList.remove("hidden");
    }
    return s;
  } catch {
    setStatus(false, "Hors ligne");
    return null;
  }
}

async function fetchModels() {
  const res = await api("/api/tags");
  const data = await res.json();
  state.models = (data.models || []).map((m) => m.name || m.model);
  return state.models;
}

/* Télécharge un modèle avec barre de progression.
   onProgress({pct, label}) ; resolve() quand c'est terminé. */
async function pullModel(name, onProgress) {
  const res = await fetch("/api/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, stream: true }),
  });
  if (res.status === 401) { openTokenModal(); throw new Error("Clé d'accès requise"); }
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let last = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.error) throw new Error(ev.error);
      if (ev.status) {
        last = ev;
        const pct = ev.total ? Math.round((ev.completed / ev.total) * 100) : null;
        onProgress({ pct, label: ev.status, ev });
      }
    }
  }
  if (!last || last.status !== "success") throw new Error("Téléchargement interrompu");
}

/* ---------- démarrage ---------- */

async function boot() {
  state.conversations = loadLS(LS.convs, []);
  state.settings = { ...state.settings, ...loadLS(LS.settings, {}) };
  state.token = loadLS(LS.token, null);

  if (!state.conversations.length) newConversation(false);
  else state.currentId = state.conversations[0].id;
  renderConvList();
  renderMessages();

  bindUI();

  const s = await fetchStatus();
  if (!s) { setStatus(false, "Serveur injoignable"); return; }
  if (s.token_required && !state.token) { openTokenModal(); return; }

  await ensureModels();

  // rafraîchit le statut régulièrement
  setInterval(async () => {
    const st = await fetchStatus();
    if (st) setStatus(st.ollama_up, st.ollama_up ? "Prêt" : "Ollama démarre…");
  }, 30000);
}

async function ensureModels() {
  const box = $("#startup-state");
  const showStartup = (title, text) => {
    $("#empty-state").classList.add("hidden");
    $("#messages").classList.add("hidden");
    box.classList.remove("hidden");
    $("#startup-title").textContent = title;
    $("#startup-text").textContent = text;
  };

  for (let attempt = 0; attempt < 60; attempt++) {
    let models;
    try {
      models = await fetchModels();
    } catch (e) {
      showStartup("Ollama démarre…",
        "Le service met quelques secondes à se lancer dans le cloud. Patientez…");
      setStatus(false, "Ollama démarre…");
      await new Promise((r) => setTimeout(r, 4000));
      continue;
    }
    setStatus(true, "Prêt");

    if (models.length) {
      const wanted = state.settings.model || DEFAULT_MODEL;
      state.model = models.includes(wanted) ? wanted : models[0];
      if (state.model !== state.settings.model) {
        state.settings.model = state.model;
        saveLS(LS.settings, state.settings);
      }
      $("#current-model").textContent = state.model;
      box.classList.add("hidden");
      $("#messages").classList.remove("hidden");
      if (!currentConv().messages.length) $("#empty-state").classList.remove("hidden");
      return;
    }

    // aucun modèle : on télécharge le modèle par défaut
    const target = state.settings.model || DEFAULT_MODEL;
    showStartup("Téléchargement du modèle…",
      `« ${target} » est en cours de téléchargement sur le serveur (première fois : ` +
      `comptez quelques minutes). Vous pourrez ensuite discuter.`);
    $("#startup-progress").classList.remove("hidden");
    $("#startup-progress-label").classList.remove("hidden");
    try {
      await pullModel(target, ({ pct, label }) => {
        if (pct !== null) $("#startup-progress-bar").style.width = `${pct}%`;
        $("#startup-progress-label").textContent =
          pct !== null ? `${label} — ${pct} %` : label;
      });
    } catch (e) {
      if (String(e.message).includes("Clé d'accès")) return;
      $("#startup-text").textContent =
        `Échec du téléchargement : ${e.message}. Nouvelle tentative dans 15 s…`;
      await new Promise((r) => setTimeout(r, 15000));
    }
    await fetchModels();
  }
  toast("Impossible de joindre Ollama après plusieurs tentatives.", "error");
}

/* ---------- conversations ---------- */

function currentConv() {
  return state.conversations.find((c) => c.id === state.currentId) || null;
}

function newConversation(focus = true) {
  const conv = { id: uid(), title: "Nouvelle conversation", model: state.model, messages: [] };
  state.conversations.unshift(conv);
  state.currentId = conv.id;
  saveLS(LS.convs, state.conversations);
  renderConvList();
  renderMessages();
  if (focus) $("#input").focus();
}

function selectConversation(id) {
  state.currentId = id;
  renderConvList();
  renderMessages();
  $("#sidebar").classList.remove("open");
}

function deleteConversation(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.currentId === id) {
    state.currentId = state.conversations[0]?.id || null;
    if (!state.currentId) newConversation(false);
  }
  saveLS(LS.convs, state.conversations);
  renderConvList();
  renderMessages();
}

function renderConvList() {
  const list = $("#conv-list");
  list.innerHTML = "";
  for (const conv of state.conversations) {
    const item = document.createElement("div");
    item.className = "conv-item" + (conv.id === state.currentId ? " active" : "");
    item.innerHTML =
      `<span class="conv-title">${esc(conv.title)}</span>` +
      `<button class="conv-del" title="Supprimer">🗑</button>`;
    item.addEventListener("click", () => selectConversation(conv.id));
    item.querySelector(".conv-del").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Supprimer « ${conv.title} » ?`)) deleteConversation(conv.id);
    });
    list.appendChild(item);
  }
}

/* ---------- rendu des messages ---------- */

function messageHTML(role, content, extraClass = "") {
  const who = role === "user" ? "👤 Vous" : "🦙 Assistant";
  return `<div class="msg ${role} ${extraClass}">
    <div class="avatar">${role === "user" ? "👤" : "🦙"}</div>
    <div class="msg-body">
      <div class="msg-author">${who}</div>
      <div class="bubble md">${role === "user" ? esc(content).replace(/\r?\n/g, "<br>") : md(content)}</div>
    </div>
  </div>`;
}

function renderMessages() {
  const conv = currentConv();
  const box = $("#messages");
  box.innerHTML = "";
  if (conv) {
    for (const m of conv.messages) {
      box.insertAdjacentHTML("beforeend", messageHTML(m.role, m.content, m.error ? "error" : ""));
    }
  }
  const empty = !conv || !conv.messages.length;
  $("#empty-state").classList.toggle("hidden", !empty || !$("#startup-state").classList.contains("hidden"));
  scrollDown(true);
}

function appendMessageEl(role, content, extraClass = "") {
  $("#empty-state").classList.add("hidden");
  $("#messages").insertAdjacentHTML("beforeend", messageHTML(role, content, extraClass));
  const el = $("#messages").lastElementChild;
  scrollDown();
  return el;
}

let _autoScroll = true;
function scrollDown(force = false) {
  const sc = $("#chat-scroll");
  if (force) _autoScroll = true;
  if (_autoScroll) sc.scrollTop = sc.scrollHeight;
}

/* ---------- envoi & streaming ---------- */

async function sendMessage(text) {
  if (state.generating) return;
  text = (text ?? $("#input").value).trim();
  if (!text) return;

  if (!state.model) { toast("Aucun modèle n'est prêt pour le moment.", "error"); return; }

  let conv = currentConv();
  if (!conv) { newConversation(false); conv = currentConv(); }

  conv.messages.push({ role: "user", content: text });
  if (conv.title === "Nouvelle conversation") {
    conv.title = text.length > 42 ? text.slice(0, 41) + "…" : text;
  }
  saveLS(LS.convs, state.conversations);
  renderConvList();
  appendMessageEl("user", text);
  $("#input").value = "";
  autoGrow();

  await streamChat(conv);
}

async function streamChat(conv) {
  state.generating = true;
  setComposerBusy(true);

  const assistantMsg = { role: "assistant", content: "" };
  conv.messages.push(assistantMsg);

  const el = appendMessageEl("assistant", "");
  const bubble = el.querySelector(".bubble");
  bubble.classList.add("streaming");

  const messages = [];
  if (state.settings.systemPrompt && state.settings.systemPrompt.trim()) {
    messages.push({ role: "system", content: state.settings.systemPrompt.trim() });
  }
  for (const m of conv.messages.slice(-60)) {
    if (m === assistantMsg) break;
    if (m.role === "user" || m.role === "assistant") messages.push({ role: m.role, content: m.content });
  }

  state.controller = new AbortController();
  let lastRender = 0;
  let stats = null;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        model: state.model,
        messages,
        stream: true,
        options: { temperature: Number(state.settings.temperature) },
      }),
      signal: state.controller.signal,
    });

    if (res.status === 401) { openTokenModal(); throw new Error("Clé d'accès requise"); }
    if (!res.ok) {
      let msg = `Erreur ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.error) throw new Error(ev.error);
        if (ev.message && ev.message.content) assistantMsg.content += ev.message.content;
        if (ev.done) { stats = ev; }
        const now = performance.now();
        if (now - lastRender > 90) {
          lastRender = now;
          bubble.innerHTML = md(assistantMsg.content);
          scrollDown();
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") {
      assistantMsg.content += "\n\n*(génération interrompue)*";
    } else {
      assistantMsg.content ||= `⚠️ ${e.message}`;
      el.classList.add("error");
      toast(e.message, "error");
    }
  } finally {
    bubble.classList.remove("streaming");
    bubble.innerHTML = md(assistantMsg.content);
    state.generating = false;
    state.controller = null;
    setComposerBusy(false);
    saveLS(LS.convs, state.conversations);
    scrollDown();
  }

  // met à jour le titre « Nouvelle conversation » si le 1er échange a échoué
  if (conv.title === "Nouvelle conversation" && conv.messages.length > 1) {
    const firstUser = conv.messages.find((m) => m.role === "user");
    if (firstUser) conv.title = firstUser.content.slice(0, 42);
    saveLS(LS.convs, state.conversations);
    renderConvList();
  }
  void stats;
}

function setComposerBusy(busy) {
  $("#btn-send").classList.toggle("hidden", busy);
  $("#btn-stop").classList.toggle("hidden", !busy);
  $("#input").disabled = false;
}

function stopGeneration() {
  if (state.controller) state.controller.abort();
}

/* ---------- modale modèles ---------- */

function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(el) {
  el.classList.add("hidden");
  if (el.id === "modal-token" && state.status.token_required && !state.token) {
    /* on reste sur la modale tant que la clé n'est pas fournie */
    setTimeout(() => el.classList.remove("hidden"), 120);
    toast("Une clé d\'accès est nécessaire pour utiliser ce service.", "error");
    return;
  }
}
function bindModals() {
  $$(".modal-backdrop").forEach((back) => {
    back.addEventListener("click", (e) => { if (e.target === back) closeModal(back); });
    back.querySelectorAll(".modal-close").forEach((b) =>
      b.addEventListener("click", () => closeModal(back)));
  });
}

async function renderModelsModal() {
  const inst = $("#installed-list");
  inst.innerHTML = "";
  if (!state.models.length) {
    inst.innerHTML = '<p class="muted small">Aucun modèle installé pour l\'instant.</p>';
  }
  for (const name of state.models) {
    const card = document.createElement("div");
    card.className = "model-card";
    card.innerHTML =
      `<div><div class="m-name">${esc(name)}</div></div>` +
      `<span class="spacer"></span>` +
      `<button class="btn ghost use-btn">Utiliser</button>` +
      `<button class="btn danger del-btn" title="Supprimer du serveur">🗑</button>`;
    card.querySelector(".use-btn").addEventListener("click", () => {
      state.model = name;
      state.settings.model = name;
      saveLS(LS.settings, state.settings);
      $("#current-model").textContent = name;
      closeModal($("#modal-models"));
      toast(`Modèle actif : ${name}`, "ok");
    });
    card.querySelector(".del-btn").addEventListener("click", async () => {
      if (!confirm(`Supprimer « ${name} » du serveur ?`)) return;
      try {
        await api("/api/delete", { method: "DELETE", body: JSON.stringify({ name }) });
        await fetchModels();
        if (state.model === name) state.model = state.models[0] || null;
        await renderModelsModal();
        toast(`${name} supprimé`, "ok");
      } catch (e) { toast(e.message, "error"); }
    });
    inst.appendChild(card);
  }

  const cat = $("#catalog-list");
  cat.innerHTML = "";
  const dl = $("#catalog-tags");
  dl.innerHTML = "";
  for (const m of CATALOG) {
    const installed = state.models.includes(m.tag);
    const card = document.createElement("div");
    card.className = "model-card";
    card.innerHTML =
      `<div><div class="m-name">${esc(m.tag)}</div><div class="m-desc">${esc(m.desc)}</div></div>` +
      `<span class="m-size">${m.size}</span>` +
      (installed
        ? '<span class="badge-installed">installé</span>'
        : `<button class="btn primary add-btn">Télécharger</button>`);
    if (!installed) {
      card.querySelector(".add-btn").addEventListener("click", () =>
        downloadModelFlow(m.tag, () => renderModelsModal()));
    }
    cat.appendChild(card);
    const opt = document.createElement("option");
    opt.value = m.tag;
    dl.appendChild(opt);
  }
}

async function downloadModelFlow(name, refreshUI) {
  const zone = $("#pull-zone");
  zone.classList.remove("hidden");
  $("#pull-name").textContent = `⬇️ ${name}`;
  $("#pull-bar").style.width = "0%";
  $("#pull-label").textContent = "Démarrage…";
  try {
    await pullModel(name, ({ pct, label }) => {
      if (pct !== null) $("#pull-bar").style.width = `${pct}%`;
      $("#pull-label").textContent = pct !== null ? `${label} — ${pct} %` : label;
    });
    await fetchModels();
    state.model = name;
    state.settings.model = name;
    saveLS(LS.settings, state.settings);
    $("#current-model").textContent = name;
    toast(`${name} est prêt à discuter 🎉`, "ok");
    if (refreshUI) await refreshUI();
  } catch (e) {
    toast(`Téléchargement de ${name} échoué : ${e.message}`, "error");
    $("#pull-label").textContent = `Échec : ${e.message}`;
  } finally {
    setTimeout(() => zone.classList.add("hidden"), 2500);
  }
}

/* ---------- modale réglages ---------- */

function openSettingsModal() {
  $("#set-system").value = state.settings.systemPrompt || "";
  $("#set-temp").value = state.settings.temperature ?? 0.7;
  $("#set-temp-value").textContent = $("#set-temp").value;
  openModal("#modal-settings");
}

/* ---------- modale clé d'accès ---------- */

function openTokenModal() {
  $("#token-input").value = state.token || "";
  openModal("#modal-token");
  setTimeout(() => $("#token-input").focus(), 50);
}

async function saveToken() {
  state.token = $("#token-input").value.trim();
  saveLS(LS.token, state.token);
  $("#modal-token").classList.add("hidden");
  if (state.status.token_required && state.token) {
    state.status.token_required = false; // la vérification réelle se fera à la requête suivante
    await ensureModels();
  }
}

/* ---------- événements ---------- */

function autoGrow() {
  const ta = $("#input");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 190) + "px";
}

function bindUI() {
  bindModals();

  $("#new-chat").addEventListener("click", () => {
    if (state.generating) { toast("Attendez la fin de la génération.", "error"); return; }
    newConversation();
    $("#sidebar").classList.remove("open");
  });

  $("#btn-send").addEventListener("click", () => sendMessage());
  $("#btn-stop").addEventListener("click", stopGeneration);

  const input = $("#input");
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  $("#chat-scroll").addEventListener("scroll", () => {
    const sc = $("#chat-scroll");
    _autoScroll = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 90;
  });

  // boutons copier le code (délégation)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    const code = btn.closest(".codeblock")?.querySelector("code")?.innerText || "";
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = "✓ Copié";
    } catch {
      btn.textContent = "✗ Erreur";
    }
    setTimeout(() => (btn.textContent = "Copier"), 1600);
  });

  // chips de suggestion
  $$("#empty-state .chip").forEach((chip) =>
    chip.addEventListener("click", () => sendMessage(chip.textContent)));

  // sidebar mobile
  $("#open-sidebar").addEventListener("click", () => $("#sidebar").classList.add("open"));
  $("#close-sidebar").addEventListener("click", () => $("#sidebar").classList.remove("open"));

  // modales : ouverture
  $("#btn-settings").addEventListener("click", openSettingsModal);
  $("#btn-settings-top").addEventListener("click", openSettingsModal);
  const openModels = async () => { await renderModelsModal(); openModal("#modal-models"); };
  $("#btn-models").addEventListener("click", openModels);
  $("#btn-models-top").addEventListener("click", openModels);

  // réglages
  $("#set-temp").addEventListener("input", () =>
    ($("#set-temp-value").textContent = $("#set-temp").value));
  $("#save-settings").addEventListener("click", () => {
    state.settings.systemPrompt = $("#set-system").value;
    state.settings.temperature = parseFloat($("#set-temp").value);
    saveLS(LS.settings, state.settings);
    $("#modal-settings").classList.add("hidden");
    toast("Réglages enregistrés", "ok");
  });

  // modèles
  $("#custom-pull-btn").addEventListener("click", () => {
    const name = $("#custom-model").value.trim();
    if (!name) return;
    $("#custom-model").value = "";
    downloadModelFlow(name, () => renderModelsModal());
  });
  $("#custom-model").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#custom-pull-btn").click();
  });

  // clé d'accès
  $("#save-token").addEventListener("click", saveToken);
  $("#token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveToken();
  });
}

/* ---------- c'est parti ---------- */
boot();
