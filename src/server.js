'use strict';

const path = require('path');
const express = require('express');
const { getNft, NftError } = require('./nft');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

/* ---------- Простой лимит запросов (на IP, в памяти) ---------- */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 40;
const hits = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  let rec = hits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    rec = { start: now, count: 0 };
    hits.set(ip, rec);
  }
  rec.count++;
  if (rec.count > RATE_MAX) {
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: 'Слишком много запросов, подождите минуту / Too many requests, wait a minute'
    });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) {
    if (now - rec.start > RATE_WINDOW_MS) hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

/* ---------- Обработчик NFT ---------- */
async function nftHandler(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const link = body.url || body.link || req.query.url || req.query.link;

  try {
    const nft = await getNft(link);
    res.json(Object.assign({ ok: true, valid: true }, nft));
  } catch (e) {
    if (e instanceof NftError) {
      return res.status(e.status).json({ ok: false, code: e.code, error: e.message });
    }
    console.error('Unexpected NFT error:', e);
    res.status(500).json({
      ok: false,
      code: 'INTERNAL_ERROR',
      error: 'Внутренняя ошибка сервера / Internal server error'
    });
  }
}

/* ---------- API ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Новый endpoint
app.get('/api/nft', rateLimit, nftHandler);
app.post('/api/nft', rateLimit, nftHandler);

// Старый endpoint сохранён для совместимости с frontend:
// теперь он тоже возвращает slug + image + название + владельца.
app.get('/api/validate-nft', rateLimit, nftHandler);
app.post('/api/validate-nft', rateLimit, nftHandler);

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

app.listen(PORT, '0.0.0.0', () => {
  console.log('One Tap Trade server listening on port ' + PORT);
});
