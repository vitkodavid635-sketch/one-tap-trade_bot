(function () {
  'use strict';

  /* ---------- Настройки ---------- */
  var API_ENDPOINT = '/api/validate-nft';      // существующая загрузка NFT
  var ANIMATION_ENDPOINT = '/api/nft-animation';
  var OFFERS_ENDPOINT = '/api/offers';
  var REQUEST_TIMEOUT_MS = 20000;
  var MEDIA_TIMEOUT_MS = 12000;                // сколько ждём старта анимации, затем остаётся статичное изображение
  var LANG_KEY = 'ott_lang';
  var LOTTIE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
  var IMAGE_KEYS = ['image', 'imageUrl', 'image_url', 'imageURL', 'preview', 'previewUrl', 'preview_url', 'thumbnail', 'picture', 'img'];

  /* ---------- Тексты ---------- */
  var I18N = {
    ru: {
      heroFoot: 'Telegram NFT · 1 на 1',
      homeDesc: 'Обменивайтесь Telegram NFT один на один: создайте предложение и отправьте его партнёру.',
      createDeal: 'СОЗДАТЬ СДЕЛКУ',
      createTitle: 'Новая сделка',
      yourNft: 'ВАШ NFT',
      partnerNft: 'NFT ПАРТНЁРА',
      yourUsername: 'Ваш Telegram username',
      partnerUsername: 'Telegram username партнёра',
      nftLink: 'Ссылка на NFT',
      confirm: 'ПОДТВЕРДИТЬ',
      confirming: 'ЗАГРУЖАЕМ NFT…',
      creating: 'СОЗДАЁМ ПРЕДЛОЖЕНИЕ…',
      errUsernameEmpty: 'Введите Telegram username.',
      errUsernameFormat: 'Username: 5–32 символа, латиница, цифры и «_», начинается с буквы.',
      errSameUser: 'Укажите двух разных пользователей.',
      errLinkEmpty: 'Вставьте ссылку на NFT.',
      errLinkFormat: 'Нужна ссылка вида t.me/nft/Название-123456.',
      errSameLink: 'Нужны две разные NFT.',
      errNftNotFound: 'NFT не найден. Проверьте ссылку.',
      errNftNoImage: 'У этого NFT не удалось получить изображение.',
      errNftUnavailable: 'Данные NFT сейчас недоступны. Повторите позже.',
      errImageLoad: 'Не удалось загрузить изображение NFT.',
      errNftLoad: 'Не все NFT удалось загрузить — сделка не создана.',
      fixFields: 'Исправьте отмеченные поля.',
      errCreate: 'Не удалось создать предложение. Повторите попытку.',
      errRate: 'Слишком много запросов. Подождите минуту.',
      errNetwork: 'Не удалось связаться с сервером. Проверьте соединение.',
      errTimeout: 'Сервер не ответил вовремя. Повторите попытку.',
      errServer: 'Сервер вернул ошибку.',
      errBadResponse: 'Сервер вернул непонятный ответ.',
      offerTitle: 'ПРЕДЛОЖЕНИЕ',
      statusActive: 'АКТИВНО',
      statusExpired: 'ИСТЕКЛО',
      statusLoading: 'ЗАГРУЗКА',
      offerLoading: 'Загружаем предложение…',
      offerSentence: 'Пользователь @{u1} предлагает совершить обмен NFT {n1} на NFT {n2}.',
      offerActive: 'Предложение активно ещё:',
      offerExpired: 'Предложение недействительно',
      share: 'ПОДЕЛИТЬСЯ',
      shareUntil: 'Предложение действует до {time}.',
      newDeal: 'Создать новую сделку',
      toHome: 'На главную',
      imgFail: 'Изображение недоступно',
      errOfferNotFound: 'Предложение не найдено. Возможно, ссылка неверна или оно было удалено.',
      errOfferLoad: 'Не удалось загрузить предложение.',
      animFallback: 'анимация получена, но не воспроизводится — показано статичное изображение',
      animMeta: 'сервер не смог получить данные анимации у источника — показано статичное изображение',
      animNone: 'источник не подтверждает анимацию — показано статичное изображение',
      animStatic: 'источник вернул только статичное изображение',
      animUnsupported: 'формат анимации не поддерживается — показано статичное изображение',
      animMedia: 'сервер не смог загрузить файл анимации — показано статичное изображение',
      animEndpoint: 'не удалось запросить анимацию у сервера — показано статичное изображение'
    },
    en: {
      heroFoot: 'Telegram NFT · one-to-one',
      homeDesc: 'Swap Telegram NFTs one-to-one: create an offer and send it to your partner.',
      createDeal: 'CREATE DEAL',
      createTitle: 'New deal',
      yourNft: 'YOUR NFT',
      partnerNft: "PARTNER'S NFT",
      yourUsername: 'Your Telegram username',
      partnerUsername: "Partner's Telegram username",
      nftLink: 'NFT link',
      confirm: 'CONFIRM',
      confirming: 'LOADING NFTs…',
      creating: 'CREATING OFFER…',
      errUsernameEmpty: 'Enter a Telegram username.',
      errUsernameFormat: 'Username: 5–32 chars, Latin letters, digits and "_", must start with a letter.',
      errSameUser: 'Enter two different users.',
      errLinkEmpty: 'Paste the NFT link.',
      errLinkFormat: 'Use a link like t.me/nft/Name-123456.',
      errSameLink: 'The two NFTs must be different.',
      errNftNotFound: 'NFT not found. Check the link.',
      errNftNoImage: 'Could not get an image for this NFT.',
      errNftUnavailable: 'NFT data is unavailable right now. Try again later.',
      errImageLoad: 'Failed to load the NFT image.',
      errNftLoad: 'Not all NFTs could be loaded — the deal was not created.',
      fixFields: 'Please fix the highlighted fields.',
      errCreate: 'Could not create the offer. Please try again.',
      errRate: 'Too many requests. Wait a minute.',
      errNetwork: 'Could not reach the server. Check your connection.',
      errTimeout: 'The server did not respond in time. Try again.',
      errServer: 'The server returned an error.',
      errBadResponse: 'The server returned an unexpected response.',
      offerTitle: 'OFFER',
      statusActive: 'ACTIVE',
      statusExpired: 'EXPIRED',
      statusLoading: 'LOADING',
      offerLoading: 'Loading the offer…',
      offerSentence: 'User @{u1} offers to swap NFT {n1} for NFT {n2}.',
      offerActive: 'Offer is active for another:',
      offerExpired: 'This offer is no longer valid',
      share: 'SHARE',
      shareUntil: 'The offer is valid until {time}.',
      newDeal: 'Create a new deal',
      toHome: 'Home',
      imgFail: 'Image unavailable',
      errOfferNotFound: 'Offer not found. The link may be wrong or the offer was removed.',
      errOfferLoad: 'Could not load the offer.',
      animFallback: 'animation received but cannot be played — showing the static image',
      animMeta: 'the server could not get animation data from the source — showing the static image',
      animNone: 'the source does not confirm an animation — showing the static image',
      animStatic: 'the source returned only a static image',
      animUnsupported: 'animation format is not supported — showing the static image',
      animMedia: 'the server could not load the animation file — showing the static image',
      animEndpoint: 'could not request the animation from the server — showing the static image'
    }
  };

  // Причина от сервера -> ключ заметки
  var REASON_NOTE = {
    METADATA_UNAVAILABLE: 'animMeta',
    NO_ANIMATION_IN_METADATA: 'animNone',
    STATIC_IMAGE_ONLY: 'animStatic',
    UNSUPPORTED_FORMAT: 'animUnsupported',
    MEDIA_UNAVAILABLE: 'animMedia'
  };

  // Код ошибки сервера -> ключ текста
  var SERVER_CODE_KEY = {
    NFT_NOT_FOUND: 'errNftNotFound',
    IMAGE_MISSING: 'errNftNoImage',
    DATA_UNAVAILABLE: 'errNftUnavailable',
    FETCH_ERROR: 'errNftUnavailable',
    FETCH_TIMEOUT: 'errNftUnavailable',
    INVALID_LINK: 'errLinkFormat',
    INVALID_USERNAME: 'errUsernameFormat',
    SAME_USER: 'errSameUser',
    SAME_NFT: 'errSameLink',
    RATE_LIMITED: 'errRate',
    STORE_ERROR: 'errCreate'
  };

  var USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
  // t.me/nft/Name-123 и https://t.me/nft/Name-123; другие домены не принимаются
  var NFT_LINK_RE = /^(?:https?:\/\/)?t\.me\/nft\/([A-Za-z0-9]+)-(\d+)\/?(?:[?#].*)?$/i;
  var OFFER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

  var lang = 'ru';
  try {
    var saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ru' || saved === 'en') lang = saved;
  } catch (e) {}

  /* ---------- Утилиты ---------- */
  function $(id) { return document.getElementById(id); }
  function t(key) { return (I18N[lang] && I18N[lang][key]) || key; }
  function fmt(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  var state = {
    screen: 'home',
    offer: null,
    skew: 0,
    timerId: null,
    busy: false,
    busyKey: null,
    offerView: 'ready'
  };

  var el = {
    root: $('appRoot'),
    langRu: $('langRu'), langEn: $('langEn'),
    backBtn: $('backBtn'),
    createDealBtn: $('createDealBtn'),
    confirmBtn: $('confirmBtn'), confirmBtnText: $('confirmBtnText'),
    createStatus: $('createStatus'),
    shareBtn: $('shareBtn'), newDealBtn: $('newDealBtn'),
    offerCard: $('offerCard'), offerStatus: $('offerStatus'),
    offerSentence: $('offerSentence'), offerTimerLabel: $('offerTimerLabel'), offerTime: $('offerTime'),
    offerNotes: $('offerNotes'), offerWrap: $('offerWrap'),
    offerError: $('offerError'), offerErrorText: $('offerErrorText'), offerErrorBtn: $('offerErrorBtn'),
    offerActions: $('offerActions')
  };

  var FIELDS = ['myUsername', 'myNftLink', 'partnerUsername', 'partnerNftLink'];
  var fieldErrKeys = {};
  var createStatusKey = null;
  var offerErrorKey = null;
  var slotFailed = { n1: false, n2: false };
  var noteState = { n1: { key: null, detail: null }, n2: { key: null, detail: null } };

  function noteText(p) {
    var n = noteState[p];
    if (!n.key) return '';
    return t(n.key) + (n.detail ? ' (' + n.detail + ')' : '');
  }

  /* ---------- Высота и безопасные области Telegram Mini App ---------- */
  function setAppHeight() {
    var h = (tg && tg.viewportStableHeight) || window.innerHeight;
    if (h) document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  }

  /* ---------- Язык ---------- */
  function applyLang() {
    document.documentElement.lang = lang;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === el.confirmBtnText && state.busy) continue;
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    el.langRu.classList.toggle('active', lang === 'ru');
    el.langEn.classList.toggle('active', lang === 'en');
    el.langRu.setAttribute('aria-pressed', lang === 'ru');
    el.langEn.setAttribute('aria-pressed', lang === 'en');
    if (state.busy && state.busyKey) el.confirmBtnText.textContent = t(state.busyKey);

    FIELDS.forEach(function (id) {
      if (fieldErrKeys[id]) $(id + 'Err').textContent = t(fieldErrKeys[id]);
    });
    if (createStatusKey) el.createStatus.textContent = t(createStatusKey);
    if (offerErrorKey) el.offerErrorText.textContent = t(offerErrorKey);

    ['n1', 'n2'].forEach(function (p) {
      if (slotFailed[p]) $(p + 'Fail').textContent = t('imgFail');
    });
    renderOfferTexts();
    refreshOfferNotes();
  }

  function setLang(l) {
    if (l !== 'ru' && l !== 'en') return;
    lang = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    applyLang();
  }

  /* ---------- Навигация ---------- */
  function go(screen) {
    state.screen = screen;
    el.root.setAttribute('data-screen', screen);
    ['Home', 'Create', 'Offer'].forEach(function (s) {
      $('screen' + s).classList.toggle('active', s.toLowerCase() === screen);
    });
    if (screen !== 'offer') stopTimer();
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  function clearOfferParam() {
    try {
      var hash = location.hash || '';
      history.replaceState(null, '', location.pathname + hash);
    } catch (e) {}
  }

  /* ---------- Ссылки и валидация ---------- */
  function normalizeNftLink(v) {
    var m = NFT_LINK_RE.exec(String(v || '').trim());
    return m ? 'https://t.me/nft/' + m[1] + '-' + m[2] : null; // https:// добавляется автоматически, поле не меняется
  }
  function slugOf(link) {
    var m = /\/nft\/(.+)$/.exec(link);
    return m ? m[1] : null;
  }
  function normalizeUsername(v) {
    return String(v || '').trim().replace(/^@+/, '');
  }

  function setFieldError(id, key) {
    var field = $(id + 'Field');
    fieldErrKeys[id] = key || null;
    field.classList.toggle('invalid', !!key);
    $(id + 'Err').textContent = key ? t(key) : '';
  }
  function clearFieldErrors() {
    FIELDS.forEach(function (id) { setFieldError(id, null); });
  }

  function showCreateStatus(kind, key) {
    createStatusKey = key;
    el.createStatus.className = 'status show ' + kind;
    el.createStatus.textContent = t(key);
  }
  function hideCreateStatus() {
    createStatusKey = null;
    el.createStatus.className = 'status';
    el.createStatus.textContent = '';
  }

  function validateCreateForm() {
    var ok = true;
    var d = {
      myUsername: normalizeUsername($('myUsername').value),
      partnerUsername: normalizeUsername($('partnerUsername').value),
      myLink: normalizeNftLink($('myNftLink').value),
      partnerLink: normalizeNftLink($('partnerNftLink').value)
    };

    function user(id, v) {
      if (!v) { setFieldError(id, 'errUsernameEmpty'); ok = false; }
      else if (!USERNAME_RE.test(v)) { setFieldError(id, 'errUsernameFormat'); ok = false; }
    }
    function link(id, raw, norm) {
      if (!String(raw || '').trim()) { setFieldError(id, 'errLinkEmpty'); ok = false; }
      else if (!norm) { setFieldError(id, 'errLinkFormat'); ok = false; }
    }

    user('myUsername', d.myUsername);
    user('partnerUsername', d.partnerUsername);
    link('myNftLink', $('myNftLink').value, d.myLink);
    link('partnerNftLink', $('partnerNftLink').value, d.partnerLink);

    if (ok && d.myUsername.toLowerCase() === d.partnerUsername.toLowerCase()) {
      setFieldError('partnerUsername', 'errSameUser');
      ok = false;
    }
    if (ok && d.myLink.toLowerCase() === d.partnerLink.toLowerCase()) {
      setFieldError('partnerNftLink', 'errSameLink');
      ok = false;
    }
    if (!ok) return null;
    d.mySlug = slugOf(d.myLink);
    d.partnerSlug = slugOf(d.partnerLink);
    return d;
  }

  /* ---------- Сеть ---------- */
  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    options = options || {};
    options.signal = controller.signal;
    return fetch(url, options).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  // Универсальный запрос JSON API (предложения)
  function apiJson(url, opts) {
    return fetchWithTimeout(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        if (!json || typeof json !== 'object') {
          var e1 = new Error('bad response');
          e1.code = 'bad';
          throw e1;
        }
        if (!res.ok || json.ok === false) {
          var e2 = new Error(String(json.error || 'HTTP ' + res.status));
          e2.code = 'server';
          e2.serverCode = json.code || null;
          e2.errors = json.errors || null;
          e2.which = json.which || null;
          throw e2;
        }
        return json;
      });
    }, function (e) {
      var err = new Error(e && e.name === 'AbortError' ? 'timeout' : 'network');
      err.code = e && e.name === 'AbortError' ? 'timeout' : 'network';
      throw err;
    });
  }

  // Существующая загрузка NFT (/api/validate-nft)
  function requestNft(link, username) {
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url: link, link: link, username: username || '' })
    };
    return fetchWithTimeout(API_ENDPOINT, opts).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var msg = (json && (json.error || json.message)) || ('HTTP ' + res.status);
          var err = new Error(typeof msg === 'string' ? msg : 'HTTP ' + res.status);
          err.code = 'server';
          err.serverCode = json && json.code ? json.code : null;
          throw err;
        }
        if (!json || typeof json !== 'object') {
          var e2 = new Error('bad response');
          e2.code = 'bad';
          throw e2;
        }
        if (json.ok === false || json.valid === false || json.success === false) {
          var e3 = new Error(String(json.error || json.message || 'invalid'));
          e3.code = 'server';
          e3.serverCode = json.code || null;
          throw e3;
        }
        return { slug: json.slug || null, imageUrl: extractImage(json), raw: json };
      });
    }, function (e) {
      var err = new Error(e && e.name === 'AbortError' ? 'timeout' : 'network');
      err.code = e && e.name === 'AbortError' ? 'timeout' : 'network';
      throw err;
    });
  }

  function isSafeImageUrl(u) {
    if (typeof u !== 'string') return false;
    u = u.trim();
    if (/^https:\/\//i.test(u)) return true;
    if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);/i.test(u)) return true;
    if (u.charAt(0) === '/' && u.charAt(1) !== '/') return true;
    return false;
  }

  function isSafeMediaUrl(u) {
    if (typeof u !== 'string') return false;
    u = u.trim();
    return /^https:\/\//i.test(u) || u.indexOf('/api/nft-media?') === 0;
  }

  function extractImage(json) {
    var sources = [json];
    if (json.nft && typeof json.nft === 'object') sources.push(json.nft);
    if (json.data && typeof json.data === 'object') sources.push(json.data);
    if (json.metadata && typeof json.metadata === 'object') sources.push(json.metadata);
    for (var s = 0; s < sources.length; s++) {
      for (var i = 0; i < IMAGE_KEYS.length; i++) {
        var v = sources[s][IMAGE_KEYS[i]];
        if (isSafeImageUrl(v)) return v.trim();
      }
    }
    return null;
  }

  function preloadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        if (img.naturalWidth > 0) resolve(); else reject(new Error('empty'));
      };
      img.onerror = function () { reject(new Error('load')); };
      img.src = src;
    });
  }

  // Ключ текста ошибки по ошибке запроса
  function errKeyFor(e) {
    if (e && e.serverCode && SERVER_CODE_KEY[e.serverCode]) return SERVER_CODE_KEY[e.serverCode];
    if (e && e.code === 'network') return 'errNetwork';
    if (e && e.code === 'timeout') return 'errTimeout';
    if (e && e.code === 'bad') return 'errBadResponse';
    return 'errServer';
  }

  // Запрос анимации — отдельный слой. НИКОГДА не отклоняется и не влияет на загрузку NFT.
  // Возвращает { media: {kind,url}|null, noteKey, detail }
  function requestAnimation(slug) {
    var url = ANIMATION_ENDPOINT + '?slug=' + encodeURIComponent(slug);
    return fetchWithTimeout(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) return { media: null, noteKey: 'animEndpoint', detail: 'HTTP ' + res.status };
        return res.json().then(function (j) {
          if (!j || typeof j !== 'object' || j.ok === false) {
            return { media: null, noteKey: 'animEndpoint', detail: 'bad response' };
          }
          var m = j.media;
          if (m && typeof m === 'object' && ['lottie', 'video', 'gif'].indexOf(m.kind) >= 0 && isSafeMediaUrl(m.url)) {
            return { media: { kind: m.kind, url: m.url.trim() }, noteKey: null, detail: null };
          }
          var a = j.animation || {};
          return {
            media: null,
            noteKey: REASON_NOTE[a.reason] || 'animNone',
            detail: a.detail ? String(a.detail) : null
          };
        });
      })
      .catch(function (e) {
        return { media: null, noteKey: 'animEndpoint', detail: e && e.name === 'AbortError' ? 'timeout' : 'network' };
      });
  }

  // Кэш запросов анимации в рамках сессии (на экране создания запрос стартует заранее)
  var animCache = {};
  function animFor(slug) {
    if (!animCache[slug]) {
      animCache[slug] = requestAnimation(slug).then(function (a) {
        if (!a.media) delete animCache[slug]; // неудачи не запоминаем
        return a;
      });
    }
    return animCache[slug];
  }

  /* ---------- Анимация ---------- */
  var lottiePromise = null;
  var anims = { n1: null, n2: null };
  var slotToken = { n1: 0, n2: 0 };

  function E(p) {
    return { slot: $(p + 'Slot'), img: $(p + 'Img'), media: $(p + 'Media'), sk: $(p + 'Sk'), fail: $(p + 'Fail') };
  }

  function loadLottieLib() {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (lottiePromise) return lottiePromise;
    lottiePromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LOTTIE_SRC;
      s.async = true;
      s.onload = function () { window.lottie ? resolve(window.lottie) : reject(new Error('lottie')); };
      s.onerror = function () { reject(new Error('lottie')); };
      document.head.appendChild(s);
    });
    lottiePromise.catch(function () { lottiePromise = null; });
    return lottiePromise;
  }

  // Файл Lottie запрашиваем сами, параллельно с загрузкой библиотеки
  function fetchLottieData(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (res) {
      if (!res.ok) {
        var e1 = new Error('http');
        e1.detail = 'HTTP ' + res.status;
        throw e1;
      }
      return res.json().then(function (data) {
        if (!data || !Array.isArray(data.layers)) {
          var e2 = new Error('not lottie');
          e2.detail = 'not a Lottie file';
          throw e2;
        }
        return data;
      }, function () {
        var e3 = new Error('json');
        e3.detail = 'invalid JSON';
        throw e3;
      });
    }, function () {
      var e4 = new Error('network');
      e4.detail = 'network';
      throw e4;
    });
  }

  function teardownMedia(p) {
    var e = E(p);
    if (anims[p]) {
      try { anims[p].destroy(); } catch (x) {}
      anims[p] = null;
    }
    var vids = e.media.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].pause(); vids[i].removeAttribute('src'); vids[i].load(); } catch (x) {}
    }
    e.media.innerHTML = '';
    e.media.classList.remove('pending', 'on');
    e.img.classList.remove('hide');
    e.slot.classList.remove('live');
  }

  // Resolve({ok:true}) только когда анимация действительно запущена; иначе {ok:false, detail}
  function mountMedia(p, media, token) {
    return new Promise(function (resolve) {
      var box = E(p).media;
      var done = false;
      var timer = setTimeout(function () { finish(false, 'timeout'); }, MEDIA_TIMEOUT_MS);

      function finish(ok, detail) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: ok, detail: detail || null });
      }

      box.classList.add('pending');

      if (media.kind === 'lottie') {
        Promise.all([loadLottieLib(), fetchLottieData(media.url)]).then(function (r) {
          if (done || slotToken[p] !== token) return finish(false, 'cancelled');
          var anim;
          try {
            anim = r[0].loadAnimation({
              container: box,
              renderer: 'svg',
              loop: true,
              autoplay: true,
              animationData: r[1],
              rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
            });
          } catch (x) { return finish(false, 'lottie init'); }
          anims[p] = anim;

          // С animationData событие могло сработать до подписки, поэтому проверяем состояние напрямую
          var tries = 0;
          function check() {
            if (done) return;
            if (anim.isLoaded || anim.totalFrames > 0) {
              if (anim.totalFrames > 1) finish(true);
              else finish(false, 'single frame');
              return;
            }
            if (++tries < 400) setTimeout(check, 25);
          }
          anim.addEventListener('DOMLoaded', check);
          anim.addEventListener('data_failed', function () { finish(false, 'lottie data failed'); });
          check();
        }, function (err) {
          finish(false, (err && err.detail) || 'lottie-web not loaded');
        });
      } else if (media.kind === 'video') {
        // WEBM / MP4: autoplay, без звука, с повтором, inline
        var v = document.createElement('video');
        v.muted = true;
        v.defaultMuted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        v.preload = 'auto';
        v.addEventListener('playing', function () { finish(true); });
        v.addEventListener('error', function () { finish(false, 'video error'); });
        box.appendChild(v);
        v.src = media.url;
        try {
          var pr = v.play();
          if (pr && pr.catch) pr.catch(function () {});
        } catch (x) {}
      } else if (media.kind === 'gif') {
        var g = new Image();
        g.alt = '';
        g.onload = function () { if (g.naturalWidth > 0) finish(true); else finish(false, 'gif empty'); };
        g.onerror = function () { finish(false, 'gif error'); };
        box.appendChild(g);
        g.src = media.url;
      } else {
        finish(false, 'unknown kind');
      }
    });
  }

  function setNote(p, key, detail) {
    noteState[p] = { key: key || null, detail: detail || null };
    refreshOfferNotes();
  }

  // Как только анимация реально играет — плавно переключаем слот со статичного изображения на неё
  function startAnimation(p, media, token) {
    mountMedia(p, media, token).then(function (r) {
      if (slotToken[p] !== token) return;
      var e = E(p);
      if (r.ok) {
        e.sk.style.display = 'none';
        e.media.classList.remove('pending');
        e.media.classList.add('on');
        e.img.classList.add('hide');
        e.slot.classList.add('live');
        setNote(p, null, null);
      } else {
        teardownMedia(p);
        setNote(p, 'animFallback', r.detail);
      }
    });
  }

  function refreshOfferNotes() {
    var box = el.offerNotes;
    box.textContent = '';
    if (!state.offer) return;
    [['n1', state.offer.nft1], ['n2', state.offer.nft2]].forEach(function (x) {
      if (!noteState[x[0]].key) return;
      var line = document.createElement('div');
      line.textContent = x[1].name + ' #' + x[1].number + ': ' + noteText(x[0]);
      box.appendChild(line);
    });
  }

  /* ---------- Слоты NFT в карточке предложения ---------- */
  function resetSlot(p) {
    slotToken[p]++;
    teardownMedia(p);
    var e = E(p);
    slotFailed[p] = false;
    e.slot.classList.remove('failed');
    e.fail.textContent = '';
    e.img.onload = null;
    e.img.onerror = null;
    e.img.classList.remove('ready');
    e.img.removeAttribute('src');
    e.img.alt = '';
    e.sk.style.display = '';
    $(p + 'Name').textContent = '';
    $(p + 'User').textContent = '';
    noteState[p] = { key: null, detail: null };
  }

  function failSlot(p) {
    var e = E(p);
    slotFailed[p] = true;
    e.slot.classList.add('failed');
    e.fail.textContent = t('imgFail');
  }

  function loadSlot(p, nft, username) {
    var token = slotToken[p];
    var e = E(p);
    var retried = false;

    $(p + 'Name').textContent = nft.name + ' #' + nft.number;
    $(p + 'User').textContent = '@' + username;
    e.img.alt = nft.name + ' #' + nft.number;

    e.img.onload = function () {
      if (slotToken[p] !== token) return;
      e.img.classList.add('ready');
      e.sk.style.display = 'none';
    };
    e.img.onerror = function () {
      if (slotToken[p] !== token) return;
      if (retried) return failSlot(p);
      retried = true;
      // Сохранённый адрес мог устареть — один раз запрашиваем свежие данные существующим способом
      requestNft(nft.link, '').then(function (r) {
        if (slotToken[p] !== token) return;
        if (r.imageUrl && r.imageUrl !== nft.image) e.img.src = r.imageUrl;
        else failSlot(p);
      }, function () {
        if (slotToken[p] === token) failSlot(p);
      });
    };
    e.img.src = nft.image;

    // Анимация — отдельный необязательный слой
    animFor(nft.slug).then(function (a) {
      if (slotToken[p] !== token) return;
      if (a.media) startAnimation(p, a.media, token);
      else setNote(p, a.noteKey, a.detail);
    });
  }

  /* ---------- Предложение: тексты, таймер, отображение ---------- */
  function nftLabel(n) { return n.name + ' #' + n.number; }

  function offerSentence(o) {
    return fmt(t('offerSentence'), { u1: o.user1.username, n1: nftLabel(o.nft1), n2: nftLabel(o.nft2) });
  }

  function remainingMs() {
    return state.offer.expiresAt - (Date.now() + state.skew);
  }

  function formatHMS(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  }

  function renderOfferTexts() {
    var o = state.offer;
    if (!o) {
      if (state.offerView === 'loading') {
        el.offerStatus.textContent = t('statusLoading');
        el.offerSentence.textContent = t('offerLoading');
        el.offerTimerLabel.textContent = '';
        el.offerTime.textContent = '';
      }
      return;
    }
    el.offerSentence.textContent = offerSentence(o);
    updateTimer();
  }

  function updateTimer() {
    var o = state.offer;
    if (!o) return;
    var rem = remainingMs();
    var expired = rem <= 0;
    el.offerCard.classList.toggle('expired', expired);
    el.offerStatus.textContent = t(expired ? 'statusExpired' : 'statusActive');
    if (expired) {
      el.offerTimerLabel.textContent = t('offerExpired');
      el.offerTime.textContent = '';
    } else {
      el.offerTimerLabel.textContent = t('offerActive');
      el.offerTime.textContent = formatHMS(rem);
    }
    el.shareBtn.disabled = expired;
  }

  function startTimer() {
    stopTimer();
    updateTimer();
    state.timerId = setInterval(updateTimer, 250);
  }
  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  function setOfferView(view) {
    state.offerView = view;
    var err = view === 'error';
    el.offerWrap.style.display = err ? 'none' : '';
    el.offerActions.style.display = err ? 'none' : '';
    el.offerNotes.style.display = err ? 'none' : '';
    el.offerError.classList.toggle('show', err);
    if (view === 'loading') el.shareBtn.disabled = true;
  }

  // Показ готового предложения (после создания или открытия по ссылке)
  function showOffer(offer, serverNow) {
    state.offer = offer;
    // Таймер считается по серверному времени создания, а не по моменту открытия страницы
    state.skew = (serverNow || Date.now()) - Date.now();
    offerErrorKey = null;
    setOfferView('ready');

    resetSlot('n1');
    resetSlot('n2');
    el.offerCard.classList.remove('expired');
    renderOfferTexts();
    refreshOfferNotes();
    loadSlot('n1', offer.nft1, offer.user1.username);
    loadSlot('n2', offer.nft2, offer.user2.username);

    go('offer');
    startTimer();
    try {
      history.replaceState(null, '', location.pathname + '?offer=' + encodeURIComponent(offer.id) + (location.hash || ''));
    } catch (e) {}
  }

  function showOfferLoading() {
    state.offer = null;
    stopTimer();
    offerErrorKey = null;
    resetSlot('n1');
    resetSlot('n2');
    el.offerCard.classList.remove('expired');
    el.offerNotes.textContent = '';
    setOfferView('loading');
    renderOfferTexts();
    go('offer');
  }

  function showOfferError(e) {
    state.offer = null;
    stopTimer();
    offerErrorKey = e && e.serverCode === 'OFFER_NOT_FOUND' ? 'errOfferNotFound'
      : (e && (e.code === 'network' || e.code === 'timeout')) ? errKeyFor(e)
      : 'errOfferLoad';
    el.offerErrorText.textContent = t(offerErrorKey);
    setOfferView('error');
  }

  function openOfferById(id) {
    showOfferLoading();
    apiJson(OFFERS_ENDPOINT + '/' + encodeURIComponent(id), { method: 'GET', headers: { 'Accept': 'application/json' } })
      .then(function (j) { showOffer(j.offer, j.serverNow); }, showOfferError);
  }

  /* ---------- Подтверждение сделки ---------- */
  function setBusy(v, key) {
    state.busy = v;
    state.busyKey = v ? key : null;
    el.confirmBtn.disabled = v;
    el.confirmBtn.classList.toggle('loading', v);
    el.confirmBtnText.textContent = t(v ? key : 'confirm');
  }

  // Проверка NFT существующим способом: данные + настоящее изображение
  function checkNft(link, username) {
    return requestNft(link, username).then(function (r) {
      if (!r.imageUrl) return { ok: false, errKey: 'errNftNoImage' };
      return preloadImage(r.imageUrl).then(function () {
        return { ok: true };
      }, function () {
        return { ok: false, errKey: 'errImageLoad' };
      });
    }, function (e) {
      return { ok: false, errKey: errKeyFor(e) };
    });
  }

  function handleCreateError(e) {
    if (e && e.errors) {
      if (e.errors.my) setFieldError('myNftLink', SERVER_CODE_KEY[e.errors.my.code] || 'errNftUnavailable');
      if (e.errors.partner) setFieldError('partnerNftLink', SERVER_CODE_KEY[e.errors.partner.code] || 'errNftUnavailable');
      showCreateStatus('error', 'errNftLoad');
      return;
    }
    if (e && e.which && e.serverCode) {
      var map = {
        INVALID_USERNAME: e.which === 'my' ? 'myUsername' : 'partnerUsername',
        INVALID_LINK: e.which === 'my' ? 'myNftLink' : 'partnerNftLink',
        SAME_USER: 'partnerUsername',
        SAME_NFT: 'partnerNftLink'
      };
      if (map[e.serverCode]) {
        setFieldError(map[e.serverCode], SERVER_CODE_KEY[e.serverCode]);
        showCreateStatus('error', 'fixFields');
        return;
      }
    }
    var key = e && e.serverCode ? (SERVER_CODE_KEY[e.serverCode] || 'errCreate') : errKeyFor(e);
    showCreateStatus('error', key === 'errServer' ? 'errCreate' : key);
  }

  function onConfirm() {
    if (state.busy) return;
    clearFieldErrors();
    hideCreateStatus();

    var d = validateCreateForm();
    if (!d) {
      showCreateStatus('error', 'fixFields');
      return;
    }

    setBusy(true, 'confirming');
    // Информация об анимациях запрашивается заранее, пока загружаются NFT
    animFor(d.mySlug);
    animFor(d.partnerSlug);

    Promise.all([
      checkNft(d.myLink, d.myUsername),
      checkNft(d.partnerLink, d.partnerUsername)
    ]).then(function (res) {
      var bad = false;
      if (!res[0].ok) { setFieldError('myNftLink', res[0].errKey); bad = true; }
      if (!res[1].ok) { setFieldError('partnerNftLink', res[1].errKey); bad = true; }
      if (bad) {
        // Если хотя бы один NFT не загрузился, сделка не создаётся
        setBusy(false);
        showCreateStatus('error', 'errNftLoad');
        return;
      }
      setBusy(true, 'creating');
      return apiJson(OFFERS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          myUsername: d.myUsername,
          myLink: d.myLink,
          partnerUsername: d.partnerUsername,
          partnerLink: d.partnerLink
        })
      }).then(function (j) {
        setBusy(false);
        showOffer(j.offer, j.serverNow);
      }, function (e) {
        setBusy(false);
        handleCreateError(e);
      });
    }).catch(function () {
      setBusy(false);
      showCreateStatus('error', 'errCreate');
    });
  }

  /* ---------- Поделиться ---------- */
  function shareMessage(o) {
    var until = new Date(o.expiresAt);
    var time = until.toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' });
    return offerSentence(o) + '\n' + fmt(t('shareUntil'), { time: time });
  }

  function onShare() {
    var o = state.offer;
    if (!o || remainingMs() <= 0) return;
    // Официальный способ: ссылка t.me/share/url открывает выбор чата в Telegram
    var url = 'https://t.me/share/url?url=' + encodeURIComponent(o.shareUrl) +
      '&text=' + encodeURIComponent(shareMessage(o));
    if (tg && typeof tg.openTelegramLink === 'function') {
      try { tg.openTelegramLink(url); return; } catch (e) {}
    }
    window.open(url, '_blank');
  }

  /* ---------- Открытие по ссылке ---------- */
  function initialOfferId() {
    var id = null;
    try { id = new URLSearchParams(location.search).get('offer'); } catch (e) {}
    if (!id && tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) id = tg.initDataUnsafe.start_param;
    if (!id) {
      try { id = new URLSearchParams((location.hash || '').replace(/^#/, '')).get('tgWebAppStartParam'); } catch (e) {}
    }
    return id && OFFER_ID_RE.test(id) ? id : null;
  }

  /* ---------- События ---------- */
  el.langRu.addEventListener('click', function () { setLang('ru'); });
  el.langEn.addEventListener('click', function () { setLang('en'); });

  el.createDealBtn.addEventListener('click', function () { go('create'); });
  el.backBtn.addEventListener('click', function () {
    if (state.screen === 'offer') clearOfferParam();
    go('home');
  });
  el.offerErrorBtn.addEventListener('click', function () { clearOfferParam(); go('home'); });
  el.confirmBtn.addEventListener('click', onConfirm);
  el.shareBtn.addEventListener('click', onShare);
  el.newDealBtn.addEventListener('click', function () {
    FIELDS.forEach(function (id) { $(id).value = ''; });
    clearFieldErrors();
    hideCreateStatus();
    clearOfferParam();
    go('create');
  });

  FIELDS.forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (fieldErrKeys[id]) setFieldError(id, null);
    });
    $(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    });
  });

  // Пересчёт таймера при возврате в приложение
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.offer) updateTimer();
  });
  window.addEventListener('resize', setAppHeight);

  /* ---------- Telegram WebApp ---------- */
  try {
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('#0a0c10');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0a0c10');
      if (tg.onEvent) tg.onEvent('viewportChanged', setAppHeight);
    }
  } catch (e) {}

  setAppHeight();
  applyLang();

  var startId = initialOfferId();
  if (startId) openOfferById(startId);
  else go('home');

  // Библиотеку lottie-web подгружаем заранее
  setTimeout(function () { loadLottieLib().catch(function () {}); }, 300);
})();
