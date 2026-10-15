# Kiran Organic Backend

The active application is the CommonJS Express server in `server.js`, backed by
MongoDB through Mongoose. Configure `MONGO_URI` and `JWT_SECRET` in the
server-only `.env` file before starting it.

## Commands

- `npm run dev` — start the MongoDB-backed server with Node watch mode.
- `npm start` — start the MongoDB-backed server.
- `npm run build` — syntax-check the active JavaScript server and routes.
- `npm test` — exercise authenticated order creation, owner-only order listing,
  and admin status updates using mocked model methods without database writes.
- `node scripts/syncFrontendProducts.js --catalog-only` — report frontend
  products, duplicate legacy IDs, missing local image files and known image
  review flags without connecting to MongoDB.
- `npm run sync:products` — preview the frontend catalog import without writes.
- `node scripts/syncFrontendProducts.js` — compare the frontend catalog against
  MongoDB without writes.
- `node scripts/syncFrontendProducts.js --apply --backup --confirm-production`
  — after reviewing a dry-run, back up existing product and category documents,
  then add missing frontend products and categories without overwriting matches.
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

Order checkout persists through `POST /api/orders` using the signed-in customer
token. `GET /api/orders` returns only orders linked to that account, plus
legacy unlinked orders with the same account email. Admin updates use
`PATCH /api/admin/orders/:id/status` and modify `orderStatus` without changing
`paymentStatus`; customer order history is fetched fresh from the API rather
than browser localStorage.

## Production deployment

### Backend on Render

Set these variables in the Render service environment. `MONGO_URI` must be the
MongoDB Atlas URI; keep it and all other secrets on the backend only.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB Atlas connection URI |
| `JWT_SECRET` | Yes | Signing and verifying user/admin JWTs |
| `PORT` | Supplied by Render | HTTP listener port |
| `FRONTEND_URL` | Optional | Additional allowed browser origin |
| `ADMIN_URL` | Optional | Additional allowed admin origin |
| `CLOUDINARY_CLOUD_NAME` | For image uploads | Cloudinary account name |
| `CLOUDINARY_API_KEY` | For image uploads | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | For image uploads | Cloudinary API secret |
| `SEED_ADMIN_EMAIL` | For `npm run seed:admin` | Account to provision as admin |
| `SEED_ADMIN_PASSWORD` | For first-time admin creation | Password used only when creating the account |
| `RESET_ADMIN_PASSWORD` | Optional, explicit reset only | Set to `true` to change the selected admin password |

The service connects to the database before listening and reports database
readiness at `GET /health`. Configure `MONGO_URI`, JWT and Cloudinary credentials
in Render; a local `.env` file does not update Render's environment.
After deploying backend changes, redeploy the Render service. Verify that
`GET /api/orders` returns `401` without a bearer token (rather than `404`);
customer requests must include the signed-in customer's bearer token.

The catalog importer is additive and requires all three explicit flags
(`--apply --backup --confirm-production`) before it can write. Run
`npm run sync:products` against the intended database first and review its
database name, collection counts, duplicate/inactive matches, and image mapping
report. The importer stores approved image URLs under
`https://kiransorganic.com/product-images/`; API responses also convert legacy
`/src/assets/Product/...` paths to website-root `/product-images/...` paths
without changing database records. The combined frontend deployment build
places and verifies the corresponding original image files at that path. Source
images marked for manual review are excluded from packaging and are not attached
to products until a correct image is available. Upload the entire contents of
`frontend/dist/`, including `product-images/`, to the MilesWeb document root.

### Public website and admin static files

Both Vite applications use the public variable `VITE_API_URL`, whose value is
`https://kiran-backend-yvdf.onrender.com/api`. The admin additionally uses
`VITE_FRONTEND_URL=https://kiransorganic.com` for its public-site link. These
variables contain no secrets.

Install dependencies in both `frontend/` and `admin/`, then run
`npm run build:deployment` from `frontend/`. The command builds the public app,
builds the admin app separately, and assembles one Apache document root at
`frontend/dist/`; deploy that directory's contents to the domain document root.
The output includes `.htaccess`, the public app at `/`, and the admin app under
`/admin/`. Enable Apache `mod_rewrite` and allow `.htaccess` overrides so
refreshes of nested public and admin routes resolve to their own app entry
points. Do not deploy the two `dist/` directories over one another.

For local development, copy each app's `.env.example` to `.env` and set
`VITE_API_URL=http://localhost:5000/api`; both Vite dev servers proxy `/api` to
the local backend. The production build defaults to the Render API if the
variable is not provided.
