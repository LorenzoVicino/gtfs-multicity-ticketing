SET search_path TO transport, public;

ALTER TABLE ticket_type
    ADD COLUMN IF NOT EXISTS agency_id BIGINT;

ALTER TABLE ticket_type
    ADD COLUMN IF NOT EXISTS fare_id BIGINT;

UPDATE ticket_type tt
SET agency_id = resolved.agency_id
FROM (
    SELECT
        tt_inner.ticket_type_id,
        COALESCE(
            exact_fare.agency_id,
            priced_fare.agency_id,
            city_agency.agency_id
        ) AS agency_id
    FROM ticket_type tt_inner
    LEFT JOIN LATERAL (
        SELECT f.agency_id
        FROM fare f
        WHERE f.city_id = tt_inner.city_id
          AND f.fare_name = tt_inner.name
        ORDER BY f.fare_id
        LIMIT 1
    ) exact_fare ON TRUE
    LEFT JOIN LATERAL (
        SELECT f.agency_id
        FROM fare f
        WHERE f.city_id = tt_inner.city_id
          AND ROUND(f.price * 100)::INTEGER = tt_inner.price_cents
          AND f.validity_minutes = tt_inner.duration_minutes
        ORDER BY f.fare_id
        LIMIT 1
    ) priced_fare ON TRUE
    LEFT JOIN LATERAL (
        SELECT a.agency_id
        FROM agency a
        WHERE a.city_id = tt_inner.city_id
        ORDER BY a.agency_id
        LIMIT 1
    ) city_agency ON TRUE
) resolved
WHERE tt.ticket_type_id = resolved.ticket_type_id
  AND tt.agency_id IS NULL
  AND resolved.agency_id IS NOT NULL;

UPDATE ticket_type tt
SET fare_id = resolved.fare_id
FROM (
    SELECT
        tt_inner.ticket_type_id,
        matched_fare.fare_id
    FROM ticket_type tt_inner
    LEFT JOIN LATERAL (
        SELECT f.fare_id
        FROM fare f
        WHERE f.city_id = tt_inner.city_id
          AND (
            f.fare_name = tt_inner.name
            OR (
                ROUND(f.price * 100)::INTEGER = tt_inner.price_cents
                AND f.validity_minutes = tt_inner.duration_minutes
            )
          )
        ORDER BY
            CASE WHEN f.fare_name = tt_inner.name THEN 0 ELSE 1 END,
            f.fare_id
        LIMIT 1
    ) matched_fare ON TRUE
) resolved
WHERE tt.ticket_type_id = resolved.ticket_type_id
  AND tt.fare_id IS NULL
  AND resolved.fare_id IS NOT NULL;

DO $$
DECLARE constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'transport.ticket_type'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (city_id, name)';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE transport.ticket_type DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE ticket_type
    ALTER COLUMN agency_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'transport.ticket_type'::regclass
          AND conname = 'ticket_type_agency_fk'
    ) THEN
        ALTER TABLE transport.ticket_type
            ADD CONSTRAINT ticket_type_agency_fk
            FOREIGN KEY (agency_id, city_id)
            REFERENCES transport.agency (agency_id, city_id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'transport.ticket_type'::regclass
          AND conname = 'ticket_type_fare_fk'
    ) THEN
        ALTER TABLE transport.ticket_type
            ADD CONSTRAINT ticket_type_fare_fk
            FOREIGN KEY (fare_id, city_id)
            REFERENCES transport.fare (fare_id, city_id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_type_city_agency_name
ON ticket_type (city_id, agency_id, name);

CREATE INDEX IF NOT EXISTS idx_ticket_type_city_agency_active
ON ticket_type (city_id, agency_id, active);

INSERT INTO ticket_type (city_id, agency_id, fare_id, name, duration_minutes, price_cents, active)
SELECT
    f.city_id,
    f.agency_id,
    f.fare_id,
    f.fare_name,
    f.validity_minutes,
    ROUND(f.price * 100)::INTEGER,
    f.is_active
FROM fare f
ON CONFLICT (city_id, agency_id, name)
DO UPDATE SET
    fare_id = COALESCE(ticket_type.fare_id, EXCLUDED.fare_id),
    duration_minutes = EXCLUDED.duration_minutes,
    price_cents = EXCLUDED.price_cents,
    active = EXCLUDED.active;

INSERT INTO ticket_type (city_id, agency_id, name, duration_minutes, price_cents, active)
SELECT
    a.city_id,
    a.agency_id,
    'Biglietto 90 minuti',
    90,
    150,
    TRUE
FROM agency a
WHERE NOT EXISTS (
    SELECT 1
    FROM ticket_type tt
    WHERE tt.city_id = a.city_id
      AND tt.agency_id = a.agency_id
);

ALTER TABLE ticket
    ALTER COLUMN itinerary_id DROP NOT NULL;
