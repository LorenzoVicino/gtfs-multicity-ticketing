\set ON_ERROR_STOP on

-- Migration 001: drop the obsolete ticketing domain.
--
-- The application no longer has a ticketing domain: PR #10 removed it from the
-- code and from db/schema.sql. That only affects databases created afterwards,
-- because /docker-entrypoint-initdb.d does not run again on a populated volume.
-- This migration brings an existing database to the current schema.
--
-- DESTRUCTIVE. It permanently deletes every customer, passenger, booking,
-- itinerary, ticket, payment and validation row. Take a backup first; the
-- procedure is in docs/deployment.md.
--
-- Idempotent: every statement is guarded, so a second run is a no-op.
--
-- No GTFS table references any of these tables -- the foreign keys all point the
-- other way, from ticketing into city, stop and trip -- so CASCADE here cannot
-- reach GTFS data. It only clears the ticketing tables' own dependencies.

SET search_path TO transport, public;

DO $$
BEGIN
    IF to_regnamespace('transport') IS NULL THEN
        RAISE EXCEPTION 'schema "transport" not found: this does not look like a GTFS Hub database';
    END IF;

    IF to_regclass('transport.city') IS NULL THEN
        RAISE EXCEPTION 'table "transport.city" not found: this does not look like a GTFS Hub database';
    END IF;
END $$;

-- Report what is about to be destroyed, so the operator sees it in the psql output.
DO $$
DECLARE
    target TEXT;
    rows_found BIGINT;
    rows_total BIGINT := 0;
    present INTEGER := 0;
BEGIN
    FOREACH target IN ARRAY ARRAY[
        'customer', 'passenger', 'booking', 'itinerary', 'itinerary_segment',
        'ticket', 'payment', 'validation', 'ticket_type'
    ]
    LOOP
        IF to_regclass('transport.' || target) IS NULL THEN
            RAISE NOTICE 'transport.%  already absent', target;
        ELSE
            EXECUTE format('SELECT count(*) FROM transport.%I', target) INTO rows_found;
            present := present + 1;
            rows_total := rows_total + rows_found;
            RAISE NOTICE 'transport.%  % row(s) to delete', target, rows_found;
        END IF;
    END LOOP;

    IF present = 0 THEN
        RAISE NOTICE 'nothing to do: no ticketing table is present';
    ELSE
        RAISE NOTICE '% table(s), % row(s) total will be dropped', present, rows_total;
    END IF;
END $$;

BEGIN;

-- Reverse dependency order, so CASCADE has as little as possible left to do.
DROP TABLE IF EXISTS validation CASCADE;
DROP TABLE IF EXISTS payment CASCADE;
DROP TABLE IF EXISTS ticket CASCADE;
DROP TABLE IF EXISTS itinerary_segment CASCADE;
DROP TABLE IF EXISTS itinerary CASCADE;
DROP TABLE IF EXISTS booking CASCADE;
DROP TABLE IF EXISTS passenger CASCADE;
DROP TABLE IF EXISTS customer CASCADE;
DROP TABLE IF EXISTS ticket_type CASCADE;

-- The trigger went with itinerary_segment; its function did not.
DROP FUNCTION IF EXISTS transport.check_itinerary_segment_stops_on_trip() CASCADE;

-- db/extend_ticketing.sql created this sequence with a bare CREATE SEQUENCE and
-- then pointed a column default at it, so it was never owned by that column and
-- DROP TABLE does not take it along.
DROP SEQUENCE IF EXISTS transport.itinerary_segment_segment_id_seq;

-- fare stays: it is the projection of the GTFS fare_attributes.txt file, and the
-- upload pipeline still syncs it. These two columns were ticketing-only and had
-- no reader left once the domain went away.
ALTER TABLE IF EXISTS fare DROP COLUMN IF EXISTS fare_name;
ALTER TABLE IF EXISTS fare DROP COLUMN IF EXISTS validity_minutes;

-- Still inside the transaction: if any CASCADE above reached a GTFS object, abort
-- and roll the whole migration back rather than report the loss afterwards.
--
-- mv_next_departures used to be on this list. Migration 002 drops it and the
-- current db/schema.sql no longer creates it, so requiring it here would make this
-- migration fail on a database that is already on 002, and on any fresh one. The
-- eight tables are what the CASCADE could actually have reached.
DO $$
DECLARE
    target TEXT;
    missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOREACH target IN ARRAY ARRAY[
        'city', 'agency', 'route', 'calendar', 'trip', 'stop', 'stop_time', 'fare'
    ]
    LOOP
        IF to_regclass('transport.' || target) IS NULL THEN
            missing := missing || target;
        END IF;
    END LOOP;

    IF array_length(missing, 1) > 0 THEN
        RAISE EXCEPTION 'aborting: GTFS objects would be lost: %', array_to_string(missing, ', ');
    END IF;

    RAISE NOTICE 'GTFS schema intact: all 8 tables still present';
END $$;

COMMIT;

\echo ''
\echo '-- Verification: the first three queries must return zero rows;'
\echo '-- the last one lists the GTFS tables that remain.'
\echo ''
\echo '-- Leftover tables, sequences, views or indexes:'

SELECT
    c.relkind AS kind,
    n.nspname || '.' || c.relname AS object
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'transport'
  AND c.relname ~ '(customer|passenger|booking|itinerar|ticket|payment|validation)'
ORDER BY c.relkind, c.relname;

\echo '-- Leftover functions:'

SELECT n.nspname || '.' || p.proname AS function
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'transport'
  AND p.proname ~ '(itinerar|ticket|booking|validation)'
ORDER BY p.proname;

\echo '-- Leftover fare columns:'

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'transport'
  AND table_name = 'fare'
  AND column_name IN ('fare_name', 'validity_minutes');

\echo '-- Remaining tables (expect: agency, calendar, city, fare, route, stop, stop_time, trip):'

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'transport'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
