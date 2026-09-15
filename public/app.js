/* OllamaLocloud — logique de l'interface (aucune dependance) */

'use strict';

/* ============================== Outils ============================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const LS = {
  state: 'ollamalocloud.state.v1',
  prefs: 'ollamalocloud.prefs.v1',
  custom: 'ollamalocloud.custom.v1',
  token: 'ollamalocloud.token',
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

let toastTimer = null;
function toast(message, ms = 2600) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================ Markdown ============================= */

function inlineMd(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(«"'])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(«"'])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Analyse une liste (avec imbrication) a partir de la ligne `start`.
 * Renvoie le HTML produit et l'index de la premiere ligne non consommee.
 */
function parseList(lines, start) {
  const baseIndent = lines[start].match(/^(\s*)/)[1].length;
  const ordered = /^\s*\d/.test(lines[start]);
  const items = [];
  let current = null;
  let i = start;

  while (i < lines.length) {
    const match = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (match) {
      const indent = match[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) {
        const nested = parseList(lines, i);
        if (current !== null) items[current] += nested.html;
        i = nested.next;
        continue;
      }
      items.push(inlineMd(match[3]));
      current = items.length - 1;
      i += 1;
      continue;
    }
    if (current !== null && /^\s{2,}\S/.test(lines[i])) {
      items[current] += `<br>${inlineMd(lines[i].trim())}`;
      i += 1;
      continue;
    }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  return {
    html: `<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`,
    next: i,
  };
}

function codeBlockHtml(lang, code) {
  const label = lang ? `<span class="tag">${escapeHtml(lang)}</span>` : '';
  return `<pre>${label}<button class="copy ghost" type="button">Copier</button><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
}

function renderTextBlocks(text) {
  const lines = escapeHtml(text).split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Tableau
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const head = `<tr>${header.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr>`;
      const body = rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead>${head}</thead><tbody>${body}</tbody></table>`);
      continue;
    }

    // Titres
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Separateur
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // Citation
    if (/^\s*&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${buf.map(inlineMd).join('<br>')}</blockquote>`);
      continue;
    }

    // Listes (imbrication geree par parseList)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const parsed = parseList(lines, i);
      out.push(parsed.html);
      i = parsed.next;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Paragraphe
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|&gt;|([-*+]|\d+[.)])\s|\|)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    if (buf.length) out.push(`<p>${buf.map(inlineMd).join('<br>')}</p>`);
    else i += 1;
  }

  return out.join('\n');
}

/** Rendu markdown : les blocs de code sont traites separement (pas d'echappement double). */
function markdown(text) {
  const parts = String(text ?? '').split('```');
  let html = '';
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const newline = part.indexOf('\n');
      const lang = newline >= 0 ? part.slice(0, newline).trim() : '';
      const code = newline >= 0 ? part.slice(newline + 1) : part;
      html += codeBlockHtml(lang, code);
    } else {
      html += renderTextBlocks(part);
    }
  });
  return html;
}

/* ============================ Etat local =========================== */

let config = null;
let presets = [];
let models = [];
let statusInfo = null;
let streaming = null;
let stickToBottom = true;
let renderQueued = false;

const state = {
  conversations: [],
  activeId: null,
  model: '',
  provider: null,
  token: localStorage.getItem(LS.token) || '',
};

const prefs = Object.assign(
  { theme: 'sombre', sendOnEnter: true, streaming: true, showThinking: true },
  (() => {
    try {
      return JSON.parse(localStorage.getItem(LS.prefs) || '{}') || {};
    } catch {
      return {};
    }
  })(),
);

function persistPrefs() {
  localStorage.setItem(LS.prefs, JSON.stringify(prefs));
}

function persistState() {
  try {
    localStorage.setItem(LS.state, JSON.stringify({ conversations: state.conversations, activeId: state.activeId }));
  } catch (err) {
    toast('Stockage local saturé : exporte puis efface d\'anciennes conversations.');
  }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS.state) || '{}');
    state.conversations = Array.isArray(saved.conversations) ? saved.conversations : [];
    state.activeId = saved.activeId || null;
  } catch {
    state.conversations = [];
  }
  if (!state.conversations.length) createConversation(false);
  if (!state.conversations.some((c) => c.id === state.activeId)) {
    state.activeId = state.conversations[0].id;
  }
}

function customSystem() {
  try {
    return JSON.parse(localStorage.getItem(LS.custom) || '{}').system || '';
  } catch {
    return '';
  }
}

function saveCustomSystem(system) {
  localStorage.setItem(LS.custom, JSON.stringify({ system }));
}

function presetById(id) {
  if (id === 'personnalise') {
    return { id, label: 'Personnalisé', system: customSystem() };
  }
  return presets.find((p) => p.id === id) || presets[0] || { id: 'libre', label: 'Libre', system: '' };
}

function activeConv() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

function createConversation(focus = true) {
  const conv = {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: 'Nouvelle conversation',
    preset: config?.defaults?.preset || 'libre',
    model: state.model || '',
    system: null,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.conversations.unshift(conv);
  state.activeId = conv.id;
  persistState();
  renderConversations();
  renderChat();
  if (focus) $('#input')?.focus();
  return conv;
}

/* ============================== API ================================ */

function authHeaders() {
  return state.token ? { 'x-access-token': state.token } : {};
}

async function api(path, options = {}, retry = true) {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  if (res.status === 401 && retry) {
    const token = window.prompt('Cette instance est protégée. Colle le jeton d\'accès (OLLAMALOCLOUD_TOKEN) :');
    if (token) {
      state.token = token.trim();
      localStorage.setItem(LS.token, state.token);
      return api(path, options, false);
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

/** Consomme un flux SSE renvoye par le serveur. */
async function streamRequest(path, body, handlers, signal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch { /* flux non-JSON */ }
    if (res.status === 401) {
      message += " — ouvre l'application avec ?token=TON_JETON (Réglages → Fournisseur) puis recharge la page.";
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      handlers(event, parsed);
    }
  }
}

/* ============================ Rendu ================================ */

function renderConversations() {
  const list = $('#conversation-list');
  list.innerHTML = '';
  state.conversations.forEach((conv) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `conv${conv.id === state.activeId ? ' active' : ''}`;
    btn.innerHTML = `<span class="title">${escapeHtml(conv.title || 'Sans titre')}</span><span class="conv-del" title="Supprimer">✕</span>`;
    btn.addEventListener('click', (event) => {
      if (event.target.classList.contains('conv-del')) {
        event.stopPropagation();
        deleteConversation(conv.id);
        return;
      }
      state.activeId = conv.id;
      persistState();
      renderConversations();
      renderChat();
      document.body.classList.remove('sidebar-open');
    });
    list.appendChild(btn);
  });
}

function deleteConversation(id) {
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  if (conv.messages.length && !window.confirm(`Supprimer « ${conv.title} » ?`)) return;
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (!state.conversations.length) createConversation(false);
  else if (state.activeId === id) state.activeId = state.conversations[0].id;
  persistState();
  renderConversations();
  renderChat();
}

function renderChat() {
  const conv = activeConv();
  const container = $('#messages');
  container.innerHTML = '';
  if (!conv || !conv.messages.length) {
    $('#empty-state').hidden = false;
    container.hidden = true;
    updateFoot();
    return;
  }
  $('#empty-state').hidden = true;
  container.hidden = false;

  conv.messages.forEach((msg, index) => {
    container.appendChild(buildMessageEl(conv, msg, index));
  });
  updateFoot();
  scrollToBottom(true);
}

function buildMessageEl(conv, msg, index) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${msg.role}`;
  wrap.dataset.index = String(index);

  const avatar = msg.role === 'user' ? '🙂' : '◍';
  wrap.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="body">
      <div class="meta"></div>
      <div class="bubble"></div>
      <div class="msg-actions"></div>
    </div>`;

  const meta = $('.meta', wrap);
  const bubble = $('.bubble', wrap);
  const actions = $('.msg-actions', wrap);

  meta.textContent = msg.role === 'user' ? 'Toi' : msg.model || 'assistant';
  if (msg.role === 'assistant' && msg.provider) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `via ${msg.provider}`;
    meta.appendChild(tag);
  }
  if (msg.ts) {
    const time = document.createElement('span');
    time.textContent = formatTime(msg.ts);
    meta.appendChild(time);
  }

  paintMessage(bubble, msg, Boolean(streaming && streaming.msg === msg));

  // Actions
  const copy = document.createElement('button');
  copy.className = 'ghost';
  copy.type = 'button';
  copy.textContent = '⧉ Copier';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(msg.content || '');
      toast('Message copié.');
    } catch {
      toast('Copie impossible : sélectionne le texte à la main.');
    }
  });
  actions.appendChild(copy);

  if (msg.role === 'assistant' && index === conv.messages.length - 1 && !streaming) {
    const regen = document.createElement('button');
    regen.className = 'ghost';
    regen.type = 'button';
    regen.textContent = '↻ Régénérer';
    regen.addEventListener('click', regenerate);
    actions.appendChild(regen);
  }

  const del = document.createElement('button');
  del.className = 'ghost';
  del.type = 'button';
  del.textContent = '🗑 Supprimer';
  del.addEventListener('click', () => {
    conv.messages.splice(index, 1);
    conv.updatedAt = Date.now();
    persistState();
    renderChat();
  });
  actions.appendChild(del);

  return wrap;
}

function paintMessage(bubble, msg, isStreaming) {
  const isPending = isStreaming || msg.pending;
  bubble.classList.toggle('error', Boolean(msg.error));

  let html = '';
  if (msg.role === 'assistant' && msg.thinking && prefs.showThinking && !msg.error) {
    html += `<details class="thinking"${isPending ? ' open' : ''}><summary>🧠 Raisonnement du modèle</summary><div class="thinking-body">${escapeHtml(msg.thinking)}</div></details>`;
  }
  if (msg.error) {
    html += `<p><strong>Erreur :</strong> ${escapeHtml(msg.error)}</p>`;
    if (msg.content) html += markdown(msg.content);
  } else if (msg.content) {
    html += markdown(msg.content);
  } else if (isPending) {
    html += '<p class="muted">…</p>';
  }
  bubble.innerHTML = html;
  if (isStreaming || msg.pending) {
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    bubble.appendChild(cursor);
  }

  $$('pre', bubble).forEach((pre) => {
    const button = $('.copy', pre);
    if (button) {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText($('code', pre)?.textContent || '');
          button.textContent = 'Copié';
          setTimeout(() => {
            button.textContent = 'Copier';
          }, 1500);
        } catch {
          toast('Copie impossible.');
        }
      });
    }
  });
}

function queuePaint(conv, msg) {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const index = conv.messages.indexOf(msg);
    const el = $(`#messages .msg[data-index="${index}"]`);
    if (!el) return;
    paintMessage($('.bubble', el), msg, true);
    if (stickToBottom) scrollToBottom();
  });
}

function scrollToBottom(force = false) {
  const container = $('#messages');
  if (force || stickToBottom) container.scrollTop = container.scrollHeight;
}

function updateFoot() {
  const conv = activeConv();
  const preset = presetById(conv?.preset || 'libre');
  const options = config?.defaults || {};
  $('#foot-info').textContent = `${state.model || 'aucun modèle'} · ${preset.emoji || ''} ${preset.label || preset.id}${statusInfo?.demo ? ' · mode démo' : ''}`;
  $('#foot-options').textContent = `température ${Number(options.temperature ?? 0.8).toFixed(2)} · contexte ${options.numCtx || 8192} · ${conv?.messages.length || 0} messages`;
  $('#btn-regen').hidden = !(conv && conv.messages.length && !streaming);
}

function renderSelectors() {
  const modelSelect = $('#model-select');
  const previous = state.model;
  modelSelect.innerHTML = '';
  const options = models.length ? models : [];
  if (!options.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = statusInfo?.demo ? 'mode démo — aucun modèle' : 'aucun modèle trouvé';
    modelSelect.appendChild(opt);
  }
  options.forEach((model) => {
    const opt = document.createElement('option');
    opt.value = model.id;
    const size = model.size ? ` · ${formatBytes(model.size)}` : '';
    opt.textContent = `${model.id}${size}${model.provider === 'openai' ? ' ☁' : ''}`;
    modelSelect.appendChild(opt);
  });
  const wanted = previous || config?.defaults?.model || '';
  if (wanted && options.some((m) => m.id === wanted)) {
    state.model = wanted;
    modelSelect.value = wanted;
  } else if (options.length) {
    state.model = options[0].id;
  } else {
    state.model = '';
  }

  const presetSelect = $('#preset-select');
  presetSelect.innerHTML = '';
  presets.forEach((preset) => {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = `${preset.emoji || ''} ${preset.label}`.trim();
    presetSelect.appendChild(opt);
  });
  const conv = activeConv();
  presetSelect.value = conv?.preset || config?.defaults?.preset || 'libre';
}

function renderStatus() {
  const pill = $('#status-pill');
  if (!statusInfo) {
    pill.dataset.state = 'error';
    pill.textContent = 'Serveur injoignable';
    return;
  }
  if (statusInfo.demo) {
    pill.dataset.state = 'demo';
    pill.textContent = 'Mode démo — brancher un modèle';
  } else if (statusInfo.active === 'ollama') {
    pill.dataset.state = 'ok';
    pill.textContent = `Ollama ${statusInfo.providers?.ollama?.version || ''} · ${models.length} modèle(s)`;
  } else {
    pill.dataset.state = 'ok';
    pill.textContent = `Cloud · ${models.length} modèle(s)`;
  }
  const hint = $('#empty-hint');
  if (hint) {
    hint.textContent = statusInfo.demo
      ? "Aucun moteur de langage n'est branché pour l'instant : ouvre le Guide (bouton en haut à droite) ou Réglages → Fournisseur pour en brancher un en deux minutes."
      : `Modèle actif : ${state.model || 'à choisir'} — les réponses viennent de ${statusInfo.active === 'ollama' ? 'ta machine' : 'ton fournisseur distant'}.`;
  }
}

/* ============================ Conversation ========================= */

function buildPayload(conv) {
  const limit = Math.max(2, Number(config?.defaults?.historyLimit) || 40);
  const system = (conv.system !== null && conv.system !== undefined) ? conv.system : presetById(conv.preset).system;
  const history = conv.messages
    .filter((m) => !m.pending && !m.error && String(m.content || '').trim())
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));
  const messages = [];
  if (system && String(system).trim()) messages.push({ role: 'system', content: system });
  messages.push(...history);
  return messages;
}

async function sendMessage(text) {
  const conv = activeConv();
  const content = String(text || '').trim();
  if (!content) return;
  if (streaming) {
    toast('Une réponse est déjà en cours.');
    return;
  }
  if (!state.model && !statusInfo?.demo) {
    toast('Aucun modèle sélectionné : Réglages → Modèles.');
    openDialog('#settings-dialog', 'models');
    return;
  }

  conv.messages.push({ role: 'user', content, ts: Date.now() });
  const firstUser = conv.messages.filter((m) => m.role === 'user').length === 1;
  if (firstUser) conv.title = content.replace(/\s+/g, ' ').slice(0, 48);
  conv.model = state.model;
  conv.updatedAt = Date.now();
  if (conv.system === undefined) conv.system = null;

  const assistant = { role: 'assistant', content: '', thinking: '', model: state.model, provider: '', ts: Date.now(), pending: true };
  conv.messages.push(assistant);

  persistState();
  renderConversations();
  renderChat();
  stickToBottom = true;
  $('#input').value = '';
  autoGrow($('#input'));

  await runStream(conv, assistant, buildPayload(conv), firstUser);
}

async function runStream(conv, assistant, messages, isFirst) {
  const controller = new AbortController();
  streaming = { conv, msg: assistant, controller };
  setBusy(true);

  try {
    await streamRequest(
      '/api/chat',
      {
        messages,
        model: state.model,
        provider: state.provider || undefined,
        options: config?.defaults || {},
      },
      (event, data) => {
        if (event === 'meta') {
          assistant.provider = data.provider;
          if (data.demo) statusInfo = { ...(statusInfo || {}), demo: true, active: 'demo' };
        } else if (event === 'token') {
          assistant.content += data.t ?? data.text ?? '';
          if (prefs.streaming) queuePaint(conv, assistant);
        } else if (event === 'thinking') {
          assistant.thinking += data.text ?? data.t ?? '';
          if (prefs.streaming && prefs.showThinking) queuePaint(conv, assistant);
        } else if (event === 'error') {
          assistant.error = data.message || 'Erreur inconnue.';
        } else if (event === 'done') {
          assistant.model = data.model || assistant.model;
          assistant.usage = data.usage;
        }
      },
      controller.signal,
    );
  } catch (err) {
    if (err.name !== 'AbortError') assistant.error = err.message;
    else if (!assistant.content) assistant.content = '_Réponse interrompue._';
  } finally {
    assistant.pending = false;
    assistant.ts = assistant.ts || Date.now();
    streaming = null;
    setBusy(false);
    persistState();
    renderChat();
    updateFoot();
    if (isFirst) maybeAutoTitle(conv);
  }
}

async function maybeAutoTitle(conv) {
  if (!statusInfo || statusInfo.demo) return;
  try {
    const { title } = await api('/api/title', {
      method: 'POST',
      body: JSON.stringify({ messages: buildPayload(conv), model: state.model }),
    });
    if (title && conv.title !== title) {
      conv.title = title;
      persistState();
      renderConversations();
    }
  } catch {
    /* titre optionnel */
  }
}

function regenerate() {
  const conv = activeConv();
  if (!conv || streaming) return;
  while (conv.messages.length && conv.messages[conv.messages.length - 1].role !== 'user') conv.messages.pop();
  const last = conv.messages[conv.messages.length - 1];
  if (!last || last.role !== 'user') return;
  const assistant = { role: 'assistant', content: '', thinking: '', model: state.model, ts: Date.now(), pending: true };
  conv.messages.push(assistant);
  renderChat();
  runStream(conv, assistant, buildPayload({ ...conv, messages: conv.messages.slice(0, -1) }), false);
}

function stopStream() {
  if (streaming) {
    streaming.controller.abort();
    toast('Réponse arrêtée.');
  }
}

function setBusy(busy) {
  $('#btn-send').disabled = busy;
  $('#btn-stop').hidden = !busy;
  $('#btn-regen').hidden = busy;
  $('#btn-send').textContent = busy ? 'En cours…' : 'Envoyer ➤';
}

/* ============================ Événements UI ======================== */

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.45)}px`;
}

function openDialog(selector, tab) {
  const dialog = $(selector);
  if (!dialog) return;
  if (tab) selectTab(tab);
  if (!dialog.open) dialog.showModal();
  if (selector === '#settings-dialog') refreshModelsTab();
}

function selectTab(name) {
  $$('#settings-dialog .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  $$('#settings-dialog .tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
}

async function refreshStatus() {
  try {
    statusInfo = await api('/api/status');
    models = statusInfo.models || [];
  } catch (err) {
    statusInfo = null;
    toast(`Serveur injoignable : ${err.message}`);
  }
  renderSelectors();
  renderStatus();
  updateFoot();
}

async function refreshModelsTab() {
  try {
    const data = await api('/api/models');
    models = data.models || [];
  } catch {
    /* on garde la liste précédente */
  }
  renderModelList();
  fillSettingsForm();
}

function renderModelList() {
  const container = $('#model-list');
  const filter = ($('#model-filter').value || '').toLowerCase();
  const list = models.filter((m) => m.id.toLowerCase().includes(filter));
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<p class="muted small">Aucun modèle trouvé. Vérifie qu\'Ollama est lancé (Réglages → Fournisseur → Tester la connexion).</p>';
    return;
  }
  list.forEach((model) => {
    const row = document.createElement('div');
    row.className = `model-row${model.id === state.model ? ' active' : ''}`;
    const badges = [model.parameters, model.quantization, model.size ? formatBytes(model.size) : ''].filter(Boolean).join(' · ');
    row.innerHTML = `<span class="name">${escapeHtml(model.id)}</span><span class="tag">${escapeHtml(badges)}</span>`;

    const use = document.createElement('button');
    use.className = 'ghost';
    use.type = 'button';
    use.textContent = model.id === state.model ? 'Utilisé' : 'Utiliser';
    use.addEventListener('click', async () => {
      state.model = model.id;
      const conv = activeConv();
      if (conv) {
        conv.model = model.id;
        persistState();
      }
      await api('/api/config', { method: 'PUT', body: JSON.stringify({ defaults: { model: model.id } }) }).catch(() => {});
      renderSelectors();
      renderModelList();
      updateFoot();
      toast(`Modèle actif : ${model.id}`);
    });
    row.appendChild(use);

    if (model.provider === 'ollama') {
      const del = document.createElement('button');
      del.className = 'danger';
      del.type = 'button';
      del.textContent = 'Suppr.';
      del.title = 'Supprimer ce modèle du disque';
      del.addEventListener('click', async () => {
        if (!window.confirm(`Supprimer définitivement ${model.id} ?`)) return;
        try {
          await api('/api/models', { method: 'DELETE', body: JSON.stringify({ model: model.id }) });
          toast('Modèle supprimé.');
          await refreshModelsTab();
          await refreshStatus();
        } catch (err) {
          toast(err.message);
        }
      });
      row.appendChild(del);
    }
    container.appendChild(row);
  });
}

function fillSettingsForm() {
  if (!config) return;
  $('#set-provider').value = config.provider || 'auto';
  $('#set-ollama-url').value = config.ollama?.url || '';
  $('#set-openai-url').value = config.openai?.baseUrl || '';
  $('#set-openai-model').value = config.openai?.model || '';
  $('#set-openai-key').placeholder = config.openai?.hasApiKey ? 'clé enregistrée (laisser vide pour conserver)' : 'sk-…';
  $('#config-path').textContent = config.configPath ? `Fichier de configuration : ${config.configPath}` : '';

  const defaults = config.defaults || {};
  $('#set-temp').value = defaults.temperature ?? 0.8;
  $('#out-temp').textContent = Number(defaults.temperature ?? 0.8).toFixed(2);
  $('#set-topp').value = defaults.topP ?? 0.95;
  $('#out-topp').textContent = Number(defaults.topP ?? 0.95).toFixed(2);
  $('#set-ctx').value = defaults.numCtx ?? 8192;
  $('#set-maxtok').value = defaults.maxTokens ?? 0;
  $('#set-history').value = defaults.historyLimit ?? 40;

  const conv = activeConv();
  const presetId = conv?.preset || defaults.preset || 'libre';
  $('#set-preset').value = presetId;
  const system = (conv?.system !== null && conv?.system !== undefined) ? conv.system : presetById(presetId).system;
  $('#set-system').value = system || '';

  $('#create-from').value = state.model || '';
  $('#create-system').value = system || '';

  $('#set-theme').value = prefs.theme;
  $('#set-enter').checked = prefs.sendOnEnter;
  $('#set-stream').checked = prefs.streaming;
  $('#set-thinking').checked = prefs.showThinking;

  const bytes = new Blob([localStorage.getItem(LS.state) || '']).size;
  $('#storage-info').textContent = `${state.conversations.length} conversation(s) · ${state.conversations.reduce((n, c) => n + c.messages.length, 0)} message(s) · ${formatBytes(bytes) || '0 o'} dans ce navigateur.`;
}

/* ============================ Export / Import ====================== */

function conversationToMarkdown(conv) {
  const preset = presetById(conv.preset);
  const lines = [
    `# ${conv.title}`,
    '',
    `- Modèle : ${conv.model || 'inconnu'}`,
    `- Personnalité : ${preset.emoji || ''} ${preset.label}`,
    `- Créée le : ${formatTime(conv.createdAt)}`,
    '',
    '---',
    '',
  ];
  conv.messages.forEach((msg) => {
    lines.push(msg.role === 'user' ? '## 🙋 Toi' : `## ◍ ${msg.model || 'assistant'}`);
    if (msg.thinking) lines.push('', '> *Raisonnement :*', `> ${msg.thinking.replace(/\n/g, '\n> ')}`);
    lines.push('', msg.content || (msg.error ? `*Erreur : ${msg.error}*` : ''), '');
  });
  return lines.join('\n');
}

/* ============================ Démarrage ============================ */

function bindEvents() {
  const input = $('#input');
  const form = $('#composer');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener('input', () => autoGrow(input));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && prefs.sendOnEnter) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  $('#btn-stop').addEventListener('click', stopStream);
  $('#btn-regen').addEventListener('click', regenerate);
  $('#new-chat').addEventListener('click', () => createConversation());
  $('#toggle-sidebar').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  $('#close-sidebar').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  $('#status-pill').addEventListener('click', () => openDialog('#settings-dialog', 'provider'));

  ['#btn-settings', '#btn-settings-2'].forEach((sel) => $(sel).addEventListener('click', () => openDialog('#settings-dialog')));
  ['#btn-guide', '#btn-guide-2'].forEach((sel) => $(sel).addEventListener('click', () => openDialog('#guide-dialog')));

  $('#messages').addEventListener('scroll', () => {
    const el = $('#messages');
    stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  });

  $$('.suggestions button').forEach((button) => {
    button.addEventListener('click', () => sendMessage(button.dataset.prompt));
  });

  $('#model-select').addEventListener('change', (event) => {
    state.model = event.target.value;
    const conv = activeConv();
    if (conv) {
      conv.model = state.model;
      persistState();
    }
    updateFoot();
    renderModelList();
  });

  $('#preset-select').addEventListener('change', (event) => {
    const conv = activeConv();
    if (!conv) return;
    conv.preset = event.target.value;
    conv.system = null; // on revient au prompt du preset
    persistState();
    $('#set-preset').value = conv.preset;
    $('#set-system').value = presetById(conv.preset).system || '';
    updateFoot();
    toast(`Personnalité : ${presetById(conv.preset).label}`);
  });

  $('#btn-export').addEventListener('click', () => {
    const conv = activeConv();
    if (!conv || !conv.messages.length) return toast('Rien à exporter.');
    const safe = (conv.title || 'conversation').replace(/[^\w\-À-ÿ ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
    download(`${safe || 'conversation'}.md`, conversationToMarkdown(conv), 'text/markdown');
  });

  // Onglets
  $$('#settings-dialog .tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));

  // Fournisseur
  $('#btn-save-config').addEventListener('click', async () => {
    const patch = {
      provider: $('#set-provider').value,
      ollama: { url: $('#set-ollama-url').value.trim() },
      openai: { baseUrl: $('#set-openai-url').value.trim(), model: $('#set-openai-model').value.trim() },
    };
    const key = $('#set-openai-key').value.trim();
    if (key) patch.openai.apiKey = key;
    try {
      config = await api('/api/config', { method: 'PUT', body: JSON.stringify(patch) });
      state.provider = null;
      $('#set-openai-key').value = '';
      toast('Réglages enregistrés.');
      await refreshStatus();
      fillSettingsForm();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#btn-test').addEventListener('click', async (event) => {
    const out = $('#test-result');
    out.hidden = false;
    out.textContent = 'Test en cours…';
    event.target.disabled = true;
    try {
      const data = await api('/api/status');
      statusInfo = data;
      const lines = Object.entries(data.providers || {}).map(([id, info]) =>
        info.available ? `✓ ${id} — joignable (${info.version})` : `✗ ${id} — ${info.error}`,
      );
      lines.push('', `Fournisseur actif : ${data.active}`);
      if (data.models?.length) lines.push(`Modèles : ${data.models.length}`);
      out.textContent = lines.join('\n');
    } catch (err) {
      out.textContent = `✗ ${err.message}`;
    } finally {
      event.target.disabled = false;
    }
  });

  // Modèles
  $('#model-filter').addEventListener('input', renderModelList);
  $('#btn-refresh-models').addEventListener('click', async () => {
    await refreshModelsTab();
    await refreshStatus();
    toast('Liste actualisée.');
  });

  $('#btn-pull').addEventListener('click', async (event) => {
    const name = $('#pull-name').value.trim();
    if (!name) return toast('Indique le nom du modèle.');
    const log = $('#pull-log');
    const bar = $('#pull-bar');
    const progress = $('.progress');
    log.hidden = false;
    progress.hidden = false;
    log.textContent = `Téléchargement de ${name}…\n`;
    event.target.disabled = true;
    try {
      await streamRequest('/api/pull', { model: name }, (type, data) => {
        if (type === 'progress') {
          if (typeof data.percent === 'number') {
            bar.style.width = `${data.percent}%`;
            log.textContent = `${data.status} — ${data.percent}%${data.total ? ` (${formatBytes(data.completed)} / ${formatBytes(data.total)})` : ''}`;
          } else if (data.status) {
            log.textContent = data.status;
          }
        } else if (type === 'done') {
          bar.style.width = '100%';
          log.textContent = `✓ ${name} téléchargé.`;
        } else if (type === 'error') {
          log.textContent = `✗ ${data.message}`;
        }
      });
      await refreshModelsTab();
      await refreshStatus();
    } catch (err) {
      log.textContent = `✗ ${err.message}`;
    } finally {
      event.target.disabled = false;
      setTimeout(() => {
        progress.hidden = true;
        bar.style.width = '0';
      }, 2500);
    }
  });

  $('#btn-create').addEventListener('click', async (event) => {
    const name = $('#create-name').value.trim().replace(/\s+/g, '-');
    const from = $('#create-from').value.trim();
    const system = $('#create-system').value;
    const log = $('#create-log');
    if (!name || !from) return toast('Renseigne le modèle de base et le nom.');
    log.hidden = false;
    log.textContent = `Création de ${name}…`;
    event.target.disabled = true;
    try {
      await streamRequest(
        '/api/create',
        {
          name,
          from,
          system,
          parameters: {
            temperature: Number(config?.defaults?.temperature ?? 0.8),
            num_ctx: Number(config?.defaults?.numCtx ?? 8192),
          },
        },
        (type, data) => {
          if (type === 'progress' && data.status) log.textContent = data.status;
          else if (type === 'done') log.textContent = `✓ ${name} créé. Sélectionne-le dans la liste des modèles.`;
          else if (type === 'error') log.textContent = `✗ ${data.message}`;
        },
      );
      await refreshModelsTab();
      await refreshStatus();
    } catch (err) {
      log.textContent = `✗ ${err.message}`;
    } finally {
      event.target.disabled = false;
    }
  });

  // Personnalité
  $('#set-preset').addEventListener('change', (event) => {
    $('#set-system').value = presetById(event.target.value).system || '';
    $('#persona-note').textContent = presetById(event.target.value).description || '';
  });

  $('#btn-system-save').addEventListener('click', () => {
    const conv = activeConv();
    if (!conv) return;
    conv.preset = $('#set-preset').value;
    conv.system = $('#set-system').value;
    if (conv.preset === 'personnalise') saveCustomSystem(conv.system);
    persistState();
    renderSelectors();
    $('#preset-select').value = conv.preset;
    updateFoot();
    toast('Personnalité appliquée à cette conversation.');
  });

  $('#btn-system-global').addEventListener('click', async () => {
    const preset = $('#set-preset').value;
    const system = $('#set-system').value;
    if (preset === 'personnalise') saveCustomSystem(system);
    try {
      config = await api('/api/config', { method: 'PUT', body: JSON.stringify({ defaults: { preset, system } }) });
      toast('Personnalité par défaut enregistrée.');
      fillSettingsForm();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#btn-system-reset').addEventListener('click', () => {
    $('#set-system').value = presetById($('#set-preset').value).system || '';
  });

  // Génération
  $('#set-temp').addEventListener('input', (event) => {
    $('#out-temp').textContent = Number(event.target.value).toFixed(2);
  });
  $('#set-topp').addEventListener('input', (event) => {
    $('#out-topp').textContent = Number(event.target.value).toFixed(2);
  });

  $('#btn-save-options').addEventListener('click', async () => {
    const patch = {
      defaults: {
        temperature: Number($('#set-temp').value),
        topP: Number($('#set-topp').value),
        numCtx: Number($('#set-ctx').value),
        maxTokens: Number($('#set-maxtok').value),
        historyLimit: Number($('#set-history').value),
      },
    };
    try {
      config = await api('/api/config', { method: 'PUT', body: JSON.stringify(patch) });
      toast('Paramètres de génération enregistrés.');
      updateFoot();
      fillSettingsForm();
    } catch (err) {
      toast(err.message);
    }
  });

  // Interface
  $('#set-theme').addEventListener('change', (event) => {
    prefs.theme = event.target.value;
    persistPrefs();
    applyTheme();
  });
  $('#set-enter').addEventListener('change', (event) => {
    prefs.sendOnEnter = event.target.checked;
    persistPrefs();
  });
  $('#set-stream').addEventListener('change', (event) => {
    prefs.streaming = event.target.checked;
    persistPrefs();
  });
  $('#set-thinking').addEventListener('change', (event) => {
    prefs.showThinking = event.target.checked;
    persistPrefs();
    renderChat();
  });

  // Données
  $('#btn-export-all').addEventListener('click', () => {
    download(
      `ollamalocloud-conversations-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), conversations: state.conversations }, null, 2),
      'application/json',
    );
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.conversations;
      if (!Array.isArray(incoming)) throw new Error('Format inattendu.');
      incoming.forEach((conv) => {
        conv.id = conv.id || `c${Math.random().toString(36).slice(2, 9)}`;
        conv.messages = Array.isArray(conv.messages) ? conv.messages : [];
        state.conversations.unshift(conv);
      });
      persistState();
      renderConversations();
      fillSettingsForm();
      toast(`${incoming.length} conversation(s) importée(s).`);
    } catch (err) {
      toast(`Import impossible : ${err.message}`);
    } finally {
      event.target.value = '';
    }
  });

  $('#btn-wipe').addEventListener('click', () => {
    if (!window.confirm('Effacer toutes les conversations de ce navigateur ? Cette action est définitive.')) return;
    state.conversations = [];
    state.activeId = null;
    localStorage.removeItem(LS.state);
    createConversation(false);
    renderConversations();
    renderChat();
    fillSettingsForm();
    toast('Conversations effacées.');
  });
}

async function init() {
  applyTheme();
  loadState();
  renderConversations();
  renderChat();

  const url = new URL(window.location.href);
  const tokenFromUrl = url.searchParams.get('token');
  if (tokenFromUrl) {
    state.token = tokenFromUrl;
    localStorage.setItem(LS.token, tokenFromUrl);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
  }

  bindEvents();

  try {
    config = await api('/api/config');
  } catch (err) {
    toast(`Configuration illisible : ${err.message}`);
  }

  try {
    const data = await api('/api/presets');
    presets = data.presets || [];
  } catch {
    presets = [{ id: 'libre', label: 'Libre', emoji: '🔓', system: '' }];
  }

  await refreshStatus();
  $('#preset-select').value = activeConv()?.preset || config?.defaults?.preset || 'libre';
  fillSettingsForm();
  $('#input').focus();

  // Rafraîchit l'état du moteur de temps en temps (sans bloquer l'interface).
  setInterval(() => {
    if (!streaming) refreshStatus();
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
