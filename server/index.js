'use strict';

/**
 * OllamaLocloud — serveur applicatif.
 *
 * - sert l'interface web (public/)
 * - expose une petite API REST + des flux SSE vers les fournisseurs de modeles
 * - ne depend d'aucun paquet externe (Node >= 18)
 *
 * Lancement :  node server/index.js   (PORT, HOST, OLLAMALOCLOUD_TOKEN)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { load, save, toPublic } = require('./config');
const providers = require('./providers');
const demo = require('./demo');

const PORT = Number(process.env.PORT || 7860);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PRESETS_PATH = path.join(ROOT, 'presets', 'system-prompts.json');
const ACCESS_TOKEN = process.env.OLLAMALOCLOUD_TOKEN || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/* ---------------------------------------------------------------- */
/* Utilitaires                                                        */
/* ---------------------------------------------------------------- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Corps de requete trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function openSse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
  };
  const close = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  };
  req.on('close', () => clearInterval(heartbeat));
  return { send, close, isOpen: () => !res.writableEnded };
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'inconnu';
}

/** Limiteur simple : N requetes lourdes simultanees par IP. */
const active = new Map();
function acquire(ip, max = 4) {
  const current = active.get(ip) || 0;
  if (current >= max) return false;
  active.set(ip, current + 1);
  return true;
}
function release(ip) {
  const current = (active.get(ip) || 1) - 1;
  if (current <= 0) active.delete(ip);
  else active.set(ip, current);
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeOptions(raw = {}, defaults = {}) {
  return {
    temperature: clampNumber(raw.temperature ?? defaults.temperature, 0, 2, 0.8),
    topP: clampNumber(raw.topP ?? defaults.topP, 0.01, 1, 0.95),
    numCtx: Math.round(clampNumber(raw.numCtx ?? defaults.numCtx, 512, 262144, 8192)),
    maxTokens: Math.round(clampNumber(raw.maxTokens ?? defaults.maxTokens, 0, 131072, 0)),
  };
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .filter((m) => ['system', 'user', 'assistant'].includes(m.role))
    .slice(-200)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 200000) }));
}

function readPresets() {
  try {
    return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
  } catch (err) {
    console.error(`[presets] illisible : ${err.message}`);
    return { presets: [] };
  }
}

function providerErrorHint(err) {
  if (err.status === 404) {
    return 'Modele introuvable. Verifie son nom dans Réglages → Modèles (ollama list).';
  }
  if (err.status === 401 || err.status === 403) {
    return 'Acces refuse : verifie la cle API dans Réglages → Fournisseur.';
  }
  if (err.status === 429) {
    return 'Trop de requetes cote fournisseur : attends quelques secondes ou change de modele.';
  }
  if (/Connexion impossible/.test(err.message)) {
    return "Le serveur de modeles n'est pas joignable. Lance-le (ollama serve) ou verifie l'adresse dans Réglages → Fournisseur.";
  }
  return '';
}

/* ---------------------------------------------------------------- */
/* Routes API                                                         */
/* ---------------------------------------------------------------- */

async function handleStatus(req, res) {
  const config = load();
  const state = await providers.status(config);
  let models = [];
  let modelsError = '';
  try {
    const provider = await providers.resolve(config);
    if (provider) models = await provider.listModels(config);
  } catch (err) {
    modelsError = err.message;
  }
  sendJson(res, 200, {
    ...state,
    defaultModel: config.defaults.model,
    models,
    modelsError: modelsError || undefined,
    configPath: require('./config').CONFIG_PATH,
  });
}

async function handleModels(req, res) {
  const config = load();
  const provider = await providers.resolve(config);
  if (!provider) return sendJson(res, 200, { models: [], demo: true });
  const models = await provider.listModels(config);
  sendJson(res, 200, { models, provider: provider.id });
}

async function handleChat(req, res, body) {
  const config = load();
  const messages = sanitizeMessages(body.messages);
  if (!messages.length) return sendJson(res, 400, { error: 'Aucun message a envoyer.' });

  const options = normalizeOptions(body.options, config.defaults);
  const sse = openSse(req, res);
  const ip = clientIp(req);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  let provider = null;
  try {
    provider = body.provider && providers.PROVIDERS[body.provider]
      ? (config.provider = body.provider, await providers.resolve({ ...config, provider: body.provider }))
      : await providers.resolve(config);
  } catch (err) {
    provider = null;
  }

  // Aucun moteur joignable -> mode demo (explication honnete, pas de fausse IA).
  if (!provider) {
    sse.send('meta', { provider: 'demo', demo: true });
    const texte = demo.reponseDemo(messages, config);
    for (const fragment of demo.tokenize(texte)) {
      if (sse.isOpen() === false) break;
      sse.send('token', { t: fragment });
      await new Promise((r) => setTimeout(r, 8));
    }
    sse.send('done', { model: 'mode-demo', demo: true });
    return sse.close();
  }

  const model = (body.model || (provider.id === 'openai' ? config.openai.model : config.defaults.model) || '').trim();
  if (!model) {
    sse.send('error', {
      message:
        provider.id === 'openai'
          ? "Aucun modele choisi : renseigne-en un dans Réglages → Fournisseur (champ « Modele par defaut »)."
          : "Aucun modele disponible : telecharge-en un (ollama pull qwen3:8b) puis rouvre Réglages → Modèles.",
    });
    return sse.close();
  }

  if (!acquire(ip)) {
    sse.send('error', { message: 'Trop de requetes simultanees depuis cet appareil. Patiente un instant.' });
    return sse.close();
  }

  sse.send('meta', { provider: provider.id, model });
  try {
    await provider.streamChat(
      config,
      { model, messages, options, signal: controller.signal },
      (event) => {
        // Normalisation du contrat SSE attendu par l'interface : { t } / { text }.
        if (event.type === 'token') sse.send('token', { t: event.text });
        else if (event.type === 'thinking') sse.send('thinking', { text: event.text });
        else sse.send(event.type, event);
      },
    );
  } catch (err) {
    if (err.name !== 'AbortError') {
      const hint = providerErrorHint(err);
      sse.send('error', { message: err.message + (hint ? ` — ${hint}` : '') });
    }
  } finally {
    release(ip);
    sse.close();
  }
}

async function handlePull(req, res, body) {
  const config = load();
  const provider = await providers.resolve(config);
  const sse = openSse(req, res);
  const name = String(body.model || '').trim();
  if (!name) {
    sse.send('error', { message: 'Nom de modele manquant.' });
    return sse.close();
  }
  if (!provider || provider.id !== 'ollama') {
    sse.send('error', { message: 'Le telechargement de modeles necessite un serveur Ollama joignable.' });
    return sse.close();
  }
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  try {
    await provider.pull(config, { model: name, signal: controller.signal }, (event) => sse.send(event.type, event));
  } catch (err) {
    sse.send('error', { message: err.message });
  } finally {
    sse.close();
  }
}

async function handleCreate(req, res, body) {
  const config = load();
  const provider = await providers.resolve(config);
  const sse = openSse(req, res);
  if (!provider || provider.id !== 'ollama') {
    sse.send('error', { message: 'La creation de modeles necessite un serveur Ollama joignable.' });
    return sse.close();
  }
  const name = String(body.name || '').trim();
  const from = String(body.from || '').trim();
  if (!name || !from) {
    sse.send('error', { message: 'Indique le modele de base et le nom du nouveau modele.' });
    return sse.close();
  }
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  try {
    const modelfile = await provider.create(
      config,
      { model: name, from, system: body.system || '', parameters: body.parameters || {}, signal: controller.signal },
      (event) => sse.send(event.type, event),
    );
    sse.send('modelfile', { content: modelfile });
  } catch (err) {
    sse.send('error', { message: err.message });
  } finally {
    sse.close();
  }
}

async function handleDeleteModel(req, res, body) {
  const config = load();
  const provider = await providers.resolve(config);
  if (!provider) return sendJson(res, 503, { error: 'Aucun fournisseur joignable.' });
  const result = await provider.remove(config, { model: String(body.model || '') });
  sendJson(res, 200, result);
}

async function handleTitle(req, res, body) {
  const config = load();
  const messages = sanitizeMessages(body.messages);
  const premier = messages.find((m) => m.role === 'user')?.content || '';
  const repli = premier.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Nouvelle conversation';
  try {
    const provider = await providers.resolve(config);
    const model = (body.model || (provider?.id === 'openai' ? config.openai.model : config.defaults.model) || '').trim();
    if (!provider || !model || provider.id === 'demo') return sendJson(res, 200, { title: repli });
    const title = await provider.chatOnce(config, {
      model,
      messages: [
        {
          role: 'system',
          content:
            "Tu generes des titres de conversation. Reponds uniquement par un titre de 3 a 6 mots, sans guillemets, sans ponctuation finale, dans la langue du message.",
        },
        { role: 'user', content: premier.slice(0, 1500) },
      ],
      options: { temperature: 0.3 },
    });
    const propre = String(title || '').replace(/["'«»\n]/g, '').trim().slice(0, 60);
    sendJson(res, 200, { title: propre || repli });
  } catch {
    sendJson(res, 200, { title: repli });
  }
}

/* ---------------------------------------------------------------- */
/* Fichiers statiques                                                 */
/* ---------------------------------------------------------------- */

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Interdit');
    return true;
  }
  let data;
  try {
    data = fs.readFileSync(target);
  } catch {
    // Routes du type /chat/abc renvoient l'application (SPA sans build).
    if (!path.extname(rel)) {
      try {
        data = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
      } catch {
        return false;
      }
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(data);
      return true;
    }
    return false;
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(data);
  return true;
}

/* ---------------------------------------------------------------- */
/* Serveur                                                            */
/* ---------------------------------------------------------------- */

function authorized(req, url) {
  if (!ACCESS_TOKEN) return true;
  const header = req.headers['x-access-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const query = url.searchParams.get('token');
  return header === ACCESS_TOKEN || query === ACCESS_TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) {
      if (!authorized(req, url)) return sendJson(res, 401, { error: "Jeton d'acces requis." });

      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
      }
      if (req.method === 'GET' && pathname === '/api/status') return await handleStatus(req, res);
      if (req.method === 'GET' && pathname === '/api/models') return await handleModels(req, res);
      if (req.method === 'GET' && pathname === '/api/presets') return sendJson(res, 200, readPresets());
      if (req.method === 'GET' && pathname === '/api/config') return sendJson(res, 200, toPublic(load()));

      if (req.method === 'PUT' && pathname === '/api/config') {
        const body = await readBody(req);
        const next = save(body);
        return sendJson(res, 200, toPublic(next));
      }
      if (req.method === 'POST' && pathname === '/api/chat') {
        const body = await readBody(req);
        return await handleChat(req, res, body);
      }
      if (req.method === 'POST' && pathname === '/api/pull') {
        const body = await readBody(req);
        return await handlePull(req, res, body);
      }
      if (req.method === 'POST' && pathname === '/api/create') {
        const body = await readBody(req);
        return await handleCreate(req, res, body);
      }
      if (req.method === 'POST' && pathname === '/api/title') {
        const body = await readBody(req);
        return await handleTitle(req, res, body);
      }
      if (req.method === 'DELETE' && pathname === '/api/models') {
        const body = await readBody(req);
        return await handleDeleteModel(req, res, body);
      }
      return sendJson(res, 404, { error: 'Route inconnue.' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Methode non autorisee.' });
    }
    if (serveStatic(req, res, pathname)) return;
    sendJson(res, 404, { error: 'Fichier introuvable.' });
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, err.status || 500, { error: err.message || 'Erreur interne.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  const config = load();
  console.log(`\n  OllamaLocloud — interface : http://localhost:${PORT}`);
  console.log(`  Ollama        : ${config.ollama.url}`);
  console.log(`  Cloud (OpenAI): ${config.openai.baseUrl}${config.openai.apiKey ? ' (cle renseignee)' : ' (sans cle)'}`);
  if (ACCESS_TOKEN) console.log('  Acces protege par jeton (OLLAMALOCLOUD_TOKEN).');
  console.log('  Arret : Ctrl+C\n');
});

process.on('SIGINT', () => {
  console.log('\nArret du serveur.');
  server.close(() => process.exit(0));
});
