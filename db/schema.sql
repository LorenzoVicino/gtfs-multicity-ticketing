CREATE SCHEMA IF NOT EXISTS transport;
SET search_path TO transport, public;

CREATE TABLE city (
    city_id BIGSERIAL PRIMARY KEY,
    city_code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    region VARCHAR(120),
    country_code CHAR(2) NOT NULL DEFAULT 'IT',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Rome',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agency (
    agency_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    gtfs_agency_id VARCHAR(64) NOT NULL,
    name VARCHAR(140) NOT NULL,
    url TEXT,
    timezone VARCHAR(64) NOT NULL,
    lang_code VARCHAR(10),
    phone VARCHAR(40),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_agency_id),
    UNIQUE (agency_id, city_id)
);

CREATE TABLE route (
    route_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    agency_id BIGINT NOT NULL,
    gtfs_route_id VARCHAR(64) NOT NULL,
    short_name VARCHAR(32),
    long_name VARCHAR(180) NOT NULL,
    route_type SMALLINT NOT NULL CHECK (route_type IN (0, 1, 2, 3, 4, 5, 6, 7, 11, 12)),
    color_hex CHAR(6),
    text_color_hex CHAR(6),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_route_id),
    UNIQUE (route_id, city_id),
    FOREIGN KEY (agency_id, city_id) REFERENCES agency (agency_id, city_id) ON DELETE RESTRICT,
    CHECK (color_hex IS NULL OR color_hex ~ '^[0-9A-Fa-f]{6}$'),
    CHECK (text_color_hex IS NULL OR text_color_hex ~ '^[0-9A-Fa-f]{6}$')
);

CREATE TABLE calendar (
    calendar_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    gtfs_service_id VARCHAR(64) NOT NULL,
    monday BOOLEAN NOT NULL DEFAULT FALSE,
    tuesday BOOLEAN NOT NULL DEFAULT FALSE,
    wednesday BOOLEAN NOT NULL DEFAULT FALSE,
    thursday BOOLEAN NOT NULL DEFAULT FALSE,
    friday BOOLEAN NOT NULL DEFAULT FALSE,
    saturday BOOLEAN NOT NULL DEFAULT FALSE,
    sunday BOOLEAN NOT NULL DEFAULT FALSE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_service_id),
    UNIQUE (calendar_id, city_id),
    CHECK (end_date >= start_date)
);

CREATE TABLE trip (
    trip_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    route_id BIGINT NOT NULL,
    calendar_id BIGINT NOT NULL,
    gtfs_trip_id VARCHAR(96) NOT NULL,
    service_date DATE NOT NULL,
    headsign VARCHAR(180),
    short_name VARCHAR(32),
    direction_id SMALLINT CHECK (direction_id IN (0, 1)),
    block_id VARCHAR(64),
    wheelchair_accessible SMALLINT CHECK (wheelchair_accessible IN (0, 1, 2)),
    bikes_allowed SMALLINT CHECK (bikes_allowed IN (0, 1, 2)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_trip_id, service_date),
    UNIQUE (trip_id, city_id),
    FOREIGN KEY (route_id, city_id) REFERENCES route (route_id, city_id) ON DELETE RESTRICT,
    FOREIGN KEY (calendar_id, city_id) REFERENCES calendar (calendar_id, city_id) ON DELETE RESTRICT
);

CREATE TABLE stop (
    stop_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    gtfs_stop_id VARCHAR(64) NOT NULL,
    code VARCHAR(32),
    name VARCHAR(180) NOT NULL,
    lat NUMERIC(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon NUMERIC(9, 6) NOT NULL CHECK (lon BETWEEN -180 AND 180),
    zone_id VARCHAR(64),
    location_type SMALLINT NOT NULL DEFAULT 0 CHECK (location_type IN (0, 1, 2, 3, 4)),
    parent_stop_id BIGINT REFERENCES stop (stop_id) ON DELETE RESTRICT,
    wheelchair_boarding SMALLINT CHECK (wheelchair_boarding IN (0, 1, 2)),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_stop_id),
    UNIQUE (stop_id, city_id),
    CHECK (parent_stop_id IS NULL OR parent_stop_id <> stop_id)
);

CREATE TABLE stop_time (
    trip_id BIGINT NOT NULL,
    city_id BIGINT NOT NULL,
    stop_sequence INTEGER NOT NULL CHECK (stop_sequence > 0),
    stop_id BIGINT NOT NULL,
    arrival_time INTERVAL NOT NULL CHECK (arrival_time >= INTERVAL '0 second'),
    departure_time INTERVAL NOT NULL CHECK (departure_time >= INTERVAL '0 second'),
    pickup_type SMALLINT NOT NULL DEFAULT 0 CHECK (pickup_type IN (0, 1, 2, 3)),
    drop_off_type SMALLINT NOT NULL DEFAULT 0 CHECK (drop_off_type IN (0, 1, 2, 3)),
    shape_dist_traveled NUMERIC(10, 3),
    PRIMARY KEY (trip_id, stop_sequence),
    UNIQUE (trip_id, stop_id, stop_sequence),
    FOREIGN KEY (trip_id, city_id) REFERENCES trip (trip_id, city_id) ON DELETE CASCADE,
    FOREIGN KEY (stop_id, city_id) REFERENCES stop (stop_id, city_id) ON DELETE RESTRICT,
    CHECK (departure_time >= arrival_time),
    CHECK (shape_dist_traveled IS NULL OR shape_dist_traveled >= 0)
);

CREATE TABLE fare (
    fare_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    agency_id BIGINT NOT NULL,
    gtfs_fare_id VARCHAR(64) NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    payment_method SMALLINT NOT NULL DEFAULT 0 CHECK (payment_method IN (0, 1)),
    transfers SMALLINT NOT NULL DEFAULT -1 CHECK (transfers IN (-1, 0, 1, 2)),
    transfer_duration_sec INTEGER CHECK (transfer_duration_sec IS NULL OR transfer_duration_sec >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_fare_id),
    UNIQUE (fare_id, city_id),
    FOREIGN KEY (agency_id, city_id) REFERENCES agency (agency_id, city_id) ON DELETE RESTRICT
);

CREATE INDEX idx_trip_city_service_date ON trip (city_id, service_date);
CREATE INDEX idx_stop_time_stop_departure ON stop_time (stop_id, departure_time);

CREATE MATERIALIZED VIEW mv_next_departures AS
SELECT
    st.city_id,
    st.stop_id,
    s.name AS stop_name,
    t.trip_id,
    r.route_id,
    COALESCE(r.short_name, r.long_name) AS line_name,
    t.service_date + st.departure_time AS departure_ts
FROM stop_time st
JOIN trip t
  ON t.trip_id = st.trip_id
 AND t.city_id = st.city_id
JOIN route r
  ON r.route_id = t.route_id
 AND r.city_id = t.city_id
JOIN stop s
  ON s.stop_id = st.stop_id
 AND s.city_id = st.city_id
WHERE (t.service_date + st.departure_time) >= NOW()
ORDER BY departure_ts
WITH NO DATA;
