
const NFT_LINK_RE = /^https?:\/\/t\.me\/nft\/([A-Za-z0-9]+-\d+)\/?$/i;

function parseTelegramNftLink(input) {
  if (typeof input !== "string") return null;

  const value = input.trim();
  const match = value.match(NFT_LINK_RE);

  if (!match) return null;

  return {
    url: `https://t.me/nft/${match[1]}`,
    slug: match[1]
  };
}

function validImageUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

module.exports = {
  parseTelegramNftLink,
  validImageUrl
};
