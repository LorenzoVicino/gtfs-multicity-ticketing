# GTFS Hub

Applicazione full-stack per esplorare, creare, modificare e pubblicare feed **GTFS multi-città**, con una demo di ticketing digitale e validazione QR.

Il repository nasce da un project work universitario sulla progettazione di un database GTFS con PostgreSQL. Oggi è un’applicazione più completa: include una mappa interattiva, GTFS Studio, import/sincronizzazione dei feed, corse e orari, biglietti per agenzia e un deploy self-hosted riproducibile.

## Cosa offre

- esplorazione di città, fermate e linee su OpenStreetMap/Leaflet;
- filtri per linea, categoria e agenzia;
- **GTFS Studio** per creare un feed da zero;
- apertura e modifica di un archivio `.zip` esistente;
- modifica di una città già importata nel Hub;
- supporto a più agenzie, calendari, linee, pattern di corsa e orari oltre le 24:00;
- esportazione di uno ZIP GTFS standard;
- sincronizzazione sicura del feed in PostgreSQL senza cancellare riferimenti storici usati da itinerari o biglietti;
- acquisto dimostrativo, wallet, QR firmato e validazione dei titoli di viaggio;
- sfondi fotografici della home in rotazione, responsive e compatibili con `prefers-reduced-motion`.

## Architettura

| Livello | Tecnologia | Responsabilità |
|---|---|---|
| Web | Next.js 16, React 19, TypeScript | UI, GTFS Studio e Route Handlers |
| Mappa | Leaflet, React Leaflet, OpenStreetMap | fermate, linee e selezione geografica |
| Dati | PostgreSQL 16, SQL relazionale | GTFS, ticketing, itinerari e vincoli storici |
| Import/export | AdmZip, csv-parse, csv-stringify, `psql` | parsing, normalizzazione, ZIP e sincronizzazione |
| Deploy | Docker, Docker Compose | app standalone e database self-hosted |
| Qualità | GitHub Actions, TypeScript, Next build | gate CI su pull request e `main` |

Supabase e Vercel non fanno parte dell’architettura corrente. Il progetto usa PostgreSQL standard ed è pensato per esecuzione locale o self-hosted.

## Avvio rapido

Prerequisiti:

- Node.js 22;
- npm;
- Docker con Docker Compose.

Il bootstrap prepara PostgreSQL, installa le dipendenze e importa i dati dimostrativi:

```bash
cp .env.example .env.local
npm run bootstrap
```

Su Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm run bootstrap
```

Apri [http://localhost:3000](http://localhost:3000).

Per preparare database e dipendenze senza lasciare aperto il dev server:

```bash
npm run bootstrap:setup
```

Avvio manuale:

```bash
docker compose up -d postgres
npm ci
npm run dev
```

Le variabili locali sono documentate in `.env.example`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gtfs_ticketing
TICKET_QR_SECRET=change-me-with-a-long-random-secret
GTFS_IMPORT_MODE=docker
```

Non usare i valori di esempio in un ambiente pubblico.

## GTFS Studio

### Creare un feed

1. Apri **Non trovi la tua città?**.
2. Seleziona **Crea GTFS da zero**.
3. Configura città, agenzie e calendari.
4. Posiziona le fermate sulla mappa.
5. Crea linee, sequenze, corse e orari.
6. Scarica lo ZIP oppure importalo nel Hub.

### Modificare un feed

- Da ZIP: inserisci city code e nome, poi scegli **Apri e modifica GTFS**.
- Dal database: entra nella città e premi **Modifica GTFS**.

Lo Studio conserva più `agency_id` e `service_id`, i pattern specifici delle corse e i principali campi opzionali. Un feed troppo grande per il browser viene rifiutato prima della decompressione completa con un errore esplicito.

Quando salvi nel Hub, il feed caricato è considerato lo snapshot corrente: linee, fermate, agenzie e tariffe assenti vengono disattivate; gli orari vengono ricostruiti. Le righe storiche restano disponibili per non invalidare biglietti e itinerari già registrati.

## API principali

| Metodo | Endpoint | Uso |
|---|---|---|
| `GET` | `/api/health` | stato app e connessione PostgreSQL |
| `GET` | `/api/cities` | elenco città |
| `GET` | `/api/cities/{code}/gtfs` | rete visibile sulla mappa |
| `GET` | `/api/cities/{code}/gtfs/edit` | feed completo modificabile |
| `POST` | `/api/gtfs/parse` | converte uno ZIP in una bozza Studio |
| `POST` | `/api/gtfs/build` | valida la bozza e genera lo ZIP |
| `POST` | `/api/gtfs/upload` | sincronizza uno ZIP nel database |
| `GET` | `/api/cities/{code}/tickets` | catalogo titoli per agenzia |
| `POST` | `/api/tickets/purchase` | acquisto dimostrativo |
| `POST` | `/api/tickets/validate` | validazione QR o codice |
| `GET` | `/api/bookings?email=...` | wallet e storico prenotazioni |
| `GET` | `/api/stops/departures` | prossime partenze da una fermata |

## Controlli

```bash
npm run check
docker compose --env-file deploy.env.example -f compose.production.yml config --quiet
docker build --tag gtfs-hub:local .
```

`npm run check` esegue ESLint, TypeScript e build di produzione. La stessa pipeline gira nella GitHub Action `CI / quality` su pull request e push a `main`.

## Deploy self-hosted

Il deploy supportato usa `Dockerfile` e `compose.production.yml`:

```bash
cp deploy.env.example deploy.env
# modifica deploy.env con segreti casuali
npm run deploy:local
curl http://127.0.0.1:3000/api/health
```

PostgreSQL non espone una porta pubblica; l’app è vincolata a `127.0.0.1` e va pubblicata dietro un reverse proxy con TLS. I dettagli operativi e di hardening sono in [docs/deployment.md](docs/deployment.md).

## Database e dati GTFS

Gli script principali sono in `db/`. Il Compose di sviluppo inizializza schema, feed dimostrativi, ticketing e indici su un volume vuoto. Gli script in `/docker-entrypoint-initdb.d` non vengono rieseguiti su un volume già popolato.

Reset completo dell’ambiente di sviluppo, con perdita del volume locale:

```bash
docker compose down -v
docker compose up -d postgres
```

I dataset inclusi servono a rendere la demo riproducibile. Prima di aggiungere altri feed, verifica licenza, attribuzione e compatibilità con la distribuzione pubblica.

## Sicurezza e governance

- `main` è destinato a modifiche tramite pull request e controllo `quality`;
- `CODEOWNERS` assegna il repository a `@LorenzoVicino`;
- GitHub Actions usa permessi `contents: read` e dipendenze fissate a SHA;
- `.env.local`, `deploy.env`, upload e dump locali sono ignorati;
- l’app di produzione gira come utente non-root e non monta il socket Docker;
- le segnalazioni sensibili seguono [SECURITY.md](SECURITY.md).

Questo resta un progetto dimostrativo: prima di gestire pagamenti o dati personali reali servono autenticazione, autorizzazione, audit, backup, TLS e un’integrazione con un payment provider conforme.

## Struttura

```text
app/                     pagine e API Next.js
components/              mappa, GTFS Studio, wallet e ticket UI
db/                      schema, import, ticketing e indici
data/gtfs/               feed e materiali riproducibili
docs/                    documentazione operativa
lib/                     database, GTFS, ZIP, parser e servizi
public/hero-backgrounds/ immagini ottimizzate della home
scripts/                 bootstrap cross-platform
types/                   modelli TypeScript
```

## Origine e crediti

Il progetto è stato ideato da **Lorenzo Vicino** come lavoro universitario e successivamente evoluto in un laboratorio personale su dati di trasporto, UX cartografica e architetture self-hosted.

Le fotografie della home provengono da Unsplash e sono attribuite nei nomi degli asset a Guillaume Lebelt, Chan Lee, Alain Duss, Amy Chen, Mitchell Johnson, Ash Gerlach, Kit Suman, JESHOOTS.COM e Tapio Haaja, oltre all’immagine originale già presente nel progetto.

GTFS è un formato aperto per i dati del trasporto pubblico. La mappa usa OpenStreetMap tramite Leaflet.
