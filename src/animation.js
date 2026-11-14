'use strict';

/**
 * Отдельный слой анимации. Не участвует в поиске NFT и не влияет на /api/nft.
 *
 * Источник: https://nft.fragment.com/gift/<slug>.json (описан в открытых справочниках,
 * мной не проверялся). Ссылка на анимацию берётся ТОЛЬКО из полей этого ответа.
 * Формат файла определяется по его первым байтам, а не по расширению.
 *
 * Ошибки этого слоя никогда не превращаются в "NFT not found":
 * getNftAnimation не бросает из-за проблем источника, а возвращает причину (reason).
 */

const { parseNftLink, NftError } = require('./nft');

const META_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 8000;
const FILE_TIMEOUT_MS = 10000;
const MAX_JSON_LENGTH = 1 * 1024 * 1024;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const OK_TTL_MS = 5 * 60 * 1000;
const FAIL_TTL_MS = 20 * 1000;
const CACHE_MAX = 500;

const UA = 'Mozilla/5.0 (compatible; OneTapTrade/1.0)';

// Допустимые источники медиа (только https и только эти хосты)
const MEDIA_HOSTS = [/^nft\.fragment\.com$/i, /^fragment\.com$/i, /(^|\.)telesco\.pe$/i];
// Поля метаданных, где может лежать ссылка на анимацию
const ANIMATION_KEYS = ['lottie', 'animation_url', 'animation', 'video', 'video_url'];

/*
 * Причины (reason), которые получает frontend:
 *  METADATA_UNAVAILABLE      — метаданные не получены
 *  NO_ANIMATION_IN_METADATA  — метаданные получены, ссылки на анимацию в них нет
 *  STATIC_IMAGE_ONLY         — по ссылке обычное изображение, не анимация
 *  UNSUPPORTED_FORMAT        — формат файла не поддерживается
 *  MEDIA_UNAVAILABLE         — файл не удалось загрузить
 */

/* ---------- Проверка формата по содержимому ---------- */

function sniffFormat(buf) {
  if (!buf || buf.length < 4) return null;

  const head6 = buf.toString('latin1', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';

  // EBML (WEBM/Matroska): 1A 45 DF A3, DocType "webm" должен быть в заголовке
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return buf.indexOf('webm', 0, 'latin1') >= 0 ? 'webm' : null;
  }

  // MP4: "ftyp" на смещении 4
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';

  // Обычные изображения (это не анимация)
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';

  // JSON (Lottie): первый непробельный байт '{'
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || (i === 0 && b === 0xef)) continue;
    return b === 0x7b ? 'json' : null;
  }
  return null;
}

const FORMAT_INFO = {
  gif: { kind: 'gif', mime: 'image/gif' },
  webm: { kind: 'video', mime: 'video/webm' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  json: { kind: 'lottie', mime: 'application/json' }
};

function isAllowedMediaUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && MEDIA_HOSTS.some((re) => re.test(x.hostname));
  } catch (e) {
    return false;
  }
}

// Читает первые байты файла и определяет формат. Никогда не бросает.
async function probeMedia(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Range': 'bytes=0-63' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    if (res.status !== 200 && res.status !== 206) return { state: 'unavailable' };
    if (!res.body) return { state: 'unavailable' };

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
    if (buf.length < 4) return { state: 'unavailable' };
    return { state: 'ok', format: sniffFormat(buf) };
  } catch (e) {
    return { state: 'unavailable' };
  }
}

/* ---------- Метаданные ---------- */

// Никогда не бросает: { state: 'ok' | 'none' | 'unavailable', json? }
async function fetchMetadata(slug) {
  const url = 'https://nft.fragment.com/gift/' + slug.toLowerCase() + '.json';
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

function slugFrom(input) {
  const link = parseNftLink('https://t.me/nft/' + String(input || ''));
  if (!link) {
    throw new NftError('INVALID_LINK', 'Неверный slug / Invalid slug', 400);
  }
  return link.slug;
}

function unavailable(slug, reason) {
  return { slug: slug, animation: { available: false, kind: null, format: null, reason: reason }, media: null };
}

// Возвращает { slug, animation: { available, kind, format, reason }, media | null }
async function getNftAnimation(slugInput) {
  const slug = slugFrom(slugInput);

  const cached = cacheGet(slug);
  if (cached) return cached;

  const metaRes = await fetchMetadata(slug);
  let result;
  let ttl = OK_TTL_MS;

  if (metaRes.state !== 'ok') {
    result = unavailable(slug, 'METADATA_UNAVAILABLE');
    if (metaRes.state !== 'none') ttl = FAIL_TTL_MS;
  } else {
    // Кандидаты — только значения из известных полей, только допустимые https-хосты
    const candidates = [];
    for (const key of ANIMATION_KEYS) {
      const v = metaRes.json[key];
      if (typeof v === 'string' && isAllowedMediaUrl(v.trim())) {
        candidates.push({ key: key, url: v.trim() });
      }
    }

    if (candidates.length === 0) {
      result = unavailable(slug, 'NO_ANIMATION_IN_METADATA');
    } else {
      let failReason = null;
      result = null;
      for (const c of candidates) {
        const probe = await probeMedia(c.url);
        if (probe.state !== 'ok') {
          failReason = failReason || 'MEDIA_UNAVAILABLE';
          ttl = FAIL_TTL_MS;
          continue;
        }
        const info = FORMAT_INFO[probe.format];
        if (info) {
          result = {
            slug: slug,
            animation: { available: true, kind: info.kind, format: probe.format, reason: null },
            media: {
              kind: info.kind,
              format: probe.format,
              mime: info.mime,
              field: c.key,
              originalUrl: c.url,
              // Lottie отдаём через наш сервер (без CORS); видео и GIF — напрямую по проверенному URL
              url: info.kind === 'lottie' ? '/api/nft-media?slug=' + encodeURIComponent(slug) : c.url
            }
          };
          break;
        }
        if (probe.format === 'png' || probe.format === 'jpeg' || probe.format === 'webp') {
          failReason = failReason || 'STATIC_IMAGE_ONLY';
        } else {
          failReason = failReason || 'UNSUPPORTED_FORMAT';
        }
      }
      if (!result) result = unavailable(slug, failReason || 'MEDIA_UNAVAILABLE');
    }
  }

  cacheSet(slug, result, ttl);
  return result;
}

// Отдаёт Lottie JSON из проверенного URL источника для этого slug
async function getAnimationFile(slugInput) {
  const info = await getNftAnimation(slugInput);
  const media = info.media;
  if (!media || media.kind !== 'lottie' || !isAllowedMediaUrl(media.originalUrl)) {
    throw new NftError('NO_ANIMATION', 'Анимация недоступна / Animation is not available', 404);
  }

  let res;
  try {
    res = await fetch(media.originalUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new NftError('MEDIA_TIMEOUT', 'Источник анимации не ответил вовремя / Animation source timed out', 504);
    }
    throw new NftError('MEDIA_ERROR', 'Ошибка загрузки медиа / Failed to load media', 502);
  }

  if (res.status === 404) {
    throw new NftError('NO_ANIMATION', 'Анимация недоступна / Animation is not available', 404);
  }
  if (!res.ok) {
    throw new NftError('MEDIA_ERROR', 'Ошибка загрузки медиа (HTTP ' + res.status + ') / Failed to load media', 502);
  }

  const declared = parseInt(res.headers.get('content-length') || '0', 10);
  if (declared > MAX_MEDIA_BYTES) {
    throw new NftError('MEDIA_ERROR', 'Файл анимации слишком большой / Animation file too large', 502);
  }

  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new NftError('MEDIA_ERROR', 'Ошибка чтения медиа / Failed to read media', 502);
  }
  if (buf.length > MAX_MEDIA_BYTES) {
    throw new NftError('MEDIA_ERROR', 'Файл анимации слишком большой / Animation file too large', 502);
  }

  // Полная проверка: это Lottie JSON (есть массив layers)
  try {
    const j = JSON.parse(buf.toString('utf8'));
    if (!j || typeof j !== 'object' || !Array.isArray(j.layers)) throw new Error('not lottie');
  } catch (e) {
    throw new NftError('UNSUPPORTED_FORMAT', 'Неподдерживаемый формат анимации / Unsupported animation format', 502);
  }

  return { body: buf, contentType: 'application/json; charset=utf-8' };
}

module.exports = { getNftAnimation, getAnimationFile };
