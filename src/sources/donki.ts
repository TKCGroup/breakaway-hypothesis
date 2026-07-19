import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

export const DONKI_KINDS = ["CME", "FLR", "GST", "IPS", "SEP", "HSS"] as const;
export type DonkiKind = (typeof DONKI_KINDS)[number];

export function donkiUrl(kind: DonkiKind, startDate: Date, endDate: Date, apiKey = "DEMO_KEY"): string {
  const query = new URLSearchParams({
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    api_key: apiKey
  });
  return `https://api.nasa.gov/DONKI/${kind}?${query.toString()}`;
}

export async function fetchDonkiEvents(
  apiKey = "DEMO_KEY",
  now = new Date(),
  kinds: readonly DonkiKind[] = DONKI_KINDS
): Promise<NormalizedEvent[]> {
  const endDate = now;
  const startDate = new Date(now.getTime() - 7 * 24 * 3_600_000);
  const batches = await Promise.allSettled(
    kinds.map(async (kind) => {
      const rows = await fetchDonkiRows(kind, donkiUrl(kind, startDate, endDate, apiKey));
      return rows.map((row) => normalizeDonkiEvent(kind, row, now));
    })
  );
  for (const [index, batch] of batches.entries()) {
    if (batch.status === "rejected") {
      console.error(batch.reason instanceof Error ? batch.reason.message : `NASA DONKI ${kinds[index]} failed`);
    }
  }
  return batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
}

async function fetchDonkiRows(kind: DonkiKind, url: string, maxAttempts = 3): Promise<Record<string, unknown>[]> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) {
      return (await response.json()) as Record<string, unknown>[];
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
    officialUrl: typeof raw.link === "string" ? raw.link : "https://api.nasa.gov/DONKI/",
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
