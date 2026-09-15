'use strict';

/**
 * Adaptateurs de fournisseurs de modeles.
 *
 * Deux familles sont supportees :
 *   - ollama : API native (http://localhost:11434) — /api/tags, /api/chat, /api/pull, /api/create
 *   - openai : toute API compatible OpenAI (/v1/models, /v1/chat/completions) — OpenRouter,
 *              llama.cpp server, LM Studio, vLLM, Together, Groq, etc.
 *
 * Toutes les fonctions "stream" emettent des evenements normalises via `emit(event)` :
 *   { type: 'token', text }        fragment de la reponse
 *   { type: 'thinking', text }     raisonnement interne (modeles de type R1)
 *   { type: 'status', text }       information de progression (telechargement, etc.)
 *   { type: 'progress', percent, status }
 *   { type: 'done', model, usage }
 *   { type: 'error', message }
 */

const OLLAMA_TIMEOUT = 4000;
const OPENAI_TIMEOUT = 8000;

class ProviderError extends Error {
  constructor(message, status = 0, body = '') {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.body = body;
  }
}

async function request(url, { method = 'GET', headers = {}, body, timeout = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ProviderError(`Delai depasse en contactant ${url}`);
    throw new ProviderError(`Connexion impossible a ${url} (${err.message})`);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/** Lit un flux texte ligne par ligne (NDJSON ou SSE). */
async function readLines(stream, onLine) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  }
  if (buffer.trim()) onLine(buffer.trim());
}

/* ------------------------------------------------------------------ */
/* Ollama                                                             */
/* ------------------------------------------------------------------ */

const ollama = {
  id: 'ollama',
  label: 'Ollama (local)',

  async info(config) {
    const base = normalizeBase(config.ollama.url);
    const res = await request(`${base}/api/version`, { timeout: OLLAMA_TIMEOUT });
    if (!res.ok) throw new ProviderError(`Ollama a repondu ${res.status}`, res.status);
    const data = await res.json().catch(() => ({}));
    return { ok: true, version: data.version || 'inconnue' };
  },

  async listModels(config) {
    const base = normalizeBase(config.ollama.url);
    const res = await request(`${base}/api/tags`, { timeout: 8000 });
    if (!res.ok) throw new ProviderError(`Ollama a repondu ${res.status} sur /api/tags`, res.status);
    const data = await res.json().catch(() => ({ models: [] }));
    return (data.models || [])
      .map((m) => ({
        id: m.name || m.model,
        provider: 'ollama',
        size: m.size || 0,
        family: m.details?.family || '',
        parameters: m.details?.parameter_size || '',
        quantization: m.details?.quantization_level || '',
        modifiedAt: m.modified_at || '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  async streamChat(config, { model, messages, options = {}, signal }, emit) {
    const base = normalizeBase(config.ollama.url);
    const payload = {
      model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature,
        top_p: options.topP,
        num_ctx: options.numCtx,
        ...(options.maxTokens > 0 ? { num_predict: options.maxTokens } : {}),
      },
    };
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderError(`Ollama a repondu ${res.status}`, res.status, detail.slice(0, 500));
    }

    let finish = null;
    await readLines(res.body, (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      if (data.error) {
        emit({ type: 'error', message: String(data.error) });
        return;
      }
      const thinking = data.message?.thinking;
      if (thinking) emit({ type: 'thinking', text: thinking });
      const text = data.message?.content;
      if (text) emit({ type: 'token', text });
      if (data.done) {
        finish = {
          type: 'done',
          model: data.model || model,
          usage: {
            promptTokens: data.prompt_eval_count || 0,
            completionTokens: data.eval_count || 0,
            totalDurationMs: data.total_duration ? Math.round(data.total_duration / 1e6) : 0,
          },
        };
      }
    });
    if (finish) emit(finish);
    else emit({ type: 'done', model });
  },

  async chatOnce(config, { model, messages, options = {}, signal }) {
    const base = normalizeBase(config.ollama.url);
    const res = await request(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { model, messages, stream: false, options: { temperature: options.temperature } },
      timeout: 120000,
    });
    if (!res.ok) throw new ProviderError(`Ollama a repondu ${res.status}`, res.status, await res.text());
    const data = await res.json();
    return data.message?.content || '';
  },

  async pull(config, { model, signal }, emit) {
    const base = normalizeBase(config.ollama.url);
    const res = await fetch(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal,
    });
    if (!res.ok) throw new ProviderError(`Ollama a repondu ${res.status} sur /api/pull`, res.status, await res.text());
    await readLines(res.body, (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      if (data.error) {
        emit({ type: 'error', message: String(data.error) });
        return;
      }
      const percent = data.total ? Math.round((data.completed / data.total) * 100) : null;
      emit({ type: 'progress', status: data.status || '', percent, total: data.total, completed: data.completed });
      if (data.status === 'success') emit({ type: 'done', model });
    });
  },

  /** Cree un modele derive (Modelfile) : base + system prompt + parametres. */
  async create(config, { model, from, system, parameters, signal }, emit) {
    const base = normalizeBase(config.ollama.url);
    const lines = [`FROM ${from}`];
    if (system && system.trim()) {
      lines.push('SYSTEM """' + system.replace(/"""/g, '\\"\\"\\"') + '"""');
    }
    if (parameters && typeof parameters === 'object') {
      for (const [key, value] of Object.entries(parameters)) {
        if (value === '' || value === null || value === undefined) continue;
        lines.push(`PARAMETER ${key} ${value}`);
      }
    }
    const modelfile = `${lines.join('\n')}\n`;

    const res = await fetch(`${base}/api/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, from, system, parameters, modelfile, stream: true }),
      signal,
    });
    if (!res.ok) throw new ProviderError(`Ollama a repondu ${res.status} sur /api/create`, res.status, await res.text());
    await readLines(res.body, (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      if (data.error) {
        emit({ type: 'error', message: String(data.error) });
        return;
      }
      emit({ type: 'progress', status: data.status || '', percent: null });
      if (data.status === 'success') emit({ type: 'done', model });
    });
    return modelfile;
  },

  async remove(config, { model }) {
    const base = normalizeBase(config.ollama.url);
    const res = await request(`${base}/api/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: { model },
      timeout: 30000,
    });
    if (!res.ok) throw new ProviderError(`Ollama a repondu ${res.status} sur /api/delete`, res.status, await res.text());
    return { ok: true };
  },
};

/* ------------------------------------------------------------------ */
/* API compatible OpenAI (OpenRouter, LM Studio, llama.cpp, vLLM...)  */
/* ------------------------------------------------------------------ */

function openaiHeaders(config) {
  const headers = { 'content-type': 'application/json' };
  if (config.openai.apiKey) headers.authorization = `Bearer ${config.openai.apiKey}`;
  // En-tetes d'identification conseilles par OpenRouter (facultatifs ailleurs).
  headers['HTTP-Referer'] = 'http://localhost';
  headers['X-Title'] = 'OllamaLocloud';
  return headers;
}

const openai = {
  id: 'openai',
  label: 'API compatible OpenAI (cloud / serveur distant)',

  async info(config) {
    const base = normalizeBase(config.openai.baseUrl);
    const res = await request(`${base}/models`, { headers: openaiHeaders(config), timeout: OPENAI_TIMEOUT });
    if (!res.ok) throw new ProviderError(`Le fournisseur a repondu ${res.status} sur /models`, res.status);
    const data = await res.json().catch(() => ({ data: [] }));
    return { ok: true, version: `${(data.data || []).length} modeles disponibles` };
  },

  async listModels(config) {
    const base = normalizeBase(config.openai.baseUrl);
    const res = await request(`${base}/models`, { headers: openaiHeaders(config), timeout: 20000 });
    if (!res.ok) throw new ProviderError(`Le fournisseur a repondu ${res.status} sur /models`, res.status);
    const data = await res.json().catch(() => ({ data: [] }));
    return (data.data || [])
      .map((m) => ({
        id: m.id,
        provider: 'openai',
        size: 0,
        family: m.owned_by || '',
        parameters: m.context_length ? `${m.context_length} ctx` : '',
        quantization: '',
        modifiedAt: m.created ? new Date(m.created * 1000).toISOString() : '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  async streamChat(config, { model, messages, options = {}, signal }, emit) {
    const base = normalizeBase(config.openai.baseUrl);
    const payload = {
      model,
      messages,
      stream: true,
      temperature: options.temperature,
      top_p: options.topP,
      ...(options.maxTokens > 0 ? { max_tokens: options.maxTokens } : {}),
    };
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: openaiHeaders(config),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderError(`Le fournisseur a repondu ${res.status}`, res.status, detail.slice(0, 500));
    }

    let finish = null;
    let usage = null;
    await readLines(res.body, (line) => {
      if (!line.startsWith('data:')) return;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === '[DONE]') return;
      let data;
      try {
        data = JSON.parse(chunk);
      } catch {
        return;
      }
      if (data.error) {
        emit({ type: 'error', message: String(data.error.message || data.error) });
        return;
      }
      const choice = (data.choices || [])[0] || {};
      const delta = choice.delta || {};
      const reasoning = delta.reasoning || delta.reasoning_content;
      if (reasoning) emit({ type: 'thinking', text: reasoning });
      if (delta.content) emit({ type: 'token', text: delta.content });
      if (data.usage) usage = data.usage;
      if (choice.finish_reason) {
        finish = {
          type: 'done',
          model: data.model || model,
          usage: usage
            ? {
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
              }
            : undefined,
        };
      }
    });
    emit(finish || { type: 'done', model });
  },

  async chatOnce(config, { model, messages, options = {} }) {
    const base = normalizeBase(config.openai.baseUrl);
    const res = await request(`${base}/chat/completions`, {
      method: 'POST',
      headers: openaiHeaders(config),
      body: { model, messages, stream: false, temperature: options.temperature },
      timeout: 120000,
    });
    if (!res.ok) throw new ProviderError(`Le fournisseur a repondu ${res.status}`, res.status, await res.text());
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  },

  async pull() {
    throw new ProviderError("Le telechargement de modeles n'existe que pour Ollama.");
  },
  async create() {
    throw new ProviderError("La creation de modeles n'existe que pour Ollama.");
  },
  async remove() {
    throw new ProviderError('La suppression de modeles est desactivee pour ce fournisseur.');
  },
};

const PROVIDERS = { ollama, openai };

/** Choisit un fournisseur : explicite, ou le premier qui repond en mode 'auto'. */
async function resolve(config) {
  if (config.provider === 'ollama' || config.provider === 'openai') {
    return PROVIDERS[config.provider];
  }
  const candidates = [];
  if (config.ollama?.url) candidates.push(ollama);
  if (config.openai?.baseUrl) candidates.push(openai);
  const results = await Promise.all(
    candidates.map(async (provider) => {
      try {
        await provider.info(config);
        return provider;
      } catch {
        return null;
      }
    }),
  );
  return results.find(Boolean) || null;
}

async function status(config) {
  const report = {};
  await Promise.all(
    ['ollama', 'openai'].map(async (id) => {
      try {
        report[id] = { available: true, ...(await PROVIDERS[id].info(config)) };
      } catch (err) {
        report[id] = { available: false, error: err.message };
      }
    }),
  );
  const active = await resolve(config);
  return {
    providers: report,
    active: active ? active.id : 'demo',
    demo: !active,
    configPath: undefined,
  };
}

module.exports = { PROVIDERS, ProviderError, resolve, status, ollama, openai, normalizeBase };
