# Contributing

The repository is maintained by [@LorenzoVicino](https://github.com/LorenzoVicino). `main` is protected: changes go through a dedicated branch, a pull request, and the `quality` CI check.

## Local workflow

```bash
npm ci
cp .env.example .env.local
npm run bootstrap:setup
npm run dev
```

Before opening a pull request:

```bash
npm run check
docker compose --env-file deploy.env.example -f compose.production.yml config --quiet
```

Do not include feeds with incompatible licenses, dumps containing personal data, `.env.local`, `deploy.env`, or artifacts under `data/gtfs/incoming/uploads`.
