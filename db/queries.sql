SET search_path TO transport, public;

-- 1) Prossime partenze da una fermata: mostra le prossime corse in uscita da uno stop.
-- Parametri: :city_id, :stop_id, :service_date
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
WHERE st.city_id = :city_id
  AND st.stop_id = :stop_id
  AND t.service_date = :service_date
  AND (t.service_date + st.departure_time) >= NOW()
ORDER BY departure_ts
LIMIT 20;

-- 2) Corse dirette tra due fermate: stessa trip con sequenza fermate coerente.
-- Parametri: :city_id, :from_stop_id, :to_stop_id, :service_date
SELECT
    t.trip_id,
    r.route_id,
    COALESCE(r.short_name, r.long_name) AS line_name,
    dep.stop_sequence AS from_seq,
    arr.stop_sequence AS to_seq,
    dep.departure_time AS from_departure_time,
    arr.arrival_time AS to_arrival_time
FROM trip t
JOIN route r
  ON r.route_id = t.route_id
 AND r.city_id = t.city_id
JOIN stop_time dep
  ON dep.trip_id = t.trip_id
 AND dep.city_id = t.city_id
JOIN stop_time arr
  ON arr.trip_id = t.trip_id
 AND arr.city_id = t.city_id
WHERE t.city_id = :city_id
  AND t.service_date = :service_date
  AND dep.stop_id = :from_stop_id
  AND arr.stop_id = :to_stop_id
  AND arr.stop_sequence > dep.stop_sequence
ORDER BY dep.departure_time
LIMIT 100;

-- 3) Ricostruzione itinerario: dettaglio segmenti ordinati per segment_seq.
-- Parametro: :itinerary_id
SELECT
    i.itinerary_id,
    i.city_id,
    i.created_at AS itinerary_created_at,
    s.segment_id,
    s.segment_seq,
    s.trip_id,
    s.from_stop_id,
    fs.name AS from_stop_name,
    s.to_stop_id,
    ts.name AS to_stop_name
FROM itinerary i
JOIN itinerary_segment s
  ON s.itinerary_id = i.itinerary_id
LEFT JOIN stop fs
  ON fs.stop_id = s.from_stop_id
 AND fs.city_id = i.city_id
LEFT JOIN stop ts
  ON ts.stop_id = s.to_stop_id
 AND ts.city_id = i.city_id
WHERE i.itinerary_id = :itinerary_id
ORDER BY s.segment_seq ASC;

-- 4) Storico prenotazioni cliente: booking con ticket e passeggeri associati.
-- Parametro: :customer_email
SELECT
    b.booking_id,
    b.booking_code,
    b.status AS booking_status,
    b.created_at AS booking_created_at,
    b.total_cents,
    t.ticket_id,
    t.ticket_code,
    t.status AS ticket_status,
    t.valid_until,
    p.passenger_id,
    p.full_name AS passenger_name
FROM customer c
JOIN booking b
  ON b.customer_id = c.customer_id
LEFT JOIN ticket t
  ON t.booking_id = b.booking_id
LEFT JOIN passenger p
  ON p.passenger_id = t.passenger_id
WHERE LOWER(c.email) = LOWER(:customer_email)
ORDER BY b.created_at DESC, t.ticket_id ASC
LIMIT 200;

-- 5) Verifica validità ticket a tempo: calcola stato attuale con NOW() <= valid_until.
-- Parametro: :ticket_code
SELECT
    t.ticket_code,
    t.status,
    t.first_validated_at,
    t.valid_until,
    tt.duration_minutes,
    CASE
        WHEN t.status <> 'ISSUED' THEN FALSE
        WHEN t.valid_until IS NULL THEN FALSE
        WHEN NOW() <= t.valid_until THEN TRUE
        ELSE FALSE
    END AS is_valid
FROM ticket t
JOIN ticket_type tt
  ON tt.ticket_type_id = t.ticket_type_id
WHERE t.ticket_code = :ticket_code;
