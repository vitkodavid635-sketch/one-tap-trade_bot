
const $ = (id) => document.getElementById(id);

const translations = {
  ru: {
    username: "Укажи Telegram username, например @user.",
    link: "Добавь ссылку на NFT.",
    checking: "Проверяем NFT...",
    valid: "Ссылка принята: ",
    invalid: "Не удалось проверить ссылку.",
    success: "Обе ссылки приняты. Формат проверен.",
    error: "Исправь поля и попробуй ещё раз.",
    preview: "ПРЕДПРОСМОТР NFT",
    imageError: "ИЗОБРАЖЕНИЕ НЕ ЗАГРУЗИЛОСЬ"
  },
  en: {
    username: "Enter a Telegram username, e.g. @user.",
    link: "Add an NFT link.",
    checking: "Checking NFTs...",
    valid: "Link accepted: ",
    invalid: "Could not validate the link.",
    success: "Both links accepted. Format validated.",
    error: "Check the fields and try again.",
    preview: "NFT PREVIEW",
    imageError: "IMAGE COULD NOT LOAD"
  }
};

function language() {
  return localStorage.getItem("ott-language") || "ru";
}

function setPreview(slot, src) {
  const target = $("preview" + slot);
  target.replaceChildren();

  if (!src) {
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = translations[language()].preview;
    target.appendChild(placeholder);
    return;
  }

  const img = document.createElement("img");
  img.alt = "NFT preview";
  img.src = src;

  img.onerror = () => {
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = translations[language()].imageError;
    target.replaceChildren(placeholder);
  };

  target.appendChild(img);
}

function validUsername(value) {
  return /^@?[A-Za-z0-9_]{5,32}$/.test(value.trim());
}

function updateLanguage() {
  for (const slot of [1, 2]) {
    const status = $("status" + slot);
    if (status.dataset.key) {
      status.textContent = translations[language()][status.dataset.key];
    }
  }
}

$("checkBtn").addEventListener("click", async () => {
  const t = translations[language()];
  $("globalStatus").textContent = t.checking;

  let valid = true;
  const results = [];

  for (const slot of [1, 2]) {
    const username = $("username" + slot).value.trim();
    const link = $("link" + slot).value.trim();
    const status = $("status" + slot);

    status.textContent = "";
    status.dataset.key = "";

    if (!validUsername(username)) {
      status.textContent = t.username;
      valid = false;
      continue;
    }

    if (!link) {
      status.textContent = t.link;
      valid = false;
      continue;
    }

    try {
      const response = await fetch("/api/validate-nft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t.invalid);
      }

      status.textContent = t.valid + data.slug;
      results.push({ slot, data });
    } catch (error) {
      status.textContent = error.message || t.invalid;
      valid = false;
    }
  }

  if (valid && results.length === 2) {
    $("globalStatus").textContent = t.success;
  } else {
    $("globalStatus").textContent = t.error;
  }
});

window.addEventListener("storage", updateLanguage);

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}
