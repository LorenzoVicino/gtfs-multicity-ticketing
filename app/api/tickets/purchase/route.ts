import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issueSignedTicketQr } from "@/lib/ticketing";

type PurchaseBody = {
  cityCode?: string;
  cityId?: number;
  agencyId?: number;
  ticketTypeName?: string;
  ticketTypeId?: number;
  customer?: {
    email?: string;
    fullName?: string;
  };
  passengers?: Array<{
    fullName?: string;
    birthDate?: string | null;
  }>;
};

type CityRow = { city_id: number };

type TicketTypeRow = {
  ticket_type_id: number;
  agency_id: number;
  agency_name: string;
  gtfs_agency_id: string;
  name: string;
  duration_minutes: number;
  price_cents: number;
};

type CustomerRow = { customer_id: number };
type PassengerRow = { passenger_id: number };
type BookingRow = { booking_id: number };

function makeCode(prefix: string, bytes = 6): string {
  return `${prefix}-${randomBytes(bytes).toString("hex").toUpperCase()}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseBirthDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "INVALID_DATE";
  }

  return value;
}

function splitPassengerName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length <= 1) {
    return {
      firstName: parts[0] ?? fullName.trim(),
      lastName: "-"
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "-"
  };
}

export async function POST(request: Request) {
  let body: PurchaseBody;

  try {
    body = (await request.json()) as PurchaseBody;
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const cityCode = body.cityCode?.trim().toUpperCase();
  const cityIdInput = body.cityId;
  const agencyIdInput = body.agencyId;
  const ticketTypeName = body.ticketTypeName?.trim();
  const ticketTypeIdInput = body.ticketTypeId;
  const customerEmail = body.customer?.email?.trim().toLowerCase();
  const customerFullName = body.customer?.fullName?.trim();
  const passengersInput = body.passengers ?? [];

  if (!cityCode && !cityIdInput) {
    return NextResponse.json(
      { error: "Fornisci cityCode (preferito) oppure cityId" },
      { status: 400 }
    );
  }

  if (!ticketTypeName && !ticketTypeIdInput) {
    return NextResponse.json(
      { error: "Fornisci ticketTypeId oppure ticketTypeName" },
      { status: 400 }
    );
  }

  if (ticketTypeName && !agencyIdInput) {
    return NextResponse.json(
      { error: "agencyId obbligatorio quando selezioni il ticket tramite nome" },
      { status: 400 }
    );
  }

  if (!customerEmail || !customerFullName) {
    return NextResponse.json(
      { error: "customer.email e customer.fullName sono obbligatori" },
      { status: 400 }
    );
  }

  if (!isValidEmail(customerEmail)) {
    return NextResponse.json({ error: "Email non valida" }, { status: 400 });
  }

  if (!Array.isArray(passengersInput) || passengersInput.length === 0) {
    return NextResponse.json(
      { error: "passengers deve contenere almeno un elemento" },
      { status: 400 }
    );
  }

  for (const passenger of passengersInput) {
    if (!passenger.fullName?.trim()) {
      return NextResponse.json(
        { error: "Ogni passenger deve avere fullName" },
        { status: 400 }
      );
    }

    if (passenger.birthDate && parseBirthDate(passenger.birthDate) === "INVALID_DATE") {
      return NextResponse.json(
        { error: `birthDate non valido per passenger ${passenger.fullName}` },
        { status: 400 }
      );
    }
  }

  const client = await db.connect();
  let txStarted = false;

  try {
    await client.query("BEGIN");
    txStarted = true;
    await client.query("SET search_path TO transport, public");

    let cityId: number;

    if (cityCode) {
      const cityResult = await client.query<CityRow>(
        `
        SELECT city_id
        FROM city
        WHERE city_code = $1
        LIMIT 1
        `,
        [cityCode]
      );

      if (cityResult.rowCount === 0) {
        await client.query("ROLLBACK");
        txStarted = false;
        return NextResponse.json({ error: "Citta non trovata" }, { status: 404 });
      }

      cityId = cityResult.rows[0].city_id;
    } else {
      const cityResult = await client.query<CityRow>(
        `
        SELECT city_id
        FROM city
        WHERE city_id = $1
        LIMIT 1
        `,
        [cityIdInput]
      );

      if (cityResult.rowCount === 0) {
        await client.query("ROLLBACK");
        txStarted = false;
        return NextResponse.json({ error: "cityId non trovato" }, { status: 404 });
      }

      cityId = cityResult.rows[0].city_id;
    }

    let ticketType: TicketTypeRow | null = null;

    if (ticketTypeIdInput) {
      const ticketTypeResult = await client.query<TicketTypeRow>(
        `
        SELECT
          tt.ticket_type_id,
          tt.agency_id,
          a.name AS agency_name,
          a.gtfs_agency_id,
          tt.name,
          tt.duration_minutes,
          tt.price_cents
        FROM ticket_type tt
        JOIN agency a
          ON a.agency_id = tt.agency_id
         AND a.city_id = tt.city_id
        WHERE tt.city_id = $1
          AND tt.ticket_type_id = $2
          AND tt.active = TRUE
        LIMIT 1
        `,
        [cityId, ticketTypeIdInput]
      );

      ticketType = ticketTypeResult.rows[0] ?? null;
    } else if (ticketTypeName && agencyIdInput) {
      const ticketTypeResult = await client.query<TicketTypeRow>(
        `
        SELECT
          tt.ticket_type_id,
          tt.agency_id,
          a.name AS agency_name,
          a.gtfs_agency_id,
          tt.name,
          tt.duration_minutes,
          tt.price_cents
        FROM ticket_type tt
        JOIN agency a
          ON a.agency_id = tt.agency_id
         AND a.city_id = tt.city_id
        WHERE tt.city_id = $1
          AND tt.agency_id = $2
          AND tt.name = $3
          AND tt.active = TRUE
        LIMIT 1
        `,
        [cityId, agencyIdInput, ticketTypeName]
      );

      ticketType = ticketTypeResult.rows[0] ?? null;
    }

    if (!ticketType) {
      await client.query("ROLLBACK");
      txStarted = false;
      return NextResponse.json(
        { error: "Ticket type attivo non trovato per la citta/agency richiesta" },
        { status: 404 }
      );
    }

    const customerResult = await client.query<CustomerRow>(
      `
      INSERT INTO customer (email, full_name)
      VALUES ($1, $2)
      ON CONFLICT (email)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        updated_at = NOW()
      RETURNING customer_id
      `,
      [customerEmail, customerFullName]
    );

    const customerId = customerResult.rows[0].customer_id;
    const totalCents = ticketType.price_cents * passengersInput.length;
    const totalAmount = totalCents / 100;

    let bookingId: number | null = null;
    let bookingCode = "";

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = makeCode("BKG", 4);
      const bookingInsert = await client.query<BookingRow>(
        `
        INSERT INTO booking (
          city_id,
          customer_id,
          booking_code,
          travel_date,
          status,
          total_amount,
          total_cents,
          currency_code
        )
        VALUES ($1, $2, $3, CURRENT_DATE, 'PAID', $4, $5, 'EUR')
        ON CONFLICT (booking_code) DO NOTHING
        RETURNING booking_id
        `,
        [cityId, customerId, candidate, totalAmount, totalCents]
      );

      if (bookingInsert.rowCount === 1) {
        bookingId = bookingInsert.rows[0].booking_id;
        bookingCode = candidate;
        break;
      }
    }

    if (!bookingId) {
      throw new Error("Impossibile generare booking_code univoco");
    }

    const paymentRef = makeCode("PAY", 6);

    await client.query(
      `
      INSERT INTO payment (
        city_id,
        booking_id,
        transaction_ref,
        amount,
        amount_cents,
        currency_code,
        method,
        status,
        paid_at,
        provider,
        external_ref
      )
      VALUES ($1, $2, $3, $4, $5, 'EUR', 'card', 'PAID', NOW(), 'mock', $3)
      `,
      [cityId, bookingId, paymentRef, totalAmount, totalCents]
    );

    const tickets: Array<{
      ticketCode: string;
      passengerName: string;
      qrToken: string;
    }> = [];

    for (const passengerInput of passengersInput) {
      const passengerName = passengerInput.fullName!.trim();
      const birthDate = parseBirthDate(passengerInput.birthDate);
      const splitName = splitPassengerName(passengerName);

      const passengerInsert = await client.query<PassengerRow>(
        `
        INSERT INTO passenger (customer_id, first_name, last_name, full_name, birth_date)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING passenger_id
        `,
        [customerId, splitName.firstName, splitName.lastName, passengerName, birthDate]
      );

      const passengerId = passengerInsert.rows[0].passenger_id;

      let ticketCode = "";
      let qrToken = "";
      let inserted = false;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = makeCode("TKT", 6);
        const signedQr = issueSignedTicketQr({
          ticketCode: candidate,
          bookingCode,
          cityId,
          agencyId: ticketType.agency_id,
          ticketTypeId: ticketType.ticket_type_id,
          issuedAt: new Date().toISOString()
        });

        const ticketInsert = await client.query(
          `
          INSERT INTO ticket (
            city_id,
            ticket_code,
            booking_id,
            itinerary_id,
            passenger_id,
            issued_at,
            valid_from,
            valid_to,
            status,
            qr_payload,
            ticket_type_id
          )
          VALUES (
            $1,
            $2,
            $3,
            NULL,
            $4,
            NOW(),
            NOW(),
            NOW() + ($5 * INTERVAL '1 minute'),
            'ISSUED',
            $6,
            $7
          )
          ON CONFLICT (ticket_code) DO NOTHING
          RETURNING ticket_id
          `,
          [
            cityId,
            candidate,
            bookingId,
            passengerId,
            ticketType.duration_minutes,
            signedQr,
            ticketType.ticket_type_id
          ]
        );

        if (ticketInsert.rowCount === 1) {
          ticketCode = candidate;
          qrToken = signedQr;
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        throw new Error("Impossibile generare ticket_code univoco");
      }

      tickets.push({
        ticketCode,
        passengerName,
        qrToken
      });
    }

    await client.query("COMMIT");
    txStarted = false;

    return NextResponse.json(
      {
        bookingCode,
        totalCents,
        cityId,
        agency: {
          agencyId: ticketType.agency_id,
          gtfsAgencyId: ticketType.gtfs_agency_id,
          name: ticketType.agency_name
        },
        ticketType: {
          ticketTypeId: ticketType.ticket_type_id,
          name: ticketType.name,
          durationMinutes: ticketType.duration_minutes,
          priceCents: ticketType.price_cents
        },
        tickets
      },
      { status: 201 }
    );
  } catch (error) {
    if (txStarted) {
      await client.query("ROLLBACK");
    }

    return NextResponse.json(
      {
        error: "Acquisto ticket fallito",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
