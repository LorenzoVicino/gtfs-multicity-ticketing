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

CREATE TABLE calendar_date (
    calendar_date_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    calendar_id BIGINT NOT NULL,
    service_date DATE NOT NULL,
    exception_type SMALLINT NOT NULL CHECK (exception_type IN (1, 2)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, calendar_id, service_date),
    FOREIGN KEY (calendar_id, city_id) REFERENCES calendar (calendar_id, city_id) ON DELETE CASCADE
);

CREATE TABLE shape (
    shape_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    gtfs_shape_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_shape_id),
    UNIQUE (shape_id, city_id)
);

CREATE TABLE shape_point (
    shape_id BIGINT NOT NULL,
    city_id BIGINT NOT NULL,
    shape_pt_sequence INTEGER NOT NULL CHECK (shape_pt_sequence >= 0),
    lat NUMERIC(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon NUMERIC(9, 6) NOT NULL CHECK (lon BETWEEN -180 AND 180),
    shape_dist_traveled NUMERIC(10, 3) CHECK (shape_dist_traveled IS NULL OR shape_dist_traveled >= 0),
    PRIMARY KEY (shape_id, shape_pt_sequence),
    FOREIGN KEY (shape_id, city_id) REFERENCES shape (shape_id, city_id) ON DELETE CASCADE
);

CREATE TABLE trip (
    trip_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    route_id BIGINT NOT NULL,
    calendar_id BIGINT NOT NULL,
    shape_id BIGINT,
    gtfs_trip_id VARCHAR(96) NOT NULL,
    headsign VARCHAR(180),
    short_name VARCHAR(32),
    direction_id SMALLINT CHECK (direction_id IN (0, 1)),
    block_id VARCHAR(64),
    wheelchair_accessible SMALLINT CHECK (wheelchair_accessible IN (0, 1, 2)),
    bikes_allowed SMALLINT CHECK (bikes_allowed IN (0, 1, 2)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_trip_id),
    UNIQUE (trip_id, city_id),
    FOREIGN KEY (route_id, city_id) REFERENCES route (route_id, city_id) ON DELETE RESTRICT,
    FOREIGN KEY (calendar_id, city_id) REFERENCES calendar (calendar_id, city_id) ON DELETE RESTRICT,
    FOREIGN KEY (shape_id, city_id) REFERENCES shape (shape_id, city_id) ON DELETE RESTRICT
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

CREATE INDEX idx_trip_city_calendar ON trip (city_id, calendar_id);
CREATE INDEX idx_stop_time_stop_departure ON stop_time (stop_id, departure_time);
CREATE INDEX idx_calendar_date_city_date ON calendar_date (city_id, service_date, exception_type);
CREATE INDEX idx_shape_point_shape_sequence ON shape_point (shape_id, shape_pt_sequence);
CREATE INDEX idx_trip_city_shape ON trip (city_id, shape_id) WHERE shape_id IS NOT NULL;

-- A service runs on a date when its weekly pattern covers that date and no
-- exception removes it, or when an exception adds it. That is the GTFS rule
-- spanning calendar.txt and calendar_dates.txt, and it is the only place the
-- rule is written down.
CREATE OR REPLACE FUNCTION active_calendar_ids(p_city_id BIGINT, p_date DATE)
RETURNS TABLE (calendar_id BIGINT)
LANGUAGE sql
STABLE
AS $$
    SELECT c.calendar_id
    FROM calendar c
    WHERE c.city_id = p_city_id
      AND p_date BETWEEN c.start_date AND c.end_date
      AND CASE EXTRACT(ISODOW FROM p_date)
              WHEN 1 THEN c.monday
              WHEN 2 THEN c.tuesday
              WHEN 3 THEN c.wednesday
              WHEN 4 THEN c.thursday
              WHEN 5 THEN c.friday
              WHEN 6 THEN c.saturday
              ELSE c.sunday
          END
      AND NOT EXISTS (
          SELECT 1
          FROM calendar_date removed
          WHERE removed.city_id = c.city_id
            AND removed.calendar_id = c.calendar_id
            AND removed.service_date = p_date
            AND removed.exception_type = 2
      )
  UNION
    SELECT added.calendar_id
    FROM calendar_date added
    WHERE added.city_id = p_city_id
      AND added.service_date = p_date
      AND added.exception_type = 1;
$$;
