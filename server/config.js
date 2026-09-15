'use strict';

/**
 * Configuration persistante d'OllamaLocloud.
 *
 * Ordre de priorite :
 *   1. variables d'environnement (lecture seule, ecrasent le fichier)
 *   2. fichier config.json (ecrit par l'interface web)
 *   3. valeurs par defaut ci-dessous
 *
 * Le fichier config.json peut contenir une cle API : il est exclu de git.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = process.env.OLLAMALOCLOUD_CONFIG || path.join(ROOT, 'config.json');

const DEFAULTS = {
  // 'auto' = on utilise Ollama s'il repond, sinon l'API compatible OpenAI, sinon le mode demo
  provider: 'auto',
  ollama: {
    url: 'http://127.0.0.1:11434',
  },
  openai: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: '',
  },
  defaults: {
    model: '',
    preset: 'libre',
    system: '',
    temperature: 0.8,
    topP: 0.95,
    numCtx: 8192,
    maxTokens: 0,
    historyLimit: 40,
  },
  ui: {
    theme: 'sombre',
    sendOnEnter: true,
    streaming: true,
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Fusion profonde : les valeurs de `patch` ecrasent celles de `base`. */
function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function envOverrides() {
  const env = {};
  if (process.env.OLLAMA_URL) env.ollama = { url: process.env.OLLAMA_URL };
  if (process.env.OPENAI_BASE_URL || process.env.OPENAI_API_KEY || process.env.OPENAI_MODEL) {
    env.openai = {};
    if (process.env.OPENAI_BASE_URL) env.openai.baseUrl = process.env.OPENAI_BASE_URL;
    if (process.env.OPENAI_API_KEY) env.openai.apiKey = process.env.OPENAI_API_KEY;
    if (process.env.OPENAI_MODEL) env.openai.model = process.env.OPENAI_MODEL;
  }
  if (process.env.OLLAMALOCLOUD_PROVIDER) env.provider = process.env.OLLAMALOCLOUD_PROVIDER;
  if (process.env.OLLAMALOCLOUD_MODEL) env.defaults = { model: process.env.OLLAMALOCLOUD_MODEL };
  return env;
}

function load() {
  let fromFile = {};
  try {
    fromFile = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[config] ${CONFIG_PATH} illisible (${err.message}), valeurs par defaut utilisees.`);
    }
  }
  return deepMerge(deepMerge(DEFAULTS, fromFile), envOverrides());
}

function save(patch) {
  const current = (() => {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      return {};
    }
  })();
  const next = deepMerge(current, patch);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return load();
}

/** Version de la config sans le secret : ce que l'interface web a le droit de lire. */
function toPublic(config) {
  return {
    ...config,
    openai: {
      baseUrl: config.openai.baseUrl,
      model: config.openai.model,
      apiKey: '',
      hasApiKey: Boolean(config.openai.apiKey),
    },
    configPath: CONFIG_PATH,
  };
}

module.exports = { DEFAULTS, CONFIG_PATH, load, save, toPublic, deepMerge };
