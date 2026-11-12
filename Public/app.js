const $ = (id) => document.getElementById(id);

function setPreview(slot, src) {
  const target = $("preview" + slot);
  target.innerHTML = "";
  if (!src) {
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = "NFT IMAGE";
    target.appendChild(placeholder);
    return;
  }
  const img = document.createElement("img");
  img.alt = "NFT preview";
  img.src = src;
  img.onerror = () => {
    target.innerHTML = '<div class="placeholder">IMAGE COULD NOT LOAD</div>';
  };
  target.appendChild(img);
}

function wireSlot(slot) {
  $("image" + slot).addEventListener("input", (event) => {
    const value = event.target.value.trim();
    if (value) setPreview(slot, value);
  });
  $("file" + slot).addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setPreview(slot, URL.createObjectURL(file));
      $("status" + slot).textContent = "Local image preview loaded.";
    }
  });
}
wireSlot(1);
wireSlot(2);

$("checkBtn").addEventListener("click", async () => {
  $("globalStatus").textContent = "Checking links…";
  let valid = true;
  for (const slot of [1, 2]) {
    const link = $("link" + slot).value.trim();
    const imageUrl = $("image" + slot).value.trim();
    const status = $("status" + slot);
    if (!link) {
      status.textContent = "Add a Telegram NFT link.";
      valid = false;
      continue;
    }
    try {
      const response = await fetch("/api/validate-nft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link, imageUrl })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Invalid link");
      status.textContent = "Valid link · " + data.slug;
    } catch (error) {
      status.textContent = error.message;
      valid = false;
    }
  }
  $("globalStatus").textContent = valid
    ? "Both links are valid. Image previews are ready for this prototype."
    : "Fix the highlighted fields and check again.";
});

if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}
