'use strict';

/**
 * Получение данных Telegram NFT с публичной страницы https://t.me/nft/<Slug>-<Number>
 * Используются Open Graph мета-теги и таблица свойств на странице.
 * Зависимостей нет (нужен Node.js 18+ с глобальным fetch).
 */

const NFT_LINK_RE = /^https:\/\/t\.me\/nft\/([A-Za-z0-9]+)-(\d+)\/?$/;
const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_LENGTH = 2 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

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
  const text = row.value;
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
  return { text: text, username: username, url: url };
}

function parseAttribute(row) {
  // "Jage Crystal 1.2%" -> { name, value, rarity }
  const m = /^(.*?)\s*(\d+(?:[.,]\d+)?)\s*%$/.exec(row.value);
  if (m && m[1]) {
    return { name: row.label, value: m[1].trim(), rarity: m[2].replace(',', '.') + '%' };
  }
  return { name: row.label, value: row.value, rarity: null };
}

function isUsableImageUrl(u) {
  if (!u || !/^https:\/\//i.test(u)) return false;
  // общие картинки-заглушки Telegram не считаем изображением NFT
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
  const attributes = rows
    .filter((r) => r !== ownerRow)
    .map(parseAttribute);

  return {
    slug: link.slug,
    link: link.url,
    collection: link.collection,
    number: link.number,
    name: name,
    title: title || (name + ' #' + link.number),
    image: image,
    description: meta['og:description'] || null,
    owner: parseOwner(ownerRow),
    attributes: attributes
  };
}

/* ---------- Загрузка ---------- */

async function fetchPage(link) {
  let res;
  try {
    res = await fetch(link.url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OneTapTrade/1.0)',
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

/* ---------- Кэш ---------- */

const cache = new Map();

function cacheGet(slug) {
  const hit = cache.get(slug);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(slug);
    return null;
  }
  return hit.data;
}

function cacheSet(slug, data) {
  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(slug, { at: Date.now(), data: data });
}

/* ---------- Публичная функция ---------- */

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

  const html = await fetchPage(link);
  const data = parseNftPage(html, link);
  data.fetchedAt = new Date().toISOString();
  cacheSet(link.slug, data);
  return data;
}

module.exports = { getNft, parseNftLink, parseNftPage, NftError };
