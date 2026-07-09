import { createHash } from "node:crypto";
import type { NormalizedEvent, OfficialSource } from "../types.js";

export const TSUNAMI_FEEDS = {
  ntwc: "https://www.tsunami.gov/events/xml/PAAQAtom.xml",
  ptwc: "https://www.tsunami.gov/events/xml/PHEBAtom.xml"
} as const;

export async function fetchTsunamiFeed(feed: keyof typeof TSUNAMI_FEEDS, now = new Date()): Promise<NormalizedEvent[]> {
  const response = await fetch(TSUNAMI_FEEDS[feed], { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Tsunami ${feed} feed failed: ${response.status} ${response.statusText}`);
  }
  return parseTsunamiAtom(await response.text(), feed, now);
}

export function parseTsunamiAtom(xml: string, feed: keyof typeof TSUNAMI_FEEDS, ingestTime = new Date()): NormalizedEvent[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  const source: OfficialSource = feed === "ntwc" ? "tsunami_ntwc" : "tsunami_ptwc";
  return entries.map((entry, index) => {
    const body = entry[1];
    const title = textTag(body, "title") ?? "NOAA tsunami product";
    const updated = parseDate(textTag(body, "updated")) ?? ingestTime;
    const published = parseDate(textTag(body, "published")) ?? updated;
    const id = textTag(body, "id") ?? `${feed}:${index}:${title}`;
    const href = body.match(/<link[^>]+href="([^"]+)"/)?.[1] ?? TSUNAMI_FEEDS[feed];
    return {
      id: stableId(source, id),
      source,
      externalId: id,
      eventType: "tsunami",
      title,
      eventTime: published,
      sourceUpdatedAt: updated,
      ingestTime,
      severity: tsunamiSeverity(title),
      officialUrl: href,
      rawJson: { entry: body }
    };
  });
}

function tsunamiSeverity(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("warning")) return "warning";
  if (lower.includes("advisory")) return "advisory";
  if (lower.includes("watch")) return "watch";
  return "statement";
}

function textTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function stableId(source: string, externalId: string): string {
  return createHash("sha256").update(`${source}:${externalId}`).digest("hex").slice(0, 24);
}
