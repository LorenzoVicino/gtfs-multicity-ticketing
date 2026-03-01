SET search_path TO transport, public;

-- 1) Nuova tabella ticket_type
CREATE TABLE IF NOT EXISTS ticket_type (
    ticket_type_id BIGSERIAL PRIMARY KEY,
    city_id BIGINT NOT NULL REFERENCES city (city_id) ON DELETE RESTRICT,
    name VARCHAR(120) NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (city_id, name)
);

-- 2) customer (gia presente): soddisfa i requisiti minimi.

-- 3) passenger: customer_id deve poter essere NULL + full_name richiesto.
ALTER TABLE passenger
    ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE passenger
    ADD COLUMN IF NOT EXISTS full_name VARCHAR(150);

UPDATE passenger
SET full_name = TRIM(CONCAT_WS(' ', first_name, last_name))
WHERE full_name IS NULL;

ALTER TABLE passenger
    ALTER COLUMN full_name SET NOT NULL;

-- 4) booking: created_at + total_cents + status minimo richiesto.
ALTER TABLE booking
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE booking
    ADD COLUMN IF NOT EXISTS total_cents INTEGER;

UPDATE booking
SET total_cents = ROUND(total_amount * 100)::INTEGER
WHERE total_cents IS NULL;

ALTER TABLE booking
    ALTER COLUMN total_cents SET NOT NULL;

UPDATE booking
SET status = CASE
    WHEN UPPER(status) IN ('PAID', 'CONFIRMED') THEN 'PAID'
    WHEN UPPER(status) IN ('CANCELLED', 'CANCELED', 'EXPIRED') THEN 'CANCELLED'
    ELSE 'CREATED'
END;

DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'transport.booking'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE transport.booking DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE booking
    ADD CONSTRAINT booking_status_check_time
    CHECK (status IN ('CREATED', 'PAID', 'CANCELLED'));

-- 5) ticket: ticket_type + first_validated_at + valid_until + status minimo richiesto.
ALTER TABLE ticket
    ADD COLUMN IF NOT EXISTS ticket_type_id BIGINT REFERENCES ticket_type (ticket_type_id) ON DELETE RESTRICT;

ALTER TABLE ticket
    ADD COLUMN IF NOT EXISTS first_validated_at TIMESTAMPTZ;

ALTER TABLE ticket
    ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;

UPDATE ticket
SET first_validated_at = (
    SELECT MIN(v.validated_at)
    FROM validation v
    WHERE v.ticket_id = ticket.ticket_id
)
WHERE first_validated_at IS NULL;

UPDATE ticket
SET valid_until = valid_to
WHERE valid_until IS NULL;

UPDATE ticket
SET status = CASE
    WHEN UPPER(status) IN ('ISSUED', 'VALIDATED') THEN 'ISSUED'
    ELSE 'REVOKED'
END;

DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'transport.ticket'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE transport.ticket DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE ticket
    ADD CONSTRAINT ticket_status_check_time
    CHECK (status IN ('ISSUED', 'REVOKED'));

-- 6) payment: amount_cents + external_ref + status minimo richiesto.
ALTER TABLE payment
    ADD COLUMN IF NOT EXISTS amount_cents INTEGER;

ALTER TABLE payment
    ADD COLUMN IF NOT EXISTS external_ref VARCHAR(128);

UPDATE payment
SET amount_cents = ROUND(amount * 100)::INTEGER
WHERE amount_cents IS NULL;

UPDATE payment
SET external_ref = transaction_ref
WHERE external_ref IS NULL;

UPDATE payment
SET provider = COALESCE(NULLIF(provider, ''), 'unknown');

ALTER TABLE payment
    ALTER COLUMN provider SET NOT NULL;

ALTER TABLE payment
    ALTER COLUMN amount_cents SET NOT NULL;

UPDATE payment
SET status = CASE
    WHEN UPPER(status) = 'PAID' THEN 'PAID'
    ELSE 'FAILED'
END;

DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'transport.payment'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE transport.payment DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE payment
    ADD CONSTRAINT payment_status_check_time
    CHECK (status IN ('PAID', 'FAILED'));

-- 7) itinerary: tabella gia presente e compatibile (ha almeno itinerary_id, city_id, created_at).

-- 8) itinerary_segment: aggiunge nomi richiesti (segment_id, from_stop_id, to_stop_id)
-- mantenendo compatibilita con colonne esistenti.
ALTER TABLE itinerary_segment
    ADD COLUMN IF NOT EXISTS segment_id BIGINT;

UPDATE itinerary_segment
SET segment_id = itinerary_segment_id
WHERE segment_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relnamespace = 'transport'::regnamespace
          AND relkind = 'S'
          AND relname = 'itinerary_segment_segment_id_seq'
    ) THEN
        CREATE SEQUENCE transport.itinerary_segment_segment_id_seq;
    END IF;
END $$;

ALTER TABLE itinerary_segment
    ALTER COLUMN segment_id SET DEFAULT nextval('transport.itinerary_segment_segment_id_seq');

SELECT SETVAL(
    'transport.itinerary_segment_segment_id_seq',
    COALESCE((SELECT MAX(segment_id) FROM itinerary_segment), 1),
    TRUE
);

ALTER TABLE itinerary_segment
    ALTER COLUMN segment_id SET NOT NULL;

DO $$
DECLARE pkey_name TEXT;
BEGIN
    SELECT conname INTO pkey_name
    FROM pg_constraint
    WHERE conrelid = 'transport.itinerary_segment'::regclass
      AND contype = 'p';

    IF pkey_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE transport.itinerary_segment DROP CONSTRAINT %I', pkey_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'transport.itinerary_segment'::regclass
          AND contype = 'p'
          AND conname = 'itinerary_segment_pkey_segment_id'
    ) THEN
        ALTER TABLE transport.itinerary_segment
            ADD CONSTRAINT itinerary_segment_pkey_segment_id PRIMARY KEY (segment_id);
    END IF;
END $$;

ALTER TABLE itinerary_segment
    ADD COLUMN IF NOT EXISTS from_stop_id BIGINT;

ALTER TABLE itinerary_segment
    ADD COLUMN IF NOT EXISTS to_stop_id BIGINT;

UPDATE itinerary_segment
SET from_stop_id = departure_stop_id
WHERE from_stop_id IS NULL;

UPDATE itinerary_segment
SET to_stop_id = arrival_stop_id
WHERE to_stop_id IS NULL;

ALTER TABLE itinerary_segment
    ALTER COLUMN from_stop_id SET NOT NULL;

ALTER TABLE itinerary_segment
    ALTER COLUMN to_stop_id SET NOT NULL;

ALTER TABLE itinerary_segment
    DROP CONSTRAINT IF EXISTS itinerary_segment_from_to_check_time;

ALTER TABLE itinerary_segment
    ADD CONSTRAINT itinerary_segment_from_to_check_time
    CHECK (from_stop_id <> to_stop_id);

ALTER TABLE itinerary_segment
    DROP CONSTRAINT IF EXISTS itinerary_segment_segment_seq_check_time;

ALTER TABLE itinerary_segment
    ADD CONSTRAINT itinerary_segment_segment_seq_check_time
    CHECK (segment_seq > 0);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.itinerary_segment'::regclass
          AND conname = 'itinerary_segment_trip_id_fk_simple'
    ) THEN
        ALTER TABLE transport.itinerary_segment
            ADD CONSTRAINT itinerary_segment_trip_id_fk_simple
            FOREIGN KEY (trip_id) REFERENCES transport.trip (trip_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.itinerary_segment'::regclass
          AND conname = 'itinerary_segment_from_stop_fk_simple'
    ) THEN
        ALTER TABLE transport.itinerary_segment
            ADD CONSTRAINT itinerary_segment_from_stop_fk_simple
            FOREIGN KEY (from_stop_id) REFERENCES transport.stop (stop_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.itinerary_segment'::regclass
          AND conname = 'itinerary_segment_to_stop_fk_simple'
    ) THEN
        ALTER TABLE transport.itinerary_segment
            ADD CONSTRAINT itinerary_segment_to_stop_fk_simple
            FOREIGN KEY (to_stop_id) REFERENCES transport.stop (stop_id) ON DELETE RESTRICT;
    END IF;
END $$;

-- 9) validation: aggiunge riferimenti richiesti.
ALTER TABLE validation
    ADD COLUMN IF NOT EXISTS segment_id BIGINT;

ALTER TABLE validation
    ADD COLUMN IF NOT EXISTS validator_device VARCHAR(64);

UPDATE validation
SET validator_device = validator_device_id
WHERE validator_device IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.validation'::regclass
          AND conname = 'validation_ticket_fk_simple'
    ) THEN
        ALTER TABLE transport.validation
            ADD CONSTRAINT validation_ticket_fk_simple
            FOREIGN KEY (ticket_id) REFERENCES transport.ticket (ticket_id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.validation'::regclass
          AND conname = 'validation_stop_fk_simple'
    ) THEN
        ALTER TABLE transport.validation
            ADD CONSTRAINT validation_stop_fk_simple
            FOREIGN KEY (stop_id) REFERENCES transport.stop (stop_id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'transport.validation'::regclass
          AND conname = 'validation_segment_fk'
    ) THEN
        ALTER TABLE transport.validation
            ADD CONSTRAINT validation_segment_fk
            FOREIGN KEY (segment_id) REFERENCES transport.itinerary_segment (segment_id) ON DELETE SET NULL;
    END IF;
END $$;

-- 10) Indici richiesti
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ticket_code ON ticket (ticket_code);
CREATE INDEX IF NOT EXISTS idx_booking_customer_created_desc ON booking (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_ticket_validated_at ON validation (ticket_id, validated_at);
CREATE INDEX IF NOT EXISTS idx_itinerary_segment_itinerary_seq_req ON itinerary_segment (itinerary_id, segment_seq);

-- 11) Dato minimo di esempio richiesto: 1 ticket_type per una city esistente.
INSERT INTO ticket_type (city_id, name, duration_minutes, price_cents, active)
SELECT c.city_id, 'Biglietto 90 minuti', 90, 150, TRUE
FROM city c
ORDER BY c.city_id
LIMIT 1
ON CONFLICT (city_id, name) DO NOTHING;

-- Allinea ticket esistenti ad un ticket_type valido (quando possibile).
UPDATE ticket t
SET ticket_type_id = tt.ticket_type_id
FROM ticket_type tt
WHERE t.ticket_type_id IS NULL
  AND tt.city_id = t.city_id
  AND tt.active = TRUE;
