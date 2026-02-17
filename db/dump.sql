\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS transport CASCADE;
\i db/schema.sql
\i db/sample_data.sql

