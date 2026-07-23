import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

export const NWS_ALERTS_URL =
  "https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&severity=Extreme,Severe";

const USER_AGENT =
  "breakaway-hypothesis-watcher/0.2 (https://github.com/TKCGroup/breakaway-hypothesis)";

export async function fetchNwsAlerts(
  now = new Date()
): Promise<NormalizedEvent[]> {
  const response = await fetch(NWS_ALERTS_URL, {
    cache: "no-store",
    headers: {
      accept: "application/geo+json",
      "user-agent": USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(
      `NWS active alerts failed: ${response.status} ${response.statusText}`
    );
  }
  const data = (await response.json()) as { features?: unknown[] };
  return (data.features ?? []).map((feature, index) =>
    normalizeNwsAlert(feature, now, index)
  );
}

export function normalizeNwsAlert(
  raw: unknown,
  ingestTime = new Date(),
  fallbackIndex = 0
): NormalizedEvent {
  const feature =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const properties =
    feature.properties && typeof feature.properties === "object"
      ? (feature.properties as Record<string, unknown>)
      : {};
  const externalId =
    stringField(properties, "id") ??
    stringField(feature, "id") ??
    `nws:${fallbackIndex}:${JSON.stringify(raw).slice(0, 80)}`;
  const eventName = stringField(properties, "event") ?? "Weather alert";
  const area = stringField(properties, "areaDesc");
  const eventTime =
    dateField(properties, ["onset", "effective", "sent"]) ?? ingestTime;
  const sourceUpdatedAt =
    dateField(properties, ["sent", "effective"]) ?? eventTime;
  const severity = stringField(properties, "severity");
  const certainty = stringField(properties, "certainty");
  const urgency = stringField(properties, "urgency");

  return {
    id: stableId("nws_alerts", externalId),
    source: "nws_alerts",
    externalId,
    eventType: "weather_alert",
    title: area ? `${eventName}: ${area}` : eventName,
    eventTime,
    sourceUpdatedAt,
    ingestTime,
    severity: [severity, certainty, urgency].filter(Boolean).join("/"),
    officialUrl:
      stringField(properties, "@id") ??
      stringField(feature, "id") ??
      "https://api.weather.gov/alerts/active",
    body:
      stringField(properties, "headline") ??
      stringField(properties, "description"),
    rawJson: raw
  };
}

function stringField(
  obj: Record<string, unknown>,
  name: string
): string | undefined {
  const value = obj[name];
  return typeof value === "string" && value.length ? value : undefined;
}

function dateField(
  obj: Record<string, unknown>,
  names: string[]
): Date | undefined {
  for (const name of names) {
    const value = obj[name];
    if (typeof value !== "string" && typeof value !== "number") {
      continue;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return undefined;
}

function stableId(source: string, externalId: string): string {
  return createHash("sha256")
    .update(`${source}:${externalId}`)
    .digest("hex")
    .slice(0, 24);
}
