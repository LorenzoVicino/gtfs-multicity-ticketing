SET search_path TO transport, public;

-- Query #1: prossime partenze da stop.
-- Copre filtro per city_id/stop_id e ordinamento/finestra su departure_time;
-- trip_id in coda aiuta il join immediato con trip.
CREATE INDEX IF NOT EXISTS idx_stop_time_city_stop_departure_trip
ON stop_time (city_id, stop_id, departure_time, trip_id);

-- Query #1: filtro su trip per city_id + service_date.
-- Alternativa: (city_id, service_date, trip_id). Usiamo questa forma estesa per aiutare anche i join.
CREATE INDEX IF NOT EXISTS idx_trip_city_service_date_trip
ON trip (city_id, service_date, trip_id);

-- Query #2: ricerca dep/arr sulla stessa corsa (trip_id/city_id) con filtro stop_id.
CREATE INDEX IF NOT EXISTS idx_stop_time_city_trip_stop
ON stop_time (city_id, trip_id, stop_id);

-- Query #2: supporto confronto sequenze fermate sulla stessa corsa.
CREATE INDEX IF NOT EXISTS idx_stop_time_city_trip_sequence
ON stop_time (city_id, trip_id, stop_sequence);

-- Query #3: ricostruzione itinerario con segmenti ordinati.
CREATE INDEX IF NOT EXISTS idx_itinerary_segment_itinerary_seq
ON itinerary_segment (itinerary_id, segment_seq);

-- Query #4: lookup customer case-insensitive su email.
CREATE INDEX IF NOT EXISTS idx_customer_lower_email
ON customer (LOWER(email));

-- Query #4: storico prenotazioni ordinato per created_at DESC.
CREATE INDEX IF NOT EXISTS idx_booking_customer_created_desc
ON booking (customer_id, created_at DESC);

-- Query #4: join ticket -> booking.
CREATE INDEX IF NOT EXISTS idx_ticket_booking_id
ON ticket (booking_id);

-- Query #5: lookup veloce ticket per codice (vincolo business univoco).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ticket_code
ON ticket (ticket_code);

-- Query #5 (e endpoint ticket status): ultime validazioni per ticket in ordine temporale.
CREATE INDEX IF NOT EXISTS idx_validation_ticket_validated_desc
ON validation (ticket_id, validated_at DESC);
