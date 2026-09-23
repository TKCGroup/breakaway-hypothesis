import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

/** Official NHC active tropical cyclone status (Atlantic + EPAC + CPAC). */
export const NHC_CURRENT_STORMS_URL =
  "https://www.nhc.noaa.gov/CurrentStorms.json";

const USER_AGENT =
  "breakaway-hypothesis-watcher/0.2 (https://github.com/TKCGroup/breakaway-hypothesis)";

const CLASSIFICATION_LABELS: Record<string, string> = {
  HU: "Hurricane",
  TS: "Tropical Storm",
  TD: "Tropical Depression",
  STS: "Subtropical Storm",
  SS: "Subtropical Storm",
  SD: "Subtropical Depression",
  PTC: "Potential Tropical Cyclone",
  EX: "Post-Tropical Cyclone",
  LO: "Remnant Low",
  WV: "Tropical Wave",
  DB: "Disturbance",
  IN: "Inland"
};

export async function fetchNhcCurrentStorms(
  now = new Date()
): Promise<NormalizedEvent[]> {
  const response = await fetch(NHC_CURRENT_STORMS_URL, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(
      `NHC CurrentStorms failed: ${response.status} ${response.statusText}`
    );
  }
  const data = (await response.json()) as { activeStorms?: unknown[] };
  return (data.activeStorms ?? []).map((storm, index) =>
    normalizeNhcStorm(storm, now, index)
  );
}

export function normalizeNhcStorm(
  raw: unknown,
  ingestTime = new Date(),
  fallbackIndex = 0
): NormalizedEvent {
  const storm =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const externalId =
    stringField(storm, "id") ??
    `nhc:${fallbackIndex}:${JSON.stringify(raw).slice(0, 80)}`;
  const name = stringField(storm, "name") ?? "Unnamed";
  const classification =
    stringField(storm, "classification")?.toUpperCase() ?? "UNK";
  const classLabel =
    CLASSIFICATION_LABELS[classification] ?? `Cyclone (${classification})`;
  const basin = basinFromStormId(externalId, stringField(storm, "binNumber"));
  const intensityKt = numberField(storm, "intensity");
  const pressureMb = numberField(storm, "pressure");
  const lat = numberField(storm, "latitudeNumeric") ?? parseHemisphereCoord(
    stringField(storm, "latitude"),
    "NS"
  );
  const lon = numberField(storm, "longitudeNumeric") ?? parseHemisphereCoord(
    stringField(storm, "longitude"),
    "EW"
  );
  const lastUpdate =
    dateField(storm, "lastUpdate") ??
    productTime(storm, "publicAdvisory") ??
    ingestTime;
  const publicAdvisory = objectField(storm, "publicAdvisory");
  const officialUrl =
    stringField(publicAdvisory, "url") ??
    `https://www.nhc.noaa.gov/`;
  const movementDir = numberField(storm, "movementDir");
  const movementSpeed = numberField(storm, "movementSpeed");
  const severityParts = [
    classification,
    intensityKt !== undefined ? `${intensityKt} kt` : undefined,
    pressureMb !== undefined ? `${pressureMb} mb` : undefined,
    basin
  ].filter(Boolean);

  const movement =
    movementDir !== undefined && movementSpeed !== undefined
      ? `Moving ${movementDir}° at ${movementSpeed} mph.`
      : undefined;

  return {
    id: stableId("nhc_current_storms", externalId),
    source: "nhc_current_storms",
    externalId,
    eventType: "tropical_cyclone",
    title: `${classLabel} ${name}`,
    eventTime: lastUpdate,
    sourceUpdatedAt: lastUpdate,
    ingestTime,
    lat,
    lon,
    magnitude: intensityKt,
    severity: severityParts.join("/"),
    officialUrl,
    body: [
      `${classLabel} ${name} (${externalId.toUpperCase()}, ${basin}).`,
      intensityKt !== undefined ? `Max sustained winds ${intensityKt} kt.` : undefined,
      pressureMb !== undefined ? `Minimum pressure ${pressureMb} mb.` : undefined,
      movement,
      "Position and intensity from NOAA National Hurricane Center CurrentStorms.json."
    ]
      .filter(Boolean)
      .join(" "),
    rawJson: raw
  };
}

function basinFromStormId(
  stormId: string,
  binNumber: string | undefined
): string {
  const id = stormId.toLowerCase();
  if (id.startsWith("ep") || binNumber?.toUpperCase().startsWith("EP")) {
    return "EPAC";
  }
  if (id.startsWith("cp") || binNumber?.toUpperCase().startsWith("CP")) {
    return "CPAC";
  }
  if (id.startsWith("al") || binNumber?.toUpperCase().startsWith("AT")) {
    return "Atlantic";
  }
  return "NHC";
}

function parseHemisphereCoord(
  value: string | undefined,
  hemispheres: "NS" | "EW"
): number | undefined {
  if (!value) return undefined;
  const match = value
    .trim()
    .match(new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)\\s*([${hemispheres}])$`, "i"));
  if (!match) return undefined;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return undefined;
  const hemi = match[2]!.toUpperCase();
  if (hemi === "S" || hemi === "W") return -magnitude;
  return magnitude;
}

function productTime(
  storm: Record<string, unknown>,
  field: string
): Date | undefined {
  const product = objectField(storm, field);
  return (
    dateField(product, "issuance") ?? dateField(product, "fileUpdateTime")
  );
}

function objectField(
  obj: Record<string, unknown>,
  name: string
): Record<string, unknown> {
  const value = obj[name];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(
  obj: Record<string, unknown>,
  name: string
): string | undefined {
  const value = obj[name];
  if (typeof value === "string" && value.length) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberField(
  obj: Record<string, unknown>,
  name: string
): number | undefined {
  const value = obj[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function dateField(
  obj: Record<string, unknown>,
  name: string
): Date | undefined {
  const value = obj[name];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function stableId(source: string, externalId: string): string {
  return createHash("sha256")
    .update(`${source}:${externalId}`)
    .digest("hex")
    .slice(0, 24);
}
