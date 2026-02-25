\set ON_ERROR_STOP on
SET search_path TO transport, public;

BEGIN;

CREATE TEMP TABLE gtfs_agency_raw (
    agency_id TEXT,
    agency_name TEXT,
    agency_url TEXT,
    agency_timezone TEXT,
    agency_lang TEXT,
    agency_phone TEXT
);

CREATE TEMP TABLE gtfs_routes_raw (
    route_id TEXT,
    agency_id TEXT,
    route_short_name TEXT,
    route_long_name TEXT,
    route_type TEXT,
    route_color TEXT,
    route_text_color TEXT
);

CREATE TEMP TABLE gtfs_stops_raw (
    stop_id TEXT,
    stop_code TEXT,
    stop_name TEXT,
    stop_lat TEXT,
    stop_lon TEXT,
    zone_id TEXT,
    location_type TEXT,
    parent_station TEXT,
    wheelchair_boarding TEXT
);

CREATE TEMP TABLE gtfs_calendar_raw (
    service_id TEXT,
    monday TEXT,
    tuesday TEXT,
    wednesday TEXT,
    thursday TEXT,
    friday TEXT,
    saturday TEXT,
    sunday TEXT,
    start_date TEXT,
    end_date TEXT
);

CREATE TEMP TABLE gtfs_trips_raw (
    route_id TEXT,
    service_id TEXT,
    trip_id TEXT,
    trip_headsign TEXT,
    trip_short_name TEXT,
    direction_id TEXT,
    block_id TEXT,
    wheelchair_accessible TEXT,
    bikes_allowed TEXT
);

CREATE TEMP TABLE gtfs_stop_times_raw (
    trip_id TEXT,
    arrival_time TEXT,
    departure_time TEXT,
    stop_id TEXT,
    stop_sequence TEXT,
    pickup_type TEXT,
    drop_off_type TEXT,
    shape_dist_traveled TEXT
);

CREATE TEMP TABLE gtfs_fares_raw (
    fare_id TEXT,
    price TEXT,
    currency_type TEXT,
    payment_method TEXT,
    transfers TEXT,
    transfer_duration TEXT
);

\copy gtfs_agency_raw FROM '/work/data/gtfs/incoming/BOLOGNA_norm/agency.txt' WITH (FORMAT csv, HEADER true)
\copy gtfs_routes_raw FROM '/work/data/gtfs/incoming/BOLOGNA_norm/routes.txt' WITH (FORMAT csv, HEADER true)
\copy gtfs_stops_raw FROM '/work/data/gtfs/incoming/BOLOGNA_norm/stops.txt' WITH (FORMAT csv, HEADER true)
\copy gtfs_calendar_raw FROM '/work/data/gtfs/incoming/BOLOGNA_norm/calendar.txt' WITH (FORMAT csv, HEADER true)
\copy gtfs_trips_raw FROM '/work/data/gtfs/incoming/BOLOGNA_norm/trips.txt' WITH (FORMAT csv, HEADER true)
\copy gtfs_stop_times_raw FROM '/work/data/gtfs/incoming/BOLOGNA_norm/stop_times.txt' WITH (FORMAT csv, HEADER true)
\copy gtfs_fares_raw FROM '/work/data/gtfs/incoming/BOLOGNA_norm/fare_attributes.txt' WITH (FORMAT csv, HEADER true)

INSERT INTO city (city_code, name, region, country_code, timezone)
VALUES ('BOL', 'Bologna', 'N/A', 'IT', 'Europe/Rome')
ON CONFLICT (city_code)
DO UPDATE SET name = EXCLUDED.name;

CREATE TEMP TABLE gtfs_import_ctx AS
SELECT city_id
FROM city
WHERE city_code = 'BOL';

INSERT INTO agency (
    city_id, gtfs_agency_id, name, url, timezone, lang_code, phone
)
SELECT
    ctx.city_id,
    COALESCE(NULLIF(a.agency_id, ''), 'DEFAULT'),
    COALESCE(NULLIF(a.agency_name, ''), 'Bologna' || ' Transit'),
    NULLIF(a.agency_url, ''),
    COALESCE(NULLIF(a.agency_timezone, ''), 'Europe/Rome'),
    NULLIF(a.agency_lang, ''),
    NULLIF(a.agency_phone, '')
FROM gtfs_agency_raw a
CROSS JOIN gtfs_import_ctx ctx
ON CONFLICT (city_id, gtfs_agency_id)
DO UPDATE SET
    name = EXCLUDED.name,
    url = EXCLUDED.url,
    timezone = EXCLUDED.timezone,
    lang_code = EXCLUDED.lang_code,
    phone = EXCLUDED.phone,
    is_active = TRUE;

INSERT INTO agency (
    city_id, gtfs_agency_id, name, timezone
)
SELECT
    ctx.city_id,
    'DEFAULT',
    'Bologna' || ' Transit',
    'Europe/Rome'
FROM gtfs_import_ctx ctx
WHERE NOT EXISTS (
    SELECT 1
    FROM agency a
    WHERE a.city_id = ctx.city_id
);

INSERT INTO route (
    city_id, agency_id, gtfs_route_id, short_name, long_name, route_type, color_hex, text_color_hex
)
SELECT
    ctx.city_id,
    COALESCE(ag_specific.agency_id, ag_default.agency_id),
    NULLIF(r.route_id, ''),
    NULLIF(r.route_short_name, ''),
    COALESCE(NULLIF(r.route_long_name, ''), COALESCE(NULLIF(r.route_short_name, ''), NULLIF(r.route_id, ''))),
    CASE
        WHEN NULLIF(r.route_type, '') ~ '^\d+$' THEN NULLIF(r.route_type, '')::SMALLINT
        ELSE 3
    END,
    NULLIF(r.route_color, ''),
    NULLIF(r.route_text_color, '')
FROM gtfs_routes_raw r
CROSS JOIN gtfs_import_ctx ctx
LEFT JOIN LATERAL (
    SELECT a.agency_id
    FROM agency a
    WHERE a.city_id = ctx.city_id
      AND a.gtfs_agency_id = NULLIF(r.agency_id, '')
    LIMIT 1
) ag_specific ON TRUE
LEFT JOIN LATERAL (
    SELECT a.agency_id
    FROM agency a
    WHERE a.city_id = ctx.city_id
    ORDER BY a.agency_id
    LIMIT 1
) ag_default ON TRUE
WHERE NULLIF(r.route_id, '') IS NOT NULL
ON CONFLICT (city_id, gtfs_route_id)
DO UPDATE SET
    agency_id = EXCLUDED.agency_id,
    short_name = EXCLUDED.short_name,
    long_name = EXCLUDED.long_name,
    route_type = EXCLUDED.route_type,
    color_hex = EXCLUDED.color_hex,
    text_color_hex = EXCLUDED.text_color_hex,
    is_active = TRUE;

INSERT INTO stop (
    city_id, gtfs_stop_id, code, name, lat, lon, zone_id, location_type, wheelchair_boarding
)
SELECT
    ctx.city_id,
    NULLIF(s.stop_id, ''),
    NULLIF(s.stop_code, ''),
    COALESCE(NULLIF(s.stop_name, ''), NULLIF(s.stop_id, '')),
    NULLIF(s.stop_lat, '')::NUMERIC(9, 6),
    NULLIF(s.stop_lon, '')::NUMERIC(9, 6),
    NULLIF(s.zone_id, ''),
    COALESCE(NULLIF(s.location_type, ''), '0')::SMALLINT,
    CASE
        WHEN NULLIF(s.wheelchair_boarding, '') ~ '^\d+$' THEN NULLIF(s.wheelchair_boarding, '')::SMALLINT
        ELSE NULL
    END
FROM gtfs_stops_raw s
CROSS JOIN gtfs_import_ctx ctx
WHERE NULLIF(s.stop_id, '') IS NOT NULL
  AND NULLIF(s.stop_lat, '') IS NOT NULL
  AND NULLIF(s.stop_lon, '') IS NOT NULL
ON CONFLICT (city_id, gtfs_stop_id)
DO UPDATE SET
    code = EXCLUDED.code,
    name = EXCLUDED.name,
    lat = EXCLUDED.lat,
    lon = EXCLUDED.lon,
    zone_id = EXCLUDED.zone_id,
    location_type = EXCLUDED.location_type,
    wheelchair_boarding = EXCLUDED.wheelchair_boarding,
    is_active = TRUE;

INSERT INTO calendar (
    city_id, gtfs_service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date
)
SELECT
    ctx.city_id,
    NULLIF(c.service_id, ''),
    COALESCE(NULLIF(c.monday, ''), '0') = '1',
    COALESCE(NULLIF(c.tuesday, ''), '0') = '1',
    COALESCE(NULLIF(c.wednesday, ''), '0') = '1',
    COALESCE(NULLIF(c.thursday, ''), '0') = '1',
    COALESCE(NULLIF(c.friday, ''), '0') = '1',
    COALESCE(NULLIF(c.saturday, ''), '0') = '1',
    COALESCE(NULLIF(c.sunday, ''), '0') = '1',
    TO_DATE(NULLIF(c.start_date, ''), 'YYYYMMDD'),
    TO_DATE(NULLIF(c.end_date, ''), 'YYYYMMDD')
FROM gtfs_calendar_raw c
CROSS JOIN gtfs_import_ctx ctx
WHERE NULLIF(c.service_id, '') IS NOT NULL
  AND NULLIF(c.start_date, '') IS NOT NULL
  AND NULLIF(c.end_date, '') IS NOT NULL
ON CONFLICT (city_id, gtfs_service_id)
DO UPDATE SET
    monday = EXCLUDED.monday,
    tuesday = EXCLUDED.tuesday,
    wednesday = EXCLUDED.wednesday,
    thursday = EXCLUDED.thursday,
    friday = EXCLUDED.friday,
    saturday = EXCLUDED.saturday,
    sunday = EXCLUDED.sunday,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date;

INSERT INTO calendar (
    city_id, gtfs_service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date
)
SELECT
    ctx.city_id,
    tr.service_id,
    TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE,
    '2026-02-22'::DATE,
    '2026-02-22'::DATE
FROM (
    SELECT DISTINCT NULLIF(service_id, '') AS service_id
    FROM gtfs_trips_raw
) tr
CROSS JOIN gtfs_import_ctx ctx
WHERE tr.service_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM calendar c
      WHERE c.city_id = ctx.city_id
        AND c.gtfs_service_id = tr.service_id
  );

INSERT INTO trip (
    city_id, route_id, calendar_id, gtfs_trip_id, service_date, headsign, short_name, direction_id, block_id, wheelchair_accessible, bikes_allowed
)
SELECT
    ctx.city_id,
    r.route_id,
    c.calendar_id,
    NULLIF(tr.trip_id, ''),
    '2026-02-22'::DATE,
    NULLIF(tr.trip_headsign, ''),
    NULLIF(tr.trip_short_name, ''),
    CASE
        WHEN NULLIF(tr.direction_id, '') ~ '^\d+$' THEN NULLIF(tr.direction_id, '')::SMALLINT
        ELSE NULL
    END,
    NULLIF(tr.block_id, ''),
    CASE
        WHEN NULLIF(tr.wheelchair_accessible, '') ~ '^\d+$' THEN NULLIF(tr.wheelchair_accessible, '')::SMALLINT
        ELSE NULL
    END,
    CASE
        WHEN NULLIF(tr.bikes_allowed, '') ~ '^\d+$' THEN NULLIF(tr.bikes_allowed, '')::SMALLINT
        ELSE NULL
    END
FROM gtfs_trips_raw tr
CROSS JOIN gtfs_import_ctx ctx
JOIN route r
  ON r.city_id = ctx.city_id
 AND r.gtfs_route_id = NULLIF(tr.route_id, '')
JOIN calendar c
  ON c.city_id = ctx.city_id
 AND c.gtfs_service_id = NULLIF(tr.service_id, '')
WHERE NULLIF(tr.trip_id, '') IS NOT NULL
ON CONFLICT (city_id, gtfs_trip_id, service_date)
DO UPDATE SET
    route_id = EXCLUDED.route_id,
    calendar_id = EXCLUDED.calendar_id,
    headsign = EXCLUDED.headsign,
    short_name = EXCLUDED.short_name,
    direction_id = EXCLUDED.direction_id,
    block_id = EXCLUDED.block_id,
    wheelchair_accessible = EXCLUDED.wheelchair_accessible,
    bikes_allowed = EXCLUDED.bikes_allowed;

INSERT INTO stop_time (
    trip_id, city_id, stop_sequence, stop_id, arrival_time, departure_time, pickup_type, drop_off_type, shape_dist_traveled
)
SELECT
    t.trip_id,
    ctx.city_id,
    NULLIF(st.stop_sequence, '')::INTEGER,
    s.stop_id,
    COALESCE(NULLIF(st.arrival_time, '')::INTERVAL, NULLIF(st.departure_time, '')::INTERVAL),
    COALESCE(NULLIF(st.departure_time, '')::INTERVAL, NULLIF(st.arrival_time, '')::INTERVAL),
    COALESCE(NULLIF(st.pickup_type, ''), '0')::SMALLINT,
    COALESCE(NULLIF(st.drop_off_type, ''), '0')::SMALLINT,
    CASE
        WHEN NULLIF(st.shape_dist_traveled, '') IS NOT NULL THEN NULLIF(st.shape_dist_traveled, '')::NUMERIC(10, 3)
        ELSE NULL
    END
FROM gtfs_stop_times_raw st
CROSS JOIN gtfs_import_ctx ctx
JOIN trip t
  ON t.city_id = ctx.city_id
 AND t.gtfs_trip_id = NULLIF(st.trip_id, '')
 AND t.service_date = '2026-02-22'::DATE
JOIN stop s
  ON s.city_id = ctx.city_id
 AND s.gtfs_stop_id = NULLIF(st.stop_id, '')
WHERE NULLIF(st.stop_sequence, '') ~ '^\d+$'
  AND (NULLIF(st.arrival_time, '') IS NOT NULL OR NULLIF(st.departure_time, '') IS NOT NULL)
ON CONFLICT (trip_id, stop_sequence)
DO UPDATE SET
    stop_id = EXCLUDED.stop_id,
    arrival_time = EXCLUDED.arrival_time,
    departure_time = EXCLUDED.departure_time,
    pickup_type = EXCLUDED.pickup_type,
    drop_off_type = EXCLUDED.drop_off_type,
    shape_dist_traveled = EXCLUDED.shape_dist_traveled;

INSERT INTO fare (
    city_id, agency_id, gtfs_fare_id, fare_name, currency_code, price, payment_method, transfers, transfer_duration_sec, validity_minutes
)
SELECT
    ctx.city_id,
    ag.agency_id,
    NULLIF(f.fare_id, ''),
    'GTFS Fare ' || NULLIF(f.fare_id, ''),
    COALESCE(NULLIF(f.currency_type, ''), 'EUR'),
    NULLIF(f.price, '')::NUMERIC(10, 2),
    COALESCE(NULLIF(f.payment_method, ''), '0')::SMALLINT,
    CASE
        WHEN NULLIF(f.transfers, '') ~ '^\d+$' THEN NULLIF(f.transfers, '')::SMALLINT
        ELSE -1
    END,
    CASE
        WHEN NULLIF(f.transfer_duration, '') ~ '^\d+$' THEN NULLIF(f.transfer_duration, '')::INTEGER
        ELSE NULL
    END,
    90
FROM gtfs_fares_raw f
CROSS JOIN gtfs_import_ctx ctx
JOIN LATERAL (
    SELECT a.agency_id
    FROM agency a
    WHERE a.city_id = ctx.city_id
    ORDER BY a.agency_id
    LIMIT 1
) ag ON TRUE
WHERE NULLIF(f.fare_id, '') IS NOT NULL
  AND NULLIF(f.price, '') IS NOT NULL
ON CONFLICT (city_id, gtfs_fare_id)
DO UPDATE SET
    agency_id = EXCLUDED.agency_id,
    fare_name = EXCLUDED.fare_name,
    currency_code = EXCLUDED.currency_code,
    price = EXCLUDED.price,
    payment_method = EXCLUDED.payment_method,
    transfers = EXCLUDED.transfers,
    transfer_duration_sec = EXCLUDED.transfer_duration_sec,
    is_active = TRUE;

COMMIT;


