'use strict';

/**
 * Предложения обмена NFT.
 *
 * - NFT проверяются существующей функцией getNft (src/nft.js), данные NFT берутся с сервера,
 *   а не из тела запроса, поэтому подделать название или картинку через API нельзя.
 * - Время действия — ровно 6 часов с момента создания. Статус (active/expired) вычисляется
 *   по серверному времени при каждом чтении, отдельных "фальшивых" статусов нет.
 * - Хранилище:
 *     DATABASE_URL задан и установлен пакет "pg"  -> PostgreSQL (переживает перезапуски Render)
 *     иначе                                       -> JSON-файл (DATA_DIR или ./data/offers.json);
 *                                                    на бесплатном Render файловая система временная,
 *                                                    после перезапуска/деплоя предложения пропадут.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { getNft, NftError } = require('./nft');

const OFFER_TTL_MS = 6 * 60 * 60 * 1000;          // ровно 6 часов
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;         // сколько хранить после истечения
const MAX_OFFERS = 10000;                         // предел для файлового хранилища

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
// t.me/nft/Name-123 и https://t.me/nft/Name-123 (регистр хоста не важен), посторонние домены не допускаются
const NFT_LINK_RE = /^(?:https?:\/\/)?t\.me\/nft\/([A-Za-z0-9]+)-(\d+)\/?(?:[?#].*)?$/i;
const OFFER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

class OfferError extends NftError {
  constructor(code, message, status, extra) {
    super(code, message, status);
    this.name = 'OfferError';
    this.extra = extra || null;
  }
}

/* ---------- Нормализация ---------- */

function normalizeUsername(v) {
  return String(v || '').trim().replace(/^@+/, '');
}

function normalizeNftLink(v) {
  const m = NFT_LINK_RE.exec(String(v || '').trim());
  if (!m) return null;
  return 'https://t.me/nft/' + m[1] + '-' + m[2];
}

/* ---------- Файловое хранилище ---------- */

function createFileStore() {
  const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'offers.json');
  const map = new Map();

  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
    console.error('Offers: cannot create data dir:', e.message);
  }
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(arr)) for (const o of arr) if (o && o.id) map.set(o.id, o);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Offers: cannot read store:', e.message);
  }

  function purge(force) {
    const limit = Date.now() - KEEP_MS;
    for (const [id, o] of map) {
      if (o.expiresAt < limit) map.delete(id);
    }
    // если всё ещё слишком много — удаляем самые старые
    while (force && map.size >= MAX_OFFERS) {
      map.delete(map.keys().next().value);
    }
  }
  purge(false);

  let timer = null;
  let writing = false;
  let dirty = false;

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(flush, 300);
  }

  async function flush() {
    timer = null;
    if (writing) { schedule(); return; }
    writing = true;
    dirty = false;
    try {
      const tmp = file + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(Array.from(map.values())));
      await fsp.rename(tmp, file);
    } catch (e) {
      console.error('Offers: cannot save store:', e.message);
    } finally {
      writing = false;
      if (dirty) schedule();
    }
  }

  function flushSync() {
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify(Array.from(map.values())));
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      console.error('Offers: cannot save store on shutdown:', e.message);
    }
  }

  return {
    kind: 'file',
    async get(id) { return map.get(id) || null; },
    async put(offer) {
      if (map.has(offer.id)) return false;
      if (map.size >= MAX_OFFERS) purge(true);
      map.set(offer.id, offer);
      schedule();
      return true;
    },
    flushSync: flushSync
  };
}

/* ---------- PostgreSQL (необязательно) ---------- */

async function createPgStore(url) {
  let pg;
  try {
    pg = require('pg');
  } catch (e) {
    console.error('Offers: DATABASE_URL is set, but the "pg" package is not installed. Run: npm install pg');
    return null;
  }
  const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: url, ssl: ssl, max: 5 });
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS offers (' +
      'id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, data JSONB NOT NULL)'
    );
    await pool.query('DELETE FROM offers WHERE expires_at < $1', [Date.now() - KEEP_MS]);
  } catch (e) {
    console.error('Offers: PostgreSQL init failed:', e.message);
    try { await pool.end(); } catch (e2) {}
    return null;
  }
  return {
    kind: 'postgres',
    async get(id) {
      const r = await pool.query('SELECT data FROM offers WHERE id = $1', [id]);
      return r.rows[0] ? r.rows[0].data : null;
    },
    async put(offer) {
      const r = await pool.query(
        'INSERT INTO offers (id, created_at, expires_at, data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [offer.id, offer.createdAt, offer.expiresAt, JSON.stringify(offer)]
      );
      return r.rowCount === 1;
    },
    flushSync: function () {}
  };
}

/* ---------- Инициализация ---------- */

let storePromise = null;

function init() {
  if (!storePromise) {
    storePromise = (async function () {
      let store = null;
      const url = (process.env.DATABASE_URL || '').trim();
      if (url) store = await createPgStore(url);
      if (!store) {
        store = createFileStore();
        console.warn('Offers: using FILE storage (' + (url ? 'PostgreSQL unavailable' : 'no DATABASE_URL') +
          '). On Render free plans the filesystem is ephemeral: offers are lost on restart/redeploy.');
      } else {
        console.log('Offers: using PostgreSQL storage');
      }
      const stop = function () { try { store.flushSync(); } catch (e) {} process.exit(0); };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      return store;
    })();
  }
  return storePromise;
}

async function storageKind() {
  const s = await init();
  return s.kind;
}

/* ---------- Публичное представление ---------- */

function buildShareUrl(id, req) {
  // Предпочтительно ссылка на Mini App: TG_APP_LINK=https://t.me/<bot>/<app_short_name> (или https://t.me/<bot>)
  const appLink = (process.env.TG_APP_LINK || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/t\.me\/[A-Za-z0-9_]{4,}(?:\/[A-Za-z0-9_]+)?$/.test(appLink)) {
    return appLink + '?startapp=' + encodeURIComponent(id);
  }
  const base = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '') ||
    (req.protocol + '://' + req.get('host'));
  return base + '/?offer=' + encodeURIComponent(id);
}

function publicOffer(o, req) {
  const now = Date.now();
  return {
    id: o.id,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    ttlMs: o.expiresAt - o.createdAt,
    status: now < o.expiresAt ? 'active' : 'expired',
    user1: { username: o.user1 },
    user2: { username: o.user2 },
    nft1: o.nft1,
    nft2: o.nft2,
    shareUrl: buildShareUrl(o.id, req)
  };
}

function snapshotNft(n) {
  return {
    slug: n.slug,
    link: n.link,
    collection: n.collection,
    number: n.number,
    name: n.name,
    title: n.title,
    image: n.image,
    owner: n.owner ? { text: n.owner.text, username: n.owner.username } : null
  };
}

function nftFailure(reason) {
  if (reason instanceof NftError) return { code: reason.code, error: reason.message };
  console.error('Offers: unexpected NFT error:', reason);
  return { code: 'INTERNAL_ERROR', error: 'Внутренняя ошибка сервера / Internal server error' };
}

/* ---------- Создание и чтение ---------- */

async function createOffer(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const u1 = normalizeUsername(b.myUsername);
  const u2 = normalizeUsername(b.partnerUsername);
  const l1 = normalizeNftLink(b.myLink);
  const l2 = normalizeNftLink(b.partnerLink);

  if (!USERNAME_RE.test(u1)) throw new OfferError('INVALID_USERNAME', 'Неверный username / Invalid username', 400, { which: 'my' });
  if (!USERNAME_RE.test(u2)) throw new OfferError('INVALID_USERNAME', 'Неверный username партнёра / Invalid partner username', 400, { which: 'partner' });
  if (!l1) throw new OfferError('INVALID_LINK', 'Неверная ссылка на NFT / Invalid NFT link', 400, { which: 'my' });
  if (!l2) throw new OfferError('INVALID_LINK', 'Неверная ссылка на NFT партнёра / Invalid partner NFT link', 400, { which: 'partner' });
  if (u1.toLowerCase() === u2.toLowerCase()) throw new OfferError('SAME_USER', 'Нужны разные пользователи / Users must differ', 400, { which: 'partner' });
  if (l1.toLowerCase() === l2.toLowerCase()) throw new OfferError('SAME_NFT', 'NFT должны быть разными / NFTs must differ', 400, { which: 'partner' });

  const store = await init();

  // Существующая логика получения NFT (с её кэшем); обе загрузки идут параллельно
  const settled = await Promise.allSettled([getNft(l1), getNft(l2)]);
  const errors = {};
  if (settled[0].status === 'rejected') errors.my = nftFailure(settled[0].reason);
  if (settled[1].status === 'rejected') errors.partner = nftFailure(settled[1].reason);
  if (errors.my || errors.partner) {
    const first = errors.my || errors.partner;
    throw new OfferError('NFT_LOAD_FAILED', first.error, 422, { errors: errors });
  }

  const createdAt = Date.now();
  const offer = {
    id: null,
    createdAt: createdAt,
    expiresAt: createdAt + OFFER_TTL_MS,
    user1: u1,
    user2: u2,
    nft1: snapshotNft(settled[0].value),
    nft2: snapshotNft(settled[1].value)
  };

  let saved = false;
  for (let i = 0; i < 5 && !saved; i++) {
    offer.id = crypto.randomBytes(9).toString('base64url'); // 12 символов: A-Z a-z 0-9 _ -
    saved = await store.put(offer);
  }
  if (!saved) throw new OfferError('STORE_ERROR', 'Не удалось сохранить предложение / Could not save the offer', 500);

  return publicOffer(offer, req);
}

async function getOffer(id, req) {
  if (!OFFER_ID_RE.test(String(id || ''))) {
    throw new OfferError('OFFER_NOT_FOUND', 'Предложение не найдено / Offer not found', 404);
  }
  const store = await init();
  const o = await store.get(id);
  if (!o) throw new OfferError('OFFER_NOT_FOUND', 'Предложение не найдено / Offer not found', 404);
  return publicOffer(o, req);
}

module.exports = { init, storageKind, createOffer, getOffer, normalizeNftLink, OfferError, OFFER_TTL_MS };
