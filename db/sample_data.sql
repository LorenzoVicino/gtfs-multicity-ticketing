SET search_path TO transport, public;

TRUNCATE TABLE
    stop_time,
    trip,
    fare,
    stop,
    route,
    calendar,
    agency,
    city
RESTART IDENTITY CASCADE;

INSERT INTO city (city_id, city_code, name, region, country_code, timezone)
VALUES
    (1, 'MIL', 'Milano', 'Lombardia', 'IT', 'Europe/Rome'),
    (2, 'ROM', 'Roma', 'Lazio', 'IT', 'Europe/Rome');

INSERT INTO agency (agency_id, city_id, gtfs_agency_id, name, url, timezone, lang_code, phone)
VALUES
    (1, 1, 'ATM', 'Azienda Trasporti Milanesi', 'https://www.atm.it', 'Europe/Rome', 'it', '+39-02-48607607'),
    (2, 2, 'ATAC', 'Agenzia del trasporto autoferrotranviario del Comune di Roma', 'https://www.atac.roma.it', 'Europe/Rome', 'it', '+39-06-46951');

INSERT INTO route (
    route_id, city_id, agency_id, gtfs_route_id, short_name, long_name, route_type, color_hex, text_color_hex
)
VALUES
    (1, 1, 1, 'M1', 'M1', 'Linea Metropolitana 1', 1, 'E30613', 'FFFFFF'),
    (2, 1, 1, 'M2', 'M2', 'Linea Metropolitana 2', 1, '008C45', 'FFFFFF'),
    (3, 2, 2, 'METRO_B', 'MB', 'Metro B Laurentina - Rebibbia', 1, '005BBB', 'FFFFFF');

INSERT INTO calendar (
    calendar_id, city_id, gtfs_service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date
)
VALUES
    (1, 1, 'WKD_MIL_2026', TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, DATE '2026-01-01', DATE '2026-12-31'),
    (2, 2, 'WKD_ROM_2026', TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, DATE '2026-01-01', DATE '2026-12-31');

INSERT INTO stop (stop_id, city_id, gtfs_stop_id, code, name, lat, lon, zone_id, location_type, wheelchair_boarding)
VALUES
    (1, 1, 'MIL_DUOMO_M1', 'DUOMO', 'Duomo M1', 45.464247, 9.190011, 'MI_URB', 0, 1),
    (2, 1, 'MIL_CADORNA_M1', 'CADORNA', 'Cadorna M1/M2', 45.468680, 9.176370, 'MI_URB', 0, 1),
    (3, 1, 'MIL_CENTRALE_M2', 'CENTRALE', 'Centrale FS M2', 45.485450, 9.204375, 'MI_URB', 0, 1),
    (4, 1, 'MIL_GARIBALDI_M2', 'GARIBALDI', 'Garibaldi FS M2', 45.484495, 9.187606, 'MI_URB', 0, 1),
    (5, 2, 'ROM_TERMINI_MB', 'TERMINI', 'Roma Termini MB', 41.901200, 12.501600, 'RM_URB', 0, 1),
    (6, 2, 'ROM_COLOSSEO_MB', 'COLOSSEO', 'Colosseo MB', 41.890200, 12.492300, 'RM_URB', 0, 1);

INSERT INTO trip (
    trip_id, city_id, route_id, calendar_id, gtfs_trip_id, headsign, short_name, direction_id, wheelchair_accessible, bikes_allowed
)
VALUES
    (1, 1, 1, 1, 'M1_0800', 'Sesto 1 Maggio FS', 'M1-0800', 0, 1, 1),
    (2, 1, 2, 1, 'M2_0825', 'Assago Forum', 'M2-0825', 1, 1, 1),
    (3, 2, 3, 2, 'MB_0900', 'Laurentina', 'MB-0900', 1, 1, 1);

-- Two exceptions, so the sample exercises both directions of calendar_dates.txt:
-- 2026-12-25 is a Friday the weekday pattern would cover, and 2026-04-05 is a
-- Sunday it would not.
INSERT INTO calendar_date (
    calendar_date_id, city_id, calendar_id, service_date, exception_type
)
VALUES
    (1, 1, 1, DATE '2026-12-25', 2),
    (2, 1, 1, DATE '2026-04-05', 1);

INSERT INTO stop_time (
    trip_id, city_id, stop_sequence, stop_id, arrival_time, departure_time, pickup_type, drop_off_type, shape_dist_traveled
)
VALUES
    (1, 1, 1, 1, INTERVAL '08:00:00', INTERVAL '08:00:00', 0, 0, 0.000),
    (1, 1, 2, 2, INTERVAL '08:12:00', INTERVAL '08:13:00', 0, 0, 4.100),
    (2, 1, 1, 2, INTERVAL '08:20:00', INTERVAL '08:21:00', 0, 0, 0.000),
    (2, 1, 2, 3, INTERVAL '08:31:00', INTERVAL '08:32:00', 0, 0, 3.800),
    (2, 1, 3, 4, INTERVAL '08:40:00', INTERVAL '08:40:00', 0, 0, 6.900),
    (3, 2, 1, 5, INTERVAL '09:00:00', INTERVAL '09:00:00', 0, 0, 0.000),
    (3, 2, 2, 6, INTERVAL '09:07:00', INTERVAL '09:07:00', 0, 0, 2.200);

INSERT INTO fare (
    fare_id, city_id, agency_id, gtfs_fare_id, currency_code, price, payment_method, transfers, transfer_duration_sec
)
VALUES
    (1, 1, 1, 'MIL_URB_90', 'EUR', 2.20, 0, -1, 5400),
    (2, 2, 2, 'ROM_BIT_100', 'EUR', 1.50, 0, -1, 6000);

SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('city', 'city_id'), COALESCE(MAX(city_id), 1), TRUE) FROM city;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('agency', 'agency_id'), COALESCE(MAX(agency_id), 1), TRUE) FROM agency;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('route', 'route_id'), COALESCE(MAX(route_id), 1), TRUE) FROM route;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('calendar', 'calendar_id'), COALESCE(MAX(calendar_id), 1), TRUE) FROM calendar;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('calendar_date', 'calendar_date_id'), COALESCE(MAX(calendar_date_id), 1), TRUE) FROM calendar_date;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('trip', 'trip_id'), COALESCE(MAX(trip_id), 1), TRUE) FROM trip;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('stop', 'stop_id'), COALESCE(MAX(stop_id), 1), TRUE) FROM stop;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('fare', 'fare_id'), COALESCE(MAX(fare_id), 1), TRUE) FROM fare;
