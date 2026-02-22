# GTFS Hub - Progettazione DB GTFS Multi-Citta + Ticketing

Schema di persistenza relazionale PostgreSQL per una piattaforma di:
- consultazione orari trasporto pubblico (GTFS)
- gestione itinerari anche con cambi/scali
- vendita e validazione digitale dei biglietti

## Web App Next.js (full stack)

Questa cartella ora include anche una web app Next.js con:
- ricerca citta tramite barra testuale + dropdown
- click su una citta per caricare GTFS dal database
- visualizzazione su mappa (OpenStreetMap + Leaflet) di fermate e linee principali
- upload GTFS `.zip` diretto dalla homepage (con import automatico nel DB Docker)

### Setup rapido

1. Configura variabili ambiente:

```bash
cp .env.example .env.local
```

Su Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

2. Verifica `DATABASE_URL` in `.env.local`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gtfs_ticketing
```

3. Installa dipendenze e avvia:

```bash
npm install
npm run dev
```

4. Apri:

```text
http://localhost:3000
```

### API disponibili

- `GET /api/cities` -> elenco citta
- `GET /api/cities/{CITY_CODE}/gtfs` -> fermate + linee campione della citta
- `POST /api/gtfs/upload` -> upload `.zip` + import GTFS nel DB
- `POST /api/tickets/purchase` -> acquisto ticket a tempo (mock payment)
- `POST /api/tickets/{ticketCode}/validate` -> validazione ticket a tempo
- `GET /api/stops/departures?cityId=...&stopId=...&serviceDate=YYYY-MM-DD` -> prossime 10 partenze da fermata
- `GET /api/bookings?email=...` -> storico prenotazioni cliente (paginato)
- `POST /api/itineraries` -> creazione itinerario con 1-2 segmenti (cambi/scali)
- `GET /api/itineraries/{itineraryId}` -> lettura itinerario con segmenti ordinati

Esempi manuali (`curl`):

```bash
curl -X POST http://localhost:3000/api/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{
    "cityCode": "BRI",
    "ticketTypeName": "Urban 90",
    "customer": { "email": "demo@example.com", "fullName": "Demo User" },
    "passengers": [{ "fullName": "Demo Passenger", "birthDate": "1999-01-01" }]
  }'
```

Fallback con `cityId`:

```bash
curl -X POST http://localhost:3000/api/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{
    "cityId": 1,
    "ticketTypeName": "Urban 90",
    "customer": { "email": "demo2@example.com", "fullName": "Demo User 2" },
    "passengers": [{ "fullName": "Passenger 1" }, { "fullName": "Passenger 2" }]
  }'
```

Validazione ticket (prima o successive timbrature):

```bash
curl -X POST http://localhost:3000/api/tickets/TKT-ABCDEF123456/validate \
  -H "Content-Type: application/json" \
  -d '{
    "stopId": 123,
    "segmentId": 456,
    "validatorDevice": "turnstile-01"
  }'
```

Validazione con body vuoto:

```bash
curl -X POST http://localhost:3000/api/tickets/TKT-ABCDEF123456/validate \
  -H "Content-Type: application/json" \
  -d '{}'
```

Storico prenotazioni per email:

```bash
curl "http://localhost:3000/api/bookings?email=demo@example.com&limit=20&offset=0"
```

Prossime partenze da fermata:

```bash
curl "http://localhost:3000/api/stops/departures?cityId=1&stopId=123&serviceDate=2026-02-22"
```

Creazione itinerario (1 segmento):

```bash
curl -X POST http://localhost:3000/api/itineraries \
  -H "Content-Type: application/json" \
  -d '{
    "cityCode": "BRI",
    "segments": [
      { "segmentSeq": 1, "tripId": 123, "fromStopId": 10, "toStopId": 20 }
    ]
  }'
```

Lettura itinerario:

```bash
curl "http://localhost:3000/api/itineraries/999"
```

Creazione itinerario con cambio (2 segmenti):

```bash
curl -X POST http://localhost:3000/api/itineraries \
  -H "Content-Type: application/json" \
  -d '{
    "cityId": 1,
    "segments": [
      { "segmentSeq": 1, "tripId": 123, "fromStopId": 10, "toStopId": 20 },
      { "segmentSeq": 2, "tripId": 456, "fromStopId": 30, "toStopId": 40 }
    ]
  }'
```

## PostgreSQL con Docker (consigliato)

Se non vuoi installare `psql` localmente, usa Docker.

### Avvio database

```bash
docker compose up -d postgres
```

Questo crea:
- database `gtfs_ticketing`
- utente `postgres`
- password `postgres`
- import automatico iniziale di `db/schema.sql` e `db/sample_data.sql`

Stringa connessione:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gtfs_ticketing
```

### Verifica rapida

```bash
docker compose ps
docker compose logs -f postgres
```

### Reset completo del database

```bash
docker compose down -v
docker compose up -d postgres
```

Nota: gli script in `/docker-entrypoint-initdb.d` vengono eseguiti solo su volume vuoto.

## Database dump

### Generare `db/dump.sql` con `pg_dump`

Se usi PostgreSQL locale:

```bash
pg_dump -d gtfs_ticketing -f db/dump.sql
```

Se usi il database Docker (`gtfs-postgres`):

```bash
docker exec -i gtfs-postgres pg_dump -U postgres -d gtfs_ticketing > db/dump.sql
```

### Ripristino da dump con `psql`

Database locale:

```bash
psql -d gtfs_ticketing -f db/dump.sql
```

Database Docker:

```bash
Get-Content db/dump.sql | docker exec -i gtfs-postgres psql -U postgres -d gtfs_ticketing
```

### Note Docker Compose

- `docker compose down -v` rimuove anche il volume dati: al prossimo `up` riparte init (`schema.sql`, `sample_data.sql`, eventuali script in `docker-entrypoint-initdb.d`).
- Il ripristino da `dump.sql` e l'init automatico sono alternative: usa l'uno o l'altro a seconda del flusso.
- Prima di dump/restore verifica che il container sia attivo:

```bash
docker compose ps
```

## Struttura repository

```text
gtfs-hub/
  db/
    schema.sql
    sample_data.sql
    dump.sql
    import_gtfs.sql
  data/
    gtfs/
      raw/
      incoming/
      README.md
  scripts/
    import_gtfs.ps1
  README.md
```

## Prerequisiti

- PostgreSQL 13+ (consigliato 15+)
- Client `psql`

## Creazione database

```bash
createdb gtfs_ticketing
```

Oppure con utente esplicito:

```bash
createdb -U postgres gtfs_ticketing
```

## Import schema e dati

### Opzione 1: import modulare

```bash
psql -d gtfs_ticketing -f db/schema.sql
psql -d gtfs_ticketing -f db/sample_data.sql
```

### Opzione 2: import completo da dump

`db/dump.sql` ricrea lo schema `transport` da zero e poi carica i dati demo.

```bash
psql -d gtfs_ticketing -f db/dump.sql
```

## Import feed GTFS reali (multi-citta)

1. Inserisci feed GTFS `.zip` (o file `.txt` estratti) in:
- `data/gtfs/raw/MIL/`
- `data/gtfs/raw/ROM/`

2. Lancia import per una citta:

```powershell
.\scripts\import_gtfs.ps1 `
  -CityCode MIL `
  -CityName "Milano" `
  -FeedPath ".\data\gtfs\raw\MIL\feed.zip" `
  -ServiceDate 2026-02-18 `
  -DbName gtfs_ticketing
```

3. Lancia import per un'altra citta:

```powershell
.\scripts\import_gtfs.ps1 `
  -CityCode ROM `
  -CityName "Roma" `
  -FeedPath ".\data\gtfs\raw\ROM\feed.zip" `
  -ServiceDate 2026-02-18 `
  -DbName gtfs_ticketing
```

Lo script supporta:
- feed come cartella o `.zip`
- upsert (aggiornamento dati gia presenti)
- fallback automatico per `calendar.txt` e `fare_attributes.txt` se mancanti

Verifica rapida import:

```sql
SET search_path TO transport, public;
SELECT city_code, name FROM city ORDER BY city_code;
SELECT city_id, COUNT(*) AS routes FROM route GROUP BY city_id ORDER BY city_id;
SELECT city_id, COUNT(*) AS trips FROM trip GROUP BY city_id ORDER BY city_id;
SELECT city_id, COUNT(*) AS stop_times FROM stop_time GROUP BY city_id ORDER BY city_id;
```

## Modello dati (sintesi)

### Modulo Trasporto (GTFS)
- `city`
- `agency`
- `route`
- `trip`
- `stop`
- `stop_time`
- `calendar`
- `fare`

### Modulo Ticketing
- `customer`
- `passenger`
- `booking`
- `itinerary`
- `itinerary_segment`
- `ticket`
- `payment`
- `validation`

## Requisiti coperti

- Multi-citta: ogni entita operativa e contestualizzata a `city_id`
- Gestione cambi/scali: `itinerary` 1:N `itinerary_segment`
- Integrita referenziale: PK/FK composite per coerenza tra citta, corse e fermate
- Vincoli business: `CHECK` su stati, importi, validita temporali, codici univoci
- Integrita segmenti-corsa: trigger `trg_itinerary_segment_stops_on_trip`
- Ottimizzazione: indici su percorsi di query principali + materialized view `mv_next_departures`

## Indici principali implementati

- `trip(city_id, service_date)`
- `stop_time(stop_id, departure_time)`
- `itinerary_segment(itinerary_id, segment_seq)`
- `ticket(ticket_code)` (UNIQUE)
- `booking(customer_id)`
- `validation(ticket_id)`

## Query rappresentative

### 1) Ricerca corse tra due fermate in una data

```sql
SET search_path TO transport, public;

SELECT
    t.trip_id,
    r.short_name AS linea,
    t.service_date,
    dep.departure_time AS partenza,
    arr.arrival_time AS arrivo
FROM trip t
JOIN route r
  ON r.route_id = t.route_id
 AND r.city_id = t.city_id
JOIN stop_time dep
  ON dep.trip_id = t.trip_id
 AND dep.city_id = t.city_id
JOIN stop_time arr
  ON arr.trip_id = t.trip_id
 AND arr.city_id = t.city_id
 AND arr.stop_sequence > dep.stop_sequence
WHERE t.city_id = 1
  AND t.service_date = DATE '2026-02-18'
  AND dep.stop_id = 1
  AND arr.stop_id = 4
ORDER BY dep.departure_time;
```

### 2) Prossime partenze da una fermata

```sql
SET search_path TO transport, public;
REFRESH MATERIALIZED VIEW transport.mv_next_departures;

SELECT city_id, stop_id, stop_name, line_name, departure_ts
FROM transport.mv_next_departures
WHERE city_id = 1
  AND stop_id = 2
ORDER BY departure_ts
LIMIT 10;
```

### 3) Costruzione itinerario con cambio

```sql
SET search_path TO transport, public;

SELECT
    i.itinerary_id,
    i.departure_ts,
    i.arrival_ts,
    i.transfers_count,
    s.segment_seq,
    s.trip_id,
    s.departure_stop_id,
    s.arrival_stop_id,
    s.planned_departure_ts,
    s.planned_arrival_ts
FROM itinerary i
JOIN itinerary_segment s
  ON s.itinerary_id = i.itinerary_id
 AND s.city_id = i.city_id
WHERE i.booking_id = 1
ORDER BY s.segment_seq;
```

### 4) Storico prenotazioni cliente

```sql
SET search_path TO transport, public;

SELECT
    b.booking_code,
    b.booked_at,
    b.travel_date,
    b.status,
    b.total_amount,
    b.currency_code
FROM booking b
JOIN customer c ON c.customer_id = b.customer_id
WHERE c.email = 'mario.rossi@example.com'
ORDER BY b.booked_at DESC;
```

### 5) Verifica validita di un biglietto

```sql
SET search_path TO transport, public;

SELECT
    t.ticket_code,
    t.status,
    t.valid_from,
    t.valid_to,
    CASE
        WHEN t.status IN ('void', 'refunded') THEN 'NOT_VALID'
        WHEN NOW() < t.valid_from THEN 'NOT_YET_VALID'
        WHEN NOW() > t.valid_to THEN 'EXPIRED'
        ELSE 'VALID'
    END AS validity_state
FROM ticket t
WHERE t.ticket_code = 'TCK-MIL-000001';
```
