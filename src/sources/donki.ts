import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

export const DONKI_KINDS = ["CME", "FLR", "GST", "IPS", "SEP", "HSS"] as const;
export type DonkiKind = (typeof DONKI_KINDS)[number];

// CCMC moved DONKI on 2026-09-30: api.nasa.gov/DONKI/* now 301s to an HTML news page, which a
// redirect-following fetch read as 200 and parsed as no data (dark for 15 days, every run "success").
// The CCMC web service takes no API key; paths after /DONKI/ are unchanged.
export const DONKI_BASE = "https://ccmc.gsfc.nasa.gov/DONKI/WS/get";

export function donkiUrl(kind: DonkiKind, startDate: Date, endDate: Date): string {
  const query = new URLSearchParams({
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10)
  });
  return `${DONKI_BASE}/${kind}?${query.toString()}`;
}

// `_apiKey` is kept for the worker's call signature; the CCMC endpoint does not use one.
export async function fetchDonkiEvents(
  _apiKey?: string,
  now = new Date(),
  kinds: readonly DonkiKind[] = DONKI_KINDS
): Promise<NormalizedEvent[]> {
  const endDate = now;
  const startDate = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const batches = await Promise.allSettled(
    kinds.map(async (kind) => {
      const rows = await fetchDonkiRows(kind, donkiUrl(kind, startDate, endDate));
      return rows.map((row) => normalizeDonkiEvent(kind, row, now));
    })
  );
  const failures: string[] = [];
  for (const [index, batch] of batches.entries()) {
    if (batch.status === "rejected") {
      const message = batch.reason instanceof Error ? batch.reason.message : String(batch.reason);
      const line = message.startsWith("NASA DONKI") ? message : `NASA DONKI ${kinds[index]}: ${message}`;
      failures.push(line);
      console.error(line);
    }
  }
  // Every kind failing is an outage, not an empty week: reject so the source run records "error".
  if (kinds.length > 0 && failures.length === kinds.length) {
    throw new Error(`NASA DONKI: all ${kinds.length} kinds failed (${failures.join("; ")})`.slice(0, 600));
  }
  return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
}

async function fetchDonkiRows(kind: DonkiKind, url: string, maxAttempts = 3): Promise<Record<string, unknown>[]> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Do not follow redirects: a moved endpoint must fail loudly, not resolve to someone's HTML page.
    const response = await fetch(url, { cache: "no-store", redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`NASA DONKI ${kind} moved: ${response.status} -> ${response.headers.get("location") ?? "(no location)"}`);
    }
    if (response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        throw new Error(`NASA DONKI ${kind} returned ${contentType || "no content-type"}, not JSON`);
      }
      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        throw new Error(`NASA DONKI ${kind} returned ${body === null ? "null" : typeof body}, not an array`);
      }
      return body as Record<string, unknown>[];
    }

    lastError = new Error(`NASA DONKI ${kind} failed: ${response.status} ${response.statusText}`);
    if (response.status < 500 || attempt === maxAttempts) {
      break;
    }
    await sleep(attempt * 250);
  }

  throw lastError ?? new Error(`NASA DONKI ${kind} failed`);
}

export function normalizeDonkiEvent(kind: string, raw: Record<string, unknown>, ingestTime = new Date()): NormalizedEvent {
  const externalId = stringField(raw, ["activityID", "flrID", "gstID", "ipsID", "sepID", "hssID"]) ?? `${kind}:${JSON.stringify(raw).slice(0, 80)}`;
  const eventTime =
    dateField(raw, ["startTime", "beginTime", "eventTime", "peakTime", "submissionTime"]) ?? ingestTime;
  const sourceUpdatedAt = dateField(raw, ["submissionTime", "link"]) ?? ingestTime;
  const classType = stringField(raw, ["classType"]);
  return {
    id: stableId("nasa_donki", externalId),
    source: "nasa_donki",
    externalId,
    eventType: "space_weather",
    title: `NASA DONKI ${kind} ${externalId}`,
    eventTime,
    sourceUpdatedAt,
    ingestTime,
    severity: kind === "FLR" && classType ? classType : kind,
    officialUrl: typeof raw.link === "string" ? raw.link : "https://ccmc.gsfc.nasa.gov/DONKI/",
    rawJson: raw
  };
}

function stringField(obj: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function dateField(obj: Record<string, unknown>, names: string[]): Date | undefined {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return undefined;
}

function stableId(source: string, externalId: string): string {
  return createHash("sha256").update(`${source}:${externalId}`).digest("hex").slice(0, 24);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
