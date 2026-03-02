SET search_path TO transport, public;

SELECT
    t.trip_id,
    r.short_name AS linea,
    t.service_date,
    dep.departure_time AS partenza,
    arr.arrival_time AS arrivo
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
 AND arr.stop_sequence > dep.stop_sequence
WHERE t.city_id = 1
  AND t.service_date = DATE '2026-02-18'
  AND dep.stop_id = 1
  AND arr.stop_id = 4
ORDER BY dep.departure_time;
