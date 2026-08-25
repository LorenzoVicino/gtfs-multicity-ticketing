# Deploy self-hosted

Il deploy supportato non usa Vercel né Supabase. L’app Next.js e PostgreSQL vengono eseguiti con Docker Compose; il database non espone porte pubbliche e l’app ascolta solo su `127.0.0.1` per essere pubblicata tramite un reverse proxy TLS.

## Preparazione

```bash
cp deploy.env.example deploy.env
```

Imposta in `deploy.env` password casuali e un `TICKET_QR_SECRET` di almeno 32 caratteri. Il file è ignorato da Git.

## Avvio

```bash
npm run deploy:local
docker compose --env-file deploy.env -f compose.production.yml ps
curl http://127.0.0.1:3000/api/health
```

Per arrestare i container senza eliminare i volumi:

```bash
npm run deploy:down
```

## Aggiornamento

```bash
git pull --ff-only
npm run deploy:local
```

Esegui un backup PostgreSQL prima di ogni aggiornamento che modifica `db/`.

## Perimetro di sicurezza

- il processo Next.js gira come utente non-root;
- i container usano `no-new-privileges`;
- PostgreSQL è raggiungibile solo dalla rete Docker interna;
- l’import GTFS usa `psql` direttamente, senza montare il socket Docker nell’app;
- `deploy.env` non è versionato;
- GitHub Actions esegue build e controlli, ma non possiede credenziali di deploy.

Il reverse proxy e i certificati TLS dipendono dall’host scelto e non sono inclusi. Non pubblicare direttamente la porta 3000 su Internet.
