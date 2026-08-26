import { getEditableGtfs } from "@/lib/gtfs-builder-store";
import { parseGtfsArchive } from "@/lib/gtfs-builder-parser";
import { loadPublishedGtfsSource, registerGtfsWorkspace } from "@/lib/gtfs-workspace";

type Params = { params: Promise<{ cityCode: string }> };

export const runtime = "nodejs";

export async function GET(_: Request, { params }: Params) {
  try {
    const { cityCode } = await params;
    const databaseDraft = await getEditableGtfs(cityCode);
    if (!databaseDraft) return Response.json({ error: "Città o feed modificabile non trovato." }, { status: 404 });

    const published = await loadPublishedGtfsSource(cityCode);
    if (!published) {
      return Response.json({
        draft: databaseDraft,
        losslessWarning: "Archivio sorgente non disponibile: questa città usa la proiezione conservata nel database."
      });
    }

    try {
      const draft = parseGtfsArchive(published.buffer, databaseDraft.project);
      const sourceArchive = await registerGtfsWorkspace(published.buffer, published.fileName, draft);
      return Response.json({ draft: { ...draft, sourceArchive } });
    } catch (error) {
      return Response.json({
        draft: databaseDraft,
        losslessWarning: `Archivio sorgente non riapribile: ${error instanceof Error ? error.message : "errore sconosciuto"}`
      });
    }
  } catch (error) {
    return Response.json({ error: "Impossibile aprire questa città nello Studio.", details: error instanceof Error ? error.message : "Errore sconosciuto" }, { status: 500 });
  }
}
