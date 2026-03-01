import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";

export type TicketQrClaims = {
  v: 1;
  typ: "gtfs-ticket";
  ticketCode: string;
  bookingCode: string;
  cityId: number;
  agencyId: number;
  ticketTypeId: number;
  issuedAt: string;
  nonce: string;
};

type TicketValidationInput = {
  ticketCode?: string;
  qrToken?: string;
  stopId?: number;
  segmentId?: number;
  validatorDevice?: string;
};

type ValidationOutcome = "valid" | "duplicate" | "expired";

type TicketValidationRow = {
  ticket_id: number;
  ticket_code: string;
  booking_code: string;
  city_id: number;
  agency_id: number;
  ticket_type_id: number;
  status: string;
  first_validated_at: string | null;
  valid_until: string | null;
  duration_minutes: number;
  qr_payload: string | null;
};

class TicketingError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEV_QR_SECRET = "dev-ticket-qr-secret-change-me";
let hasWarnedAboutDevQrSecret = false;
const QR_TOKEN_PREFIX = "gtfs1";
const QR_SIGNATURE_BYTES = 16;

function getQrSecret(): string {
  const secret = process.env.TICKET_QR_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    if (!hasWarnedAboutDevQrSecret) {
      hasWarnedAboutDevQrSecret = true;
      console.warn(
        "TICKET_QR_SECRET is not set. Falling back to the local development QR secret."
      );
    }

    return DEV_QR_SECRET;
  }

  if (!secret) {
    throw new Error("Missing TICKET_QR_SECRET environment variable");
  }

  return secret;
}

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signTicketPayload(encodedPayload: string): string {
  return createHmac("sha256", getQrSecret())
    .update(encodedPayload)
    .digest()
    .subarray(0, QR_SIGNATURE_BYTES)
    .toString("base64url");
}

function signTicketPayloadLegacy(encodedPayload: string): string {
  return createHmac("sha256", getQrSecret()).update(encodedPayload).digest("base64url");
}

function normalizeInteger(value: unknown, field: string): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(numeric)) {
    throw new TicketingError(400, `Claims QR non validi: ${field}`);
  }

  return numeric;
}

function parseIssuedAt(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new TicketingError(400, "Claims QR non validi: issuedAt");
  }

  return parsed.toISOString();
}

function decodeCompactClaims(encodedPayload: string): TicketQrClaims | null {
  let decoded: string;
  try {
    decoded = fromBase64Url(encodedPayload).toString("utf8");
  } catch {
    throw new TicketingError(400, "Payload QR non valido");
  }

  if (decoded.startsWith("{")) {
    return null;
  }

  const [version, ticketCode, bookingCode, cityIdRaw, agencyIdRaw, ticketTypeIdRaw, issuedAtRaw, nonce] =
    decoded.split("|");

  if (
    version !== "1" ||
    !ticketCode ||
    !bookingCode ||
    !cityIdRaw ||
    !agencyIdRaw ||
    !ticketTypeIdRaw ||
    !issuedAtRaw ||
    !nonce
  ) {
    throw new TicketingError(400, "Claims QR non validi");
  }

  const issuedAtSeconds = Number.parseInt(issuedAtRaw, 36);
  if (!Number.isInteger(issuedAtSeconds) || issuedAtSeconds <= 0) {
    throw new TicketingError(400, "Claims QR non validi: issuedAt");
  }

  const cityId = Number.parseInt(cityIdRaw, 36);
  const agencyId = Number.parseInt(agencyIdRaw, 36);
  const ticketTypeId = Number.parseInt(ticketTypeIdRaw, 36);

  if (!Number.isInteger(cityId) || !Number.isInteger(agencyId) || !Number.isInteger(ticketTypeId)) {
    throw new TicketingError(400, "Claims QR non validi");
  }

  return {
    v: 1,
    typ: "gtfs-ticket",
    ticketCode,
    bookingCode,
    cityId,
    agencyId,
    ticketTypeId,
    issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
    nonce
  };
}

function decodeLegacyClaims(encodedPayload: string): TicketQrClaims {
  let claims: unknown;

  try {
    claims = JSON.parse(fromBase64Url(encodedPayload).toString("utf8"));
  } catch {
    throw new TicketingError(400, "Payload QR non valido");
  }

  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new TicketingError(400, "Payload QR non valido");
  }

  const value = claims as Partial<TicketQrClaims>;

  if (
    value.v !== 1 ||
    value.typ !== "gtfs-ticket" ||
    typeof value.ticketCode !== "string" ||
    typeof value.bookingCode !== "string" ||
    typeof value.issuedAt !== "string" ||
    typeof value.nonce !== "string"
  ) {
    throw new TicketingError(400, "Claims QR non validi");
  }

  return {
    v: 1,
    typ: "gtfs-ticket",
    ticketCode: value.ticketCode,
    bookingCode: value.bookingCode,
    cityId: normalizeInteger(value.cityId, "cityId"),
    agencyId: normalizeInteger(value.agencyId, "agencyId"),
    ticketTypeId: normalizeInteger(value.ticketTypeId, "ticketTypeId"),
    issuedAt: parseIssuedAt(value.issuedAt),
    nonce: value.nonce
  };
}

export function issueSignedTicketQr(input: Omit<TicketQrClaims, "v" | "typ" | "nonce">): string {
  const issuedAt = parseIssuedAt(input.issuedAt);
  const cityId = normalizeInteger(input.cityId, "cityId");
  const agencyId = normalizeInteger(input.agencyId, "agencyId");
  const ticketTypeId = normalizeInteger(input.ticketTypeId, "ticketTypeId");
  const issuedAtSeconds = Math.floor(new Date(issuedAt).getTime() / 1000);
  const nonce = randomBytes(4).toString("base64url");
  const compactPayload = [
    "1",
    input.ticketCode,
    input.bookingCode,
    cityId.toString(36),
    agencyId.toString(36),
    ticketTypeId.toString(36),
    issuedAtSeconds.toString(36),
    nonce
  ].join("|");
  const encodedPayload = toBase64Url(compactPayload);
  const signature = signTicketPayload(encodedPayload);

  return `${QR_TOKEN_PREFIX}.${encodedPayload}.${signature}`;
}

export function verifySignedTicketQr(token: string): TicketQrClaims {
  const normalized = token.trim();
  const [prefix, encodedPayload, encodedSignature] = normalized.split(".");

  if (prefix !== QR_TOKEN_PREFIX || !encodedPayload || !encodedSignature) {
    throw new TicketingError(400, "QR ticket non valido");
  }

  const expectedSignature = Buffer.from(signTicketPayload(encodedPayload));
  const expectedLegacySignature = Buffer.from(signTicketPayloadLegacy(encodedPayload));
  const receivedSignature = Buffer.from(encodedSignature);

  const matchesCurrent =
    expectedSignature.length !== receivedSignature.length ||
    !timingSafeEqual(expectedSignature, receivedSignature)
      ? false
      : true;
  const matchesLegacy =
    expectedLegacySignature.length === receivedSignature.length &&
    timingSafeEqual(expectedLegacySignature, receivedSignature);

  if (!matchesCurrent && !matchesLegacy) {
    throw new TicketingError(400, "Firma QR non valida");
  }

  return decodeCompactClaims(encodedPayload) ?? decodeLegacyClaims(encodedPayload);
}

function computeValidationOutcome(ticket: TicketValidationRow, now: Date): ValidationOutcome {
  if (!ticket.first_validated_at) {
    return "valid";
  }

  if (!ticket.valid_until) {
    return "expired";
  }

  return now.getTime() <= new Date(ticket.valid_until).getTime() ? "duplicate" : "expired";
}

export async function validateTicketWithClient(client: PoolClient, input: TicketValidationInput) {
  const claims = input.qrToken ? verifySignedTicketQr(input.qrToken) : null;
  const ticketCode = input.ticketCode?.trim() || claims?.ticketCode;

  if (!ticketCode) {
    throw new TicketingError(400, "ticketCode o qrToken obbligatorio");
  }

  const ticketResult = await client.query<TicketValidationRow>(
    `
    SELECT
      t.ticket_id,
      t.ticket_code,
      b.booking_code,
      t.city_id,
      tt.agency_id,
      t.ticket_type_id,
      t.status,
      t.first_validated_at::text,
      t.valid_until::text,
      tt.duration_minutes,
      t.qr_payload
    FROM ticket t
    JOIN booking b ON b.booking_id = t.booking_id
    JOIN ticket_type tt ON tt.ticket_type_id = t.ticket_type_id
    WHERE t.ticket_code = $1
    FOR UPDATE
    `,
    [ticketCode]
  );

  if (ticketResult.rowCount === 0) {
    throw new TicketingError(404, "Ticket non trovato");
  }

  const ticket = ticketResult.rows[0];

  if (claims) {
    if (
      claims.ticketCode !== ticket.ticket_code ||
      claims.bookingCode !== ticket.booking_code ||
      claims.cityId !== ticket.city_id ||
      claims.agencyId !== ticket.agency_id ||
      claims.ticketTypeId !== ticket.ticket_type_id
    ) {
      throw new TicketingError(400, "QR ticket non coerente con il titolo emesso");
    }

    if (!ticket.qr_payload || ticket.qr_payload !== input.qrToken) {
      throw new TicketingError(400, "QR ticket non riconosciuto");
    }
  }

  if (ticket.status !== "ISSUED") {
    throw new TicketingError(409, "Ticket non valido per la validazione");
  }

  const nowResult = await client.query<{ now_ts: string }>("SELECT NOW()::text AS now_ts");
  const now = new Date(nowResult.rows[0].now_ts);
  const outcome = computeValidationOutcome(ticket, now);

  await client.query(
    `
    INSERT INTO validation (
      city_id,
      ticket_id,
      validated_at,
      validator_device_id,
      validator_device,
      stop_id,
      segment_id,
      result
    )
    VALUES ($1, $2, NOW(), $3, $3, $4, $5, $6)
    `,
    [
      ticket.city_id,
      ticket.ticket_id,
      input.validatorDevice?.trim() || "api-validator",
      input.stopId ?? null,
      input.segmentId ?? null,
      outcome
    ]
  );

  let firstValidatedAt = ticket.first_validated_at;
  let validUntil = ticket.valid_until;

  if (!ticket.first_validated_at && outcome === "valid") {
    const updateResult = await client.query<{ first_validated_at: string; valid_until: string }>(
      `
      UPDATE ticket
      SET
        first_validated_at = NOW(),
        valid_until = NOW() + ($2 * INTERVAL '1 minute')
      WHERE ticket_id = $1
      RETURNING first_validated_at::text, valid_until::text
      `,
      [ticket.ticket_id, ticket.duration_minutes]
    );

    firstValidatedAt = updateResult.rows[0].first_validated_at;
    validUntil = updateResult.rows[0].valid_until;
  }

  const isValid = validUntil ? now.getTime() <= new Date(validUntil).getTime() : false;

  if (outcome === "expired") {
    throw new TicketingError(409, "Ticket scaduto");
  }

  return {
    ticketCode: ticket.ticket_code,
    cityId: ticket.city_id,
    agencyId: ticket.agency_id,
    firstValidatedAt,
    validUntil,
    isValid,
    durationMinutes: ticket.duration_minutes,
    validationResult: outcome
  };
}

export function asTicketingError(error: unknown): TicketingError | null {
  return error instanceof TicketingError ? error : null;
}
