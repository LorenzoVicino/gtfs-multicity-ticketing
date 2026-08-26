# Self-hosted deployment

The supported deployment does not use Vercel or Supabase. Docker Compose runs the Next.js application, PostgreSQL, and the official MobilityData validator. The database and validator stay on an internal network, while the application binds only to `127.0.0.1` so it can be published through a TLS-enabled reverse proxy.

`vercel.json` explicitly disables automatic Git deployments for any legacy Vercel project. You may remove it after disconnecting the repository under **Vercel → Project Settings → Git → Disconnect**.

## Preparation

```bash
cp deploy.env.example deploy.env
```

Set a random database password in `deploy.env`. Git ignores this file.

## Start

```bash
npm run deploy:local
docker compose --env-file deploy.env -f compose.production.yml ps
curl http://127.0.0.1:3000/api/health
```

To stop the containers without deleting their volumes:

```bash
npm run deploy:down
```

## Update

```bash
git pull --ff-only
npm run deploy:local
```

Create a PostgreSQL backup before every update that changes files under `db/`.

### One-off: the database is now `gtfs_hub`

Instances created before the rename hold a database named `gtfs_ticketing`, and Compose now
points at `gtfs_hub`. Changing `POSTGRES_DB` does not rename an existing volume, so rename the
database once, before the first deployment that includes this change:

```bash
docker compose --env-file deploy.env -f compose.production.yml stop app
docker compose --env-file deploy.env -f compose.production.yml exec postgres \
  psql -U gtfs -d postgres -c 'ALTER DATABASE gtfs_ticketing RENAME TO gtfs_hub;'
npm run deploy:local
```

Stop the application first: PostgreSQL refuses to rename a database that still has open
connections. A fresh instance needs none of this.

## Migrations

`db/migrations/` holds one-off scripts that bring an **existing** database to the current schema.
They are not part of the Compose initialization: `/docker-entrypoint-initdb.d` runs only on an
empty volume, so `db/schema.sql` already covers a fresh instance and a migration would be
redundant there. Run them by hand, in numeric order, once per database.

Every migration is idempotent, so a second run is a no-op.

### 001 — drop the obsolete ticketing domain

`db/migrations/001_drop_ticketing.sql` deletes the ticketing tables that PR #10 removed from the
code: `customer`, `passenger`, `booking`, `itinerary`, `itinerary_segment`, `ticket`, `payment`,
`validation` and `ticket_type`, along with the `check_itinerary_segment_stops_on_trip` function,
the orphaned `itinerary_segment_segment_id_seq` sequence, and the two ticketing-only columns of
`fare`. GTFS data is untouched: the foreign keys all point from ticketing into `city`, `stop` and
`trip`, never the other way, so nothing cascades into a GTFS table.

**This destroys data permanently.** Run it in three steps.

**1. Back up.** Do not skip this; there is no undo.

```bash
docker compose --env-file deploy.env -f compose.production.yml exec -T postgres \
  pg_dump -U gtfs -d gtfs_hub --format=custom > gtfs_hub-before-001.dump
```

**2. Rehearse on a copy.** Restore the backup into a throwaway container and run the migration
there first. This is what tells you the migration fits *your* database, not the reference schema.

```bash
docker run -d --name gtfs-rehearsal -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=gtfs_hub postgres:16
until docker exec gtfs-rehearsal pg_isready -U postgres -d gtfs_hub; do sleep 1; done

docker exec -i gtfs-rehearsal pg_restore -U postgres -d gtfs_hub < gtfs_hub-before-001.dump
docker exec -i gtfs-rehearsal psql -U postgres -d gtfs_hub -v ON_ERROR_STOP=1 \
  < db/migrations/001_drop_ticketing.sql

docker rm -f gtfs-rehearsal
```

The script prints the row count it is about to delete per table, then four verification queries.
The first three must return zero rows; the fourth must list exactly `agency`, `calendar`, `city`,
`fare`, `route`, `stop`, `stop_time` and `trip`.

It also asserts, inside the transaction, that the eight GTFS tables and the `mv_next_departures`
materialized view are all still there. If a `CASCADE` had reached one of them the migration would
raise and roll back, rather than commit the loss and report it afterwards.

**3. Run it for real**, once the rehearsal is clean.

```bash
docker compose --env-file deploy.env -f compose.production.yml exec -T postgres \
  psql -U gtfs -d gtfs_hub -v ON_ERROR_STOP=1 < db/migrations/001_drop_ticketing.sql
```

In development the same script applies, against the development container:

```bash
docker compose exec -T postgres psql -U postgres -d gtfs_hub -v ON_ERROR_STOP=1 \
  < db/migrations/001_drop_ticketing.sql
```

A development database that holds nothing worth keeping needs none of this — `docker compose down -v`
and a fresh `docker compose up -d postgres` rebuild it from `db/schema.sql`, which is already correct.

## Security boundary

- The Next.js process runs as a non-root user.
- Containers use `no-new-privileges`.
- PostgreSQL is available only on the internal Docker network.
- MobilityData GTFS Validator is pinned to API release `1.0.0-validator8.0.1` and an image digest; only the application can reach it on the internal network.
- GTFS imports call `psql` directly without mounting the Docker socket into the application.
- Downloads and imports fail when the validator is unavailable or reports blocking errors.
- Published canonical ZIP files and lossless workspaces live in the `gtfs_uploads` volume; include it in your backup strategy.
- `deploy.env` is not version-controlled.
- GitHub Actions runs builds and checks without deployment credentials.

The reverse proxy and TLS certificates depend on the selected host and are not included. Do not expose port 3000 directly to the Internet.
