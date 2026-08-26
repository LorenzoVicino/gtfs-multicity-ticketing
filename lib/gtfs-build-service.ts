import { buildRoundTripArchive } from "@/lib/gtfs-roundtrip";
import { loadGtfsWorkspace } from "@/lib/gtfs-workspace";
import type { GtfsBuilderDraft } from "@/types/gtfs-builder";

export async function buildGtfsDraftArchive(draft: GtfsBuilderDraft) {
  const sourceArchive = await loadGtfsWorkspace(draft.sourceArchive);
  return buildRoundTripArchive({ ...draft, updatedAt: new Date().toISOString() }, sourceArchive);
}
