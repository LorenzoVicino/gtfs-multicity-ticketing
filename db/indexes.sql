SET search_path TO transport, public;

-- Query #1: prossime partenze da stop.
-- Copre filtro per city_id/stop_id e ordinamento/finestra su departure_time;
-- trip_id in coda aiuta il join immediato con trip.
CREATE INDEX IF NOT EXISTS idx_stop_time_city_stop_departure_trip
ON stop_time (city_id, stop_id, departure_time, trip_id);

-- Query #1: filtro su trip per city_id + calendar_id.
-- Le partenze non filtrano piu` per data sul trip: la data seleziona i calendari
-- attivi (active_calendar_ids) e il trip si filtra sul calendar_id risultante.
CREATE INDEX IF NOT EXISTS idx_trip_city_calendar_trip
ON trip (city_id, calendar_id, trip_id);

-- Query #1: risoluzione delle eccezioni calendar_dates per una data.
CREATE INDEX IF NOT EXISTS idx_calendar_date_city_calendar_date
ON calendar_date (city_id, calendar_id, service_date, exception_type);

-- Query #2: ricerca dep/arr sulla stessa corsa (trip_id/city_id) con filtro stop_id.
CREATE INDEX IF NOT EXISTS idx_stop_time_city_trip_stop
ON stop_time (city_id, trip_id, stop_id);

-- Query #2: supporto confronto sequenze fermate sulla stessa corsa.
CREATE INDEX IF NOT EXISTS idx_stop_time_city_trip_sequence
ON stop_time (city_id, trip_id, stop_sequence);
