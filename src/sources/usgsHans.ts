import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../types.js";

export const HANS_ENDPOINTS = {
  elevatedVolcanoes: "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes",
  monitoredVolcanoes: "https://volcanoes.usgs.gov/hans-public/api/volcano/getMonitoredVolcanoes"
} as const;

export async function fetchHansElevatedVolcanoes(now = new Date()): Promise<NormalizedEvent[]> {
  const response = await fetch(HANS_ENDPOINTS.elevatedVolcanoes, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`USGS HANS elevated volcanoes failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as unknown[];
  return data.map((notice, index) => normalizeHansNotice(notice, now, index));
}

export async function fetchNewestHansNotice(vnumOrVolcanoCd: string, now = new Date()): Promise<NormalizedEvent> {
  const url = `https://volcanoes.usgs.gov/hans-public/api/volcano/newestForVolcano/${encodeURIComponent(vnumOrVolcanoCd)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`USGS HANS newest notice failed: ${response.status} ${response.statusText}`);
  }
  return normalizeHansNotice(await response.json(), now);
}

export function normalizeHansNotice(raw: unknown, ingestTime = new Date(), fallbackIndex = 0): NormalizedEvent {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const volcanoName = stringField(obj, ["volcanoName", "volcano_name", "name", "volcanoCd"]) ?? "Unknown volcano";
  const externalId =
    stringField(obj, ["id", "noticeId", "notice_id", "notice_identifier", "vnum", "volcanoCd"]) ??
    `${volcanoName}:${fallbackIndex}:${JSON.stringify(raw).slice(0, 80)}`;
  const eventTime =
    dateField(obj, ["sent_utc", "issueDate", "issued", "noticeDate", "startDate", "updateTime", "updated"]) ??
    ingestTime;
  const sourceUpdatedAt =
    dateField(obj, ["sent_utc", "updateTime", "updated", "issueDate", "issued", "noticeDate"]) ?? eventTime;
  const alertLevel = stringField(obj, ["alertLevel", "alert_level", "alert", "status"]);
  const colorCode = stringField(obj, ["colorCode", "color_code", "aviationColorCode"]);
  const severity = [alertLevel, colorCode].filter(Boolean).join("/") || "UNKNOWN";

  return {
    id: stableId("usgs_hans", externalId),
    source: "usgs_hans",
    externalId,
    eventType: "volcano_notice",
    title: `USGS HANS ${volcanoName}: ${severity}`,
    eventTime,
    sourceUpdatedAt,
    ingestTime,
    region: regionFromVolcanoName(volcanoName),
    severity,
    officialUrl: stringField(obj, ["notice_url", "url", "link"]) ?? "https://volcanoes.usgs.gov/hans-public/",
    rawJson: raw
  };
}

function regionFromVolcanoName(name: string): NormalizedEvent["region"] {
  const lower = name.toLowerCase();
  if (lower.includes("rainier")) return "CASCADE_VOLCANOES_RAINIER";
  if (lower.includes("helens")) return "CASCADE_VOLCANOES_ST_HELENS";
  if (lower.includes("yellowstone")) return "YELLOWSTONE";
  if (["hood", "adams", "baker"].some((token) => lower.includes(token))) return "CASCADE_VOLCANOES_HOOD_ADAMS_BAKER";
  return undefined;
}

function stringField(obj: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
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
