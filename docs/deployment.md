# Self-hosted deployment

The supported deployment does not use Vercel or Supabase. Docker Compose runs the Next.js application, PostgreSQL, and the official MobilityData validator. The database and validator stay on an internal network, while the application binds only to `127.0.0.1` so it can be published through a TLS-enabled reverse proxy.

`vercel.json` explicitly disables automatic Git deployments for any legacy Vercel project. You may remove it after disconnecting the repository under **Vercel → Project Settings → Git → Disconnect**.

## Preparation

```bash
cp deploy.env.example deploy.env
```

Set a random database password and a `TICKET_QR_SECRET` of at least 32 characters in `deploy.env`. Git ignores this file.

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
