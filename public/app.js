(function () {
  'use strict';

  /* ---------- Настройки ---------- */
  var API_ENDPOINT = '/api/validate-nft';
  var API_METHOD = 'POST';          // 'POST' (JSON) или 'GET' (?url=...)
  var REQUEST_TIMEOUT_MS = 20000;
  var MEDIA_TIMEOUT_MS = 8000;      // сколько ждём старта анимации, затем остаётся статичное изображение
  var LANG_KEY = 'ott_lang';
  var LOTTIE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
  var IMAGE_KEYS = ['image', 'imageUrl', 'image_url', 'imageURL', 'preview', 'previewUrl', 'preview_url', 'thumbnail', 'picture', 'img'];

  /* ---------- Тексты ---------- */
  var I18N = {
    ru: {
      myNft: 'Мой NFT',
      partnerNft: 'NFT партнёра',
      username: 'Telegram username владельца',
      partnerUsername: 'Telegram username партнёра',
      nftLink: 'Ссылка на NFT',
      phUsername: '@username',
      load: 'ЗАГРУЗИТЬ NFT',
      loading: 'ЗАГРУЗКА…',
      errUsernameEmpty: 'Введите Telegram username.',
      errUsernameFormat: 'Username: 5–32 символа, латиница, цифры и «_», начинается с буквы.',
      errLinkEmpty: 'Вставьте ссылку на NFT.',
      errLinkFormat: 'Неверная ссылка. Пример: https://t.me/nft/BDayCandle-202879',
      errSameLink: 'Ссылки на NFT должны быть разными.',
      fixFields: 'Исправьте отмеченные поля.',
      checking: 'Проверяем ссылки и загружаем NFT…',
      success: 'Оба NFT загружены.',
      errNetwork: 'Не удалось связаться с сервером. Проверьте соединение и повторите.',
      errTimeout: 'Сервер не ответил вовремя. Повторите попытку.',
      errServer: 'Сервер вернул ошибку',
      errBadResponse: 'Сервер вернул непонятный ответ.',
      errNoImage: 'Сервер не вернул изображение для этого NFT. Для загрузки нужен серверный метод получения метаданных.',
      errImageLoad: 'Не удалось загрузить изображение NFT.',
      errPartial: 'Не все NFT удалось загрузить.',
      animOn: '● Оригинальная анимация',
      animFallback: 'Анимация недоступна — показано статичное изображение.'
    },
    en: {
      myNft: 'My NFT',
      partnerNft: "Partner's NFT",
      username: "Owner's Telegram username",
      partnerUsername: "Partner's Telegram username",
      nftLink: 'NFT link',
      phUsername: '@username',
      load: 'LOAD NFT',
      loading: 'LOADING…',
      errUsernameEmpty: 'Enter a Telegram username.',
      errUsernameFormat: 'Username: 5–32 chars, Latin letters, digits and "_", must start with a letter.',
      errLinkEmpty: 'Paste the NFT link.',
      errLinkFormat: 'Invalid link. Example: https://t.me/nft/BDayCandle-202879',
      errSameLink: 'The NFT links must be different.',
      fixFields: 'Please fix the highlighted fields.',
      checking: 'Checking links and loading NFTs…',
      success: 'Both NFTs loaded.',
      errNetwork: 'Could not reach the server. Check your connection and try again.',
      errTimeout: 'The server did not respond in time. Try again.',
      errServer: 'Server returned an error',
      errBadResponse: 'The server returned an unexpected response.',
      errNoImage: 'The server did not return an image for this NFT. Loading requires a server-side metadata method.',
      errImageLoad: 'Failed to load the NFT image.',
      errPartial: 'Not all NFTs could be loaded.',
      animOn: '● Original animation',
      animFallback: 'Animation unavailable — showing the static image.'
    }
  };

  var USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
  var NFT_LINK_RE = /^https:\/\/t\.me\/nft\/([A-Za-z0-9]+)-(\d+)$/;

  var lang = 'ru';
  try {
    var saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ru' || saved === 'en') lang = saved;
  } catch (e) {}

  var busy = false;

  /* ---------- Утилиты ---------- */
  function $(id) { return document.getElementById(id); }
  function t(key) { return (I18N[lang] && I18N[lang][key]) || key; }

  var el = {
    langRu: $('langRu'), langEn: $('langEn'),
    myUsername: $('myUsername'), myNftLink: $('myNftLink'),
    partnerUsername: $('partnerUsername'), partnerNftLink: $('partnerNftLink'),
    loadBtn: $('loadBtn'), loadBtnText: $('loadBtnText'),
    status: $('status'), results: $('results')
  };

  var fieldErrKeys = {};
  var statusKey = null;
  var cardErrKeys = { my: null, partner: null };
  var noteKeys = { my: null, partner: null };

  /* ---------- Язык ---------- */
  function applyLang() {
    document.documentElement.lang = lang;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      if (nodes[i] === el.loadBtnText && busy) continue;
      nodes[i].textContent = t(k);
    }
    var phs = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < phs.length; j++) {
      phs[j].setAttribute('placeholder', t(phs[j].getAttribute('data-i18n-placeholder')));
    }
    el.langRu.classList.toggle('active', lang === 'ru');
    el.langEn.classList.toggle('active', lang === 'en');
    el.langRu.setAttribute('aria-pressed', lang === 'ru');
    el.langEn.setAttribute('aria-pressed', lang === 'en');
    if (busy) el.loadBtnText.textContent = t('loading');

    Object.keys(fieldErrKeys).forEach(function (id) {
      if (fieldErrKeys[id]) $(id + 'Err').textContent = t(fieldErrKeys[id]);
    });
    if (statusKey) el.status.textContent = t(statusKey);
    ['my', 'partner'].forEach(function (p) {
      if (cardErrKeys[p]) $(p + 'NftFail').textContent = t(cardErrKeys[p]);
      if (noteKeys[p]) $(p + 'NftNote').textContent = t(noteKeys[p]);
    });
  }

  function setLang(l) {
    if (l !== 'ru' && l !== 'en') return;
    lang = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    applyLang();
  }

  /* ---------- Статус ---------- */
  function showStatus(kind, key, extra) {
    statusKey = extra ? null : key;
    el.status.className = 'status show ' + kind;
    el.status.textContent = extra ? t(key) + ': ' + extra : t(key);
  }
  function hideStatus() {
    statusKey = null;
    el.status.className = 'status';
    el.status.textContent = '';
  }

  /* ---------- Ошибки полей ---------- */
  function setFieldError(id, key) {
    var field = $(id + 'Field');
    var err = $(id + 'Err');
    fieldErrKeys[id] = key || null;
    if (key) {
      field.classList.add('invalid');
      err.textContent = t(key);
    } else {
      field.classList.remove('invalid');
      err.textContent = '';
    }
  }
  function clearAllFieldErrors() {
    ['myUsername', 'myNftLink', 'partnerUsername', 'partnerNftLink'].forEach(function (id) {
      setFieldError(id, null);
    });
  }

  /* ---------- Валидация ---------- */
  function normalizeUsername(v) {
    return String(v || '').trim().replace(/^@+/, '');
  }

  function validateForm() {
    var ok = true;
    var data = {
      myUsername: normalizeUsername(el.myUsername.value),
      partnerUsername: normalizeUsername(el.partnerUsername.value),
      myLink: String(el.myNftLink.value || '').trim(),
      partnerLink: String(el.partnerNftLink.value || '').trim()
    };

    function checkUser(id, v) {
      if (!v) { setFieldError(id, 'errUsernameEmpty'); ok = false; }
      else if (!USERNAME_RE.test(v)) { setFieldError(id, 'errUsernameFormat'); ok = false; }
      else setFieldError(id, null);
    }
    function checkLink(id, v) {
      if (!v) { setFieldError(id, 'errLinkEmpty'); ok = false; }
      else if (!NFT_LINK_RE.test(v)) { setFieldError(id, 'errLinkFormat'); ok = false; }
      else setFieldError(id, null);
    }

    checkUser('myUsername', data.myUsername);
    checkLink('myNftLink', data.myLink);
    checkUser('partnerUsername', data.partnerUsername);
    checkLink('partnerNftLink', data.partnerLink);

    if (ok && data.myLink.toLowerCase() === data.partnerLink.toLowerCase()) {
      setFieldError('partnerNftLink', 'errSameLink');
      ok = false;
    }
    return ok ? data : null;
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

  function requestNft(link, username) {
    var opts, url = API_ENDPOINT;
    if (API_METHOD === 'GET') {
      url += '?url=' + encodeURIComponent(link) + '&link=' + encodeURIComponent(link) +
             '&username=' + encodeURIComponent(username);
      opts = { method: 'GET', headers: { 'Accept': 'application/json' } };
    } else {
      opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url: link, link: link, username: username })
      };
    }

    return fetchWithTimeout(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var msg = (json && (json.error || json.message)) || ('HTTP ' + res.status);
          var err = new Error(typeof msg === 'string' ? msg : 'HTTP ' + res.status);
          err.code = 'server';
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
          throw e3;
        }
        return { slug: json.slug || null, imageUrl: extractImage(json), media: extractMedia(json), raw: json };
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

  // Анимация только если сервер явно вернул media с поддерживаемым типом
  function extractMedia(json) {
    var m = json.media;
    if (!m || typeof m !== 'object') return null;
    if (['lottie', 'video', 'gif'].indexOf(m.kind) < 0) return null;
    if (!isSafeMediaUrl(m.url)) return null;
    return { kind: m.kind, url: m.url.trim() };
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

  /* ---------- Анимация ---------- */
  var lottiePromise = null;
  var anims = { my: null, partner: null };
  var cardToken = { my: 0, partner: 0 };

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

  function teardownMedia(prefix) {
    var box = $(prefix + 'NftMedia');
    if (anims[prefix]) {
      try { anims[prefix].destroy(); } catch (e) {}
      anims[prefix] = null;
    }
    var vids = box.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      try { vids[i].pause(); vids[i].removeAttribute('src'); vids[i].load(); } catch (e) {}
    }
    box.innerHTML = '';
    box.classList.remove('pending', 'on');
    $(prefix + 'NftImage').classList.remove('hide');
  }

  // Resolve(true) только когда анимация действительно запущена; иначе resolve(false)
  function mountMedia(prefix, media, token) {
    return new Promise(function (resolve) {
      var box = $(prefix + 'NftMedia');
      var done = false;
      var timer = setTimeout(function () { finish(false); }, MEDIA_TIMEOUT_MS);

      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      }

      box.classList.add('pending');

      if (media.kind === 'lottie') {
        loadLottieLib().then(function (lottie) {
          if (done || cardToken[prefix] !== token) return finish(false);
          var anim;
          try {
            anim = lottie.loadAnimation({
              container: box,
              renderer: 'svg',
              loop: true,
              autoplay: true,
              path: media.url,
              rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
            });
          } catch (e) { return finish(false); }
          anims[prefix] = anim;
          anim.addEventListener('DOMLoaded', function () { finish(true); });
          anim.addEventListener('data_failed', function () { finish(false); });
        }, function () { finish(false); });
      } else if (media.kind === 'video') {
        var v = document.createElement('video');
        v.muted = true;
        v.defaultMuted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        v.addEventListener('playing', function () { finish(true); });
        v.addEventListener('error', function () { finish(false); });
        box.appendChild(v);
        v.src = media.url;
        try {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } catch (e) {}
      } else if (media.kind === 'gif') {
        var g = new Image();
        g.alt = '';
        g.onload = function () { finish(g.naturalWidth > 0); };
        g.onerror = function () { finish(false); };
        box.appendChild(g);
        g.src = media.url;
      } else {
        finish(false);
      }
    });
  }

  function setNote(prefix, key, cls) {
    var n = $(prefix + 'NftNote');
    noteKeys[prefix] = key || null;
    n.className = 'nft-note' + (cls ? ' ' + cls : '');
    n.textContent = key ? t(key) : '';
  }

  // Запускается после показа статичного изображения и не блокирует кнопку
  function startAnimation(prefix, media, token) {
    mountMedia(prefix, media, token).then(function (ok) {
      if (cardToken[prefix] !== token) return; // карточку уже сбросили
      if (ok) {
        $(prefix + 'NftMedia').classList.remove('pending');
        $(prefix + 'NftMedia').classList.add('on');
        $(prefix + 'NftImage').classList.add('hide');
        setNote(prefix, 'animOn', 'ok');
      } else {
        teardownMedia(prefix);
        setNote(prefix, 'animFallback', '');
      }
    });
  }

  /* ---------- Карточки результата ---------- */
  function resetCard(prefix) {
    cardToken[prefix]++;
    teardownMedia(prefix);
    var card = $(prefix + 'NftCard');
    var img = $(prefix + 'NftImage');
    card.classList.remove('failed');
    cardErrKeys[prefix] = null;
    $(prefix + 'NftFail').textContent = '';
    img.classList.remove('ready');
    img.removeAttribute('src');
    img.alt = '';
    $(prefix + 'NftName').textContent = '';
    $(prefix + 'NftOwner').textContent = '';
    setNote(prefix, null, '');
    var sk = card.querySelector('.skeleton');
    if (sk) sk.style.display = '';
  }

  function failCard(prefix, key) {
    cardErrKeys[prefix] = key;
    var card = $(prefix + 'NftCard');
    $(prefix + 'NftFail').textContent = t(key);
    card.classList.add('failed');
  }

  function fillCard(prefix, info) {
    var img = $(prefix + 'NftImage');
    var card = $(prefix + 'NftCard');
    img.src = info.imageUrl;
    img.alt = info.name;
    img.classList.add('ready');
    var sk = card.querySelector('.skeleton');
    if (sk) sk.style.display = 'none';
    $(prefix + 'NftName').textContent = info.name;
    $(prefix + 'NftOwner').textContent = '@' + info.username;
  }

  function nameFromLink(link) {
    var m = NFT_LINK_RE.exec(link);
    return m ? m[1] + ' #' + m[2] : link;
  }

  /* ---------- Загрузка одного NFT ---------- */
  function loadOne(prefix, link, username) {
    var token = cardToken[prefix];
    return requestNft(link, username).then(function (r) {
      if (!r.imageUrl) return { ok: false, errKey: 'errNoImage' };
      return preloadImage(r.imageUrl).then(function () {
        if (cardToken[prefix] !== token) return { ok: true };
        fillCard(prefix, {
          imageUrl: r.imageUrl,
          name: nameFromLink(link),
          username: username
        });
        if (r.media) startAnimation(prefix, r.media, token);
        return { ok: true };
      }, function () {
        return { ok: false, errKey: 'errImageLoad' };
      });
    }, function (e) {
      var map = { network: 'errNetwork', timeout: 'errTimeout', bad: 'errBadResponse', server: 'errServer' };
      return { ok: false, errKey: map[e.code] || 'errServer', detail: e.code === 'server' ? e.message : null };
    });
  }

  /* ---------- Основной обработчик ---------- */
  function setBusy(v) {
    busy = v;
    el.loadBtn.disabled = v;
    el.loadBtn.classList.toggle('loading', v);
    el.loadBtnText.textContent = v ? t('loading') : t('load');
  }

  function onLoadClick() {
    if (busy) return;
    clearAllFieldErrors();
    hideStatus();

    var data = validateForm();
    if (!data) {
      showStatus('error', 'fixFields');
      return;
    }

    setBusy(true);
    resetCard('my');
    resetCard('partner');
    el.results.classList.add('show');
    showStatus('info', 'checking');

    Promise.all([
      loadOne('my', data.myLink, data.myUsername),
      loadOne('partner', data.partnerLink, data.partnerUsername)
    ]).then(function (res) {
      var okAll = true;
      var firstDetail = null;
      var firstKey = null;
      ['my', 'partner'].forEach(function (p, i) {
        var r = res[i];
        if (!r.ok) {
          okAll = false;
          if (!firstKey) { firstKey = r.errKey; firstDetail = r.detail || null; }
          failCard(p, r.errKey);
          if (r.detail) $(p + 'NftFail').textContent = t('errServer') + ': ' + r.detail;
        }
      });

      if (okAll) {
        showStatus('success', 'success');
      } else {
        var sameKey = !res[0].ok && !res[1].ok && res[0].errKey === res[1].errKey;
        if (sameKey) showStatus('error', firstKey, firstDetail);
        else showStatus('error', 'errPartial');
      }
    }).then(function () {
      setBusy(false);
    }, function () {
      setBusy(false);
      showStatus('error', 'errNetwork');
    });
  }

  /* ---------- События ---------- */
  el.langRu.addEventListener('click', function () { setLang('ru'); });
  el.langEn.addEventListener('click', function () { setLang('en'); });
  el.loadBtn.addEventListener('click', onLoadClick);

  ['myUsername', 'myNftLink', 'partnerUsername', 'partnerNftLink'].forEach(function (id) {
    el[id].addEventListener('input', function () {
      if (fieldErrKeys[id]) setFieldError(id, null);
    });
    el[id].addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); onLoadClick(); }
    });
  });

  /* ---------- Telegram WebApp ---------- */
  try {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      if (tg.setHeaderColor) tg.setHeaderColor('#0b0d12');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0b0d12');
    }
  } catch (e) {}

  applyLang();
})();
