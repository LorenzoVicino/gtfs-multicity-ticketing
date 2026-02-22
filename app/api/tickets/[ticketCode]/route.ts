import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = {
  params: Promise<{
    ticketCode: string;
  }>;
};

type TicketRow = {
  ticket_id: number;
  ticket_code: string;
  status: "ISSUED" | "REVOKED";
  first_validated_at: string | null;
  valid_until: string | null;
  duration_minutes: number;
  is_valid: boolean;
};

type ValidationRow = {
  validated_at: string;
  stop_id: number | null;
  segment_id: number | null;
  validator_device: string | null;
};

export async function GET(_: Request, { params }: Params) {
  const { ticketCode: rawTicketCode } = await params;
  const ticketCode = rawTicketCode.trim();

  if (!ticketCode) {
    return NextResponse.json({ error: "ticketCode mancante" }, { status: 400 });
  }

  const client = await db.connect();

  try {
    await client.query("SET search_path TO transport, public");

    const ticketResult = await client.query<TicketRow>(
      `
      SELECT
        t.ticket_id,
        t.ticket_code,
        t.status,
        t.first_validated_at::text,
        t.valid_until::text,
        tt.duration_minutes,
        (
          t.valid_until IS NOT NULL
          AND NOW() <= t.valid_until
        ) AS is_valid
      FROM ticket t
      JOIN ticket_type tt ON tt.ticket_type_id = t.ticket_type_id
      WHERE t.ticket_code = $1
      LIMIT 1
      `,
      [ticketCode]
    );

    if (ticketResult.rowCount === 0) {
      return NextResponse.json({ error: "Ticket non trovato" }, { status: 404 });
    }

    const ticket = ticketResult.rows[0];

    const validationsResult = await client.query<ValidationRow>(
      `
      SELECT
        validated_at::text,
        stop_id,
        segment_id,
        validator_device
      FROM validation
      WHERE ticket_id = $1
      ORDER BY validated_at DESC
      LIMIT 10
      `,
      [ticket.ticket_id]
    );

    return NextResponse.json({
      ticketCode: ticket.ticket_code,
      status: ticket.status,
      firstValidatedAt: ticket.first_validated_at,
      validUntil: ticket.valid_until,
      isValid: ticket.is_valid,
      durationMinutes: ticket.duration_minutes,
      lastValidations: validationsResult.rows.map((row) => ({
        validatedAt: row.validated_at,
        stopId: row.stop_id,
        segmentId: row.segment_id,
        validatorDevice: row.validator_device
      }))
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Lettura stato ticket fallita",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
