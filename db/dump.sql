\set ON_ERROR_STOP on

-- Rebuild completo del database nello stato finale del progetto.
-- Questo script non e` un pg_dump testuale "raw", ma uno script di ripristino
-- riproducibile che riallinea schema, dati GTFS e indici.

DROP SCHEMA IF EXISTS transport CASCADE;
\i db/schema.sql
\i data/gtfs/incoming/import_BRI.sql
\i data/gtfs/incoming/import_BOL.sql
\i db/indexes.sql
