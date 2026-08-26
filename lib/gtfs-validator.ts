import type { CanonicalGtfsNotice, CanonicalGtfsValidation } from "@/types/gtfs-builder";

type RawNotice = {
  code?: unknown;
  severity?: unknown;
  totalNotices?: unknown;
  sampleNotices?: unknown;
};

type RawValidation = {
  summary?: Record<string, unknown>;
  notices?: unknown;
};

const DEFAULT_VALIDATOR_URL = "http://127.0.0.1:8080/v2";
const DEFAULT_TIMEOUT_MS = 180_000;

export class GtfsValidatorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GtfsValidatorUnavailableError";
  }
}

function validatorBaseUrl(): string {
  return (process.env.GTFS_VALIDATOR_URL?.trim() || DEFAULT_VALIDATOR_URL).replace(/\/$/, "");
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function severity(value: unknown): CanonicalGtfsNotice["severity"] {
  const normalized = String(value ?? "INFO").toUpperCase();
  return normalized === "ERROR" || normalized === "WARNING" ? normalized : "INFO";
}

function normalizeNotice(value: unknown): CanonicalGtfsNotice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawNotice;
  const code = stringValue(raw.code);
  if (!code) return null;
  const sampleNotices = Array.isArray(raw.sampleNotices)
    ? raw.sampleNotices.filter((sample): sample is Record<string, unknown> => Boolean(sample) && typeof sample === "object")
    : undefined;
  return {
    code,
    severity: severity(raw.severity),
    totalNotices: Math.max(0, numberValue(raw.totalNotices) ?? sampleNotices?.length ?? 0),
    sampleNotices
  };
}

function summaryString(summary: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(summary[key]);
    if (value) return value;
  }
  return undefined;
}

function summaryNumber(summary: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberValue(summary[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeResult(raw: RawValidation): CanonicalGtfsValidation {
  const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  const notices = (Array.isArray(raw.notices) ? raw.notices : [])
    .map(normalizeNotice)
    .filter((notice): notice is CanonicalGtfsNotice => notice !== null)
    .sort((left, right) => {
      const rank = { ERROR: 0, WARNING: 1, INFO: 2 };
      return rank[left.severity] - rank[right.severity] || right.totalNotices - left.totalNotices;
    });
  const totals = (wanted: CanonicalGtfsNotice["severity"]) => notices
    .filter((notice) => notice.severity === wanted)
    .reduce((total, notice) => total + notice.totalNotices, 0);
  const files = Array.isArray(summary.files)
    ? summary.files.map((file) => String(file)).filter(Boolean)
    : [];
  const rawCounts = summary.counts && typeof summary.counts === "object" ? summary.counts as Record<string, unknown> : {};
  const counts = Object.fromEntries(Object.entries(rawCounts)
    .map(([key, value]) => [key, numberValue(value)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined));
  const errors = totals("ERROR");

  return {
    valid: errors === 0,
    validatorVersion: summaryString(summary, "validatorVersion", "validator_version", "version") ?? "MobilityData GTFS Validator",
    validatedAt: summaryString(summary, "validatedAt", "validated_at"),
    validationTimeSeconds: summaryNumber(summary, "validationTimeSeconds", "validation_time_seconds"),
    errors,
    warnings: totals("WARNING"),
    infos: totals("INFO"),
    files,
    counts,
    notices
  };
}

export async function validateGtfsArchiveCanonical(buffer: Buffer, fileName = "feed.zip"): Promise<CanonicalGtfsValidation> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/zip" }), fileName);
  const timeout = Number(process.env.GTFS_VALIDATOR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const countryCode = process.env.GTFS_VALIDATOR_COUNTRY_CODE?.trim().toUpperCase();
  const endpoint = new URL(`${validatorBaseUrl()}/validate-upload`);
  if (countryCode) endpoint.searchParams.set("countryCode", countryCode);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "errore di rete";
    throw new GtfsValidatorUnavailableError(`Validatore MobilityData non raggiungibile: ${details}`);
  }

  const responseText = await response.text();
  const payload = (() => {
    try {
      return JSON.parse(responseText) as RawValidation & { error?: unknown };
    } catch {
      return { error: responseText } as RawValidation & { error?: unknown };
    }
  })();
  if (!response.ok) {
    const details = stringValue(payload.error) ?? `HTTP ${response.status}`;
    if (response.status >= 500) throw new GtfsValidatorUnavailableError(`Validatore MobilityData non disponibile: ${details}`);
    throw new Error(`Il validatore MobilityData ha rifiutato il feed: ${details}`);
  }
  return normalizeResult(payload);
}
