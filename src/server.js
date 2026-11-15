'use strict';

const path = require('path');
const zlib = require('zlib');
const { Readable, Transform, pipeline } = require('stream');
const express = require('express');
const { getNft, NftError } = require('./nft');
const { getNftAnimation, openAnimationFile, MAX_MEDIA_BYTES } = require('./animation');
const offers = require('./offers');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
// За прокси Render: корректные req.ip и req.protocol (нужны для лимитов и ссылок на предложения)
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

/* ---------- Лимиты запросов (на IP, в памяти) ---------- */
const RATE_WINDOW_MS = 60 * 1000;

function makeRateLimit(max) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) {
      if (now - rec.start > RATE_WINDOW_MS) hits.delete(ip);
    }
  }, RATE_WINDOW_MS).unref();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let rec = hits.get(ip);
    if (!rec || now - rec.start > RATE_WINDOW_MS) {
      rec = { start: now, count: 0 };
      hits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > max) {
      return res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        error: 'Слишком много запросов, подождите минуту / Too many requests, wait a minute'
      });
    }
    next();
  };
}

const rateLimit = makeRateLimit(120);       // общий лимит (на одну загрузку пары NFT уходит до 6 запросов)
const createOfferLimit = makeRateLimit(20); // создание предложений

function sendError(res, e) {
  if (e instanceof NftError) {
    return res.status(e.status).json(Object.assign({ ok: false, code: e.code, error: e.message }, e.extra || {}));
  }
  console.error('Unexpected error:', e);
  return res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    error: 'Внутренняя ошибка сервера / Internal server error'
  });
}

/* ---------- Данные NFT (прежняя логика, без анимации) ---------- */
async function nftHandler(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const link = body.url || body.link || req.query.url || req.query.link;
  try {
    const nft = await getNft(link);
    res.json(Object.assign({ ok: true, valid: true }, nft));
  } catch (e) {
    sendError(res, e);
  }
}

/* ---------- Анимация: отдельный необязательный слой ---------- */
// Всегда отвечает ok:true, если slug корректный. Причина отсутствия анимации — в animation.reason/detail.
// Блок debug показывает, что именно вернул источник (для диагностики).
async function animationHandler(req, res) {
  try {
    const r = await getNftAnimation(req.query.slug);
    const m = r.media;
    // Найденную анимацию можно кэшировать в браузере; отсутствие и ошибки — нет
    res.set('Cache-Control', r.animation.available ? 'public, max-age=300' : 'no-store');
    res.json({
      ok: true,
      slug: r.slug,
      animation: r.animation,
      media: m ? { kind: m.kind, format: m.format, mime: m.mime, url: m.url } : null,
      debug: r.debug
    });
  } catch (e) {
    sendError(res, e);
  }
}

// Файл Lottie-анимации: поток через наш сервер (адрес берётся из проверенных данных, не из запроса)
async function mediaHandler(req, res) {
  try {
    const info = await getNftAnimation(req.query.slug);
    const media = info.media;
    if (!media || media.kind !== 'lottie') {
      throw new NftError('NO_ANIMATION', 'Анимация недоступна / Animation is not available', 404);
    }

    // HTTP-кэш: файл конкретного NFT не меняется; ETag берём из проверки источника
    const etag = media.etag ? (media.etag.indexOf('W/') === 0 ? media.etag : 'W/' + media.etag) : null;
    const cacheControl = 'public, max-age=86400';
    if (etag) {
      const inm = String(req.headers['if-none-match'] || '')
        .split(',').map((s) => s.trim());
      if (inm.indexOf(etag) >= 0) {
        res.set({ 'ETag': etag, 'Cache-Control': cacheControl, 'Vary': 'Accept-Encoding' });
        return res.status(304).end();
      }
    }

    const file = await openAnimationFile(media);

    // Заголовки ставим только после успешного открытия файла, чтобы ошибки не кэшировались
    res.status(200);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'Vary': 'Accept-Encoding',
      'X-Content-Type-Options': 'nosniff'
    });
    if (etag) res.set('ETag', etag);
    if (file.lastModified) res.set('Last-Modified', file.lastModified);

    const gzip = req.acceptsEncodings('gzip') === 'gzip';
    if (gzip) res.set('Content-Encoding', 'gzip');

    // Ограничение размера на лету
    let total = 0;
    const limiter = new Transform({
      transform(chunk, enc, cb) {
        total += chunk.length;
        if (total > MAX_MEDIA_BYTES) return cb(new Error('animation file too large'));
        cb(null, chunk);
      }
    });

    const parts = [Readable.fromWeb(file.body), limiter];
    if (gzip) parts.push(zlib.createGzip({ level: 4 }));
    parts.push(res);

    // При ошибке или обрыве клиента pipeline закрывает все потоки (в том числе запрос к источнику)
    pipeline(...parts, function (err) {
      if (err) {
        console.error('Animation stream error:', err.message);
        try { res.destroy(err); } catch (e) {}
      }
    });
  } catch (e) {
    sendError(res, e);
  }
}

/* ---------- Предложения обмена ---------- */
async function offerCreateHandler(req, res) {
  try {
    const offer = await offers.createOffer(req.body, req);
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ ok: true, serverNow: Date.now(), offer: offer });
  } catch (e) {
    sendError(res, e);
  }
}

async function offerGetHandler(req, res) {
  try {
    const offer = await offers.getOffer(req.params.id, req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, serverNow: Date.now(), offer: offer });
  } catch (e) {
    sendError(res, e);
  }
}

/* ---------- API ---------- */
app.get('/api/health', async (req, res) => {
  let storage = null;
  try { storage = await offers.storageKind(); } catch (e) {}
  res.json({ ok: true, storage: storage });
});

app.get('/api/nft', rateLimit, nftHandler);
app.post('/api/nft', rateLimit, nftHandler);

// Старый endpoint сохранён для совместимости с frontend
app.get('/api/validate-nft', rateLimit, nftHandler);
app.post('/api/validate-nft', rateLimit, nftHandler);

app.get('/api/nft-animation', rateLimit, animationHandler);
app.get('/api/nft-media', rateLimit, mediaHandler);

app.post('/api/offers', rateLimit, createOfferLimit, offerCreateHandler);
app.get('/api/offers/:id', rateLimit, offerGetHandler);

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Endpoint не найден / Endpoint not found' });
});

/* ---------- Статика ---------- */
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------- Ошибки (в т.ч. неверный JSON) ---------- */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, code: 'BAD_JSON', error: 'Неверный JSON / Invalid JSON' });
  }
  console.error(err);
  res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: 'Внутренняя ошибка сервера / Internal server error' });
});

// Хранилище предложений инициализируем сразу, чтобы увидеть проблемы в логах при старте
offers.init().catch((e) => console.error('Offers init failed:', e));

app.listen(PORT, '0.0.0.0', () => {
  console.log('One Tap Trade server listening on port ' + PORT);
});
