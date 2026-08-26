SET search_path TO transport, public;

-- Le partenze si calcolano dai calendari attivi nella data, non da un service_date
-- sul trip. active_calendar_ids applica il pattern settimanale di calendar.txt e le
-- eccezioni di calendar_dates.txt.
SELECT
    st.city_id,
    st.stop_id,
    s.name AS stop_name,
    COALESCE(r.short_name, r.long_name) AS line_name,
    DATE '2026-03-02' + st.departure_time AS departure_ts
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
WHERE st.city_id = 1
  AND st.stop_id = 2
  AND t.calendar_id IN (SELECT calendar_id FROM active_calendar_ids(1, DATE '2026-03-02'))
ORDER BY departure_ts
LIMIT 10;
