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
