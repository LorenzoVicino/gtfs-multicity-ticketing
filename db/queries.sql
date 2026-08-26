SET search_path TO transport, public;

-- 1) Prossime partenze da una fermata: mostra le prossime corse in uscita da uno stop.
-- La data non e` un attributo del trip: seleziona i calendari attivi in quella data
-- (pattern settimanale di calendar.txt piu` le eccezioni di calendar_dates.txt) e
-- filtra i trip sui calendari risultanti.
-- Parametri: :city_id, :stop_id, :service_date
SELECT
    st.city_id,
    st.stop_id,
    s.name AS stop_name,
    t.trip_id,
    r.route_id,
    COALESCE(r.short_name, r.long_name) AS line_name,
    :service_date::DATE + st.departure_time AS departure_ts
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
  AND t.calendar_id IN (SELECT calendar_id FROM active_calendar_ids(:city_id, :service_date::DATE))
  AND (:service_date::DATE + st.departure_time) >= NOW()
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
  AND t.calendar_id IN (SELECT calendar_id FROM active_calendar_ids(:city_id, :service_date::DATE))
  AND dep.stop_id = :from_stop_id
  AND arr.stop_id = :to_stop_id
  AND arr.stop_sequence > dep.stop_sequence
ORDER BY dep.departure_time
LIMIT 100;

-- 3) Servizi attivi in una data, con la ragione dell'attivazione.
-- Utile per capire perche` una data non ha partenze.
-- Parametri: :city_id, :service_date
SELECT
    c.gtfs_service_id,
    c.start_date,
    c.end_date,
    cd.exception_type
FROM calendar c
LEFT JOIN calendar_date cd
  ON cd.city_id = c.city_id
 AND cd.calendar_id = c.calendar_id
 AND cd.service_date = :service_date::DATE
WHERE c.city_id = :city_id
  AND c.calendar_id IN (SELECT calendar_id FROM active_calendar_ids(:city_id, :service_date::DATE))
ORDER BY c.gtfs_service_id;
