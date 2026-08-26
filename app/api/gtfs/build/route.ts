import { buildGtfsDraftArchive } from "@/lib/gtfs-build-service";
import { safeGtfsId, validateGtfsDraft } from "@/lib/gtfs-builder-model";
import { GtfsValidatorUnavailableError, validateGtfsArchiveCanonical } from "@/lib/gtfs-validator";
import type { GtfsBuilderDraft } from "@/types/gtfs-builder";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const draft = (await request.json()) as GtfsBuilderDraft;
    if (!draft || draft.version !== 2 || !draft.project || !Array.isArray(draft.agencies) || !Array.isArray(draft.services) || !Array.isArray(draft.stops) || !Array.isArray(draft.routes) || !Array.isArray(draft.trips)) {
      return Response.json({ error: "Bozza GTFS non valida." }, { status: 400 });
    }

    const issues = validateGtfsDraft(draft);
    if (issues.length > 0) {
      return Response.json({ error: "Completa il GTFS prima di esportarlo.", issues }, { status: 422 });
    }

    const archive = await buildGtfsDraftArchive(draft);
    const canonical = await validateGtfsArchiveCanonical(archive.buffer, `${draft.project.cityCode || "GTFS"}_gtfs.zip`);
    if (!canonical.valid) {
      return Response.json({
        error: "Il validatore ufficiale MobilityData ha trovato errori bloccanti.",
        canonical
      }, { status: 422 });
    }
    const cityCode = safeGtfsId(draft.project.cityCode.toUpperCase(), "GTFS");

    return new Response(new Uint8Array(archive.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${cityCode}_gtfs.zip"`,
        "Cache-Control": "no-store",
        "X-GTFS-Roundtrip-Mode": archive.mode,
        "X-GTFS-Validator-Version": encodeURIComponent(canonical.validatorVersion),
        "X-GTFS-Validation-Warnings": String(canonical.warnings),
        "X-GTFS-Validation-Infos": String(canonical.infos)
      }
    });
  } catch (error) {
    const validatorUnavailable = error instanceof GtfsValidatorUnavailableError;
    return Response.json(
      {
        error: validatorUnavailable ? "Validazione canonica non disponibile." : "Creazione archivio GTFS fallita.",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: validatorUnavailable ? 503 : 500 }
    );
  }
}
