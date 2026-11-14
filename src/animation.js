'use strict';

/**
 * Отдельный слой анимации. Не участвует в поиске NFT и не влияет на /api/nft.
 *
 * Источник: https://nft.fragment.com/gift/<slug>.json
 * По открытым описаниям (статья на tproger.ru, справочник nxrix/telegram-gifts) этот JSON
 * содержит поле "lottie" (ссылка на <slug>.lottie.json). Если ссылки в метаданных нет,
 * проверяется адрес https://nft.fragment.com/gift/<slug>.lottie.json из того же справочника.
 * Любой файл принимается только после проверки его реального содержимого (первые байты).
 *
 * Ускорение:
 *  - запросы метаданных и проверки файла идут параллельно (спекулятивная проверка адреса);
 *  - одновременные запросы по одному slug объединяются в один (in-flight);
 *  - результат кэшируется: успех — долго, "анимации нет" — средне, временные ошибки — коротко;
 *  - файл анимации отдаётся потоком (см. openAnimationFile), а не целиком в память.
 *
 * Ошибки этого слоя никогда не превращаются в "NFT not found":
 * getNftAnimation не бросает из-за проблем источника, а возвращает reason/detail/debug.
 */

const { parseNftLink, NftError } = require('./nft');

const META_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 8000;
const FILE_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const MAX_JSON_LENGTH = 1 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

// Время жизни кэша
const SUCCESS_TTL_MS = 30 * 60 * 1000;   // анимация найдена
const NEGATIVE_TTL_MS = 5 * 60 * 1000;   // источник уверенно ответил, что анимации нет
const TRANSIENT_TTL_MS = 20 * 1000;      // сетевые ошибки / HTTP 5xx — повторим скоро
const CACHE_MAX = 1000;

const UA = 'Mozilla/5.0 (compatible; OneTapTrade/1.0)';

// Допустимые источники медиа (только https и только эти хосты, в том числе после редиректов)
const MEDIA_HOSTS = [/^nft\.fragment\.com$/i, /^fragment\.com$/i, /(^|\.)telesco\.pe$/i];
// Поля метаданных, где может лежать ссылка на анимацию
const ANIMATION_KEYS = ['lottie', 'animation_url', 'animation', 'video', 'video_url'];

/*
 * reason, которые получает frontend:
 *  METADATA_UNAVAILABLE      — метаданные и документированный адрес анимации недоступны (detail: причина)
 *  NO_ANIMATION_IN_METADATA  — метаданные получены, анимации в них нет
 *  STATIC_IMAGE_ONLY         — по ссылке обычное изображение, не анимация
 *  UNSUPPORTED_FORMAT        — формат файла не поддерживается (detail: определённый формат)
 *  MEDIA_UNAVAILABLE         — файл анимации не удалось загрузить (detail: причина)
 */

/* ---------- Безопасная загрузка ---------- */

function isAllowedMediaUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && MEDIA_HOSTS.some((re) => re.test(x.hostname));
  } catch (e) {
    return false;
  }
}

function describeError(e) {
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout';
  if (e && e.code === 'HOST_NOT_ALLOWED') return 'redirect to a disallowed host';
  if (e && e.code === 'TOO_MANY_REDIRECTS') return 'too many redirects';
  return 'network error';
}

async function discard(res) {
  try { if (res && res.body) await res.body.cancel(); } catch (e) {}
}

// GET с ручной обработкой редиректов: каждый адрес проверяется по списку разрешённых хостов
async function fetchAllowed(url, headers, timeoutMs) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedMediaUrl(current)) {
      const err = new Error('host not allowed');
      err.code = 'HOST_NOT_ALLOWED';
      throw err;
    }
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await discard(res);
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  const err = new Error('too many redirects');
  err.code = 'TOO_MANY_REDIRECTS';
  throw err;
}

/* ---------- Проверка формата по содержимому ---------- */

function sniffFormat(buf) {
  if (!buf || buf.length < 4) return null;

  const head6 = buf.toString('latin1', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';

  // EBML (WEBM): 1A 45 DF A3, в заголовке должен быть DocType "webm"
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return buf.indexOf('webm', 0, 'latin1') >= 0 ? 'webm' : null;
  }

  // MP4: "ftyp" на смещении 4
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';

  // Обычные изображения (это не анимация)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';

  // JSON (Lottie): первый значимый байт '{' (пробелы и BOM пропускаем)
  let i = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3;
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
  if (i < buf.length && buf[i] === 0x7b) return 'json';

  return null;
}

const FORMAT_INFO = {
  gif: { kind: 'gif', mime: 'image/gif' },
  webm: { kind: 'video', mime: 'video/webm' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  json: { kind: 'lottie', mime: 'application/json' }
};

// Читает первые байты файла и определяет формат. Никогда не бросает.
// state: 'ok' | 'notfound' | 'unavailable'
async function probeMedia(url) {
  let res;
  try {
    res = await fetchAllowed(url, { 'User-Agent': UA, 'Accept': '*/*', 'Range': 'bytes=0-63' }, PROBE_TIMEOUT_MS);
  } catch (e) {
    return { state: 'unavailable', detail: describeError(e) };
  }
  if (res.status === 404) {
    await discard(res);
    return { state: 'notfound', detail: 'HTTP 404' };
  }
  if (res.status !== 200 && res.status !== 206) {
    await discard(res);
    return { state: 'unavailable', detail: 'HTTP ' + res.status };
  }
  if (!res.body) return { state: 'unavailable', detail: 'empty body' };

  // Заголовки для HTTP-кэширования и проверки размера
  const etag = res.headers.get('etag') || null;
  const lastModified = res.headers.get('last-modified') || null;
  let size = null;
  const cr = res.headers.get('content-range'); // bytes 0-63/1234
  if (cr) {
    const m = /\/(\d+)\s*$/.exec(cr);
    if (m) size = parseInt(m[1], 10);
  } else if (res.status === 200) {
    const cl = parseInt(res.headers.get('content-length') || '', 10);
    if (!isNaN(cl)) size = cl;
  }

  try {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < 64) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(Buffer.from(part.value));
      total += part.value.length;
    }
    try { await reader.cancel(); } catch (e) {}
    const buf = Buffer.concat(chunks).subarray(0, 64);
    if (buf.length < 4) return { state: 'unavailable', detail: 'empty body' };
    return { state: 'ok', format: sniffFormat(buf), etag: etag, lastModified: lastModified, size: size };
  } catch (e) {
    return { state: 'unavailable', detail: describeError(e) };
  }
}

/* ---------- Метаданные ---------- */

// state: 'ok' | 'none' (404) | 'unavailable'
async function fetchMetadata(slug) {
  const url = 'https://nft.fragment.com/gift/' + slug.toLowerCase() + '.json';
  let res;
  try {
    res = await fetchAllowed(url, { 'User-Agent': UA, 'Accept': 'application/json' }, META_TIMEOUT_MS);
  } catch (e) {
    return { state: 'unavailable', detail: describeError(e) };
  }
  if (res.status === 404) {
    await discard(res);
    return { state: 'none', detail: 'HTTP 404' };
  }
  if (!res.ok) {
    await discard(res);
    return { state: 'unavailable', detail: 'HTTP ' + res.status };
  }
  let text;
  try {
    text = await res.text();
  } catch (e) {
    return { state: 'unavailable', detail: describeError(e) };
  }
  if (text.length > MAX_JSON_LENGTH) return { state: 'unavailable', detail: 'response too large' };
  let json;
  try { json = JSON.parse(text); } catch (e) { return { state: 'unavailable', detail: 'invalid JSON' }; }
  if (!json || typeof json !== 'object') return { state: 'unavailable', detail: 'invalid JSON' };
  return { state: 'ok', json: json };
}

/* ---------- Кэш и объединение одновременных запросов ---------- */

const cache = new Map();     // slug -> { at, ttl, data }
const inflight = new Map();  // slug -> Promise

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

/* ---------- Определение анимации ---------- */

function slugFrom(input) {
  const link = parseNftLink('https://t.me/nft/' + String(input || ''));
  if (!link) {
    throw new NftError('INVALID_LINK', 'Неверный slug / Invalid slug', 400);
  }
  return link.slug;
}

function buildMedia(slug, cand, probe) {
  const info = FORMAT_INFO[probe.format];
  return {
    kind: info.kind,
    format: probe.format,
    mime: info.mime,
    field: cand.key,
    source: cand.source,
    originalUrl: cand.url,
    etag: probe.etag || null,
    lastModified: probe.lastModified || null,
    size: probe.size === undefined ? null : probe.size,
    // Lottie отдаём через наш сервер (без CORS); видео и GIF — напрямую по проверенному URL
    url: info.kind === 'lottie' ? '/api/nft-media?slug=' + encodeURIComponent(slug) : cand.url
  };
}

// Никогда не бросает. Возвращает { result, ttl }
async function computeAnimation(slug) {
  const debug = { metadata: { state: null, detail: null, keys: [] }, candidates: [] };
  let transient = false;

  const patternUrl = 'https://nft.fragment.com/gift/' + slug.toLowerCase() + '.lottie.json';
  const probes = new Map();
  function getProbe(url) {
    if (!probes.has(url)) probes.set(url, probeMedia(url));
    return probes.get(url);
  }

  // Спекулятивно: проверка документированного адреса идёт параллельно с загрузкой метаданных.
  // Если метаданные укажут тот же адрес, повторный запрос не нужен.
  getProbe(patternUrl);

  const metaRes = await fetchMetadata(slug);
  debug.metadata.state = metaRes.state;
  debug.metadata.detail = metaRes.detail || null;
  if (metaRes.state === 'unavailable') transient = true;
  if (metaRes.state === 'ok') debug.metadata.keys = Object.keys(metaRes.json).slice(0, 40);

  // Проверка одного кандидата: реальный формат определяется по содержимому
  async function evaluate(cand) {
    const p = await getProbe(cand.url);
    debug.candidates.push({
      field: cand.key,
      source: cand.source,
      url: cand.url,
      state: p.state,
      format: p.format || null,
      size: p.size === undefined ? null : p.size,
      detail: p.detail || null
    });
    if (p.state === 'unavailable') transient = true;
    if (p.state !== 'ok') return { ok: false, reason: 'MEDIA_UNAVAILABLE', detail: p.detail || null };
    const info = FORMAT_INFO[p.format];
    if (info) {
      if (info.kind === 'lottie' && p.size !== null && p.size > MAX_MEDIA_BYTES) {
        return { ok: false, reason: 'MEDIA_UNAVAILABLE', detail: 'file too large' };
      }
      return { ok: true, media: buildMedia(slug, cand, p) };
    }
    if (p.format === 'png' || p.format === 'jpeg' || p.format === 'webp') {
      return { ok: false, reason: 'STATIC_IMAGE_ONLY', detail: p.format };
    }
    return { ok: false, reason: 'UNSUPPORTED_FORMAT', detail: p.format || 'unknown' };
  }

  let media = null;
  let fail = null;

  // 1) Ссылки на анимацию из метаданных
  const metaCands = [];
  if (metaRes.state === 'ok') {
    for (const key of ANIMATION_KEYS) {
      const v = metaRes.json[key];
      if (typeof v === 'string' && isAllowedMediaUrl(v.trim())) {
        metaCands.push({ key: key, source: 'metadata', url: v.trim() });
      }
    }
  }
  for (const c of metaCands) {
    const r = await evaluate(c);
    if (r.ok) { media = r.media; break; }
    if (!fail) fail = r;
  }

  // 2) Если в метаданных ссылок нет — документированный адрес <slug>.lottie.json
  if (!media && metaCands.length === 0) {
    const r = await evaluate({ key: 'documented-pattern', source: 'documented-pattern', url: patternUrl });
    if (r.ok) media = r.media;
  }

  let result;
  if (media) {
    result = {
      slug: slug,
      animation: { available: true, kind: media.kind, format: media.format, source: media.source, reason: null, detail: null },
      media: media,
      debug: debug
    };
  } else {
    let reason, detail;
    if (fail) {
      reason = fail.reason;
      detail = fail.detail;
    } else if (metaRes.state !== 'ok') {
      reason = 'METADATA_UNAVAILABLE';
      detail = metaRes.detail || null;
    } else {
      reason = 'NO_ANIMATION_IN_METADATA';
      detail = null;
    }
    result = {
      slug: slug,
      animation: { available: false, kind: null, format: null, source: null, reason: reason, detail: detail },
      media: null,
      debug: debug
    };
  }

  const ttl = media ? SUCCESS_TTL_MS : (transient ? TRANSIENT_TTL_MS : NEGATIVE_TTL_MS);
  return { result: result, ttl: ttl };
}

// Возвращает { slug, animation: { available, kind, format, source, reason, detail }, media | null, debug }
async function getNftAnimation(slugInput) {
  const slug = slugFrom(slugInput);

  const cached = cacheGet(slug);
  if (cached) return cached;

  let p = inflight.get(slug);
  if (!p) {
    p = computeAnimation(slug)
      .then(function (r) {
        cacheSet(slug, r.result, r.ttl);
        return r.result;
      })
      .finally(function () {
        inflight.delete(slug);
      });
    inflight.set(slug, p);
  }
  return p;
}

/* ---------- Файл анимации (поток) ---------- */

// Открывает поток Lottie-файла по проверенному media. В память целиком не читает.
// Возвращает { body: ReadableStream (web), etag, lastModified }
async function openAnimationFile(media) {
  if (!media || media.kind !== 'lottie' || !isAllowedMediaUrl(media.originalUrl)) {
    throw new NftError('NO_ANIMATION', 'Анимация недоступна / Animation is not available', 404);
  }

  let res;
  try {
    res = await fetchAllowed(media.originalUrl, { 'User-Agent': UA, 'Accept': 'application/json' }, FILE_TIMEOUT_MS);
  } catch (e) {
    if (describeError(e) === 'timeout') {
      throw new NftError('MEDIA_TIMEOUT', 'Источник анимации не ответил вовремя / Animation source timed out', 504);
    }
    throw new NftError('MEDIA_ERROR', 'Ошибка загрузки медиа / Failed to load media', 502);
  }

  if (res.status === 404) {
    await discard(res);
    throw new NftError('NO_ANIMATION', 'Анимация недоступна / Animation is not available', 404);
  }
  if (!res.ok) {
    await discard(res);
    throw new NftError('MEDIA_ERROR', 'Ошибка загрузки медиа (HTTP ' + res.status + ') / Failed to load media', 502);
  }

  const declared = parseInt(res.headers.get('content-length') || '0', 10);
  if (declared > MAX_MEDIA_BYTES) {
    await discard(res);
    throw new NftError('MEDIA_ERROR', 'Файл анимации слишком большой / Animation file too large', 502);
  }
  if (!res.body) {
    throw new NftError('MEDIA_ERROR', 'Пустой ответ источника / Empty response from source', 502);
  }

  return {
    body: res.body,
    etag: res.headers.get('etag') || null,
    lastModified: res.headers.get('last-modified') || null
  };
}

module.exports = { getNftAnimation, openAnimationFile, MAX_MEDIA_BYTES };
