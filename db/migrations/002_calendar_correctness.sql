\set ON_ERROR_STOP on

-- Migration 002: make trips date-independent and teach the schema about calendar
-- exceptions.
--
-- Before this, every trip carried a mandatory service_date set to the date of the
-- import that created it, and departures were found by matching that date. So the
-- same GTFS trip appeared once per import, "next departures" never really derived
-- from calendar.txt, and they stopped working the day after an import.
-- calendar_dates.txt was not imported at all: service exceptions were dropped on
-- the floor.
--
-- After this, a GTFS trip is one row, and whether it runs on a date is computed
-- from calendar.txt plus calendar_dates.txt through active_calendar_ids().
--
-- DESTRUCTIVE in one respect: duplicate trip rows for the same gtfs_trip_id are
-- deleted, keeping one. Their stop_times go with them via ON DELETE CASCADE. In
-- practice the duplicates carry no stop_times, because each import deletes the
-- city's stop_times and reattaches them to the trips it just wrote -- but back up
-- anyway. The procedure is in docs/deployment.md.
--
-- Idempotent: every step is guarded, so a second run is a no-op.

SET search_path TO transport, public;

DO $$
BEGIN
    IF to_regclass('transport.trip') IS NULL OR to_regclass('transport.calendar') IS NULL THEN
        RAISE EXCEPTION 'transport.trip or transport.calendar not found: this does not look like a GTFS Hub database';
    END IF;
END $$;

-- Report what is about to be deleted.
DO $$
DECLARE
    duplicate_trips BIGINT := 0;
    orphan_stop_times BIGINT := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'transport' AND table_name = 'trip' AND column_name = 'service_date'
    ) THEN
        RAISE NOTICE 'trip.service_date already gone: nothing to collapse';
        RETURN;
    END IF;

    SELECT count(*) INTO duplicate_trips
    FROM (
        SELECT ROW_NUMBER() OVER (PARTITION BY city_id, gtfs_trip_id ORDER BY trip_id) AS rn
        FROM transport.trip
    ) ranked
    WHERE rn > 1;

    SELECT count(*) INTO orphan_stop_times
    FROM transport.stop_time st
    JOIN (
        SELECT
            t.trip_id,
            ROW_NUMBER() OVER (
                PARTITION BY t.city_id, t.gtfs_trip_id
                ORDER BY
                    (EXISTS (SELECT 1 FROM transport.stop_time s2 WHERE s2.trip_id = t.trip_id)) DESC,
                    t.service_date DESC,
                    t.trip_id DESC
            ) AS rn
        FROM transport.trip t
    ) ranked ON ranked.trip_id = st.trip_id
    WHERE ranked.rn > 1;

    RAISE NOTICE '% duplicate trip row(s) to delete, carrying % stop_time row(s)', duplicate_trips, orphan_stop_times;
END $$;

BEGIN;

-- 1) calendar_dates.txt gets a home. Existing databases hold no exceptions yet:
--    they arrive with the next feed import.
CREATE TABLE IF NOT EXISTS calendar_date (
    calendar_date_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    calendar_id BIGINT NOT NULL,
    service_date DATE NOT NULL,
    exception_type SMALLINT NOT NULL CHECK (exception_type IN (1, 2)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city_id, calendar_id, service_date),
    FOREIGN KEY (calendar_id, city_id) REFERENCES calendar (calendar_id, city_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_date_city_date
ON calendar_date (city_id, service_date, exception_type);

CREATE INDEX IF NOT EXISTS idx_calendar_date_city_calendar_date
ON calendar_date (city_id, calendar_id, service_date, exception_type);

-- 2) mv_next_departures selected t.service_date, so it has to go before the column
--    can be dropped. It was never read by the application; queries/02 now computes
--    departures directly from the calendar.
DROP MATERIALIZED VIEW IF EXISTS mv_next_departures;

-- 3) The GTFS activation rule, in one place.
CREATE OR REPLACE FUNCTION transport.active_calendar_ids(p_city_id BIGINT, p_date DATE)
RETURNS TABLE (calendar_id BIGINT)
LANGUAGE sql
STABLE
AS $$
    SELECT c.calendar_id
    FROM transport.calendar c
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
          FROM transport.calendar_date removed
          WHERE removed.city_id = c.city_id
            AND removed.calendar_id = c.calendar_id
            AND removed.service_date = p_date
            AND removed.exception_type = 2
      )
  UNION
    SELECT added.calendar_id
    FROM transport.calendar_date added
    WHERE added.city_id = p_city_id
      AND added.service_date = p_date
      AND added.exception_type = 1;
$$;

-- 4) Collapse the per-import trip rows, then drop the column.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'transport' AND table_name = 'trip' AND column_name = 'service_date'
    ) THEN
        RETURN;
    END IF;

    -- Keep the row that actually carries stop_times; among equals, the most recent
    -- import. stop_time.trip_id has ON DELETE CASCADE, so the losers take their
    -- (normally absent) stop_times with them.
    DELETE FROM transport.trip victim
    USING (
        SELECT trip_id
        FROM (
            SELECT
                t.trip_id,
                ROW_NUMBER() OVER (
                    PARTITION BY t.city_id, t.gtfs_trip_id
                    ORDER BY
                        (EXISTS (SELECT 1 FROM transport.stop_time st WHERE st.trip_id = t.trip_id)) DESC,
                        t.service_date DESC,
                        t.trip_id DESC
                ) AS rn
            FROM transport.trip t
        ) ranked
        WHERE rn > 1
    ) duplicates
    WHERE victim.trip_id = duplicates.trip_id;

    ALTER TABLE transport.trip DROP CONSTRAINT IF EXISTS trip_city_id_gtfs_trip_id_service_date_key;

    -- Dropping the column takes its indexes and any remaining constraint over it.
    ALTER TABLE transport.trip DROP COLUMN service_date;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'transport.trip'::regclass
          AND conname = 'trip_city_id_gtfs_trip_id_key'
    ) THEN
        ALTER TABLE transport.trip
            ADD CONSTRAINT trip_city_id_gtfs_trip_id_key UNIQUE (city_id, gtfs_trip_id);
    END IF;
END $$;

DROP INDEX IF EXISTS idx_trip_city_service_date;
DROP INDEX IF EXISTS idx_trip_city_service_date_trip;

CREATE INDEX IF NOT EXISTS idx_trip_city_calendar ON trip (city_id, calendar_id);
CREATE INDEX IF NOT EXISTS idx_trip_city_calendar_trip ON trip (city_id, calendar_id, trip_id);

-- Abort rather than commit a schema that lost GTFS data.
DO $$
DECLARE
    target TEXT;
    missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOREACH target IN ARRAY ARRAY[
        'city', 'agency', 'route', 'calendar', 'calendar_date', 'trip', 'stop', 'stop_time', 'fare'
    ]
    LOOP
        IF to_regclass('transport.' || target) IS NULL THEN
            missing := missing || target;
        END IF;
    END LOOP;

    IF array_length(missing, 1) > 0 THEN
        RAISE EXCEPTION 'aborting: objects missing after migration: %', array_to_string(missing, ', ');
    END IF;

    IF to_regprocedure('transport.active_calendar_ids(bigint, date)') IS NULL THEN
        RAISE EXCEPTION 'aborting: active_calendar_ids was not created';
    END IF;

    RAISE NOTICE 'schema is on the calendar-based model';
END $$;

COMMIT;

\echo ''
\echo '-- Verification: the first query must return zero rows;'
\echo '-- the rest describe the new shape.'
\echo ''
\echo '-- trip.service_date must be gone:'

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'transport'
  AND table_name = 'trip'
  AND column_name = 'service_date';

\echo '-- one row per GTFS trip (duplicates must be 0):'

SELECT count(*) AS duplicates
FROM (
    SELECT city_id, gtfs_trip_id
    FROM trip
    GROUP BY city_id, gtfs_trip_id
    HAVING count(*) > 1
) d;

\echo '-- calendar exceptions held per city (0 until the next feed import):'

SELECT c.city_code, count(cd.calendar_date_id) AS exceptions
FROM city c
LEFT JOIN calendar_date cd ON cd.city_id = c.city_id
GROUP BY c.city_code
ORDER BY c.city_code;

\echo '-- service window per city, and whether today is inside it:'

SELECT
    c.city_code,
    MIN(cal.start_date) AS first_service_date,
    MAX(cal.end_date) AS last_service_date,
    EXISTS (SELECT 1 FROM active_calendar_ids(c.city_id, CURRENT_DATE)) AS service_today
FROM city c
JOIN calendar cal ON cal.city_id = c.city_id
GROUP BY c.city_code, c.city_id
ORDER BY c.city_code;
