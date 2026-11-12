const express = require("express");
const path = require("node:path");
const { parseTelegramNftLink, validImageUrl } = require("./nft");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "One Tap Trade", stage: 1 });
});

app.post("/api/validate-nft", (req, res) => {
  const parsed = parseTelegramNftLink(req.body?.link);
  if (!parsed) {
    return res.status(400).json({
      ok: false,
      error: "Enter a valid Telegram NFT link, for example https://t.me/nft/ViceCream-313219"
    });
  }
  const imageUrl = req.body?.imageUrl ? String(req.body.imageUrl).trim() : "";
  if (imageUrl && !validImageUrl(imageUrl)) {
    return res.status(400).json({ ok: false, error: "Image URL must start with http:// or https://" });
  }
  return res.json({ ok: true, ...parsed, imageUrl: imageUrl || null });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`One Tap Trade listening on port ${PORT}`);
});

module.exports = app;
