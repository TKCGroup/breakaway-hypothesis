import type { NormalizedEvent, RejectedRecord } from "../types.js";

// How far ahead of the cycle an observation time may sit before it is refused.
// 10-15 evidence: 13 non-NWS rows were within one 15-minute cycle ahead
// (clock skew between agency and us: ambiguous, kept) and 2 EONET rows were
// 16 days ahead (impossible for an observation: refused).
export const FUTURE_TOLERANCE_MS = 60 * 60_000;

// NWS alerts carry future onsets on purpose — a warning issued now for
// tomorrow — and the page shows those as `forecast`. Only they may be ahead.
const FUTURE_ALLOWED = new Set<NormalizedEvent["eventType"]>(["weather_alert"]);

export function ingestRejection(event: NormalizedEvent, now: Date): RejectedRecord | undefined {
  const reject = (reason: string, detail: string): RejectedRecord => ({
    externalId: event.externalId,
    reason,
    detail,
    rawJson: event.rawJson
  });
  if (!(event.eventTime instanceof Date) || Number.isNaN(event.eventTime.getTime())) {
    return reject("invalid_event_time", "event_time is not a valid date");
  }
  if (!(event.sourceUpdatedAt instanceof Date) || Number.isNaN(event.sourceUpdatedAt.getTime())) {
    return reject("invalid_source_updated_at", "source_updated_at is not a valid date");
  }
  const aheadMs = event.eventTime.getTime() - now.getTime();
  if (aheadMs > FUTURE_TOLERANCE_MS && !FUTURE_ALLOWED.has(event.eventType)) {
    return reject(
      "future_event_time",
      `${event.eventType} event_time ${event.eventTime.toISOString()} is ${(aheadMs / 3_600_000).toFixed(1)} h after the cycle`
    );
  }
  return undefined;
}
