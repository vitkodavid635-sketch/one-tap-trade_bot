const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTelegramNftLink, validImageUrl } = require("../src/nft");

test("parses a Telegram NFT link", () => {
  assert.deepEqual(parseTelegramNftLink("https://t.me/nft/ViceCream-313219"), {
    url: "https://t.me/nft/ViceCream-313219",
    slug: "ViceCream-313219"
  });
});

test("rejects a non-NFT Telegram link", () => {
  assert.equal(parseTelegramNftLink("https://t.me/somechannel"), null);
});

test("accepts http and https image URLs", () => {
  assert.equal(validImageUrl("https://example.com/a.png"), true);
  assert.equal(validImageUrl("http://example.com/a.png"), true);
});

test("rejects invalid image URLs", () => {
  assert.equal(validImageUrl("javascript:alert(1)"), false);
  assert.equal(validImageUrl("not-a-url"), false);
});
