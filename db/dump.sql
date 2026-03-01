\set ON_ERROR_STOP on

-- Rebuild completo del database nello stato finale del progetto.
-- Questo script non e` un pg_dump testuale "raw", ma uno script di ripristino
-- riproducibile che riallinea schema, dati GTFS, ticketing agency-based e indici.

DROP SCHEMA IF EXISTS transport CASCADE;
\i db/schema.sql
\i data/gtfs/incoming/import_BRI.sql
\i data/gtfs/incoming/import_BOL.sql
\i db/extend_ticketing.sql
\i db/agency_ticketing.sql
\i db/seed_time_ticket_types.sql
\i db/indexes.sql

