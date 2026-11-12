'use strict';

/**
 * Данные Telegram NFT:
 *  1) публичная страница https://t.me/nft/<Slug>-<Number>  (название, статичная картинка, владелец, свойства)
 *  2) метаданные https://nft.fragment.com/gift/<slug>.json  (ссылка на анимацию, если она там есть)
 * Зависимостей нет (Node.js 18+).
 */

const NFT_LINK_RE = /^https:\/\/t\.me\/nft\/([A-Za-z0-9]+)-(\d+)\/?$/;
const FETCH_TIMEOUT_MS = 10000;
const META_TIMEOUT_MS = 8000;
const MAX_HTML_LENGTH = 2 * 1024 * 1024;
const MAX_JSON_LENGTH = 1 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SHORT_TTL_MS = 20 * 1000;
const CACHE_MAX = 500;

const UA = 'Mozilla/5.0 (compatible; OneTapTrade/1.0)';

// Только эти хосты считаются допустимыми источниками медиа
const MEDIA_HOSTS = [/^nft\.fragment\.com$/i, /^fragment\.com$/i, /(^|\.)telesco\.pe$/i];
// Поля метаданных, в которых может быть ссылка на анимацию
const ANIMATION_KEYS = ['lottie', 'animation_url', 'animation', 'video', 'video_url'];

class NftError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'NftError';
    this.code = code;
    this.status = status;
  }
}

/* ---------- Ссылка ---------- */

function parseNftLink(input) {
  const link = String(input || '').trim();
  const m = NFT_LINK_RE.exec(link);
  if (!m) return null;
  return {
    collection: m[1],
    number: m[2],
    slug: m[1] + '-' + m[2],
    url: 'https://t.me/nft/' + m[1] + '-' + m[2]
  };
}

/* ---------- Разбор HTML ---------- */

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    try {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return String.fromCodePoint(code);
    } catch (err) {
      return m;
    }
  });
}

function stripTags(html) {
  return decodeEntities(
    String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

function parseMeta(html) {
  const meta = {};
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    const re = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = re.exec(tag)) !== null) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : a[3];
    }
    const key = attrs.property || attrs.name;
    if (key && attrs.content !== undefined && meta[key.toLowerCase()] === undefined) {
      meta[key.toLowerCase()] = decodeEntities(attrs.content).trim();
    }
  }
  return meta;
}

function parseRows(html) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const th = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(tr[1]);
    const td = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(tr[1]);
    if (!th || !td) continue;
    const label = stripTags(th[1]);
    const value = stripTags(td[1]);
    if (!label || !value) continue;
    rows.push({ label, value, valueHtml: td[1] });
  }
  return rows;
}

function parseOwner(row) {
  if (!row) return null;
  let username = null;
  let url = null;
  const href = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(row.valueHtml);
  if (href) {
    const h = decodeEntities(href[1]).trim();
    const u = /^https?:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})\/?$/i.exec(h);
    if (u) {
      username = u[1];
      url = 'https://t.me/' + u[1];
    }
  }
  return { text: row.value, username: username, url: url };
}

function parseAttribute(row) {
  const m = /^(.*?)\s*(\d+(?:[.,]\d+)?)\s*%$/.exec(row.value);
  if (m && m[1]) {
    return { name: row.label, value: m[1].trim(), rarity: m[2].replace(',', '.') + '%' };
  }
  return { name: row.label, value: row.value, rarity: null };
}

function isUsableImageUrl(u) {
  if (!u || !/^https:\/\//i.test(u)) return false;
  if (/^https:\/\/(?:www\.)?telegram\.org\/img\//i.test(u)) return false;
  return true;
}

function parseNftPage(html, link) {
  const meta = parseMeta(html);
  const rows = parseRows(html);

  const title = meta['og:title'] || '';
  const looksLikeNft = /#\d+/.test(title) || rows.length > 0;
  if (!looksLikeNft) {
    throw new NftError('NFT_NOT_FOUND', 'NFT не найден / NFT not found', 404);
  }

  const image = meta['og:image'] || meta['twitter:image'] || '';
  if (!isUsableImageUrl(image)) {
    throw new NftError('IMAGE_MISSING', 'У NFT нет изображения / NFT has no image', 422);
  }

  const tm = /^(.*?)\s*#(\d+)\s*$/.exec(title);
  const name = tm && tm[1] ? tm[1].trim() : (title || link.collection);

  const ownerRow = rows.find((r) => r.label.toLowerCase() === 'owner');
  const attributes = rows.filter((r) => r !== ownerRow).map(parseAttribute);

  return {
    slug: link.slug,
    link: link.url,
    collection: link.collection,
    number: link.number,
    name: name,
    title: title || (name + ' #' + link.number),
    image: image, // статичное превью с t.me
    description: meta['og:description'] || null,
    owner: parseOwner(ownerRow),
    attributes: attributes
  };
}

/* ---------- Загрузка страницы t.me ---------- */

async function fetchPage(link) {
  let res;
  try {
    res = await fetch(link.url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new NftError('FETCH_TIMEOUT', 'Telegram не ответил вовремя / Telegram did not respond in time', 504);
    }
    throw new NftError('FETCH_ERROR', 'Ошибка загрузки данных с Telegram / Failed to fetch data from Telegram', 502);
  }

  if (res.status === 404) {
    throw new NftError('NFT_NOT_FOUND', 'NFT не найден / NFT not found', 404);
  }
  if (res.status >= 300 && res.status < 400) {
    throw new NftError('DATA_UNAVAILABLE', 'Данные NFT недоступны / NFT data is unavailable', 502);
  }
  if (!res.ok) {
    throw new NftError('DATA_UNAVAILABLE', 'Данные NFT недоступны (HTTP ' + res.status + ') / NFT data is unavailable', 502);
  }

  let html;
  try {
    html = await res.text();
  } catch (e) {
    throw new NftError('FETCH_ERROR', 'Ошибка чтения ответа Telegram / Failed to read Telegram response', 502);
  }
  if (html.length > MAX_HTML_LENGTH) {
    throw new NftError('DATA_UNAVAILABLE', 'Данные NFT недоступны / NFT data is unavailable', 502);
  }
  return html;
}

/* ---------- Метаданные с анимацией (nft.fragment.com) ---------- */

function isAllowedMediaUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && MEDIA_HOSTS.some((re) => re.test(x.hostname));
  } catch (e) {
    return false;
  }
}

// Тип определяется строго по расширению того URL, который вернул источник
function classifyMedia(u) {
  let p;
  try { p = new URL(u).pathname.toLowerCase(); } catch (e) { return null; }
  if (/\.json$/.test(p)) return { kind: 'lottie', mime: 'application/json' };
  if (/\.mp4$/.test(p)) return { kind: 'video', mime: 'video/mp4' };
  if (/\.webm$/.test(p)) return { kind: 'video', mime: 'video/webm' };
  if (/\.gif$/.test(p)) return { kind: 'gif', mime: 'image/gif' };
  return null; // .tgs и прочее не используем
}

function extractMedia(meta, link) {
  if (!meta || typeof meta !== 'object') return null;
  for (const key of ANIMATION_KEYS) {
    const v = meta[key];
    if (typeof v !== 'string') continue;
    const u = v.trim();
    if (!isAllowedMediaUrl(u)) continue;
    const c = classifyMedia(u);
    if (!c) continue;
    return {
      kind: c.kind,
      mime: c.mime,
      field: key,
      originalUrl: u,
      // Lottie отдаём через наш сервер (без проблем с CORS); видео и GIF — напрямую
      url: c.kind === 'lottie' ? '/api/nft-media?slug=' + encodeURIComponent(link.slug) : u
    };
  }
  return null;
}

// Никогда не бросает: возвращает { state: 'ok' | 'none' | 'unavailable', json? }
async function fetchMetadata(link) {
  const url = 'https://nft.fragment.com/gift/' + link.slug.toLowerCase() + '.json';
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(META_TIMEOUT_MS)
    });
    if (res.status === 404) return { state: 'none' };
    if (!res.ok) return { state: 'unavailable' };
    const text = await res.text();
    if (text.length > MAX_JSON_LENGTH) return { state: 'unavailable' };
    let json;
    try { json = JSON.parse(text); } catch (e) { return { state: 'unavailable' }; }
    if (!json || typeof json !== 'object') return { state: 'unavailable' };
    return { state: 'ok', json: json };
  } catch (e) {
    return { state: 'unavailable' };
  }
}

/* ---------- Кэш ---------- */

const cache = new Map();

function cacheGet(slug) {
  const hit = cache.get(slug);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(slug);
    return null;
  }
  return hit.data;
}

function cacheSet(slug, data, ttl) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(slug, { at: Date.now(), ttl: ttl, data: data });
}

/* ---------- Публичные функции ---------- */

async function getNft(inputLink) {
  const link = parseNftLink(inputLink);
  if (!link) {
    throw new NftError(
      'INVALID_LINK',
      'Неверная ссылка. Пример: https://t.me/nft/ViceCream-313219 / Invalid link',
      400
    );
  }

  const cached = cacheGet(link.slug);
  if (cached) return cached;

  const [html, metaRes] = await Promise.all([fetchPage(link), fetchMetadata(link)]);
  const data = parseNftPage(html, link);

  data.media = null;
  if (metaRes.state === 'ok') {
    const media = extractMedia(metaRes.json, link);
    if (media) {
      data.media = media;
      data.animation = { available: true, kind: media.kind, reason: null };
    } else {
      // Метаданные получены, но анимации в них нет — считаем NFT статичным
      data.animation = { available: false, kind: null, reason: 'NO_ANIMATION_IN_METADATA' };
    }
  } else {
    data.animation = { available: false, kind: null, reason: 'METADATA_UNAVAILABLE' };
  }

  data.fetchedAt = new Date().toISOString();
  const ttl = metaRes.state === 'ok' || metaRes.state === 'none' ? CACHE_TTL_MS : SHORT_TTL_MS;
  cacheSet(link.slug, data, ttl);
  return data;
}

// Отдаёт Lottie JSON из того URL, что вернул источник для этого slug
async function getNftMedia(slugInput) {
  const link = parseNftLink('https://t.me/nft/' + String(slugInput || ''));
  if (!link) {
    throw new NftError('INVALID_LINK', 'Неверный slug / Invalid slug', 400);
  }

  const nft = await getNft(link.url);
  if (!nft.media || nft.media.kind !== 'lottie' || !isAllowedMediaUrl(nft.media.originalUrl)) {
    throw new NftError('NO_ANIMATION', 'Анимация недоступна / Animation is not available', 404);
  }

  let res;
  try {
    res = await fetch(nft.media.originalUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new NftError('FETCH_TIMEOUT', 'Источник анимации не ответил вовремя / Animation source timed out', 504);
    }
    throw new NftError('FETCH_ERROR', 'Ошибка загрузки анимации / Failed to fetch animation', 502);
  }

  if (res.status === 404) {
    throw new NftError('NO_ANIMATION', 'Анимация недоступна / Animation is not available', 404);
  }
  if (!res.ok) {
    throw new NftError('DATA_UNAVAILABLE', 'Анимация недоступна (HTTP ' + res.status + ') / Animation unavailable', 502);
  }

  const declared = parseInt(res.headers.get('content-length') || '0', 10);
  if (declared > MAX_MEDIA_BYTES) {
    throw new NftError('DATA_UNAVAILABLE', 'Файл анимации слишком большой / Animation file too large', 502);
  }

  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new NftError('FETCH_ERROR', 'Ошибка чтения анимации / Failed to read animation', 502);
  }
  if (buf.length > MAX_MEDIA_BYTES) {
    throw new NftError('DATA_UNAVAILABLE', 'Файл анимации слишком большой / Animation file too large', 502);
  }

  // Проверяем, что это действительно Lottie JSON (есть массив layers)
  try {
    const j = JSON.parse(buf.toString('utf8'));
    if (!j || typeof j !== 'object' || !Array.isArray(j.layers)) throw new Error('not lottie');
  } catch (e) {
    throw new NftError('DATA_UNAVAILABLE', 'Файл анимации повреждён / Animation file is invalid', 502);
  }

  return { body: buf, contentType: 'application/json; charset=utf-8' };
}

module.exports = { getNft, getNftMedia, parseNftLink, parseNftPage, NftError };
