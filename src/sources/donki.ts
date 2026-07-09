import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

export function donkiUrl(kind: "CME" | "FLR" | "GST" | "IPS" | "SEP" | "HSS", startDate: Date, endDate: Date, apiKey = "DEMO_KEY"): string {
  const query = new URLSearchParams({
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    api_key: apiKey
  });
  return `https://api.nasa.gov/DONKI/${kind}?${query.toString()}`;
}

export function normalizeDonkiEvent(kind: string, raw: Record<string, unknown>, ingestTime = new Date()): NormalizedEvent {
  const externalId = stringField(raw, ["activityID", "flrID", "gstID", "ipsID", "sepID", "hssID"]) ?? `${kind}:${JSON.stringify(raw).slice(0, 80)}`;
  const eventTime =
    dateField(raw, ["startTime", "beginTime", "eventTime", "peakTime", "submissionTime"]) ?? ingestTime;
  const sourceUpdatedAt = dateField(raw, ["submissionTime", "link"]) ?? ingestTime;
  return {
    id: stableId("nasa_donki", externalId),
    source: "nasa_donki",
    externalId,
    eventType: "space_weather",
    title: `NASA DONKI ${kind} ${externalId}`,
    eventTime,
    sourceUpdatedAt,
    ingestTime,
    severity: kind,
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
