# LipoManager
LipoManager is a lightweight FPV LiPo battery tracking webapp with:
- battery inventory management (capacity, cells, purchase date, notes, archive state)
- serial and QR label generation
- usage logging for charged and used events
- batch usage logging for multiple batteries at once
- per-battery stats and 1-5 star performance rating

## Project structure
- `docs/`: static frontend for GitHub Pages
- `worker/`: Cloudflare Worker API + D1 database schema

## Local setup
1. Install dependencies for the worker:
   - `npm --prefix worker install`
2. Create a D1 database:
   - `wrangler d1 create lipomanager-db`
3. Copy the returned `database_id` into `worker/wrangler.toml`.
4. Apply migrations:
   - `wrangler d1 migrations apply lipomanager-db --remote --config worker/wrangler.toml`
5. Deploy the worker:
   - `wrangler deploy --config worker/wrangler.toml`
6. Update `docs/config.js` with the deployed Worker URL.

## Deploy frontend to GitHub Pages
Use GitHub Pages source: `main` branch, `/docs` folder.

## API summary
- `GET /health`
- `GET /api/batteries?archived=false|true|all`
- `POST /api/batteries`
- `GET /api/batteries/:id`
- `PATCH /api/batteries/:id`
- `GET /api/batteries/:id/events?limit=20`
- `POST /api/events` (single battery)
- `POST /api/events/batch` (multiple batteries)
- `GET /api/stats`

