import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { parseGtfsArchive } from "@/lib/gtfs-builder-parser";
import { buildRoundTripArchive, sha256Buffer } from "@/lib/gtfs-roundtrip";

type CsvRow = Record<string, string>;

function fixtureArchive(): Buffer {
  const zip = new AdmZip();
  const add = (name: string, content: string) => zip.addFile(name, Buffer.from(content, "utf8"));
  add("agency.txt", "agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_email\r\nA 1,Original Transit,https://example.test,Europe/Rome,it,ops@example.test\r\n");
  add("stops.txt", "stop_id,stop_name,stop_lat,stop_lon,platform_code,location_type,parent_station\r\nSTATION,Stazione,,,P,1,\r\nS1,Prima,41.1,16.8,1,0,STATION\r\nS2,Seconda,41.2,16.9,2,0,STATION\r\n");
  add("routes.txt", "route_id,agency_id,route_short_name,route_long_name,route_type,route_desc\r\nR1,A 1,1,Centro,3,Campo non gestito\r\n");
  add("calendar.txt", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\r\nWK,1,1,1,1,1,0,0,20260101,20261231\r\n");
  add("calendar_dates.txt", "service_id,date,exception_type,holiday_name\r\nWK,20260815,2,Ferragosto\r\nWK,20260816,1,Servizio speciale\r\n");
  add("trips.txt", "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id,trip_note\r\nR1,WK,T1,Seconda,0,PATH_1,originale\r\n");
  add("stop_times.txt", "trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled,stop_note\r\nT1,08:00:00,08:00:00,S1,10,0,inizio\r\nT1,08:10:00,08:10:00,S2,20,14.2,fine\r\n");
  add("shapes.txt", "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled,shape_note\r\nPATH_1,41.1,16.8,1,0,a\r\nPATH_1,41.15,16.85,2,7.1,b\r\nPATH_1,41.2,16.9,3,14.2,c\r\n");
  add("transfers.txt", "from_stop_id,to_stop_id,transfer_type,min_transfer_time\r\nS1,S2,2,180\r\n");
  add("private_extension.txt", "vendor,payload\r\nacme,unchanged bytes: àèì\r\n");
  return zip.toBuffer();
}

function file(zipBuffer: Buffer, name: string): Buffer {
  const entry = new AdmZip(zipBuffer).getEntries().find((candidate) => candidate.entryName === name);
  assert.ok(entry, `${name} must exist`);
  return entry.getData();
}

function rows(zipBuffer: Buffer, name: string): CsvRow[] {
  return parse(file(zipBuffer, name).toString("utf8"), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true
  }) as CsvRow[];
}

test("an opened, unchanged feed remains byte-identical", () => {
  const source = fixtureArchive();
  const draft = parseGtfsArchive(source, { cityCode: "TST", cityName: "Test" });
  const result = buildRoundTripArchive(draft, source);
  assert.equal(result.mode, "original");
  assert.equal(result.outputSha256, sha256Buffer(source));
  assert.deepEqual(result.buffer, source);
});

test("an edit preserves unmanaged files, columns, exceptions, and shapes", () => {
  const source = fixtureArchive();
  const draft = parseGtfsArchive(source, { cityCode: "TST", cityName: "Test" });
  const changed = {
    ...draft,
    agencies: draft.agencies.map((agency) => agency.id === "A 1" ? { ...agency, name: "Transit aggiornato" } : agency)
  };
  const result = buildRoundTripArchive(changed, source);

  assert.equal(result.mode, "merged");
  assert.deepEqual(file(result.buffer, "transfers.txt"), file(source, "transfers.txt"));
  assert.deepEqual(file(result.buffer, "private_extension.txt"), file(source, "private_extension.txt"));

  const agency = rows(result.buffer, "agency.txt")[0];
  assert.equal(agency.agency_name, "Transit aggiornato");
  assert.equal(agency.agency_id, "A 1");
  assert.equal(agency.agency_email, "ops@example.test");

  const stops = rows(result.buffer, "stops.txt");
  assert.equal(stops.find((stop) => stop.stop_id === "STATION")?.location_type, "1");
  assert.equal(stops.find((stop) => stop.stop_id === "STATION")?.stop_lat, "");

  const stopTimes = rows(result.buffer, "stop_times.txt");
  assert.deepEqual(stopTimes.map((row) => [row.stop_sequence, row.stop_note]), [["10", "inizio"], ["20", "fine"]]);

  const exceptions = rows(result.buffer, "calendar_dates.txt");
  assert.deepEqual(exceptions.map((row) => [row.date, row.exception_type, row.holiday_name]), [
    ["20260815", "2", "Ferragosto"],
    ["20260816", "1", "Servizio speciale"]
  ]);

  const shapes = rows(result.buffer, "shapes.txt");
  assert.equal(shapes.length, 3);
  assert.deepEqual(shapes.map((row) => row.shape_note), ["a", "b", "c"]);
  assert.equal(rows(result.buffer, "trips.txt")[0].shape_id, "PATH_1");
});

const bariPath = path.join(process.cwd(), "data", "gtfs", "incoming", "uploads", "BA_1787643751675.zip");
test("the real Bari feed passes a byte-identical round trip", { skip: !existsSync(bariPath) }, () => {
  const source = readFileSync(bariPath);
  const draft = parseGtfsArchive(source, { cityCode: "BA", cityName: "Bari" });
  const result = buildRoundTripArchive(draft, source);
  assert.equal(draft.services.reduce((total, service) => total + (service.exceptions?.length ?? 0), 0), 634);
  assert.equal(result.mode, "original");
  assert.deepEqual(result.buffer, source);
});
