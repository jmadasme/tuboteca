#!/usr/bin/env node
'use strict';

/**
 * Tuboteca — catálogo local de canales de YouTube.
 * Servidor sin dependencias: sirve la web y hace de proxy del canal de YouTube.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 4321);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'channels.json');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const YT_HEADERS = {
  'user-agent': UA,
  'accept-language': 'en-US,en;q=0.9',
  cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI',
};

const FEED_TTL = 10 * 60 * 1000;
const feedCache = new Map();
const FEED_CACHE_FILE = path.join(DATA_DIR, 'feed-cache.json');
let feedCacheSaveTimer = null;

// Clave pública del reproductor web de YouTube; se intenta leer de la página y
// estas solo son el último recurso si el HTML cambia o no está disponible.
const INNERTUBE_KEY = 'x';
const INNERTUBE_VERSION = '2.20261030.02.00';
const INNERTUBE_VIDEOS_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA';

// ---------------------------------------------------------------- estado

let state = { channels: [], nodes: [] };
let writeChain = Promise.resolve();

function cleanNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (!/^n_[a-z0-9]{4,40}$/.test(node.id || '')) return null;
  const name = String(node.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return null;
  return {
    id: node.id,
    name,
    parentId: typeof node.parentId === 'string' ? node.parentId : null,
    createdAt: Number(node.createdAt) || Date.now(),
  };
}

async function loadState() {
  try {
    const raw = await fsp.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    state = {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      nodes: [],
    };

    const seen = new Set();
    for (const rawNode of nodes) {
      const node = cleanNode(rawNode);
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      state.nodes.push(node);
    }

    // Referencias huérfanas y ciclos: se suben a la raíz.
    const ids = new Set(state.nodes.map((n) => n.id));
    for (const node of state.nodes) {
      if (node.parentId && !ids.has(node.parentId)) node.parentId = null;
    }
    for (const node of state.nodes) {
      const visited = new Set();
      let current = node;
      while (current.parentId) {
        if (visited.has(current.id)) {
          current.parentId = null;
          break;
        }
        visited.add(current.id);
        current = state.nodes.find((n) => n.id === current.parentId);
        if (!current) break;
      }
    }

    for (const ch of state.channels) {
      if (!ch.watched || typeof ch.watched !== 'object') ch.watched = {};
      if (!ch.nodeId || !ids.has(ch.nodeId)) ch.nodeId = null;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[estado] no se pudo leer:', err.message);
    state = { channels: [], nodes: [] };
  }
}

function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain
    .then(async () => {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${DB_FILE}.tmp`;
      await fsp.writeFile(tmp, snapshot);
      await fsp.rename(tmp, DB_FILE);
    })
    .catch((err) => console.error('[estado] no se pudo guardar:', err.message));
  return writeChain;
}

async function loadFeedCache() {
  try {
    const raw = await fsp.readFile(FEED_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const known = new Set(state.channels.map((channel) => channel.id));
    for (const [id, entry] of Object.entries(parsed || {})) {
      if (!known.has(id)) continue;
      if (!Array.isArray(entry?.data?.videos) || !entry.data.videos.length) continue;
      feedCache.set(id, { at: Number(entry.at) || 0, data: entry.data });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[feeds] no pude leer la caché:', err.message);
  }
}

function scheduleFeedCacheSave() {
  if (feedCacheSaveTimer) return;
  feedCacheSaveTimer = setTimeout(() => {
    feedCacheSaveTimer = null;
    const snapshot = {};
    for (const [id, entry] of feedCache) {
      snapshot[id] = { at: entry.at, data: entry.data };
    }
    fsp
      .mkdir(DATA_DIR, { recursive: true })
      .then(async () => {
        const tmp = `${FEED_CACHE_FILE}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(snapshot));
        await fsp.rename(tmp, FEED_CACHE_FILE);
      })
      .catch((err) => console.error('[feeds] no pude guardar la caché:', err.message));
  }, 1500);
  feedCacheSaveTimer.unref?.();
}

// ---------------------------------------------------------------- utilidades

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.publicMessage = message;
  return err;
}

function extract(re, text) {
  const m = text.match(re);
  return m ? m[1] : null;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function retryable(err) {
  err.retryable = true;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Descarga con reintentos para errores transitorios (429, 5xx, timeouts).
async function fetchResponse(url, opts = {}) {
  const attempts = Math.max(1, Number(opts.attempts) || 2);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let res;
      try {
        res = await fetch(url, {
          method: opts.method || 'GET',
          body: opts.body,
          headers: { ...YT_HEADERS, ...(opts.headers || {}) },
          redirect: 'follow',
          signal: AbortSignal.timeout(opts.timeout || 20000),
        });
      } catch (err) {
        if (err.name === 'TimeoutError') {
          throw retryable(httpError(504, 'YouTube tardó demasiado en responder'));
        }
        throw retryable(httpError(502, `No se pudo conectar con YouTube (${err.message})`));
      }

      if (res.ok) return res;

      if (res.status === 404) throw httpError(404, 'Canal o feed no encontrado');
      const err = httpError(502, `YouTube respondió ${res.status}`);
      if (res.status === 429 || res.status >= 500) throw retryable(err);
      throw err;
    } catch (err) {
      lastError = err;
      if (!err.retryable || attempt === attempts) throw err;
      await sleep(300 * attempt);
    }
  }

  throw lastError;
}

async function fetchText(url, opts = {}) {
  const res = await fetchResponse(url, opts);
  return res.text();
}

async function fetchJson(url, opts = {}) {
  const res = await fetchResponse(url, opts);
  try {
    return await res.json();
  } catch {
    throw httpError(502, 'YouTube devolvió una respuesta que no pude leer');
  }
}

// ---------------------------------------------------------------- YouTube

function cleanChannel(ch) {
  if (!ch || typeof ch !== 'object') return null;
  if (!/^UC[\w-]{22}$/.test(ch.id || '')) return null;
  return {
    id: ch.id,
    title: String(ch.title || 'Canal').slice(0, 200),
    avatar: /^https?:\/\//.test(ch.avatar || '') ? ch.avatar : '',
    addedAt: Number(ch.addedAt) || Date.now(),
    watched: ch.watched && typeof ch.watched === 'object' ? ch.watched : {},
    nodeId: typeof ch.nodeId === 'string' ? ch.nodeId : null,
  };
}

function nodeById(id) {
  return state.nodes.find((node) => node.id === id) || null;
}

function nodeDepth(node) {
  const visited = new Set();
  let depth = 0;
  let current = node;
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    current = nodeById(current.parentId);
    depth += 1;
  }
  return depth;
}

function isDescendantOf(nodeId, ancestorId) {
  const visited = new Set();
  let current = nodeById(nodeId);
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = nodeById(current.parentId);
  }
  return false;
}

function newNodeId() {
  return `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeNodeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function metaFromHtml(html, fallbackId) {
  const id =
    extract(/"externalId":"(UC[\w-]{22})"/, html) ||
    extract(/"channelId":"(UC[\w-]{22})"/, html) ||
    extract(/channel\/(UC[\w-]{22})/, html) ||
    fallbackId;

  if (!/^UC[\w-]{22}$/.test(id || '')) {
    throw httpError(422, 'No pude identificar el canal. Prueba pegando su enlace /channel/UC…');
  }

  const title =
    decodeXml(extract(/<meta property="og:title" content="([^"]*)"/, html) || '') ||
    decodeXml(extract(/<title>([^<]*)<\/title>/, html) || '') ||
    'Canal';

  const avatar = extract(/<meta property="og:image" content="([^"]*)"/, html) || '';
  return { id, title: title.replace(/\s*-\s*YouTube\s*$/, ''), avatar };
}

async function fetchChannelMeta(id) {
  const html = await fetchText(`https://www.youtube.com/channel/${id}`);
  return metaFromHtml(html, id);
}

async function resolveInput(raw) {
  const input = String(raw || '').trim();
  if (!input) throw httpError(400, 'Pega un enlace o el @usuario del canal');

  let target;
  if (/^UC[\w-]{22}$/.test(input)) {
    target = `https://www.youtube.com/channel/${input}`;
  } else if (/^@[\w.-]+/.test(input)) {
    target = `https://www.youtube.com/${input.split(/[/?#]/)[0]}`;
  } else if (/^https?:\/\//i.test(input)) {
    target = input;
  } else if (/^[\w-]{3,}$/.test(input)) {
    target = `https://www.youtube.com/@${input}`;
  } else {
    throw httpError(400, 'No reconozco ese formato. Usa @usuario o el enlace del canal');
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    throw httpError(400, 'Enlace no válido');
  }

  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') {
    throw httpError(400, 'Solo acepto enlaces de YouTube');
  }

  const isVideo =
    host === 'youtu.be' ||
    url.pathname === '/watch' ||
    url.pathname.startsWith('/shorts/') ||
    url.pathname.startsWith('/live/');

  if (isVideo) {
    const html = await fetchText(url.href);
    const id =
      extract(/"channelId":"(UC[\w-]{22})"/, html) ||
      extract(/"externalId":"(UC[\w-]{22})"/, html) ||
      extract(/channel\/(UC[\w-]{22})/, html);
    if (!id) throw httpError(422, 'No pude detectar el canal de ese vídeo');
    return fetchChannelMeta(id);
  }

  const html = await fetchText(url.href);
  return metaFromHtml(html);
}

function jsonAfterMarker(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

function parseViewCount(value) {
  const text = String(value || '').replace(/,/g, '');
  const match = text.match(
    /([\d.]+)\s*(mil millones|thousand|million|billion|mil|mill[oó]n|[KMB])?/i
  );
  if (!match) return 0;
  const suffix = (match[2] || '').toLowerCase();
  const multiplier =
    {
      k: 1e3,
      thousand: 1e3,
      mil: 1e3,
      m: 1e6,
      million: 1e6,
      'millón': 1e6,
      millon: 1e6,
      b: 1e9,
      billion: 1e9,
      'mil millones': 1e9,
    }[suffix] || 1;
  return Math.round(parseFloat(match[1]) * multiplier) || 0;
}

// YouTube ya no publica fechas exactas en la parrilla del canal: solo "hace 4 días".
function relativeDate(value) {
  const text = String(value || '').toLowerCase();
  const match = text.match(
    /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|segundos?|minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?|s|m|h|d|w|y)/
  );
  if (!match) return '';

  const amount = Number(match[1]);
  const unit = match[2];
  const seconds = {
    s: 1,
    sec: 1,
    second: 1,
    seconds: 1,
    secs: 1,
    segundo: 1,
    segundos: 1,
    m: 60,
    min: 60,
    mins: 60,
    minute: 60,
    minutes: 60,
    minuto: 60,
    minutos: 60,
    h: 3600,
    hr: 3600,
    hrs: 3600,
    hour: 3600,
    hours: 3600,
    hora: 3600,
    horas: 3600,
    d: 86400,
    day: 86400,
    days: 86400,
    dia: 86400,
    dias: 86400,
    'día': 86400,
    'días': 86400,
    w: 604800,
    week: 604800,
    weeks: 604800,
    semana: 604800,
    semanas: 604800,
    month: 2592000,
    months: 2592000,
    mes: 2592000,
    meses: 2592000,
    y: 31536000,
    year: 31536000,
    years: 31536000,
    ano: 31536000,
    anos: 31536000,
    'año': 31536000,
    'años': 31536000,
  }[unit];

  if (!seconds) return '';
  return new Date(Date.now() - amount * seconds * 1000).toISOString();
}

function videoFromLockup(lockup) {
  const id = lockup?.contentId;
  if (!/^[\w-]{11}$/.test(id || '')) return null;

  const meta = lockup.metadata?.lockupMetadataViewModel || {};
  const rows = meta.metadata?.contentMetadataViewModel?.metadataRows || [];
  const parts = rows.flatMap((row) => row.metadataParts || []);
  let views = 0;
  let published = '';

  for (const part of parts) {
    const text = part.text?.content || '';
    const label = part.accessibilityLabel || text;
    if (part.leadingIcon?.name === 'PLAY_ARROW_OUTLINED' || /views?|visitas?/i.test(label)) {
      views = parseViewCount(text || label);
    } else if (/ago|streamed|premier|hace|emiti|estren/i.test(label)) {
      published = relativeDate(label);
    }
  }

  const sources = lockup.contentImage?.thumbnailViewModel?.image?.sources || [];
  const thumb =
    sources.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

  return { id, title: meta.title?.content || 'Vídeo', published, thumb, views };
}

function videoFromRenderer(video) {
  const id = video?.videoId;
  if (!/^[\w-]{11}$/.test(id || '')) return null;

  const thumbs = video.thumbnail?.thumbnails || [];
  const title =
    video.title?.runs?.map((run) => run.text).join('') || video.title?.simpleText || 'Vídeo';

  return {
    id,
    title,
    published: relativeDate(video.publishedTimeText?.simpleText || ''),
    thumb: thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    views: parseViewCount(video.viewCountText?.simpleText || ''),
  };
}

function collectChannelVideos(value, out, seen) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectChannelVideos(item, out, seen);
    return;
  }

  const parsed =
    videoFromLockup(value.lockupViewModel) ||
    videoFromRenderer(value.videoRenderer) ||
    videoFromRenderer(value.gridVideoRenderer);
  if (parsed && !seen.has(parsed.id)) {
    seen.add(parsed.id);
    out.push(parsed);
  }

  for (const key of Object.keys(value)) collectChannelVideos(value[key], out, seen);
}

function parseChannelData(data, channelId) {
  const title =
    data.header?.pageHeaderRenderer?.pageTitle ||
    data.metadata?.channelMetadataRenderer?.title ||
    data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.title ||
    '';

  const videos = [];
  collectChannelVideos(data.contents, videos, new Set());

  return {
    id: channelId,
    title: decodeXml(title),
    videos: videos.map((video) => ({
      ...video,
      published: video.published || new Date().toISOString(),
    })),
  };
}

function parseChannelPage(html, channelId) {
  const raw = jsonAfterMarker(html, 'ytInitialData =');
  if (!raw) throw httpError(502, 'YouTube no devolvió la lista de vídeos del canal');

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw httpError(502, 'YouTube devolvió una página que no pude leer');
  }

  return parseChannelData(data, channelId);
}

// Segunda fuente: API interna (Innertube), que devuelve JSON en vez de HTML.
async function fetchInnertubeFeed(channelId, html) {
  const key = extract(/"INNERTUBE_API_KEY":"([^"]+)"/, html || '') || INNERTUBE_KEY;
  const version =
    extract(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/, html || '') || INNERTUBE_VERSION;

  const data = await fetchJson(
    `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: { clientName: 'WEB', clientVersion: version, hl: 'en', gl: 'US' },
        },
        browseId: channelId,
        params: INNERTUBE_VIDEOS_PARAMS,
      }),
      timeout: 15000,
    }
  );

  return parseChannelData(data, channelId);
}

// Tercera fuente: página de la lista de subidos (UU…), distinta de /videos.
async function fetchPlaylistFeed(channelId) {
  const playlistId = `UU${channelId.slice(2)}`;
  const html = await fetchText(
    `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    { timeout: 12000 }
  );
  return parseChannelPage(html, channelId);
}

async function readFeed(channelId) {
  let html = '';
  let htmlError = null;

  try {
    html = await fetchText(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/videos`, {
      timeout: 12000,
    });
    const data = parseChannelPage(html, channelId);
    if (data.videos.length) return data;
    htmlError = httpError(502, 'La página del canal no trajo vídeos');
  } catch (err) {
    htmlError = err;
  }

  let innertubeError = null;
  try {
    const data = await fetchInnertubeFeed(channelId, html);
    if (data.videos.length) {
      console.warn(`[feed ${channelId}] HTML falló (${htmlError.message}); usé Innertube`);
      return data;
    }
    innertubeError = httpError(502, 'Innertube no trajo vídeos');
  } catch (err) {
    innertubeError = err;
  }

  try {
    const data = await fetchPlaylistFeed(channelId);
    if (data.videos.length) {
      console.warn(`[feed ${channelId}] HTML e Innertube fallaron; usé la lista de subidos`);
      return data;
    }
    console.error(
      `[feed ${channelId}] todas las fuentes fallaron: ` +
        `HTML=${htmlError.message}; Innertube=${innertubeError.message}; lista sin vídeos`
    );
  } catch (err) {
    console.error(
      `[feed ${channelId}] todas las fuentes fallaron: ` +
        `HTML=${htmlError.message}; Innertube=${innertubeError.message}; lista=${err.message}`
    );
  }

  if (htmlError.status === 404 && innertubeError.status === 404) {
    throw httpError(404, 'Canal o feed no encontrado');
  }
  throw httpError(502, 'YouTube no respondió o cambió su web; revisa server.log');
}

async function getFeed(channelId, force = false) {
  const cached = feedCache.get(channelId);
  if (!force && cached && Date.now() - cached.at < FEED_TTL) return cached.data;

  let data;
  try {
    data = await readFeed(channelId);
  } catch (err) {
    if (cached?.data?.videos?.length) {
      console.warn(
        `[feed ${channelId}] ${err.message}; devuelvo la copia de ` +
          new Date(cached.at).toISOString()
      );
      return { ...cached.data, stale: true, cachedAt: cached.at };
    }
    throw err;
  }

  feedCache.set(channelId, { at: Date.now(), data });
  scheduleFeedCacheSave();
  return data;
}

// ---------------------------------------------------------------- Brave

const BRAVE_BINS = ['brave-browser', 'brave-browser-stable', 'brave'];

function spawnDetached(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(bin);
    });
  });
}

async function openInBrowser(url) {
  let lastError = null;
  for (const bin of BRAVE_BINS) {
    try {
      return await spawnDetached(bin, [url]);
    } catch (err) {
      lastError = err;
    }
  }
  try {
    return await spawnDetached('xdg-open', [url]);
  } catch {
    throw httpError(
      500,
      `No encontré Brave en el sistema${lastError ? ` (${lastError.message})` : ''}`
    );
  }
}

// ---------------------------------------------------------------- HTTP

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw httpError(413, 'Cuerpo demasiado grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'JSON no válido');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw httpError(400, 'Ruta no válida');
  }
  if (decoded === '/' || decoded === '') decoded = '/index.html';

  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    throw httpError(403, 'Prohibido');
  }

  let content;
  try {
    content = await fsp.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') throw httpError(404, 'No encontrado');
    throw err;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(content);
}

function channelSummary(ch) {
  return { ...ch };
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/ping') {
    return sendJson(res, 200, { ok: true, app: 'tuboteca' });
  }

  if (p === '/api/state' && method === 'GET') {
    return sendJson(res, 200, {
      channels: state.channels.map(channelSummary),
      nodes: state.nodes.map((node) => ({ ...node })),
    });
  }

  if (p === '/api/channels' && method === 'POST') {
    const body = await readJson(req);
    const meta = await resolveInput(body.input);

    const existing = state.channels.find((c) => c.id === meta.id);
    if (existing) {
      return sendJson(res, 200, { channel: existing, existed: true });
    }

    const nodeId = body.nodeId && nodeById(body.nodeId) ? body.nodeId : null;
    const channel = cleanChannel({
      id: meta.id,
      title: meta.title,
      avatar: meta.avatar,
      addedAt: Date.now(),
      watched: {},
      nodeId,
    });
    state.channels.push(channel);
    await saveState();
    return sendJson(res, 201, { channel, existed: false });
  }

  const channelMatch = p.match(/^\/api\/channels\/(UC[\w-]{22})$/);
  if (channelMatch && method === 'PATCH') {
    const ch = state.channels.find((c) => c.id === channelMatch[1]);
    if (!ch) throw httpError(404, 'Ese canal no está en el catálogo');
    const body = await readJson(req);

    if (Object.prototype.hasOwnProperty.call(body, 'nodeId')) {
      if (body.nodeId !== null && !nodeById(body.nodeId)) {
        throw httpError(400, 'La carpeta de destino no existe');
      }
      ch.nodeId = body.nodeId ?? null;
    }

    await saveState();
    return sendJson(res, 200, { channel: ch });
  }

  if (channelMatch && method === 'DELETE') {
    const id = channelMatch[1];
    const idx = state.channels.findIndex((c) => c.id === id);
    if (idx === -1) throw httpError(404, 'Ese canal no está en el catálogo');
    state.channels.splice(idx, 1);
    feedCache.delete(id);
    scheduleFeedCacheSave();
    await saveState();
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/nodes' && method === 'POST') {
    const body = await readJson(req);
    const name = normalizeNodeName(body.name);
    if (!name) throw httpError(400, 'La carpeta necesita un nombre');

    const parentId = body.parentId ?? null;
    if (parentId !== null) {
      const parent = nodeById(parentId);
      if (!parent) throw httpError(400, 'La carpeta padre no existe');
      if (nodeDepth(parent) >= 5) throw httpError(400, 'Máximo 6 niveles de carpetas');
    }

    const node = {
      id: newNodeId(),
      name,
      parentId,
      createdAt: Date.now(),
    };
    state.nodes.push(node);
    await saveState();
    return sendJson(res, 201, { node });
  }

  const nodeMatch = p.match(/^\/api\/nodes\/(n_[a-z0-9]{4,40})$/);
  if (nodeMatch && method === 'PATCH') {
    const node = nodeById(nodeMatch[1]);
    if (!node) throw httpError(404, 'Esa carpeta no existe');
    const body = await readJson(req);

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = normalizeNodeName(body.name);
      if (!name) throw httpError(400, 'La carpeta necesita un nombre');
      node.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'parentId')) {
      const parentId = body.parentId ?? null;
      if (parentId === node.id) throw httpError(400, 'Una carpeta no puede contenerse a sí misma');
      if (parentId !== null) {
        const parent = nodeById(parentId);
        if (!parent) throw httpError(400, 'La carpeta de destino no existe');
        if (isDescendantOf(parentId, node.id)) {
          throw httpError(400, 'No puedo mover una carpeta dentro de sí misma');
        }
        if (nodeDepth(parent) >= 5) throw httpError(400, 'Máximo 6 niveles de carpetas');
      }
      node.parentId = parentId;
    }

    await saveState();
    return sendJson(res, 200, { node });
  }

  if (nodeMatch && method === 'DELETE') {
    const node = nodeById(nodeMatch[1]);
    if (!node) throw httpError(404, 'Esa carpeta no existe');

    let movedChannels = 0;
    let movedNodes = 0;
    for (const child of state.nodes) {
      if (child.parentId === node.id) {
        child.parentId = node.parentId;
        movedNodes += 1;
      }
    }
    for (const ch of state.channels) {
      if (ch.nodeId === node.id) {
        ch.nodeId = node.parentId;
        movedChannels += 1;
      }
    }
    state.nodes = state.nodes.filter((n) => n.id !== node.id);
    await saveState();
    return sendJson(res, 200, {
      ok: true,
      parentId: node.parentId,
      movedChannels,
      movedNodes,
    });
  }

  const watchedMatch = p.match(/^\/api\/channels\/(UC[\w-]{22})\/watched$/);
  if (watchedMatch && method === 'POST') {
    const ch = state.channels.find((c) => c.id === watchedMatch[1]);
    if (!ch) throw httpError(404, 'Ese canal no está en el catálogo');
    const body = await readJson(req);
    if (!/^[\w-]{11}$/.test(body.videoId || '')) throw httpError(400, 'Vídeo no válido');
    if (!ch.watched || typeof ch.watched !== 'object') ch.watched = {};
    if (body.watched === false) delete ch.watched[body.videoId];
    else ch.watched[body.videoId] = Date.now();

    const entries = Object.entries(ch.watched);
    if (entries.length > 400) {
      entries.sort((a, b) => b[1] - a[1]);
      ch.watched = Object.fromEntries(entries.slice(0, 400));
    }
    await saveState();
    return sendJson(res, 200, { ok: true, watched: ch.watched });
  }

  const seenAllMatch = p.match(/^\/api\/channels\/(UC[\w-]{22})\/seen-all$/);
  if (seenAllMatch && method === 'POST') {
    const ch = state.channels.find((c) => c.id === seenAllMatch[1]);
    if (!ch) throw httpError(404, 'Ese canal no está en el catálogo');
    const body = await readJson(req);
    const ids = Array.isArray(body.videoIds) ? body.videoIds : [];
    if (!ch.watched || typeof ch.watched !== 'object') ch.watched = {};
    const now = Date.now();
    for (const id of ids) {
      if (/^[\w-]{11}$/.test(id)) ch.watched[id] = now;
    }
    await saveState();
    return sendJson(res, 200, { ok: true, watched: ch.watched });
  }

  const feedMatch = p.match(/^\/api\/feed\/(UC[\w-]{22})$/);
  if (feedMatch && method === 'GET') {
    const force = url.searchParams.get('force') === '1';
    const data = await getFeed(feedMatch[1], force);
    return sendJson(res, 200, data);
  }

  if (p === '/api/open' && method === 'POST') {
    const body = await readJson(req);
    let target;
    try {
      target = new URL(String(body.url || ''));
    } catch {
      throw httpError(400, 'URL no válida');
    }
    const host = target.hostname.replace(/^www\./, '');
    if (
      target.protocol !== 'https:' ||
      !['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)
    ) {
      throw httpError(400, 'Solo puedo abrir enlaces de YouTube');
    }
    const browser = await openInBrowser(target.href);
    return sendJson(res, 200, { ok: true, browser });
  }

  throw httpError(404, 'Ruta no encontrada');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw httpError(405, 'Método no permitido');
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[${req.method} ${req.url}]`, err);
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, status, { error: err.publicMessage || 'Error interno del servidor' });
  }
});

(async () => {
  await loadState();
  await loadFeedCache();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Tuboteca escuchando en http://127.0.0.1:${PORT}`);
    console.log(`Datos: ${DB_FILE}`);
  });
})();

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
