import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fingerprintGtfsDraft, inspectGtfsArchive, sha256Buffer } from "@/lib/gtfs-roundtrip";
import type { GtfsBuilderDraft, GtfsSourceArchive } from "@/types/gtfs-builder";

const WORKSPACE_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

function uploadsRoot(): string {
  return process.env.GTFS_UPLOADS_ROOT?.trim() || path.join(process.cwd(), "data", "gtfs", "incoming", "uploads");
}

function workspacesRoot(): string {
  return path.join(uploadsRoot(), "workspaces");
}

function publishedRoot(): string {
  return path.join(uploadsRoot(), "sources");
}

function safeFileName(value: string): string {
  const baseName = path.basename(value).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return baseName.toLowerCase().endsWith(".zip") ? baseName : `${baseName || "gtfs"}.zip`;
}

function safeCityCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 16);
}

async function cleanupExpiredWorkspaces(): Promise<void> {
  const root = workspacesRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const threshold = Date.now() - WORKSPACE_TTL_MS;
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) return;
    const filePath = path.join(root, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < threshold) await fs.unlink(filePath).catch(() => undefined);
  }));
}

export async function registerGtfsWorkspace(buffer: Buffer, fileName: string, draft: GtfsBuilderDraft): Promise<GtfsSourceArchive> {
  const root = workspacesRoot();
  await fs.mkdir(root, { recursive: true });
  await cleanupExpiredWorkspaces();
  const token = randomBytes(24).toString("base64url");
  await fs.writeFile(path.join(root, `${token}.zip`), buffer, { flag: "wx" });
  return {
    token,
    sha256: sha256Buffer(buffer),
    fileName: safeFileName(fileName),
    files: inspectGtfsArchive(buffer),
    originalFingerprint: fingerprintGtfsDraft(draft)
  };
}

export async function loadGtfsWorkspace(source: GtfsSourceArchive | undefined): Promise<Buffer | undefined> {
  if (!source) return undefined;
  if (!TOKEN_PATTERN.test(source.token) || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new Error("Riferimento all’archivio sorgente non valido.");
  }
  const buffer = await fs.readFile(path.join(workspacesRoot(), `${source.token}.zip`)).catch(() => null);
  if (!buffer) throw new Error("La sessione lossless è scaduta. Riapri il file GTFS originale.");
  if (sha256Buffer(buffer) !== source.sha256) throw new Error("L’archivio sorgente non supera il controllo di integrità.");
  return buffer;
}

export async function savePublishedGtfsSource(cityCode: string, buffer: Buffer): Promise<void> {
  const code = safeCityCode(cityCode);
  if (!code) throw new Error("City code non valido per l’archivio sorgente.");
  const root = publishedRoot();
  await fs.mkdir(root, { recursive: true });
  const destination = path.join(root, `${code}.zip`);
  const temporary = path.join(root, `${code}.${randomBytes(8).toString("hex")}.tmp`);
  await fs.writeFile(temporary, buffer, { flag: "wx" });
  await fs.rename(temporary, destination).catch(async (error) => {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  });
}

export async function loadPublishedGtfsSource(cityCode: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const code = safeCityCode(cityCode);
  if (!code) return null;
  const fileName = `${code}.zip`;
  const buffer = await fs.readFile(path.join(publishedRoot(), fileName)).catch(() => null);
  return buffer ? { buffer, fileName } : null;
}
