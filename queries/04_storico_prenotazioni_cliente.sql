SET search_path TO transport, public;

SELECT
    b.booking_code,
    b.booked_at,
    b.travel_date,
    b.status,
    b.total_amount,
    b.currency_code
FROM booking b
JOIN customer c ON c.customer_id = b.customer_id
WHERE c.email = 'mario.rossi@example.com'
ORDER BY b.booked_at DESC;
