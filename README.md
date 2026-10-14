# Kiran Organic Backend

The active application is the CommonJS Express server in `server.js`, backed by
MongoDB through Mongoose. Configure `MONGO_URI` and `JWT_SECRET` in the
server-only `.env` file before starting it.

## Commands

- `npm run dev` — start the MongoDB-backed server with Node watch mode.
- `npm start` — start the MongoDB-backed server.
- `npm run build` — syntax-check the active JavaScript server and routes.
- `node scripts/syncFrontendProducts.js --catalog-only` — report frontend
  products, duplicate legacy IDs, missing local image files and known image
  review flags without connecting to MongoDB.
- `npm run sync:products` — preview the frontend catalog import without writes.
- `node scripts/syncFrontendProducts.js` — compare the frontend catalog against
  MongoDB without writes.
- `node scripts/syncFrontendProducts.js --apply --backup` — back up existing
  product and category documents, then import missing frontend products.
- `npm run seed:admin` — provision the admin selected by
  `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in the server environment.

## Database runtime

Only the root Express server is started by the package scripts. The older
`src/` and `prisma/` TypeScript tree is retained as a disabled historical
PostgreSQL implementation for reference; it is not mounted, built or started
by the active MongoDB runtime and its Prisma packages are not installed.
Do not use its old scripts or generated client when working on this service.

Product synchronization is additive and idempotent. It never deletes database
records or overwrites an existing match. The `--backup` option saves current
product and category documents before applying inserts.
