# Progettazione DB GTFS Multi-Citta + Ticketing

Schema di persistenza relazionale PostgreSQL per una piattaforma di:
- consultazione orari trasporto pubblico (GTFS)
- gestione itinerari anche con cambi/scali
- vendita e validazione digitale dei biglietti

## Struttura repository

```text
gtfs-multicity-ticketing/
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
