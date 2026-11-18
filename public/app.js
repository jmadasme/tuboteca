'use strict';

/* Tuboteca — interfaz con árbol de carpetas */

const mainEl = document.getElementById('main');
const listEl = document.getElementById('channel-list');
const countEl = document.getElementById('channel-count');
const addForm = document.getElementById('add-form');
const addField = addForm.querySelector('.add-field');
const addInput = document.getElementById('add-input');
const addSubmit = document.getElementById('add-submit');
const addNodeBtn = document.getElementById('add-node');
const refreshAllBtn = document.getElementById('refresh-all');
const toastsEl = document.getElementById('toasts');
const popoverEl = document.getElementById('node-popover');

const dialogBackdrop = document.getElementById('dialog-backdrop');
const dialogForm = document.getElementById('dialog-form');
const dialogTitle = document.getElementById('dialog-title');
const dialogDesc = document.getElementById('dialog-desc');
const dialogInputField = document.getElementById('dialog-input-field');
const dialogInputLabel = document.getElementById('dialog-input-label');
const dialogInput = document.getElementById('dialog-input');
const dialogSelectField = document.getElementById('dialog-select-field');
const dialogSelectLabel = document.getElementById('dialog-select-label');
const dialogSelect = document.getElementById('dialog-select');
const dialogCancel = document.getElementById('dialog-cancel');
const dialogConfirm = document.getElementById('dialog-confirm');

const ROOT_NODE = '__root__';

const app = {
  channels: [],
  nodes: [],
  feeds: new Map(),
  pending: new Map(),
  selected: null,
  selectedNode: null,
  player: null,
  adding: false,
  dragChannelId: null,
  collapsed: loadCollapsed(),
};

const watchQueues = new Map();
let nodeRefreshTimer = null;

const SUGGESTIONS = [
  { handle: '@veritasium', label: 'Veritasium', tag: 'Ciencia' },
  { handle: '@kurzgesagt', label: 'Kurzgesagt', tag: 'Animación' },
  { handle: '@3blue1brown', label: '3Blue1Brown', tag: 'Matemáticas' },
  { handle: '@Computerphile', label: 'Computerphile', tag: 'Informática' },
  { handle: '@fireship', label: 'Fireship', tag: 'Desarrollo' },
  { handle: '@DotCSV', label: 'Dot CSV', tag: 'IA' },
  { handle: '@midudev', label: 'midudev', tag: 'Desarrollo' },
  { handle: '@QuantumFracture', label: 'QuantumFracture', tag: 'Física' },
];

const viewsFmt = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

const ICON = {
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  folderOpen: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 8V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 9h16l-1.6 8.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8L3 10.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  tray: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 13h4l1.5 2h5L16 13h4M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  move: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 13.5h5m-2-2 2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>',
};

// ---------------------------------------------------------------- helpers

function loadCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem('tuboteca.collapsed') || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed() {
  localStorage.setItem('tuboteca.collapsed', JSON.stringify([...app.collapsed]));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function initial(text) {
  const chars = Array.from(String(text || '?').trim());
  return (chars[0] || '?').toUpperCase();
}

function timeAgo(value) {
  const then = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = (then - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'hace un momento';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return rtf.format(Math.round(diff / 60), 'minute');
}

function fmtViews(n) {
  if (!n) return 'sin datos de visitas';
  return `${viewsFmt.format(n)} visitas`;
}

function thumbUrl(id, big = true) {
  return `https://i.ytimg.com/vi/${id}/${big ? 'hq720' : 'mqdefault'}.jpg`;
}

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  toastsEl.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 6500 : 3200);
}

// ---------------------------------------------------------------- árbol

function nodeById(id) {
  return app.nodes.find((node) => node.id === id) || null;
}

function childNodes(parentId) {
  return app.nodes.filter((node) => (node.parentId || null) === (parentId || null));
}

function channelsDirect(nodeId) {
  if (nodeId === ROOT_NODE) return app.channels.filter((channel) => !channel.nodeId);
  return app.channels.filter((channel) => channel.nodeId === nodeId);
}

function channelsSubtree(nodeId, seen = new Set()) {
  if (nodeId === ROOT_NODE) return channelsDirect(ROOT_NODE);
  if (seen.has(nodeId)) return [];
  seen.add(nodeId);
  let out = [...channelsDirect(nodeId)];
  for (const child of childNodes(nodeId)) {
    out = out.concat(channelsSubtree(child.id, seen));
  }
  return out;
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

function nodePath(nodeId) {
  const path = [];
  const visited = new Set();
  let current = nodeById(nodeId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? nodeById(current.parentId) : null;
  }
  return path;
}

function nodeDisplayName(nodeId) {
  if (nodeId === ROOT_NODE || !nodeId) return 'Sin carpeta';
  return nodeById(nodeId)?.name || 'Sin carpeta';
}

function currentNode() {
  if (!app.selectedNode || app.selectedNode === ROOT_NODE) return null;
  return nodeById(app.selectedNode);
}

function currentChannel() {
  return app.channels.find((channel) => channel.id === app.selected) || null;
}

function expandNode(nodeId) {
  if (!nodeId) return;
  if (nodeId === ROOT_NODE) {
    app.collapsed.delete(ROOT_NODE);
  } else {
    const visited = new Set();
    let current = nodeById(nodeId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      app.collapsed.delete(current.id);
      current = current.parentId ? nodeById(current.parentId) : null;
    }
  }
  saveCollapsed();
}

function toggleNode(nodeId) {
  if (app.collapsed.has(nodeId)) app.collapsed.delete(nodeId);
  else app.collapsed.add(nodeId);
  saveCollapsed();
  renderSidebar();
}

function destinationNodeId() {
  if (app.selectedNode) return app.selectedNode === ROOT_NODE ? null : app.selectedNode;
  return currentChannel()?.nodeId || null;
}

function aggregateDot(channels) {
  if (!channels.length) return { cls: 'gray', title: 'Carpeta sin canales' };
  let unseen = 0;
  let unknown = false;
  for (const channel of channels) {
    const feed = feedFor(channel.id);
    if (!feed?.videos?.length) {
      unknown = true;
      continue;
    }
    if (!channel.watched?.[feed.videos[0].id]) unseen += 1;
  }
  if (unseen) {
    return {
      cls: 'red',
      title: `${unseen} canal${unseen === 1 ? '' : 'es'} con el último vídeo sin ver`,
    };
  }
  if (unknown) return { cls: 'gray', title: 'Cargando estados' };
  return { cls: 'green', title: 'Últimos vídeos vistos' };
}

function saveSelection() {
  if (app.selectedNode) {
    localStorage.setItem('tuboteca.selection', JSON.stringify({ type: 'node', id: app.selectedNode }));
  } else if (app.selected) {
    localStorage.setItem('tuboteca.selection', JSON.stringify({ type: 'channel', id: app.selected }));
  } else {
    localStorage.removeItem('tuboteca.selection');
  }

  if (app.selected) localStorage.setItem('tuboteca.selected', app.selected);
  else localStorage.removeItem('tuboteca.selected');
}

// ---------------------------------------------------------------- API

async function parseResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const api = {
  async get(path) {
    return parseResponse(await fetch(path));
  },
  async post(path, body) {
    return parseResponse(
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
    );
  },
  async patch(path, body) {
    return parseResponse(
      await fetch(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
    );
  },
  async del(path) {
    return parseResponse(await fetch(path, { method: 'DELETE' }));
  },
};

// ---------------------------------------------------------------- feeds

function feedFor(id) {
  return app.feeds.get(id) || null;
}

function unseenCount(channel, feed) {
  if (!feed || !feed.videos) return 0;
  return feed.videos.filter((v) => !channel.watched?.[v.id]).length;
}

function dotInfo(channel, feed) {
  if (!feed || (feed.status === 'loading' && !feed.videos?.length)) {
    return { cls: 'gray loading', title: 'Cargando…' };
  }
  if (!feed.videos?.length) {
    return { cls: 'gray', title: feed.status === 'error' ? 'No se pudo cargar' : 'Sin vídeos' };
  }
  const latest = feed.videos[0];
  const suffix = feed.stale ? ' (copia guardada)' : '';
  return channel.watched?.[latest.id]
    ? { cls: 'green', title: `Último vídeo visto${suffix}` }
    : { cls: 'red', title: `Último vídeo sin ver${suffix}` };
}

function subText(channel, feed) {
  if (!feed || (feed.status === 'loading' && !feed.videos?.length)) return 'Cargando…';
  if (feed.status === 'error' && !feed.videos?.length) return 'Error al cargar';
  const latest = feed.videos?.[0];
  if (!latest) return 'Sin vídeos';
  return `Último: ${timeAgo(latest.published)}${feed.stale ? ' · copia guardada' : ''}`;
}

function metaText(channel, feed) {
  if (!feed || (feed.status === 'loading' && !feed.videos?.length)) return 'Cargando vídeos…';
  if (feed.status === 'error' && !feed.videos?.length) return 'No se pudieron cargar los vídeos';
  const videos = feed.videos || [];
  if (!videos.length) return 'El feed de este canal está vacío';
  const unseen = unseenCount(channel, feed);
  const parts = [`${videos.length} vídeos`, unseen ? `${unseen} sin ver` : 'todo visto'];
  if (feed.at) parts.push(`actualizado ${timeAgo(feed.at)}`);
  if (feed.stale) parts.push('copia guardada: YouTube no responde');
  return parts.join(' · ');
}

// ---------------------------------------------------------------- sidebar

function avatarHTML(channel, className = 'avatar') {
  if (channel.avatar) {
    return `<img class="${className}" src="${esc(channel.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }
  return `<span class="avatar-fallback">${esc(initial(channel.title))}</span>`;
}

function channelRowHTML(channel, depth = 0) {
  const feed = feedFor(channel.id);
  const dot = dotInfo(channel, feed);
  const unseen = unseenCount(channel, feed);
  const active = channel.id === app.selected && !app.selectedNode;
  const badge = unseen
    ? `<span class="channel-badge" title="${unseen} sin ver">${unseen > 99 ? '99+' : unseen}</span>`
    : '';

  return `
    <div class="channel-row${active ? ' active' : ''}" data-row="${channel.id}"
         data-drag-channel="${channel.id}" draggable="true" style="--depth:${depth}">
      <button class="channel-item" type="button" data-channel="${channel.id}"
              ${active ? 'aria-current="true"' : ''} title="${esc(channel.title)}">
        <span class="avatar-wrap">
          ${avatarHTML(channel)}
          <span class="dot status-dot ${dot.cls}" title="${esc(dot.title)}"></span>
        </span>
        <span class="channel-meta">
          <span class="channel-name">${esc(channel.title)}</span>
          <span class="channel-sub">${esc(subText(channel, feed))}</span>
        </span>
        ${badge}
      </button>
      <span class="channel-actions">
        <button class="mini-btn" type="button" data-move-channel="${channel.id}"
                title="Mover a una carpeta" aria-label="Mover ${esc(channel.title)} a una carpeta">${ICON.move}</button>
        <button class="mini-btn danger" type="button" data-remove="${channel.id}"
                title="Quitar del catálogo" aria-label="Quitar ${esc(channel.title)}">${ICON.x}</button>
      </span>
    </div>`;
}

function nodeRowHTML(node, depth) {
  const expanded = !app.collapsed.has(node.id);
  const active = app.selectedNode === node.id;
  const channels = channelsSubtree(node.id);
  const dot = aggregateDot(channels);

  return `
    <div class="node-row${active ? ' active' : ''}" style="--depth:${depth}"
         data-node-row="${node.id}" data-drop-node="${node.id}">
      <button class="node-chevron${expanded ? ' open' : ''}" type="button" data-toggle-node="${node.id}"
              title="${expanded ? 'Contraer' : 'Expandir'}" aria-label="${expanded ? 'Contraer' : 'Expandir'} ${esc(node.name)}"
              aria-expanded="${expanded}">${ICON.chevron}</button>
      <button class="node-main" type="button" data-node-select="${node.id}"
              ${active ? 'aria-current="true"' : ''} title="${esc(node.name)}">
        <span class="node-icon">${expanded ? ICON.folderOpen : ICON.folder}</span>
        <span class="node-name">${esc(node.name)}</span>
        <span class="dot node-dot ${dot.cls}" title="${esc(dot.title)}"></span>
        <span class="node-count" title="${channels.length} canales">${channels.length}</span>
      </button>
      <button class="node-menu-btn" type="button" data-node-menu="${node.id}"
              title="Opciones de carpeta" aria-label="Opciones de ${esc(node.name)}">${ICON.dots}</button>
    </div>`;
}

function rootRowHTML() {
  const expanded = !app.collapsed.has(ROOT_NODE);
  const active = app.selectedNode === ROOT_NODE;
  const channels = channelsDirect(ROOT_NODE);
  const dot = aggregateDot(channels);

  return `
    <div class="node-row root-node${active ? ' active' : ''}" style="--depth:0"
         data-node-row="${ROOT_NODE}" data-drop-node="${ROOT_NODE}">
      <button class="node-chevron${expanded ? ' open' : ''}" type="button" data-toggle-node="${ROOT_NODE}"
              title="${expanded ? 'Contraer' : 'Expandir'}" aria-label="Expandir Sin carpeta"
              aria-expanded="${expanded}">${ICON.chevron}</button>
      <button class="node-main" type="button" data-node-select="${ROOT_NODE}"
              ${active ? 'aria-current="true"' : ''} title="Canales sin carpeta">
        <span class="node-icon tray-icon">${ICON.tray}</span>
        <span class="node-name">Sin carpeta</span>
        <span class="dot node-dot ${dot.cls}" title="${esc(dot.title)}"></span>
        <span class="node-count">${channels.length}</span>
      </button>
    </div>`;
}

function nodeTreeHTML(node, depth) {
  const expanded = !app.collapsed.has(node.id);
  const children = childNodes(node.id);
  const channels = channelsDirect(node.id);

  let html = nodeRowHTML(node, depth);
  if (!expanded) return html;

  if (!children.length && !channels.length) {
    return html + `<p class="node-empty" style="--depth:${depth + 1}">Carpeta vacía</p>`;
  }

  for (const child of children) html += nodeTreeHTML(child, depth + 1);
  for (const channel of channels) html += channelRowHTML(channel, depth + 1);
  return html;
}

function renderSidebar() {
  const scrollTop = listEl.scrollTop;
  countEl.textContent = String(app.channels.length);

  if (!app.channels.length && !app.nodes.length) {
    listEl.innerHTML = '<p class="list-empty">Aún no hay canales.<br>Crea una carpeta con el icono <b>+</b> o pega un canal arriba.</p>';
    return;
  }

  let html = '';
  if (app.nodes.length) {
    for (const node of childNodes(null)) html += nodeTreeHTML(node, 0);
    html += rootRowHTML();
    if (!app.collapsed.has(ROOT_NODE)) {
      const rootChannels = channelsDirect(ROOT_NODE);
      for (const channel of rootChannels) html += channelRowHTML(channel, 1);
      if (!rootChannels.length) {
        html += '<p class="node-empty" style="--depth:1">Arrastra un canal aquí para sacarlo de su carpeta.</p>';
      }
    }
  } else {
    for (const channel of app.channels) html += channelRowHTML(channel, 0);
  }

  listEl.innerHTML = html;
  listEl.scrollTop = scrollTop;
}

// ---------------------------------------------------------------- main

function breadcrumbHTML(nodeId) {
  if (!nodeId || nodeId === ROOT_NODE) {
    if (!app.nodes.length) return '';
    return '<button type="button" class="crumb current" data-node-select="__root__">Sin carpeta</button>';
  }
  const path = nodePath(nodeId);
  if (!path.length) return '';
  return path.map((node, index) => {
    const current = index === path.length - 1;
    return `<button type="button" class="crumb${current ? ' current' : ''}" data-node-select="${node.id}">${esc(node.name)}</button>`;
  }).join('<span class="crumb-sep">/</span>');
}

function channelHeaderHTML(channel, feed) {
  const unseen = unseenCount(channel, feed);
  const canMarkAll = unseen > 0;
  const crumb = breadcrumbHTML(channel.nodeId || (app.nodes.length ? ROOT_NODE : null));
  return `
    <header class="channel-head">
      ${avatarHTML(channel)}
      <div class="head-text">
        ${crumb ? `<p class="head-path">${crumb}</p>` : ''}
        <h2>${esc(channel.title)}</h2>
        <p class="head-meta" id="ch-meta">${esc(metaText(channel, feed))}</p>
      </div>
      <div class="head-actions">
        <button class="btn small" type="button" data-action="refresh-channel" title="Volver a pedir los últimos vídeos">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Actualizar
        </button>
        <button class="btn small" type="button" data-action="open-channel" title="Abrir el canal en Brave">
          Ver en Brave
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn small" type="button" data-action="seen-all" ${canMarkAll ? '' : 'disabled'} title="Marcar todos los vídeos del feed como vistos">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Todo visto
        </button>
        <button class="btn small btn-danger" type="button" data-action="remove-channel" title="Quitar este canal del catálogo">Quitar</button>
      </div>
    </header>`;
}

function playerHTML(channel, video) {
  const seen = !!channel.watched?.[video.id];
  return `
    <section class="player" aria-label="Reproductor">
      <div class="player-frame">
        <iframe
          src="https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1"
          title="${esc(video.title)}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen></iframe>
      </div>
      <div class="player-info">
        <div class="player-text">
          <h3>${esc(video.title)}</h3>
          <p>${fmtViews(video.views)} · ${timeAgo(video.published)}</p>
        </div>
        <div class="player-actions">
          <button class="btn small" type="button" data-action="player-brave" title="Abrir este vídeo en Brave">
            Ver en Brave
            <svg viewBox="0 0 24 24" width="13" height="13"><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn small" type="button" data-action="player-seen" id="player-seen-toggle">
            ${seen ? 'Marcar como no visto' : 'Marcar como visto'}
          </button>
          <button class="btn small btn-ghost" type="button" data-action="close-player" title="Cerrar reproductor" aria-label="Cerrar reproductor">✕</button>
        </div>
      </div>
    </section>`;
}

function checkIcon(seen) {
  return seen
    ? '<svg viewBox="0 0 24 24" width="13" height="13"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
}

function videoCardHTML(channel, video, index) {
  const seen = !!channel.watched?.[video.id];
  const isLatest = index === 0;
  const title = esc(video.title);
  return `
    <article class="video-card${seen ? ' seen' : ''}" data-video-id="${video.id}" tabindex="0" role="button"
             aria-label="Reproducir ${title}">
      <div class="thumb">
        <img src="${thumbUrl(video.id)}" alt="" loading="lazy" referrerpolicy="no-referrer"
             onerror="this.onerror=null;this.src='${thumbUrl(video.id, false)}'">
        <span class="play-hover" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5.5 19 12 8 18.5z" fill="currentColor"/></svg>
        </span>
        <button class="seen-check" type="button" data-toggle-seen="${video.id}"
                title="${seen ? 'Marcar como no visto' : 'Marcar como visto'}"
                aria-label="${seen ? 'Marcar como no visto' : 'Marcar como visto'}">${checkIcon(seen)}</button>
        <button class="card-ext" type="button" data-open-video="${video.id}" title="Abrir en Brave" aria-label="Abrir en Brave">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="video-body">
        <h3 class="video-title">${title}${!seen && isLatest ? '<span class="new-tag">nuevo</span>' : ''}</h3>
        <p class="video-meta">${fmtViews(video.views)} · ${timeAgo(video.published)}</p>
      </div>
    </article>`;
}

function gridHTML(channel, videos) {
  return `
    <div class="grid-head">
      <h3>Últimos vídeos</h3>
      <span class="video-meta">${videos.length} en el feed</span>
    </div>
    <div class="video-grid">
      ${videos.map((v, i) => videoCardHTML(channel, v, i)).join('')}
    </div>`;
}

function skeletonHTML() {
  return `
    <div class="grid-head"><h3>Últimos vídeos</h3></div>
    <div class="skeleton-grid">
      ${Array.from({ length: 6 }, () => `
        <div class="skeleton-card">
          <div class="skeleton-thumb"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>`).join('')}
    </div>`;
}

function feedErrorHTML(message) {
  return `
    <div class="error-box">
      <h3>No pude cargar los vídeos</h3>
      <p>${esc(message || 'YouTube no respondió como esperaba.')}</p>
      <button class="btn" type="button" data-action="retry-feed">Reintentar</button>
    </div>`;
}

function emptyHTML() {
  const chips = SUGGESTIONS.map((s) => `
    <button class="chip" type="button" data-handle="${esc(s.handle)}" title="Añadir ${esc(s.label)}">
      <span class="chip-avatar">${esc(initial(s.label))}</span>
      ${esc(s.label)}
      <span class="chip-tag">${esc(s.tag)}</span>
    </button>`).join('');

  return `
    <div class="empty">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30"><path d="M8 5.5 19 12 8 18.5z" fill="currentColor"/></svg>
      </div>
      <h2>${app.channels.length ? 'Elige un canal' : 'Tu catálogo está vacío'}</h2>
      <p>Pega el enlace o el <code>@usuario</code> de un canal en el buscador y se añadirá a tu colección. También puedes crear carpetas temáticas con el icono de carpeta junto a «Biblioteca».</p>
      <div class="suggestions">${chips}</div>
      <p class="empty-note">
        <i class="dot green"></i> visto
        <span style="color:#3a3a44">·</span>
        <i class="dot red"></i> con novedades
        <span style="color:#3a3a44">·</span>
        sin anuncios con Brave
      </p>
    </div>`;
}

function folderCardHTML(node) {
  const channels = channelsSubtree(node.id);
  const dot = aggregateDot(channels);
  const subfolders = childNodes(node.id).length;
  return `
    <button class="folder-card" type="button" data-node-select="${node.id}" title="Abrir ${esc(node.name)}">
      <span class="folder-card-icon">${ICON.folder}</span>
      <span class="folder-card-text">
        <strong>${esc(node.name)}</strong>
        <span>${channels.length} canal${channels.length === 1 ? '' : 'es'}${subfolders ? ` · ${subfolders} subcarpeta${subfolders === 1 ? '' : 's'}` : ''}</span>
      </span>
      <span class="dot ${dot.cls}" title="${esc(dot.title)}"></span>
    </button>`;
}

function folderChannelHTML(channel) {
  const feed = feedFor(channel.id);
  const dot = dotInfo(channel, feed);
  const unseen = unseenCount(channel, feed);
  const latest = feed?.videos?.[0];
  let meta = 'Sin datos del feed';
  if (latest) {
    meta = `${unseen ? `${unseen} sin ver` : 'Al día'} · último ${timeAgo(latest.published)}`;
  }
  return `
    <article class="folder-channel" data-channel="${channel.id}" data-drag-channel="${channel.id}"
             draggable="true" tabindex="0" role="button" aria-label="Abrir ${esc(channel.title)}">
      ${avatarHTML(channel)}
      <div class="folder-channel-text">
        <h3>${esc(channel.title)}</h3>
        <p>${esc(meta)}</p>
      </div>
      <span class="dot ${dot.cls}" title="${esc(dot.title)}"></span>
    </article>`;
}

function folderEmptyHTML(isRoot) {
  return `
    <div class="folder-empty">
      <div class="folder-empty-icon">${ICON.folderOpen}</div>
      <h3>${isRoot ? 'No hay canales sin carpeta' : 'Esta carpeta está vacía'}</h3>
      <p>${isRoot
        ? 'Todos los canales están clasificados. Arrastra uno hasta «Sin carpeta» si quieres sacarlo de su carpeta.'
        : 'Arrastra canales desde la izquierda hasta aquí, o crea una subcarpeta para seguir organizando.'}</p>
      ${isRoot ? '' : '<button class="btn small" type="button" data-action="node-new">Nueva subcarpeta</button>'}
    </div>`;
}

function renderNodeMain(scrollTop) {
  const isRoot = app.selectedNode === ROOT_NODE;
  const node = currentNode();
  if (!isRoot && !node) {
    app.selectedNode = null;
    saveSelection();
    renderMain();
    return;
  }

  const name = node ? node.name : 'Sin carpeta';
  document.title = `${name} — Tuboteca`;

  const children = node ? childNodes(node.id) : [];
  const direct = channelsDirect(app.selectedNode);
  const subtree = channelsSubtree(app.selectedNode);
  const withNews = subtree.filter((channel) => {
    const feed = feedFor(channel.id);
    return feed?.videos?.length && !channel.watched?.[feed.videos[0].id];
  }).length;
  const aggregate = aggregateDot(subtree);
  const crumb = isRoot
    ? '<button type="button" class="crumb current" data-node-select="__root__">Sin carpeta</button>'
    : breadcrumbHTML(node.id);

  const metaParts = [`${subtree.length} canal${subtree.length === 1 ? '' : 'es'}`];
  if (children.length) metaParts.push(`${children.length} subcarpeta${children.length === 1 ? '' : 's'}`);
  if (subtree.length) {
    metaParts.push(
      aggregate.cls === 'red'
        ? `${withNews} con novedades`
        : aggregate.cls === 'green'
          ? 'todo al día'
          : 'cargando estados'
    );
  }

  const actions = `
    <div class="head-actions">
      <button class="btn small" type="button" data-action="node-new" title="${isRoot ? 'Crear una carpeta' : 'Crear una subcarpeta'}">
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 11v5M9.5 13.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        ${isRoot ? 'Nueva carpeta' : 'Nueva subcarpeta'}
      </button>
      ${isRoot ? '' : `
        <button class="btn small" type="button" data-action="node-rename" title="Cambiar el nombre de la carpeta">Renombrar</button>
        <button class="btn small btn-danger" type="button" data-action="node-delete" title="Eliminar la carpeta">Eliminar</button>`}
    </div>`;

  const subfoldersHTML = children.length ? `
    <section class="folder-section">
      <div class="grid-head">
        <h3>Subcarpetas</h3>
        <span class="video-meta">${children.length}</span>
      </div>
      <div class="folder-grid">${children.map(folderCardHTML).join('')}</div>
    </section>` : '';

  const channelsHTML = direct.length ? `
    <section class="folder-section">
      <div class="grid-head">
        <h3>${isRoot ? 'Canales sin carpeta' : 'Canales'}</h3>
        <span class="video-meta">${direct.length}</span>
      </div>
      <div class="folder-grid">${direct.map(folderChannelHTML).join('')}</div>
    </section>` : '';

  const empty = !children.length && !direct.length ? folderEmptyHTML(isRoot) : '';

  mainEl.innerHTML = `
    <header class="channel-head folder-head">
      <span class="folder-hero">${ICON.folderOpen}</span>
      <div class="head-text">
        <p class="head-path">${crumb}</p>
        <h2>${esc(name)}</h2>
        <p class="head-meta">${metaParts.join(' · ')}</p>
      </div>
      ${actions}
    </header>
    ${subfoldersHTML}
    ${channelsHTML}
    ${empty}`;

  mainEl.scrollTop = scrollTop;
}

function renderMain() {
  const scrollTop = mainEl.scrollTop;
  if (app.selectedNode) {
    renderNodeMain(scrollTop);
    return;
  }

  const channel = currentChannel();
  if (!channel) {
    document.title = 'Tuboteca — tu catálogo de YouTube';
    mainEl.innerHTML = emptyHTML();
    return;
  }

  document.title = `${channel.title} — Tuboteca`;
  const feed = feedFor(channel.id);
  const hasVideos = feed?.videos?.length;

  let body;
  if (!feed || (feed.status === 'loading' && !hasVideos)) body = skeletonHTML();
  else if (feed.status === 'error' && !hasVideos) body = feedErrorHTML(feed.error);
  else body = `<div id="grid-holder">${gridHTML(channel, feed.videos)}</div>`;

  mainEl.innerHTML = `
    ${channelHeaderHTML(channel, feed)}
    ${app.player ? playerHTML(channel, app.player.video) : ''}
    ${body}`;

  mainEl.scrollTop = scrollTop;
}

function updateHeaderMeta() {
  const channel = currentChannel();
  const node = document.getElementById('ch-meta');
  if (!channel || !node) return;
  node.textContent = metaText(channel, feedFor(channel.id));
}

function renderGridOnly() {
  const channel = currentChannel();
  const holder = document.getElementById('grid-holder');
  if (!channel || !holder) return;
  const feed = feedFor(channel.id);
  if (!feed?.videos) return;
  holder.innerHTML = gridHTML(channel, feed.videos);
}

function updateWatchedUI(restoreFocusSelector) {
  const channel = currentChannel();
  if (!channel) return;

  renderGridOnly();
  updateHeaderMeta();

  const toggle = document.getElementById('player-seen-toggle');
  if (toggle && app.player) {
    const seen = !!channel.watched?.[app.player.video.id];
    toggle.textContent = seen ? 'Marcar como no visto' : 'Marcar como visto';
  }

  const seenAllButton = mainEl.querySelector('[data-action="seen-all"]');
  if (seenAllButton) {
    seenAllButton.disabled = unseenCount(channel, feedFor(channel.id)) === 0;
  }

  if (restoreFocusSelector) {
    const node = document.querySelector(restoreFocusSelector);
    if (node) node.focus({ preventScroll: true });
  }
}

// ---------------------------------------------------------------- selección

function selectChannel(id) {
  if (!app.channels.some((channel) => channel.id === id)) return;
  if (app.selected === id && !app.selectedNode) return;
  if (app.selected !== id) app.player = null;
  const channel = app.channels.find((c) => c.id === id);
  if (channel?.nodeId) expandNode(channel.nodeId);
  app.selected = id;
  app.selectedNode = null;
  saveSelection();
  renderSidebar();
  renderMain();
  mainEl.scrollTop = 0;

  const feed = feedFor(id);
  if (!feed || (!feed.loading && !feed.videos?.length)) loadFeed(id);
}

function selectNode(id) {
  if (id !== ROOT_NODE && !nodeById(id)) return;
  app.selectedNode = id;
  app.selected = null;
  app.player = null;
  if (id === ROOT_NODE) {
    app.collapsed.delete(ROOT_NODE);
    saveCollapsed();
  } else {
    expandNode(id);
  }
  saveSelection();
  renderSidebar();
  renderMain();
  mainEl.scrollTop = 0;
}

// ---------------------------------------------------------------- feeds / refresco

async function loadFeed(id, opts = {}) {
  if (app.pending.has(id)) return app.pending.get(id);
  const previous = feedFor(id);

  app.feeds.set(id, {
    status: previous?.videos?.length ? 'ready' : 'loading',
    videos: previous?.videos || [],
    at: previous?.at || 0,
    stale: previous?.stale || false,
    error: null,
    loading: true,
  });
  renderSidebar();

  const task = (async () => {
    try {
      const data = await api.get(`/api/feed/${encodeURIComponent(id)}${opts.force ? '?force=1' : ''}`);
      app.feeds.set(id, {
        status: 'ready',
        videos: Array.isArray(data.videos) ? data.videos : [],
        title: data.title || '',
        at: data.stale && data.cachedAt ? data.cachedAt : Date.now(),
        stale: Boolean(data.stale),
        error: null,
        loading: false,
      });
    } catch (err) {
      const kept = previous?.videos || [];
      app.feeds.set(id, {
        status: kept.length ? 'ready' : 'error',
        videos: kept,
        at: previous?.at || 0,
        error: err.message,
        loading: false,
      });
      if (!opts.quiet) {
        const channel = app.channels.find((c) => c.id === id);
        toast(`No pude cargar ${channel ? channel.title : 'el canal'}: ${err.message}`, 'error');
      }
    } finally {
      app.pending.delete(id);
      renderSidebar();
      if (app.selected === id) {
        updateHeaderMeta();
        if (app.player) renderGridOnly();
        else renderMain();
      } else if (app.selectedNode) {
        clearTimeout(nodeRefreshTimer);
        nodeRefreshTimer = setTimeout(() => {
          if (app.selectedNode) renderMain();
        }, 250);
      }
    }
    return feedFor(id);
  })();

  app.pending.set(id, task);
  return task;
}

async function mapLimit(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

let refreshing = false;
async function refreshAll(opts = {}) {
  if (refreshing || !app.channels.length) return;
  refreshing = true;
  refreshAllBtn.classList.add('refreshing');
  refreshAllBtn.disabled = true;
  try {
    await mapLimit(app.channels, 4, (channel) =>
      loadFeed(channel.id, { quiet: true, force: !!opts.force })
    );
    if (!opts.quiet) {
      const failed = app.channels.filter((c) => feedFor(c.id)?.error).length;
      if (failed) toast(`Actualizado, pero ${failed} canal${failed === 1 ? '' : 'es'} dio error`, 'error');
      else toast('Catálogo actualizado', 'ok');
    }
  } finally {
    refreshing = false;
    refreshAllBtn.classList.remove('refreshing');
    refreshAllBtn.disabled = false;
  }
}

// ---------------------------------------------------------------- vídeo y vistos

function playVideo(videoId) {
  const channel = currentChannel();
  if (!channel) return;
  const video = feedFor(channel.id)?.videos?.find((v) => v.id === videoId);
  if (!video) return;

  app.player = { video };
  setWatched(channel.id, videoId, true, { silent: true });
  renderMain();
  mainEl.scrollTo({ top: 0, behavior: 'smooth' });
}

function setWatched(channelId, videoId, watched, opts = {}) {
  const channel = app.channels.find((c) => c.id === channelId);
  if (!channel) return;
  if (!channel.watched || typeof channel.watched !== 'object') channel.watched = {};

  if (watched) channel.watched[videoId] = Date.now();
  else delete channel.watched[videoId];

  renderSidebar();
  if (!opts.silent && app.selected === channelId) {
    updateWatchedUI(`[data-toggle-seen="${videoId}"]`);
  }

  queueWatched(channelId, videoId, watched);
}

function queueWatched(channelId, videoId, watched) {
  const previous = watchQueues.get(channelId) || Promise.resolve();
  const next = previous
    .then(() => api.post(`/api/channels/${channelId}/watched`, { videoId, watched }))
    .catch((err) => toast(`No pude guardar el estado: ${err.message}`, 'error'));
  watchQueues.set(channelId, next);
  return next;
}

function queueSeenAll(channelId, videoIds) {
  const previous = watchQueues.get(channelId) || Promise.resolve();
  const next = previous
    .then(() => api.post(`/api/channels/${channelId}/seen-all`, { videoIds }))
    .catch((err) => toast(`No pude guardar el estado: ${err.message}`, 'error'));
  watchQueues.set(channelId, next);
  return next;
}

async function markAllSeen() {
  const channel = currentChannel();
  const feed = feedFor(channel?.id);
  if (!channel || !feed?.videos?.length) return;

  const ids = feed.videos.map((v) => v.id);
  const now = Date.now();
  if (!channel.watched || typeof channel.watched !== 'object') channel.watched = {};
  for (const id of ids) channel.watched[id] = now;

  renderSidebar();
  updateWatchedUI();
  queueSeenAll(channel.id, ids);
  toast(`«${channel.title}» marcado como visto`, 'ok');
}

// ---------------------------------------------------------------- canales

async function removeChannel(id) {
  const channel = app.channels.find((c) => c.id === id);
  if (!channel) return;
  if (!window.confirm(`¿Quitar «${channel.title}» del catálogo?\n\nSolo se borra de esta lista; no se toca tu cuenta de YouTube.`)) {
    return;
  }
  try {
    await api.del(`/api/channels/${id}`);
    app.channels = app.channels.filter((c) => c.id !== id);
    app.feeds.delete(id);

    if (app.selected === id) {
      app.selected = null;
      app.player = null;
      if (app.channels.length) {
        app.selected = app.channels[0].id;
      } else if (app.nodes.length) {
        app.selectedNode = app.nodes.find((n) => !n.parentId)?.id || app.nodes[0].id;
      }
      saveSelection();
    }

    renderSidebar();
    renderMain();
    if (app.selected && !feedFor(app.selected)?.videos?.length) loadFeed(app.selected);
    toast('Canal quitado del catálogo', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function askMoveChannel(channel) {
  openSelectDialog({
    title: 'Mover canal',
    description: `Elige la carpeta de «${channel.title}».`,
    label: 'Carpeta',
    options: flattenedNodeOptions(),
    value: channel.nodeId || ROOT_NODE,
    confirmLabel: 'Mover',
    onSubmit: (value) => moveChannel(channel.id, value),
  });
}

async function moveChannel(channelId, destination) {
  const channel = app.channels.find((c) => c.id === channelId);
  if (!channel) return;
  const target = destination === ROOT_NODE ? null : destination;
  if ((channel.nodeId || null) === target) return;

  try {
    const { channel: updated } = await api.patch(`/api/channels/${channelId}`, { nodeId: target });
    channel.nodeId = updated.nodeId ?? null;
    if (target) expandNode(target);
    renderSidebar();
    if (app.selectedNode) {
      renderMain();
    } else if (app.selected === channelId && !app.player) {
      renderMain();
    }
    toast(`«${channel.title}» movido a ${target ? `«${nodeDisplayName(target)}»` : '«Sin carpeta»'}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function addChannel(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    addInput.focus();
    return;
  }
  if (app.adding) return;

  setAdding(true);
  try {
    const destination = destinationNodeId();
    const { channel, existed } = await api.post('/api/channels', { input, nodeId: destination });
    const index = app.channels.findIndex((c) => c.id === channel.id);
    if (index >= 0) app.channels[index] = channel;
    else app.channels.push(channel);

    addInput.value = '';
    addField.classList.remove('error');
    setAdding(false);

    if (channel.nodeId) expandNode(channel.nodeId);
    renderSidebar();
    selectChannel(channel.id);

    const folder = destination ? nodeById(destination) : null;
    if (existed) toast('Ese canal ya estaba en el catálogo', 'ok');
    else toast(`Añadido: ${channel.title}${folder ? ` en «${folder.name}»` : ''}`, 'ok');

    if (!feedFor(channel.id)?.videos?.length) loadFeed(channel.id, { quiet: existed });
  } catch (err) {
    addField.classList.add('error');
    setTimeout(() => addField.classList.remove('error'), 2600);
    toast(err.message, 'error');
    setAdding(false);
  }
}

// ---------------------------------------------------------------- nodos CRUD

function askNewNode(parentId = null) {
  const parent = parentId ? nodeById(parentId) : null;
  openInputDialog({
    title: parent ? 'Nueva subcarpeta' : 'Nueva carpeta',
    description: parent
      ? `Se creará dentro de «${parent.name}».`
      : 'Crea una carpeta temática y arrastra canales dentro.',
    label: 'Nombre',
    placeholder: 'Ciencia, IA, Electrónica, Web3…',
    confirmLabel: 'Crear',
    onSubmit: (name) => createNode(name, parentId),
  });
}

async function createNode(name, parentId) {
  try {
    const { node } = await api.post('/api/nodes', { name, parentId });
    app.nodes.push(node);
    if (parentId) expandNode(parentId);
    renderSidebar();
    selectNode(node.id);
    toast(`Carpeta «${node.name}» creada`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function askRenameNode(node) {
  openInputDialog({
    title: 'Renombrar carpeta',
    description: 'El nombre se actualiza en todo el árbol.',
    label: 'Nombre',
    value: node.name,
    confirmLabel: 'Guardar',
    onSubmit: (name) => renameNode(node, name),
  });
}

async function renameNode(node, name) {
  if (name === node.name) return;
  try {
    const { node: updated } = await api.patch(`/api/nodes/${node.id}`, { name });
    node.name = updated.name;
    renderSidebar();
    renderMain();
    toast('Carpeta renombrada', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function askMoveNode(node) {
  openSelectDialog({
    title: 'Mover carpeta',
    description: `Elige dónde colocar «${node.name}» y todo su contenido.`,
    label: 'Carpeta destino',
    options: flattenedNodeOptions(node.id),
    value: node.parentId || ROOT_NODE,
    confirmLabel: 'Mover',
    onSubmit: (value) => moveNode(node, value === ROOT_NODE ? null : value),
  });
}

async function moveNode(node, parentId) {
  if ((node.parentId || null) === parentId) return;
  try {
    const { node: updated } = await api.patch(`/api/nodes/${node.id}`, { parentId });
    node.parentId = updated.parentId ?? null;
    if (parentId) expandNode(parentId);
    renderSidebar();
    renderMain();
    toast(`«${node.name}» movida`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteNode(node) {
  const channels = channelsSubtree(node.id);
  const subfolders = childNodes(node.id).length;
  const extra = channels.length || subfolders
    ? '\n\nNo se borrará ningún canal: su contenido pasará al nivel superior.'
    : '\n\nLa carpeta está vacía.';
  if (!window.confirm(`¿Eliminar la carpeta «${node.name}»?${extra}`)) return;

  const selectionWasInside = app.selectedNode === node.id
    || (app.selectedNode && isDescendantOf(app.selectedNode, node.id));

  try {
    await api.del(`/api/nodes/${node.id}`);
    for (const child of app.nodes) {
      if (child.parentId === node.id) child.parentId = node.parentId;
    }
    for (const channel of app.channels) {
      if (channel.nodeId === node.id) channel.nodeId = node.parentId;
    }
    app.nodes = app.nodes.filter((n) => n.id !== node.id);

    if (selectionWasInside) {
      app.player = null;
      if (node.parentId) {
        app.selectedNode = node.parentId;
      } else {
        const rootNode = app.nodes.find((n) => !n.parentId);
        if (rootNode) app.selectedNode = rootNode.id;
        else if (app.channels.length) app.selectedNode = ROOT_NODE;
        else app.selectedNode = null;
        app.selected = null;
      }
      saveSelection();
    }

    renderSidebar();
    renderMain();
    if (app.selected && !feedFor(app.selected)?.videos?.length) loadFeed(app.selected);
    const hasContent = channels.length > 0 || subfolders > 0;
    toast(`Carpeta eliminada${hasContent ? '; su contenido pasó al nivel superior' : ''}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function flattenedNodeOptions(excludeId = null) {
  const options = [{ value: ROOT_NODE, label: 'Sin carpeta' }];
  const walk = (parentId, depth) => {
    for (const node of childNodes(parentId)) {
      if (node.id === excludeId) continue;
      if (excludeId && isDescendantOf(node.id, excludeId)) continue;
      options.push({ value: node.id, label: `${'— '.repeat(depth)}${node.name}` });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return options;
}

// ---------------------------------------------------------------- menú de nodo

function openNodeMenu(anchor, nodeId) {
  const node = nodeById(nodeId);
  if (!node) return;
  const canSub = nodeDepth(node) < 5;

  popoverEl.innerHTML = `
    ${canSub ? '<button type="button" data-pop="sub">Nueva subcarpeta</button>' : ''}
    <button type="button" data-pop="rename">Renombrar</button>
    <button type="button" data-pop="move">Mover a…</button>
    <hr>
    <button type="button" class="danger" data-pop="delete">Eliminar carpeta</button>`;
  popoverEl.dataset.nodeId = nodeId;
  popoverEl.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const width = popoverEl.offsetWidth;
  const height = popoverEl.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function closePopover() {
  popoverEl.hidden = true;
}

// ---------------------------------------------------------------- diálogo

let dialogMode = 'input';
let dialogSubmit = null;

function openInputDialog(opts) {
  dialogMode = 'input';
  dialogTitle.textContent = opts.title || 'Nombre';
  dialogDesc.textContent = opts.description || '';
  dialogInputField.hidden = false;
  dialogSelectField.hidden = true;
  dialogInputLabel.textContent = opts.label || 'Nombre';
  dialogInput.value = opts.value || '';
  dialogInput.placeholder = opts.placeholder || '';
  dialogConfirm.textContent = opts.confirmLabel || 'Guardar';
  dialogSubmit = opts.onSubmit || null;
  dialogBackdrop.hidden = false;
  requestAnimationFrame(() => {
    dialogInput.focus();
    dialogInput.select();
  });
}

function openSelectDialog(opts) {
  dialogMode = 'select';
  dialogTitle.textContent = opts.title || 'Mover';
  dialogDesc.textContent = opts.description || '';
  dialogInputField.hidden = true;
  dialogSelectField.hidden = false;
  dialogSelectLabel.textContent = opts.label || 'Destino';
  dialogSelect.innerHTML = (opts.options || [])
    .map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`)
    .join('');
  dialogSelect.value = opts.value || ROOT_NODE;
  dialogConfirm.textContent = opts.confirmLabel || 'Mover';
  dialogSubmit = opts.onSubmit || null;
  dialogBackdrop.hidden = false;
  requestAnimationFrame(() => dialogSelect.focus());
}

function closeDialog() {
  dialogBackdrop.hidden = true;
  dialogSubmit = null;
}

// ---------------------------------------------------------------- Brave / añadir

async function openInBrave(url) {
  try {
    await api.post('/api/open', { url });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openVideoInBrave(videoId) {
  const channel = currentChannel();
  if (channel) setWatched(channel.id, videoId, true);
  openInBrave(`https://www.youtube.com/watch?v=${videoId}`);
}

function setAdding(value) {
  app.adding = value;
  addSubmit.disabled = value;
  addSubmit.classList.toggle('loading', value);
  addInput.disabled = value;
  document.querySelectorAll('.chip').forEach((chip) => { chip.disabled = value; });
}

// ---------------------------------------------------------------- eventos

addForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addChannel(addInput.value);
});

document.getElementById('open-add').addEventListener('click', () => {
  addInput.focus();
  addInput.select();
});

addNodeBtn.addEventListener('click', () => askNewNode(null));
refreshAllBtn.addEventListener('click', () => refreshAll({ force: true }));

listEl.addEventListener('click', (event) => {
  const menu = event.target.closest('[data-node-menu]');
  if (menu) {
    event.stopPropagation();
    openNodeMenu(menu, menu.dataset.nodeMenu);
    return;
  }

  const toggle = event.target.closest('[data-toggle-node]');
  if (toggle) {
    event.stopPropagation();
    toggleNode(toggle.dataset.toggleNode);
    return;
  }

  const remove = event.target.closest('[data-remove]');
  if (remove) {
    event.stopPropagation();
    removeChannel(remove.dataset.remove);
    return;
  }

  const move = event.target.closest('[data-move-channel]');
  if (move) {
    event.stopPropagation();
    const channel = app.channels.find((c) => c.id === move.dataset.moveChannel);
    if (channel) askMoveChannel(channel);
    return;
  }

  const nodeBtn = event.target.closest('[data-node-select]');
  if (nodeBtn) {
    selectNode(nodeBtn.dataset.nodeSelect);
    return;
  }

  const item = event.target.closest('[data-channel]');
  if (item) selectChannel(item.dataset.channel);
});

listEl.addEventListener('dragstart', (event) => {
  const row = event.target.closest('[data-drag-channel]');
  if (!row) return;
  app.dragChannelId = row.dataset.dragChannel;
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', app.dragChannelId);
});

listEl.addEventListener('dragend', () => {
  app.dragChannelId = null;
  listEl.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  listEl.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
});

listEl.addEventListener('dragover', (event) => {
  const target = event.target.closest('[data-drop-node]');
  if (!target || !app.dragChannelId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  target.classList.add('drop-hover');
});

listEl.addEventListener('dragleave', (event) => {
  const target = event.target.closest('[data-drop-node]');
  if (!target) return;
  if (!target.contains(event.relatedTarget)) target.classList.remove('drop-hover');
});

listEl.addEventListener('drop', (event) => {
  const target = event.target.closest('[data-drop-node]');
  if (!target || !app.dragChannelId) return;
  event.preventDefault();
  const channelId = app.dragChannelId;
  app.dragChannelId = null;
  target.classList.remove('drop-hover');
  moveChannel(channelId, target.dataset.dropNode);
});

mainEl.addEventListener('dragstart', (event) => {
  const card = event.target.closest('[data-drag-channel]');
  if (!card) return;
  app.dragChannelId = card.dataset.dragChannel;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', app.dragChannelId);
});

mainEl.addEventListener('dragend', () => {
  app.dragChannelId = null;
  mainEl.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  listEl.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
});

mainEl.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-handle]');
  if (chip) {
    addChannel(chip.dataset.handle);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    const channel = currentChannel();
    const node = currentNode();
    const name = action.dataset.action;

    if (name === 'refresh-channel' && channel) loadFeed(channel.id, { force: true });
    else if (name === 'open-channel' && channel) openInBrave(`https://www.youtube.com/channel/${channel.id}`);
    else if (name === 'seen-all') markAllSeen();
    else if (name === 'remove-channel' && channel) removeChannel(channel.id);
    else if (name === 'retry-feed' && channel) loadFeed(channel.id, { force: true });
    else if (name === 'node-new') {
      if (app.selectedNode === ROOT_NODE || !app.selectedNode) askNewNode(null);
      else askNewNode(app.selectedNode);
    } else if (name === 'node-rename' && node) askRenameNode(node);
    else if (name === 'node-delete' && node) deleteNode(node);
    else if (name === 'close-player') {
      app.player = null;
      renderMain();
    } else if (name === 'player-brave' && app.player) {
      openVideoInBrave(app.player.video.id);
    } else if (name === 'player-seen' && app.player && channel) {
      const seen = !!channel.watched?.[app.player.video.id];
      setWatched(channel.id, app.player.video.id, !seen);
    }
    return;
  }

  const nodeButton = event.target.closest('[data-node-select]');
  if (nodeButton) {
    selectNode(nodeButton.dataset.nodeSelect);
    return;
  }

  const folderChannel = event.target.closest('[data-channel]');
  if (folderChannel) {
    selectChannel(folderChannel.dataset.channel);
    return;
  }

  const openButton = event.target.closest('[data-open-video]');
  if (openButton) {
    event.stopPropagation();
    openVideoInBrave(openButton.dataset.openVideo);
    return;
  }

  const seenButton = event.target.closest('[data-toggle-seen]');
  if (seenButton) {
    event.stopPropagation();
    const channel = currentChannel();
    if (!channel) return;
    const videoId = seenButton.dataset.toggleSeen;
    const seen = !!channel.watched?.[videoId];
    setWatched(channel.id, videoId, !seen);
    return;
  }

  const card = event.target.closest('[data-video-id]');
  if (card) playVideo(card.dataset.videoId);
});

mainEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('button')) return;
  const folderChannel = event.target.closest('.folder-channel');
  if (folderChannel?.dataset.channel) {
    event.preventDefault();
    selectChannel(folderChannel.dataset.channel);
    return;
  }
  const card = event.target.closest('[data-video-id]');
  if (card) {
    event.preventDefault();
    playVideo(card.dataset.videoId);
  }
});

popoverEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-pop]');
  if (!button) return;
  const node = nodeById(popoverEl.dataset.nodeId);
  closePopover();
  if (!node) return;

  const action = button.dataset.pop;
  if (action === 'sub') askNewNode(node.id);
  else if (action === 'rename') askRenameNode(node);
  else if (action === 'move') askMoveNode(node);
  else if (action === 'delete') deleteNode(node);
});

document.addEventListener('click', (event) => {
  if (popoverEl.hidden) return;
  if (popoverEl.contains(event.target)) return;
  if (event.target.closest('[data-node-menu]')) return;
  closePopover();
});

listEl.addEventListener('scroll', closePopover);
mainEl.addEventListener('scroll', closePopover);
window.addEventListener('resize', closePopover);

dialogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = dialogMode === 'input' ? dialogInput.value.trim() : dialogSelect.value;
  if (dialogMode === 'input' && !value) {
    dialogInput.focus();
    return;
  }
  const submit = dialogSubmit;
  closeDialog();
  if (submit) submit(value);
});

dialogCancel.addEventListener('click', closeDialog);
dialogBackdrop.addEventListener('click', (event) => {
  if (event.target === dialogBackdrop) closeDialog();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!dialogBackdrop.hidden) {
      closeDialog();
      return;
    }
    if (!popoverEl.hidden) {
      closePopover();
      return;
    }
    if (app.player) {
      app.player = null;
      renderMain();
      return;
    }
  }
  if (event.key === '/' && !isTyping(event.target) && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    addInput.focus();
  }
});

// ---------------------------------------------------------------- inicio

function restoreSelection() {
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem('tuboteca.selection') || 'null');
    if (saved?.type === 'channel' && app.channels.some((c) => c.id === saved.id)) {
      app.selected = saved.id;
      restored = true;
    } else if (saved?.type === 'node' && (saved.id === ROOT_NODE || nodeById(saved.id))) {
      app.selectedNode = saved.id;
      restored = true;
    }
  } catch { /* ignora selección corrupta */ }

  if (!restored) {
    const savedChannel = localStorage.getItem('tuboteca.selected');
    if (savedChannel && app.channels.some((c) => c.id === savedChannel)) {
      app.selected = savedChannel;
      restored = true;
    }
  }

  if (!restored) {
    if (app.channels.length) app.selected = app.channels[0].id;
    else if (app.nodes.length) app.selectedNode = app.nodes.find((n) => !n.parentId)?.id || app.nodes[0].id;
  }
}

async function init() {
  try {
    const data = await api.get('/api/state');
    app.channels = Array.isArray(data.channels) ? data.channels : [];
    app.nodes = Array.isArray(data.nodes) ? data.nodes : [];
  } catch (err) {
    toast(`No pude cargar el catálogo: ${err.message}`, 'error');
  }

  restoreSelection();
  renderSidebar();
  renderMain();

  if (app.channels.length) {
    refreshAll({ quiet: true });
  }

  setInterval(() => {
    if (!document.hidden) refreshAll({ quiet: true });
  }, 15 * 60 * 1000);
}

init();
