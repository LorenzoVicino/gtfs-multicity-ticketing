SET search_path TO transport, public;

SELECT
    i.itinerary_id,
    i.departure_ts,
    i.arrival_ts,
    i.transfers_count,
    s.segment_seq,
    s.trip_id,
    s.departure_stop_id,
    s.arrival_stop_id,
    s.planned_departure_ts,
    s.planned_arrival_ts
FROM itinerary i
JOIN itinerary_segment s
  ON s.itinerary_id = i.itinerary_id
 AND s.city_id = i.city_id
WHERE i.booking_id = 1
ORDER BY s.segment_seq;
