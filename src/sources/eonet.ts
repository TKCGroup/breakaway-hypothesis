import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

export const EONET_EVENTS_URL = "https://eonet.gsfc.nasa.gov/api/v3/events";

interface EonetGeometry {
  magnitudeValue?: unknown;
  magnitudeUnit?: unknown;
  magnitudeDescription?: unknown;
  date?: unknown;
  type?: unknown;
  coordinates?: unknown;
}

export async function fetchEonetEvents(now = new Date()): Promise<NormalizedEvent[]> {
  const query = new URLSearchParams({
    status: "all",
    days: "30",
    limit: "500"
  });
  const response = await fetch(`${EONET_EVENTS_URL}?${query.toString()}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(
      `NASA EONET failed: ${response.status} ${response.statusText}`
    );
  }
  const data = (await response.json()) as { events?: unknown[] };
  return (data.events ?? []).map((event, index) =>
    normalizeEonetEvent(event, now, index)
  );
}

export function normalizeEonetEvent(
  raw: unknown,
  ingestTime = new Date(),
  fallbackIndex = 0
): NormalizedEvent {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const externalId =
    stringField(obj, "id") ??
    `eonet:${fallbackIndex}:${JSON.stringify(raw).slice(0, 80)}`;
  const title = stringField(obj, "title") ?? `NASA EONET event ${externalId}`;
  const geometries = Array.isArray(obj.geometry)
    ? (obj.geometry as EonetGeometry[])
    : [];
  const latestGeometry = [...geometries].sort(
    (a, b) => dateValue(b.date) - dateValue(a.date)
  )[0];
  const eventTime = parseDate(latestGeometry?.date) ?? ingestTime;
  const closedAt = parseDate(obj.closed);
  const sourceUpdatedAt =
    closedAt && closedAt > eventTime ? closedAt : eventTime;
  const categories = Array.isArray(obj.categories)
    ? obj.categories
        .flatMap((category) =>
          category && typeof category === "object"
            ? [stringField(category as Record<string, unknown>, "title")]
            : []
        )
        .filter((category): category is string => Boolean(category))
    : [];
  const [lon, lat] =
    latestGeometry?.type === "Point" &&
    Array.isArray(latestGeometry.coordinates)
      ? latestGeometry.coordinates.map(Number)
      : [];

  return {
    id: stableId("nasa_eonet", externalId),
    source: "nasa_eonet",
    externalId,
    eventType: "natural_event",
    title,
    eventTime,
    sourceUpdatedAt,
    ingestTime,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    severity: categories.join("/") || "Natural event",
    officialUrl:
      stringField(obj, "link") ?? `${EONET_EVENTS_URL}/${externalId}`,
    body: stringField(obj, "description"),
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

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateValue(value: unknown): number {
  return parseDate(value)?.getTime() ?? 0;
}

function stableId(source: string, externalId: string): string {
  return createHash("sha256")
    .update(`${source}:${externalId}`)
    .digest("hex")
    .slice(0, 24);
}
