SET search_path TO transport, public;

-- Tariffe demo a tempo per agency.
-- Se un'agency ha gia uno stesso nome commerciale, non viene duplicato.
WITH default_ticket_types AS (
    SELECT *
    FROM (
        VALUES
            ('Biglietto 90 minuti', 90, 150),
            ('Pass giornaliero', 1440, 490),
            ('Pass settimanale', 10080, 1890)
    ) AS v(name, duration_minutes, price_cents)
)
INSERT INTO ticket_type (
    city_id,
    agency_id,
    fare_id,
    name,
    duration_minutes,
    price_cents,
    active
)
SELECT
    a.city_id,
    a.agency_id,
    NULL::bigint AS fare_id,
    dtt.name,
    dtt.duration_minutes,
    dtt.price_cents,
    TRUE
FROM agency a
CROSS JOIN default_ticket_types dtt
WHERE NOT EXISTS (
    SELECT 1
    FROM ticket_type tt
    WHERE tt.city_id = a.city_id
      AND tt.agency_id = a.agency_id
      AND LOWER(tt.name) = LOWER(dtt.name)
);
