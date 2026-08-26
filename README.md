# GTFS Hub

A full-stack application for exploring, creating, editing, validating, and publishing **multi-city GTFS feeds**.

The repository began as a university project about designing a PostgreSQL database for GTFS data. It has since grown into a more complete application with an interactive map, GTFS Studio, feed import and synchronization, routes and timetables, and a reproducible self-hosted deployment.

## Features

- Explore cities, stops, and routes on an OpenStreetMap/Leaflet map.
- Filter routes by name, category, and agency.
- Create a feed from scratch with **GTFS Studio**.
- Open and edit an existing `.zip` archive.
- Preserve the original archive byte-for-byte when no changes are made, and preserve unmanaged files and columns when editing.
- Enforce canonical validation with MobilityData GTFS Validator 8.0.1.
- Edit a city that has already been imported into the Hub.
- Support multiple agencies, calendars, routes, trip patterns, and times beyond 24:00.
- Export a standard GTFS ZIP archive.
- Safely synchronize a feed with PostgreSQL by deactivating rows that disappear instead of deleting them.
- Resolve service on a date from `calendar.txt` and the `calendar_dates.txt` exceptions, rather than from the date a feed happened to be imported.
- Rotate responsive home-page photography while respecting `prefers-reduced-motion`.

## Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Web | Next.js 16, React 19, TypeScript | UI, GTFS Studio, and Route Handlers |
| Map | Leaflet, React Leaflet, OpenStreetMap | Stops, routes, and geographic selection |
| Data | PostgreSQL 16, relational SQL | GTFS entities, timetables, and referential constraints |
| Import/export | AdmZip, csv-parse, csv-stringify, `psql` | Parsing, conservative merging, ZIP creation, and synchronization |
| Validation | MobilityData GTFS Validator 8.0.1 | Canonical reports and export/import gate |
| Deployment | Docker, Docker Compose | Standalone application and self-hosted database |
| Quality | GitHub Actions, TypeScript, Next.js build | CI gate for pull requests and `main` |

Supabase and Vercel are not part of the current architecture. The project uses standard PostgreSQL and is designed to run locally or on a self-hosted server.

## Quick start

Prerequisites:

- Node.js 22
- npm
- Docker with Docker Compose

The bootstrap command starts PostgreSQL and the validator, installs dependencies, and imports the bundled demo data:

```bash
cp .env.example .env.local
npm run bootstrap
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm run bootstrap
```

Open [http://localhost:3000](http://localhost:3000).

To prepare the database and dependencies without leaving the development server running:

```bash
npm run bootstrap:setup
```

Manual startup:

```bash
docker compose up -d postgres gtfs-validator
npm ci
npm run dev
```

Local variables are documented in `.env.example`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gtfs_hub
GTFS_IMPORT_MODE=docker
GTFS_VALIDATOR_URL=http://127.0.0.1:8080/v2
GTFS_VALIDATOR_COUNTRY_CODE=IT
GTFS_VALIDATOR_TIMEOUT_MS=180000
```

Do not use the example credentials in a public environment.

## GTFS Studio

### Create a feed

1. Open the new-city panel.
2. Select **Create GTFS from scratch**.
3. Configure the city, agencies, and service calendars.
4. Place stops on the map.
5. Create routes, stop sequences, trips, and timetables.
6. Download the ZIP or import it into the Hub.

### Edit a feed

- From a ZIP: enter a city code and name, then select **Open and edit GTFS**.
- From the database: open a city and select **Edit GTFS**.

GTFS Studio preserves multiple `agency_id` and `service_id` values, `calendar_dates.txt`, `shape_id` references, shape distances, trip-specific patterns, and the primary optional fields. Oversized feeds are rejected before full decompression with an explicit error.

For feeds opened from a ZIP, Studio keeps the source archive on the server for 24 hours. If the draft is unchanged, the exported file is byte-identical to the original. If it changes, managed tables are merged by key while unknown columns are preserved; files such as `transfers.txt`, `pathways.txt`, and private extensions remain byte-identical. After importing into the Hub, the canonical snapshot is stored in the `gtfs_uploads` volume and reused for future edits. If that snapshot is missing, the UI explicitly identifies the export as a database reconstruction rather than a lossless transformation.

Every download and import passes through the official MobilityData validator. `ERROR` notices block the operation, while `WARNING` and `INFO` notices remain visible without blocking it. If the validator is unavailable, the request fails with `503` instead of silently skipping validation.

When you save to the Hub, the uploaded feed becomes the current snapshot: missing routes, stops, agencies, and fares are deactivated, and timetables are rebuilt. Historical rows remain in the database instead of being deleted, so references from earlier imports stay resolvable.

## Main API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Application and PostgreSQL connection status |
| `GET` | `/api/cities` | List cities |
| `GET` | `/api/cities/{code}/gtfs` | Return the network shown on the map |
| `GET` | `/api/cities/{code}/gtfs/edit` | Return the complete editable feed |
| `POST` | `/api/gtfs/parse` | Convert a ZIP archive into a Studio draft |
| `POST` | `/api/gtfs/build` | Validate a draft and generate its ZIP archive |
| `POST` | `/api/gtfs/validate` | Run canonical validation and return its report |
| `POST` | `/api/gtfs/upload` | Synchronize a ZIP archive with the database |
| `GET` | `/api/stops/departures` | Return upcoming departures from a stop |

## Quality checks

```bash
npm run check
docker compose --env-file deploy.env.example -f compose.production.yml config --quiet
docker build --tag gtfs-hub:local .
```

`npm run check` runs the tests, ESLint, TypeScript, and a production build. The same pipeline runs in the `CI / quality` GitHub Action for pull requests and pushes to `main`.

## Self-hosted deployment

The supported deployment uses `Dockerfile` and `compose.production.yml`:

```bash
cp deploy.env.example deploy.env
# Replace the example password with a strong random value.
npm run deploy:local
curl http://127.0.0.1:3000/api/health
```

PostgreSQL and the validator do not expose public ports. The application binds to `127.0.0.1` and should be published behind a TLS-enabled reverse proxy. See [docs/deployment.md](docs/deployment.md) for operational and hardening details.

## Database and GTFS data

The main database scripts live in `db/`. In development, Docker Compose initializes the schema, demo feeds, and indexes on an empty volume. Scripts in `/docker-entrypoint-initdb.d` do not run again on an existing volume.

To completely reset the development environment, including its local database volume:

```bash
docker compose down -v
docker compose up -d postgres
```

The database is named `gtfs_hub`. A development volume created before the rename still holds
`gtfs_ticketing`: recreate it with the commands above and update `DATABASE_URL` in your
`.env.local`, which is not version-controlled. For a deployed instance, rename the database in
place as described in [docs/deployment.md](docs/deployment.md).

`db/migrations/` holds one-off scripts that bring an **existing** database to the current schema,
which the init scripts cannot do because they only run on an empty volume. Run them by hand, in
numeric order, once per database; each one is idempotent. Both delete data, so back up and
rehearse on a copy first, as described in [docs/deployment.md](docs/deployment.md).

- `001_drop_ticketing.sql` removes the ticketing tables the application no longer has.
- `002_calendar_correctness.sql` moves trips off `service_date` and adds `calendar_date`.

### How service on a date is resolved

A trip is not tied to a date. `active_calendar_ids(city_id, date)` returns the services running on
a date: those whose weekly pattern in `calendar.txt` covers it and that no `calendar_dates.txt`
exception removes, plus those an exception adds. Departures then filter trips on those calendars.

This means **a feed that does not cover today has no departures today**, which is correct rather
than broken. The bundled demo feeds are expired: the Cagliari sample covers March 2026 and the
Bologna feed ends in June 2026, so departures appear only for dates inside those windows. The stop
panel reports the window a feed covers when it has nothing to show for the date you asked for.

The bundled datasets make the demo reproducible. Before adding another feed, verify its license, attribution requirements, and compatibility with public redistribution.

## Security and governance

- Changes to `main` are expected to go through pull requests and the `quality` check.
- `CODEOWNERS` assigns the repository to `@LorenzoVicino`.
- GitHub Actions uses `contents: read` permissions and SHA-pinned actions.
- `.env.local`, `deploy.env`, uploads, and local dumps are ignored.
- The production application runs as a non-root user and does not mount the Docker socket.
- Sensitive reports follow [SECURITY.md](SECURITY.md).

This remains a demonstration project. The feed upload, build, and validation endpoints are not yet protected by administrative authentication or rate limiting, so a public deployment requires authentication, authorization, auditing, backups, and TLS.

## Repository layout

```text
app/                     Next.js pages and API routes
components/              Map and GTFS Studio UI
db/                      Schema, import, indexes, and migrations
data/gtfs/               Reproducible feeds and supporting files
docs/                    Operational documentation
lib/                     Database, GTFS, ZIP, parsing, and services
public/hero-backgrounds/ Optimized home-page photography
scripts/                 Cross-platform bootstrap tooling
types/                   TypeScript models
```

## Origin and credits

**Lorenzo Vicino** created the project as university coursework and later developed it into a personal laboratory for transport data, cartographic UX, and self-hosted architecture.

Home-page photographs come from Unsplash. Asset filenames credit Guillaume Lebelt, Chan Lee, Alain Duss, Amy Chen, Mitchell Johnson, Ash Gerlach, Kit Suman, JESHOOTS.COM, and Tapio Haaja, alongside the project's original image.

GTFS is an open standard for public transport data. The map uses OpenStreetMap through Leaflet.
