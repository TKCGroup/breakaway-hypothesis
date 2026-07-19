import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

export const SWPC_ENDPOINTS = {
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  goesXray: "https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json",
  solarWindPlasma: "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json",
  solarWindMag: "https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json",
  alerts: "https://services.swpc.noaa.gov/products/alerts.json"
} as const;

export function normalizeSwpcKpRow(row: unknown, ingestTime = new Date()): NormalizedEvent | undefined {
  const [timeTag, kpValue] = Array.isArray(row)
    ? [row[0], row[1]]
    : row && typeof row === "object"
      ? [(row as Record<string, unknown>).time_tag, (row as Record<string, unknown>).Kp]
      : [undefined, undefined];
  const eventTime = parseSwpcTimestamp(timeTag);
  const kp = Number(kpValue);
  if (Number.isNaN(eventTime.getTime()) || !Number.isFinite(kp)) {
    return undefined;
  }
  return {
    id: stableId("swpc_kp", `${eventTime.toISOString()}:${kp}`),
    source: "swpc_kp",
    externalId: `${eventTime.toISOString()}:${kp}`,
    eventType: "space_weather",
    title: `NOAA/SWPC planetary K-index ${kp}`,
    eventTime,
    sourceUpdatedAt: ingestTime,
    ingestTime,
    severity: kp >= 6 ? "Kp6/G2" : kp >= 5 ? "Kp5/G1" : `Kp${kp}`,
    officialUrl: SWPC_ENDPOINTS.kp,
    rawJson: { row, kp }
  };
}

export function normalizeSwpcGoesXray(raw: Record<string, unknown>, ingestTime = new Date()): NormalizedEvent | undefined {
  const timeTag = raw.time_tag ?? raw.timeTag;
  const flux = Number(raw.flux);
  const eventTime = new Date(String(timeTag));
  if (Number.isNaN(eventTime.getTime()) || !Number.isFinite(flux)) {
    return undefined;
  }
  const flareClass = xrayFluxToClass(flux);
  return {
    id: stableId("swpc_goes_xray", `${eventTime.toISOString()}:${flux}`),
    source: "swpc_goes_xray",
    externalId: `${eventTime.toISOString()}:${flux}`,
    eventType: "space_weather",
    title: `NOAA/SWPC GOES X-ray flux ${flareClass}`,
    eventTime,
    sourceUpdatedAt: ingestTime,
    ingestTime,
    severity: flareClass,
    officialUrl: SWPC_ENDPOINTS.goesXray,
    rawJson: raw
  };
}

export async function fetchSwpcKp(now = new Date()): Promise<NormalizedEvent[]> {
  const response = await fetch(SWPC_ENDPOINTS.kp, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`SWPC Kp failed: ${response.status} ${response.statusText}`);
  }
  const rows = (await response.json()) as unknown[];
  const dataRows = Array.isArray(rows[0]) ? rows.slice(1) : rows;
  return dataRows.flatMap((row) => {
    const event = normalizeSwpcKpRow(row, now);
    return event ? [event] : [];
  });
}

function xrayFluxToClass(flux: number): string {
  if (flux >= 1e-4) return `X${formatFlux(flux / 1e-4)}`;
  if (flux >= 1e-5) return `M${formatFlux(flux / 1e-5)}`;
  if (flux >= 1e-6) return `C${formatFlux(flux / 1e-6)}`;
  if (flux >= 1e-7) return `B${formatFlux(flux / 1e-7)}`;
  return `A${formatFlux(flux / 1e-8)}`;
}

function formatFlux(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function parseSwpcTimestamp(value: unknown): Date {
  const raw = String(value);
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasZone ? raw : `${raw}Z`);
}

function stableId(source: string, externalId: string): string {
  return createHash("sha256").update(`${source}:${externalId}`).digest("hex").slice(0, 24);
}
