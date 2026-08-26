\set ON_ERROR_STOP on

-- Migration 003: give the database somewhere to keep shapes.txt.
--
-- Line geometry was reconstructed by connecting the stops of a representative
-- trip, which draws straight segments between stops instead of the path the
-- vehicle takes. shapes.txt was never imported, so the real geometry existed only
-- inside the canonical ZIP archive.
--
-- This adds shape, shape_point and trip.shape_id. It does not backfill anything:
-- the tables stay empty until the next feed import, and until then the map keeps
-- using the stop-derived line, now labelled as approximate.
--
-- Not destructive: nothing is dropped or deleted.
--
-- Idempotent: every step is guarded, so a second run is a no-op.

SET search_path TO transport, public;

DO $$
BEGIN
    IF to_regclass('transport.trip') IS NULL OR to_regclass('transport.city') IS NULL THEN
        RAISE EXCEPTION 'transport.trip or transport.city not found: this does not look like a GTFS Hub database';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'transport' AND table_name = 'trip' AND column_name = 'service_date'
    ) THEN
        RAISE EXCEPTION 'run 002_calendar_correctness.sql first: trip.service_date is still present';
    END IF;
END $$;

BEGIN;

CREATE TABLE IF NOT EXISTS shape (
    shape_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    gtfs_shape_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, gtfs_shape_id),
    UNIQUE (shape_id, city_id)
);

CREATE TABLE IF NOT EXISTS shape_point (
    shape_id BIGINT NOT NULL,
    city_id BIGINT NOT NULL,
    shape_pt_sequence INTEGER NOT NULL CHECK (shape_pt_sequence >= 0),
    lat NUMERIC(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon NUMERIC(9, 6) NOT NULL CHECK (lon BETWEEN -180 AND 180),
    shape_dist_traveled NUMERIC(10, 3) CHECK (shape_dist_traveled IS NULL OR shape_dist_traveled >= 0),
    PRIMARY KEY (shape_id, shape_pt_sequence),
    FOREIGN KEY (shape_id, city_id) REFERENCES shape (shape_id, city_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shape_point_shape_sequence
ON shape_point (shape_id, shape_pt_sequence);

ALTER TABLE trip ADD COLUMN IF NOT EXISTS shape_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'transport.trip'::regclass
          AND conname = 'trip_shape_id_city_id_fkey'
    ) THEN
        ALTER TABLE transport.trip
            ADD CONSTRAINT trip_shape_id_city_id_fkey
            FOREIGN KEY (shape_id, city_id) REFERENCES transport.shape (shape_id, city_id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trip_city_shape
ON trip (city_id, shape_id) WHERE shape_id IS NOT NULL;

-- Abort rather than commit a half-built schema.
DO $$
DECLARE
    target TEXT;
    missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOREACH target IN ARRAY ARRAY['shape', 'shape_point', 'trip', 'route', 'stop', 'stop_time'] LOOP
        IF to_regclass('transport.' || target) IS NULL THEN
            missing := missing || target;
        END IF;
    END LOOP;

    IF array_length(missing, 1) > 0 THEN
        RAISE EXCEPTION 'aborting: objects missing after migration: %', array_to_string(missing, ', ');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'transport' AND table_name = 'trip' AND column_name = 'shape_id'
    ) THEN
        RAISE EXCEPTION 'aborting: trip.shape_id was not added';
    END IF;

    RAISE NOTICE 'shape tables ready; they fill on the next feed import';
END $$;

COMMIT;

\echo ''
\echo '-- Verification.'
\echo ''
\echo '-- trip.shape_id exists and is nullable:'

SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'transport'
  AND table_name = 'trip'
  AND column_name = 'shape_id';

\echo '-- geometry available per city (shapes are 0 until the next import):'

SELECT
    c.city_code,
    count(DISTINCT s.shape_id) AS shapes,
    count(sp.shape_pt_sequence) AS shape_points,
    count(DISTINCT t.trip_id) FILTER (WHERE t.shape_id IS NOT NULL) AS trips_with_shape
FROM city c
LEFT JOIN shape s ON s.city_id = c.city_id
LEFT JOIN shape_point sp ON sp.shape_id = s.shape_id
LEFT JOIN trip t ON t.city_id = c.city_id
GROUP BY c.city_code
ORDER BY c.city_code;
