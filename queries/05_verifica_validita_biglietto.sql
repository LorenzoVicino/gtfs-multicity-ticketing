SET search_path TO transport, public;

SELECT
    t.ticket_code,
    t.status,
    t.valid_from,
    t.valid_to,
    CASE
        WHEN t.status IN ('void', 'refunded') THEN 'NOT_VALID'
        WHEN NOW() < t.valid_from THEN 'NOT_YET_VALID'
        WHEN NOW() > t.valid_to THEN 'EXPIRED'
        ELSE 'VALID'
    END AS validity_state
FROM ticket t
WHERE t.ticket_code = 'TCK-MIL-000001';
