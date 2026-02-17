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
    fare_name VARCHAR(120) NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    payment_method SMALLINT NOT NULL DEFAULT 0 CHECK (payment_method IN (0, 1)),
    transfers SMALLINT NOT NULL DEFAULT -1 CHECK (transfers IN (-1, 0, 1, 2)),
    transfer_duration_sec INTEGER CHECK (transfer_duration_sec IS NULL OR transfer_duration_sec >= 0),
    validity_minutes INTEGER NOT NULL DEFAULT 90 CHECK (validity_minutes > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_fare_id),
    UNIQUE (fare_id, city_id),
    FOREIGN KEY (agency_id, city_id) REFERENCES agency (agency_id, city_id) ON DELETE RESTRICT
);

CREATE TABLE customer (
    customer_id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(40),
    password_hash TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE passenger (
    passenger_id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customer (customer_id) ON DELETE CASCADE,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    birth_date DATE,
    document_id VARCHAR(64),
    reduced_fare_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, first_name, last_name, birth_date)
);

CREATE TABLE booking (
    booking_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    customer_id BIGINT NOT NULL REFERENCES customer (customer_id) ON DELETE RESTRICT,
    booking_code VARCHAR(32) NOT NULL UNIQUE,
    booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    travel_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
    notes TEXT,
    UNIQUE (booking_id, city_id)
);

CREATE TABLE itinerary (
    itinerary_id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    city_id BIGINT NOT NULL,
    origin_stop_id BIGINT NOT NULL,
    destination_stop_id BIGINT NOT NULL,
    departure_ts TIMESTAMPTZ NOT NULL,
    arrival_ts TIMESTAMPTZ NOT NULL,
    transfers_count INTEGER NOT NULL DEFAULT 0 CHECK (transfers_count >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'ticketed', 'cancelled', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (itinerary_id, city_id),
    UNIQUE (itinerary_id, booking_id, city_id),
    UNIQUE (booking_id, city_id, departure_ts),
    FOREIGN KEY (booking_id, city_id) REFERENCES booking (booking_id, city_id) ON DELETE CASCADE,
    FOREIGN KEY (origin_stop_id, city_id) REFERENCES stop (stop_id, city_id) ON DELETE RESTRICT,
    FOREIGN KEY (destination_stop_id, city_id) REFERENCES stop (stop_id, city_id) ON DELETE RESTRICT,
    CHECK (origin_stop_id <> destination_stop_id),
    CHECK (arrival_ts > departure_ts)
);

CREATE TABLE itinerary_segment (
    itinerary_segment_id BIGSERIAL PRIMARY KEY,
    itinerary_id BIGINT NOT NULL,
    city_id BIGINT NOT NULL,
    segment_seq INTEGER NOT NULL CHECK (segment_seq > 0),
    trip_id BIGINT NOT NULL,
    departure_stop_id BIGINT NOT NULL,
    arrival_stop_id BIGINT NOT NULL,
    planned_departure_ts TIMESTAMPTZ NOT NULL,
    planned_arrival_ts TIMESTAMPTZ NOT NULL,
    fare_id BIGINT,
    distance_km NUMERIC(8, 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (itinerary_id, segment_seq),
    FOREIGN KEY (itinerary_id, city_id) REFERENCES itinerary (itinerary_id, city_id) ON DELETE CASCADE,
    FOREIGN KEY (trip_id, city_id) REFERENCES trip (trip_id, city_id) ON DELETE RESTRICT,
    FOREIGN KEY (departure_stop_id, city_id) REFERENCES stop (stop_id, city_id) ON DELETE RESTRICT,
    FOREIGN KEY (arrival_stop_id, city_id) REFERENCES stop (stop_id, city_id) ON DELETE RESTRICT,
    FOREIGN KEY (fare_id, city_id) REFERENCES fare (fare_id, city_id) ON DELETE RESTRICT,
    CHECK (departure_stop_id <> arrival_stop_id),
    CHECK (planned_arrival_ts > planned_departure_ts),
    CHECK (distance_km IS NULL OR distance_km >= 0)
);

CREATE TABLE ticket (
    ticket_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    ticket_code VARCHAR(48) NOT NULL UNIQUE,
    booking_id BIGINT NOT NULL,
    itinerary_id BIGINT NOT NULL,
    passenger_id BIGINT NOT NULL REFERENCES passenger (passenger_id) ON DELETE RESTRICT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'validated', 'expired', 'refunded', 'void')),
    qr_payload TEXT,
    UNIQUE (ticket_id, city_id),
    UNIQUE (itinerary_id, passenger_id),
    FOREIGN KEY (booking_id, city_id) REFERENCES booking (booking_id, city_id) ON DELETE CASCADE,
    FOREIGN KEY (itinerary_id, booking_id, city_id) REFERENCES itinerary (itinerary_id, booking_id, city_id) ON DELETE CASCADE,
    CHECK (valid_to > valid_from)
);

CREATE TABLE payment (
    payment_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    booking_id BIGINT NOT NULL,
    transaction_ref VARCHAR(64) NOT NULL UNIQUE,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
    method VARCHAR(24) NOT NULL CHECK (method IN ('card', 'wallet', 'bank_transfer', 'cash')),
    status VARCHAR(24) NOT NULL CHECK (status IN ('pending', 'authorized', 'paid', 'failed', 'refunded', 'cancelled')),
    paid_at TIMESTAMPTZ,
    provider VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (booking_id, city_id) REFERENCES booking (booking_id, city_id) ON DELETE CASCADE
);

CREATE TABLE validation (
    validation_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    ticket_id BIGINT NOT NULL,
    validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validator_device_id VARCHAR(64) NOT NULL,
    stop_id BIGINT,
    result VARCHAR(24) NOT NULL CHECK (result IN ('valid', 'invalid', 'duplicate', 'expired')),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    notes TEXT,
    FOREIGN KEY (ticket_id, city_id) REFERENCES ticket (ticket_id, city_id) ON DELETE CASCADE,
    FOREIGN KEY (stop_id, city_id) REFERENCES stop (stop_id, city_id) ON DELETE RESTRICT,
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE OR REPLACE FUNCTION check_itinerary_segment_stops_on_trip()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM stop_time dep
        JOIN stop_time arr
          ON arr.trip_id = dep.trip_id
         AND arr.city_id = dep.city_id
         AND arr.stop_sequence > dep.stop_sequence
        WHERE dep.trip_id = NEW.trip_id
          AND dep.city_id = NEW.city_id
          AND dep.stop_id = NEW.departure_stop_id
          AND arr.stop_id = NEW.arrival_stop_id
    ) THEN
        RAISE EXCEPTION
            'Segmento non valido: le fermate % -> % non sono ordinate nella corsa %',
            NEW.departure_stop_id, NEW.arrival_stop_id, NEW.trip_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_itinerary_segment_stops_on_trip
BEFORE INSERT OR UPDATE OF trip_id, city_id, departure_stop_id, arrival_stop_id
ON itinerary_segment
FOR EACH ROW
EXECUTE FUNCTION check_itinerary_segment_stops_on_trip();

CREATE INDEX idx_trip_city_service_date ON trip (city_id, service_date);
CREATE INDEX idx_stop_time_stop_departure ON stop_time (stop_id, departure_time);
CREATE INDEX idx_itinerary_segment_itinerary_seq ON itinerary_segment (itinerary_id, segment_seq);
CREATE INDEX idx_booking_customer_id ON booking (customer_id);
CREATE INDEX idx_validation_ticket_id ON validation (ticket_id);

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
