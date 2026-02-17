SET search_path TO transport, public;

TRUNCATE TABLE
    validation,
    payment,
    ticket,
    itinerary_segment,
    itinerary,
    booking,
    passenger,
    customer,
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
    trip_id, city_id, route_id, calendar_id, gtfs_trip_id, service_date, headsign, short_name, direction_id, wheelchair_accessible, bikes_allowed
)
VALUES
    (1, 1, 1, 1, 'M1_20260218_0800', DATE '2026-02-18', 'Sesto 1 Maggio FS', 'M1-0800', 0, 1, 1),
    (2, 1, 2, 1, 'M2_20260218_0825', DATE '2026-02-18', 'Assago Forum', 'M2-0825', 1, 1, 1),
    (3, 2, 3, 2, 'MB_20260218_0900', DATE '2026-02-18', 'Laurentina', 'MB-0900', 1, 1, 1);

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
    fare_id, city_id, agency_id, gtfs_fare_id, fare_name, currency_code, price, payment_method, transfers, transfer_duration_sec, validity_minutes
)
VALUES
    (1, 1, 1, 'MIL_URB_90', 'Biglietto urbano 90 minuti', 'EUR', 2.20, 0, -1, 5400, 90),
    (2, 2, 2, 'ROM_BIT_100', 'BIT 100 minuti', 'EUR', 1.50, 0, -1, 6000, 100);

INSERT INTO customer (customer_id, email, full_name, phone, password_hash, status)
VALUES
    (1, 'mario.rossi@example.com', 'Mario Rossi', '+39-3331234567', 'hash_demo_1', 'active'),
    (2, 'anna.verdi@example.com', 'Anna Verdi', '+39-3349876543', 'hash_demo_2', 'active');

INSERT INTO passenger (passenger_id, customer_id, first_name, last_name, birth_date, document_id, reduced_fare_eligible)
VALUES
    (1, 1, 'Mario', 'Rossi', DATE '1995-04-11', 'CI-MR-001', FALSE),
    (2, 2, 'Anna', 'Verdi', DATE '1998-11-03', 'CI-AV-002', TRUE);

INSERT INTO booking (
    booking_id, city_id, customer_id, booking_code, booked_at, travel_date, status, total_amount, currency_code, notes
)
VALUES
    (1, 1, 1, 'BK-20260217-0001', TIMESTAMPTZ '2026-02-17 10:15:00+01', DATE '2026-02-18', 'confirmed', 2.20, 'EUR', 'Viaggio con cambio'),
    (2, 2, 2, 'BK-20260217-0002', TIMESTAMPTZ '2026-02-17 11:40:00+01', DATE '2026-02-18', 'confirmed', 1.50, 'EUR', 'Viaggio diretto');

INSERT INTO itinerary (
    itinerary_id, booking_id, city_id, origin_stop_id, destination_stop_id, departure_ts, arrival_ts, transfers_count, status
)
VALUES
    (1, 1, 1, 1, 4, TIMESTAMPTZ '2026-02-18 08:00:00+01', TIMESTAMPTZ '2026-02-18 08:40:00+01', 1, 'ticketed'),
    (2, 2, 2, 5, 6, TIMESTAMPTZ '2026-02-18 09:00:00+01', TIMESTAMPTZ '2026-02-18 09:07:00+01', 0, 'ticketed');

INSERT INTO itinerary_segment (
    itinerary_segment_id, itinerary_id, city_id, segment_seq, trip_id, departure_stop_id, arrival_stop_id,
    planned_departure_ts, planned_arrival_ts, fare_id, distance_km
)
VALUES
    (1, 1, 1, 1, 1, 1, 2, TIMESTAMPTZ '2026-02-18 08:00:00+01', TIMESTAMPTZ '2026-02-18 08:13:00+01', 1, 4.100),
    (2, 1, 1, 2, 2, 2, 4, TIMESTAMPTZ '2026-02-18 08:21:00+01', TIMESTAMPTZ '2026-02-18 08:40:00+01', 1, 6.900),
    (3, 2, 2, 1, 3, 5, 6, TIMESTAMPTZ '2026-02-18 09:00:00+01', TIMESTAMPTZ '2026-02-18 09:07:00+01', 2, 2.200);

INSERT INTO ticket (
    ticket_id, city_id, ticket_code, booking_id, itinerary_id, passenger_id, issued_at, valid_from, valid_to, status, qr_payload
)
VALUES
    (1, 1, 'TCK-MIL-000001', 1, 1, 1, TIMESTAMPTZ '2026-02-17 10:16:00+01', TIMESTAMPTZ '2026-02-18 07:50:00+01', TIMESTAMPTZ '2026-02-18 09:30:00+01', 'validated', 'qr://ticket/TCK-MIL-000001'),
    (2, 2, 'TCK-ROM-000002', 2, 2, 2, TIMESTAMPTZ '2026-02-17 11:41:00+01', TIMESTAMPTZ '2026-02-18 08:50:00+01', TIMESTAMPTZ '2026-02-18 10:30:00+01', 'issued', 'qr://ticket/TCK-ROM-000002');

INSERT INTO payment (
    payment_id, city_id, booking_id, transaction_ref, amount, currency_code, method, status, paid_at, provider
)
VALUES
    (1, 1, 1, 'TXN-20260217-MIL-0001', 2.20, 'EUR', 'card', 'paid', TIMESTAMPTZ '2026-02-17 10:16:03+01', 'Stripe'),
    (2, 2, 2, 'TXN-20260217-ROM-0002', 1.50, 'EUR', 'wallet', 'paid', TIMESTAMPTZ '2026-02-17 11:41:18+01', 'PayPal');

INSERT INTO validation (
    validation_id, city_id, ticket_id, validated_at, validator_device_id, stop_id, result, latitude, longitude, notes
)
VALUES
    (1, 1, 1, TIMESTAMPTZ '2026-02-18 08:02:11+01', 'VAL-MI-0009', 1, 'valid', 45.464247, 9.190011, 'Prima validazione regolare');

SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('city', 'city_id'), COALESCE(MAX(city_id), 1), TRUE) FROM city;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('agency', 'agency_id'), COALESCE(MAX(agency_id), 1), TRUE) FROM agency;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('route', 'route_id'), COALESCE(MAX(route_id), 1), TRUE) FROM route;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('calendar', 'calendar_id'), COALESCE(MAX(calendar_id), 1), TRUE) FROM calendar;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('trip', 'trip_id'), COALESCE(MAX(trip_id), 1), TRUE) FROM trip;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('stop', 'stop_id'), COALESCE(MAX(stop_id), 1), TRUE) FROM stop;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('fare', 'fare_id'), COALESCE(MAX(fare_id), 1), TRUE) FROM fare;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('customer', 'customer_id'), COALESCE(MAX(customer_id), 1), TRUE) FROM customer;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('passenger', 'passenger_id'), COALESCE(MAX(passenger_id), 1), TRUE) FROM passenger;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('booking', 'booking_id'), COALESCE(MAX(booking_id), 1), TRUE) FROM booking;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('itinerary', 'itinerary_id'), COALESCE(MAX(itinerary_id), 1), TRUE) FROM itinerary;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('itinerary_segment', 'itinerary_segment_id'), COALESCE(MAX(itinerary_segment_id), 1), TRUE) FROM itinerary_segment;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('ticket', 'ticket_id'), COALESCE(MAX(ticket_id), 1), TRUE) FROM ticket;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('payment', 'payment_id'), COALESCE(MAX(payment_id), 1), TRUE) FROM payment;
SELECT SETVAL(PG_GET_SERIAL_SEQUENCE('validation', 'validation_id'), COALESCE(MAX(validation_id), 1), TRUE) FROM validation;

