# Contribuire

Il repository è mantenuto da [@LorenzoVicino](https://github.com/LorenzoVicino). `main` è protetto: le modifiche passano da branch dedicati, pull request e controllo CI `quality`.

## Flusso locale

```bash
npm ci
cp .env.example .env.local
npm run bootstrap:setup
npm run dev
```

Prima di aprire una pull request:

```bash
npm run check
docker compose --env-file deploy.env.example -f compose.production.yml config --quiet
```

Non includere feed con licenze incompatibili, dump con dati personali, `.env.local`, `deploy.env` o artefatti nella cartella `data/gtfs/incoming/uploads`.
