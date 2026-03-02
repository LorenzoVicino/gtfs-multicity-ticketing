SET search_path TO transport, public;
REFRESH MATERIALIZED VIEW transport.mv_next_departures;

SELECT city_id, stop_id, stop_name, line_name, departure_ts
FROM transport.mv_next_departures
WHERE city_id = 1
  AND stop_id = 2
ORDER BY departure_ts
LIMIT 10;
