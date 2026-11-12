# One Tap Trade — Stage 1

A small deployable prototype that accepts Telegram NFT links and image URLs, then displays image previews. This stage intentionally stops before deal acceptance, NFT transfers, Stars payments, or wallet integration.

## Requirements
- Node.js 20+
- npm

## Run locally
```bash
npm install
cp .env.example .env
npm start
```
Open http://localhost:3000

## Test
```bash
npm test
npm run check
```

## Deploy to Render
1. Create a GitHub repository and upload the contents of this folder (keep `public/` and `src/` folders).
2. In Render choose **New + → Web Service** and connect the repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Deploy. Render supplies `PORT` automatically.

## Stage 1 functionality
- Enter a Telegram collectible link such as `https://t.me/nft/ViceCream-313219`.
- Enter an image URL or choose a local image file for a preview.
- The app validates the Telegram link format and displays the entered image.
- Two NFT preview slots are shown to represent the two sides of a future trade.

## Important limitations
- A Telegram NFT link is stored/displayed as a link only. This prototype does **not** fetch private or protected Telegram metadata automatically.
- Local image files are previewed in the browser and are not uploaded to permanent server storage.
- No deal is created or accepted yet.
- No NFT ownership verification, transfer, escrow, Stars payment, or wallet connection is implemented.
- Do not use this prototype to exchange valuable NFTs. Those features require a separate, security-reviewed implementation.
