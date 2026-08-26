SET search_path TO transport, public;

-- La corsa non ha una data propria: la data seleziona i calendari attivi
-- (active_calendar_ids applica calendar.txt e le eccezioni di calendar_dates.txt)
-- e i trip si filtrano sul calendar_id risultante.
SELECT
    t.trip_id,
    r.short_name AS linea,
    c.gtfs_service_id AS servizio,
    dep.departure_time AS partenza,
    arr.arrival_time AS arrivo
FROM trip t
JOIN route r
  ON r.route_id = t.route_id
 AND r.city_id = t.city_id
JOIN calendar c
  ON c.calendar_id = t.calendar_id
 AND c.city_id = t.city_id
JOIN stop_time dep
  ON dep.trip_id = t.trip_id
 AND dep.city_id = t.city_id
JOIN stop_time arr
  ON arr.trip_id = t.trip_id
 AND arr.city_id = t.city_id
 AND arr.stop_sequence > dep.stop_sequence
WHERE t.city_id = 1
  AND t.calendar_id IN (SELECT calendar_id FROM active_calendar_ids(1, DATE '2026-02-18'))
  AND dep.stop_id = 1
  AND arr.stop_id = 4
ORDER BY dep.departure_time;
