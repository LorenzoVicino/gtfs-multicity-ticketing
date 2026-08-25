import { createGtfsArchive } from "@/lib/gtfs-builder-archive";
import { safeGtfsId, validateGtfsDraft } from "@/lib/gtfs-builder-model";
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

    const archive = createGtfsArchive({ ...draft, updatedAt: new Date().toISOString() });
    const cityCode = safeGtfsId(draft.project.cityCode.toUpperCase(), "GTFS");

    return new Response(new Uint8Array(archive), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${cityCode}_gtfs.zip"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return Response.json(
      {
        error: "Creazione archivio GTFS fallita.",
        details: error instanceof Error ? error.message : "Errore sconosciuto"
      },
      { status: 500 }
    );
  }
}
