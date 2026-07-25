import { DEFAULT_CONFIG, OFFICIAL_SOURCES, type WatcherConfig } from "../config.js";
import type { NormalizedEvent, OfficialSource, StaleGateResult } from "../types.js";

const NEWS_OR_SOCIAL_SOURCES = new Set([
  "news",
  "google_news",
  "search",
  "x",
  "twitter",
  "facebook",
  "reddit",
  "social",
  "snippet"
]);

export interface StaleGateOptions {
  config?: WatcherConfig;
  now?: Date;
}

export function evaluateStaleGate(
  event: Pick<
    NormalizedEvent,
    "source" | "eventTime" | "sourceUpdatedAt" | "title" | "body" | "officialUrl"
  >,
  options: StaleGateOptions = {}
): StaleGateResult {
  const config = options.config ?? DEFAULT_CONFIG;
  const now = options.now ?? new Date();
  const reasons: string[] = [];
  const sourceOfficial = OFFICIAL_SOURCES.has(event.source as OfficialSource);
  const snippetOnly =
    NEWS_OR_SOCIAL_SOURCES.has(event.source.toLowerCase()) || !looksLikeOfficialUrl(event.officialUrl);

  if (!sourceOfficial) {
    reasons.push(`source_not_whitelisted:${event.source}`);
  }

  if (snippetOnly) {
    reasons.push("snippet_or_unofficial_url");
  }

  const eventAgeHours = hoursBetween(event.eventTime, now);
  const eventFresh = eventAgeHours <= config.freshness.maxEventAgeHours && eventAgeHours >= -1 / 60;
  if (!eventFresh) {
    reasons.push(`event_time_outside_max_age:${eventAgeHours.toFixed(2)}h`);
  }

  const sourceStaleLimit =
    sourceOfficial && config.freshness.sourceStaleHours[event.source as OfficialSource] !== undefined
      ? config.freshness.sourceStaleHours[event.source as OfficialSource]
      : config.freshness.maxEventAgeHours;
  const sourceAgeHours = hoursBetween(event.sourceUpdatedAt, now);
  const sourceFresh = sourceAgeHours <= sourceStaleLimit && sourceAgeHours >= -1 / 60;
  if (!sourceFresh) {
    reasons.push(`source_updated_at_stale:${sourceAgeHours.toFixed(2)}h`);
  }

  const titleDateConsistent = titleOrBodyDateMatchesEventTime(
    [event.title, event.body ?? ""].join("\n"),
    event.eventTime
  );
  if (!titleDateConsistent) {
    reasons.push("title_or_body_date_conflicts_with_feed_timestamp");
  }

  return {
    passed: reasons.length === 0,
    checkedAt: now,
    reasons,
    sourceOfficial,
    eventFresh,
    sourceFresh,
    titleDateConsistent,
    snippetOnly
  };
}

export function stableEventDedupeKey(event: Pick<NormalizedEvent, "source" | "externalId" | "sourceUpdatedAt">): string {
  return `${event.source}:${event.externalId}:${event.sourceUpdatedAt.toISOString()}`;
}

function hoursBetween(then: Date, now: Date): number {
  return (now.getTime() - then.getTime()) / 3_600_000;
}

function looksLikeOfficialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return [
      "usgs.gov",
      "earthquake.usgs.gov",
      "volcanoes.usgs.gov",
      "swpc.noaa.gov",
      "services.swpc.noaa.gov",
      "api.nasa.gov",
      "kauai.ccmc.gsfc.nasa.gov",
      "webtools.ccmc.gsfc.nasa.gov",
      "ccmc.gsfc.nasa.gov",
      "tsunami.gov",
      "www.tsunami.gov",
      "weather.gov",
      "www.weather.gov",
      "api.weather.gov",
      "eonet.gsfc.nasa.gov",
      "earthquakescanada.nrcan.gc.ca"
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function titleOrBodyDateMatchesEventTime(text: string, eventTime: Date): boolean {
  const eventYear = eventTime.getUTCFullYear();
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const conflictingYears = years.filter((year) => Math.abs(year - eventYear) > 0);
  return conflictingYears.length === 0;
}
