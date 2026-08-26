import { buildGtfsDraftArchive } from "@/lib/gtfs-build-service";
import { validateGtfsDraft } from "@/lib/gtfs-builder-model";
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
      return Response.json({ error: "Completa il GTFS prima di validarlo.", issues }, { status: 422 });
    }

    const archive = await buildGtfsDraftArchive(draft);
    const validation = await validateGtfsArchiveCanonical(archive.buffer, `${draft.project.cityCode || "GTFS"}_gtfs.zip`);
    return Response.json({
      validation,
      roundTrip: {
        mode: archive.mode,
        originalSha256: archive.originalSha256,
        outputSha256: archive.outputSha256
      }
    });
  } catch (error) {
    const validatorUnavailable = error instanceof GtfsValidatorUnavailableError;
    return Response.json({
      error: validatorUnavailable ? "Validazione canonica non disponibile." : "Validazione GTFS fallita.",
      details: error instanceof Error ? error.message : "Errore sconosciuto"
    }, { status: validatorUnavailable ? 503 : 500 });
  }
}
