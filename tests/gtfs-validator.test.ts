import assert from "node:assert/strict";
import test from "node:test";
import { validateGtfsArchiveCanonical } from "@/lib/gtfs-validator";

test("normalizes the MobilityData report and sends countryCode as a query parameter", async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.GTFS_VALIDATOR_URL;
  const previousCountry = process.env.GTFS_VALIDATOR_COUNTRY_CODE;
  let requestedUrl = "";
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      summary: {
        validatorVersion: "8.0.1",
        validatedAt: "2026-08-25T12:00:00Z",
        validationTimeSeconds: 1.25,
        files: ["agency.txt", "stops.txt"],
        counts: { Stops: 2, Routes: 1 }
      },
      notices: [
        { code: "fatal_example", severity: "ERROR", totalNotices: 2, sampleNotices: [{ csvRowNumber: 2 }] },
        { code: "warning_example", severity: "WARNING", totalNotices: 3 },
        { code: "info_example", severity: "INFO", totalNotices: 4 }
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  process.env.GTFS_VALIDATOR_URL = "http://validator.test/v2/";
  process.env.GTFS_VALIDATOR_COUNTRY_CODE = "it";

  try {
    const result = await validateGtfsArchiveCanonical(Buffer.from("zip"), "test.zip");
    assert.equal(requestedUrl, "http://validator.test/v2/validate-upload?countryCode=IT");
    assert.equal(result.validatorVersion, "8.0.1");
    assert.equal(result.valid, false);
    assert.deepEqual([result.errors, result.warnings, result.infos], [2, 3, 4]);
    assert.deepEqual(result.counts, { Stops: 2, Routes: 1 });
    assert.equal(result.notices[0].code, "fatal_example");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.GTFS_VALIDATOR_URL;
    else process.env.GTFS_VALIDATOR_URL = previousUrl;
    if (previousCountry === undefined) delete process.env.GTFS_VALIDATOR_COUNTRY_CODE;
    else process.env.GTFS_VALIDATOR_COUNTRY_CODE = previousCountry;
  }
});
