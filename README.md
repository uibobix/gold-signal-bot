# Gold Signal Bot

`gold-signal-bot` is a TanStack Start app that generates hourly `XAU/USD`
signals server-side and renders them in a Cloudflare-ready SSR dashboard.

## Stack

- React 19
- TanStack Start
- Cloudflare Workers via the Vite plugin
- Twelve Data for `XAU/USD` and `DXY` candles

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Add your Twelve Data API key:

```bash
cp .dev.vars.example .dev.vars
```

3. Start the dev server:

```bash
npm run dev
```

The app will render a feed error if `TWELVEDATA_API_KEY` is missing or invalid.

## Environment

Required local and production secret:

```bash
TWELVEDATA_API_KEY=your_api_key_here
```

For local Cloudflare-style secret loading, place it in `.dev.vars`.

## Scripts

- `npm run dev`: local development
- `npm run build`: production build
- `npm run preview`: preview the built app
- `npm run lint`: ESLint checks
- `npm run format`: Prettier formatting
- `npm run deploy`: deploy to Cloudflare Workers with Wrangler

## Deployment

This repo is currently configured for Cloudflare Workers.

1. Authenticate Wrangler:

```bash
npx wrangler login
```

2. Set the production secret:

```bash
npx wrangler secret put TWELVEDATA_API_KEY
```

3. Deploy:

```bash
npm run deploy
```

## Notes

- The app is SSR and cannot be deployed to a static-only host.
- `XAU/USD` and `DXY` are fetched server-side; the API key is not exposed to the
  browser.
