/**
 * The Earth Watch filter and ranking rules, in one place.
 *
 * The flat-map page used to carry these inline, where only a browser could run
 * them. They live here so the server can apply the SAME predicate when it renders
 * the no-JavaScript list, the browser page runs byte-identical code, and vitest can
 * exercise them without a DOM.
 *
 * Every function is self-contained on purpose: `earthFiltersClientSource()`
 * serialises them into the page with `.toString()` (the same pattern as
 * `solarClientSource()` and `ambientClientSource()`). Functions may call one
 * another by name, but nothing may close over module scope or import anything.
 * `earthFilters.test.ts` evaluates the emitted string to prove that holds.
 */

export interface FilterableEvent {
  id: string;
  source: string;
  family: string;
  status: string;
  eventTime: string;
  sourceUpdatedAt?: string;
  score: number;
  magnitude?: number;
  mapContext?: { eligible?: boolean } | null;
}

export interface EventFilter {
  /** Empty means every family; families combine (earthquakes AND volcanoes). */
  hazards: string[];
  /** "all" or a source group from sourceGroup(). */
  source: string;
  /** now | 24h | 7d | 30d | forecast | all */
  window: string;
}

export type SignalSort = "score" | "lastActive" | "magnitude";

/** Group an official source id the way the source dropdown does. */
export function sourceGroup(source: string): string {
  if (source.indexOf("usgs_") === 0) return "usgs";
  if (source === "nws_alerts" || source === "nhc_current_storms") return "nws";
  if (source.indexOf("swpc_") === 0) return "swpc";
  if (source.indexOf("nasa_") === 0) return "nasa";
  if (source.indexOf("tsunami_") === 0) return "tsunami";
  return "other";
}

/** The event is drawn as live: map-eligible, and an earthquake or a current signal. */
export function isActiveMapEvent(event: FilterableEvent): boolean {
  return Boolean(
    event.mapContext &&
      event.mapContext.eligible &&
      (event.family === "earthquake" || event.status === "current")
  );
}

/** The time-window test. "now" means active on the map, not merely recent. */
export function passesWindow(
  event: FilterableEvent,
  windowKey: string,
  nowMs: number
): boolean {
  if (windowKey === "all") return true;
  if (windowKey === "now") return isActiveMapEvent(event);
  if (windowKey === "forecast") return event.status === "forecast";
  var span =
    windowKey === "24h" ? 86400000 : windowKey === "7d" ? 7 * 86400000 : 30 * 86400000;
  var occurredAt = Date.parse(event.eventTime);
  return (
    event.status !== "forecast" &&
    occurredAt >= nowMs - span &&
    occurredAt <= nowMs
  );
}

/** An empty set means everything, so "no filter" and "all ticked" cannot drift. */
export function hazardSelected(hazards: string[], family: string): boolean {
  return !hazards.length || hazards.indexOf(family) !== -1;
}

/** The whole predicate the map, the list and the pill counts all go through. */
export function selectEvents<T extends FilterableEvent>(
  events: T[],
  filter: EventFilter,
  nowMs: number
): T[] {
  return events.filter(function (event) {
    if (!hazardSelected(filter.hazards, event.family)) return false;
    if (filter.source !== "all" && sourceGroup(event.source) !== filter.source)
      return false;
    return passesWindow(event, filter.window, nowMs);
  });
}

/** Per-family counts under everything EXCEPT the family filter (pill numbers). */
export function familyCounts(
  events: FilterableEvent[],
  filter: EventFilter,
  nowMs: number
): { total: number; byFamily: Record<string, number> } {
  var byFamily: Record<string, number> = {};
  var total = 0;
  events.forEach(function (event) {
    if (filter.source !== "all" && sourceGroup(event.source) !== filter.source)
      return;
    if (!passesWindow(event, filter.window, nowMs)) return;
    total += 1;
    byFamily[event.family] = (byFamily[event.family] || 0) + 1;
  });
  return { total: total, byFamily: byFamily };
}

/** Rank signals. Ties fall through score, recency, then id so order is stable. */
export function sortSignals<T extends FilterableEvent>(
  events: T[],
  sort: string
): T[] {
  return events.slice().sort(function (left, right) {
    var byTime = Date.parse(right.eventTime) - Date.parse(left.eventTime);
    var byUpdate =
      Date.parse(right.sourceUpdatedAt || "") - Date.parse(left.sourceUpdatedAt || "");
    if (sort === "lastActive") {
      return byTime || byUpdate || right.score - left.score || left.id.localeCompare(right.id);
    }
    if (sort === "magnitude") {
      var lm = isFinite(left.magnitude as number) ? (left.magnitude as number) : -Infinity;
      var rm = isFinite(right.magnitude as number) ? (right.magnitude as number) : -Infinity;
      return rm - lm || right.score - left.score || byTime || left.id.localeCompare(right.id);
    }
    return right.score - left.score || byTime || byUpdate || left.id.localeCompare(right.id);
  });
}

/** Ship the functions above to the browser verbatim. */
export function earthFiltersClientSource(): string {
  return [
    "var sourceGroup = " + sourceGroup.toString() + ";",
    "var isActiveMapEvent = " + isActiveMapEvent.toString() + ";",
    "var passesWindow = " + passesWindow.toString() + ";",
    "var hazardSelected = " + hazardSelected.toString() + ";",
    "var selectEvents = " + selectEvents.toString() + ";",
    "var familyCounts = " + familyCounts.toString() + ";",
    "var sortSignals = " + sortSignals.toString() + ";"
  ].join("\n");
}
