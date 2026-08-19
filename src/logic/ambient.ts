/**
 * Ambient glow — what the room looks like when nobody is watching the screen.
 *
 * Tyler leaves earth.tkcgroup.co up overnight and wants to read the planet's state
 * from across a dark room, asleep, with no text: a colour tells him WHAT kind of
 * event, and how filled-in/bright it is tells him HOW recent and how serious.
 *
 * Two decisions worth stating, because both could have gone wrong quietly:
 *
 * 1. **The colours are not new.** Red / purple / blue / green are already this
 *    page's hazard-family colours — severe weather / volcano / earthquake / clear.
 *    Inventing a second palette would mean learning two legends, and the one you
 *    need at 3am is the one you already know from the map.
 *
 * 2. **Seriousness selects, recency modulates.** The glow speaks for the single
 *    most significant event (matching the server's `earthMapFocus` lead-signal
 *    ranking: score, then recency as tiebreak), and then brightness/reach decay
 *    with that event's age. If recency alone drove brightness, every M1.2 tremor
 *    would light the room; if seriousness alone drove it, a week-old quake would
 *    glow as hard as a live one.
 *
 * The decay is `1 / (1 + ageHours/12)` rather than a linear ramp with a floor,
 * because it is monotonic and NEVER reaches zero. A severe event fading to exactly
 * dark would be indistinguishable from all-clear, which is the single worst thing
 * this overlay could get wrong.
 *
 * These functions are shipped to the browser verbatim via `.toString()` in
 * `ambientClientSource()` — the same pattern as `solarClientSource()` — so there is
 * exactly ONE definition of the rule instead of a TS copy and a client copy that
 * drift apart. Tests: src/tests/ambient.test.ts
 */

/** Family → colour. Mirrors the `colors` object in earth.ts (client, ~line 1700). */
export const AMBIENT_FAMILY_COLORS: Record<string, string> = {
  earthquake: "#347FAC",
  weather: "#BE2618",
  natural: "#DE5F26",
  volcano: "#7A4D91",
  tsunami: "#246B82",
  space_weather: "#697B73"
};

/** Nothing to report. Same green as the page's `--clear`. */
export const AMBIENT_CLEAR_COLOR = "#2F7D57";

/**
 * A family this build has never heard of. Deliberately NOT any known family's
 * colour — an unrecognised hazard glowing in space-weather grey would be a lie,
 * and a missing colour would render no glow at all (silent darkness during a live
 * event, the exact failure this whole file exists to avoid).
 */
export const AMBIENT_UNKNOWN_COLOR = "#5B6B7C";

/** Alpha at zero intensity — a faint presence that says "the page is alive". */
export const AMBIENT_MIN_ALPHA = 0.08;
/** Alpha at full intensity. Capped so a critical event never becomes a bedside lamp. */
export const AMBIENT_MAX_ALPHA = 0.62;

export interface AmbientEventLike {
  id?: string | null;
  family?: string | null;
  eventTime?: string | null;
  score?: number | null;
}

export interface AmbientGlowState {
  /** Family of the event being spoken for, or null when all-clear. */
  family: string | null;
  color: string;
  /** 0..1 — seriousness × recency. */
  intensity: number;
  /** CSS alpha for the glow. */
  alpha: number;
  /** How far the glow reaches inward, in viewport units. */
  reach: number;
  /** Slow breathing reserved for critical AND current. */
  pulse: boolean;
  /** Age of the lead event in hours (0 when all-clear or in the future). */
  ageHours: number;
}

function ambientClamp(n: number, lo: number, hi: number): number {
  if (!isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Hours since the event. A future timestamp (forecasts exist on this page) is 0 —
 * fully current, never negative. An unparseable timestamp returns -1 as a sentinel
 * so the caller can pick a middle recency rather than silently treating garbage as
 * "happening right now".
 */
function ambientAgeHours(eventTime: string | null | undefined, now: Date): number {
  if (typeof eventTime !== "string" || eventTime === "") return -1;
  var t = Date.parse(eventTime);
  if (!isFinite(t)) return -1;
  var h = (now.getTime() - t) / 3600000;
  if (!isFinite(h)) return -1;
  return h < 0 ? 0 : h;
}

/**
 * Recency weight. Monotonic decreasing, asymptotic to 0, never equal to 0.
 * 0h→1.00 · 6h→0.67 · 12h→0.50 · 24h→0.33 · 48h→0.20
 *
 * An unparseable timestamp gets 0.5: not maximal (which would let corrupt data
 * blaze) and not dark (which would hide a real event behind a bad field).
 */
function ambientRecency(ageHours: number): number {
  if (ageHours < 0) return 0.5;
  return 1 / (1 + ageHours / 12);
}

/**
 * The glow the room should show, given every currently-visible event.
 *
 * Pass `leadId` (from `map.focus.eventIds[0]`) whenever it is available — that is
 * the server's own lead-signal choice and it is strictly better than anything this
 * function can work out from `score` alone. The internal score-then-recency ranking
 * is only a FALLBACK for when focus is missing; see the note inside for the live
 * measurement that proved raw score insufficient on its own.
 */
export function ambientGlow(
  events: AmbientEventLike[],
  now: Date,
  leadId?: string | null
): AmbientGlowState {
  var list = Array.isArray(events) ? events : [];
  var lead: AmbientEventLike | null = null;
  var leadScore = -Infinity;
  var leadTime = -Infinity;

  // Prefer the event the SERVER already chose as the lead signal (map.focus).
  //
  // MEASURED against live /api/earth on 2026-08-19, and this is why the parameter
  // exists: 457 weather alerts were tied at score 100 — the oldest 26 days back —
  // while the map's actual lead was an M7.7 earthquake at score 98. Ranking by raw
  // score therefore picked a month-old weather alert, so the room would have glowed
  // RED all night for something long finished while a live M7.7 sat on the map in
  // blue. Raw score cannot discriminate a 457-way tie; the server's eligibility
  // rules already can. Deferring to it also guarantees the glow and the map's
  // opening viewport never disagree about what matters most.
  if (typeof leadId === "string" && leadId !== "") {
    for (var j = 0; j < list.length; j++) {
      var cand = list[j];
      if (cand && (cand as any).id === leadId) {
        lead = cand;
        leadScore = typeof cand.score === "number" && isFinite(cand.score) ? cand.score : 0;
        break;
      }
    }
  }

  // No usable lead id (absent, or names an event not in this list) — fall back to
  // score-then-recency rather than reporting all-clear, which would be a lie.
  var fallbackNeeded = lead === null;
  for (var i = 0; fallbackNeeded && i < list.length; i++) {
    var e = list[i];
    if (!e) continue;
    var raw = typeof e.score === "number" && isFinite(e.score) ? e.score : 0;
    var s = ambientClamp(raw, 0, 100);
    var parsed = typeof e.eventTime === "string" ? Date.parse(e.eventTime) : NaN;
    var t = isFinite(parsed) ? parsed : -Infinity;
    if (s > leadScore || (s === leadScore && t > leadTime)) {
      leadScore = s;
      leadTime = t;
      lead = e;
    }
  }

  if (!lead) {
    return {
      family: null,
      color: AMBIENT_CLEAR_COLOR,
      intensity: 0,
      alpha: AMBIENT_MIN_ALPHA,
      reach: 4,
      pulse: false,
      ageHours: 0
    };
  }

  var severity = ambientClamp(leadScore, 0, 100) / 100;
  var age = ambientAgeHours(lead.eventTime, now);
  var intensity = ambientClamp(severity * ambientRecency(age), 0, 1);
  var fam = typeof lead.family === "string" && lead.family !== "" ? lead.family : null;
  var color = fam && AMBIENT_FAMILY_COLORS[fam] ? AMBIENT_FAMILY_COLORS[fam] : AMBIENT_UNKNOWN_COLOR;

  return {
    family: fam,
    color: color,
    intensity: intensity,
    alpha: AMBIENT_MIN_ALPHA + (AMBIENT_MAX_ALPHA - AMBIENT_MIN_ALPHA) * intensity,
    reach: 4 + 18 * intensity,
    // Critical AND current. A big event from yesterday should sit there glowing,
    // not breathe at you all night.
    pulse: intensity >= 0.7 && age >= 0 && age <= 6,
    ageHours: age < 0 ? 0 : age
  };
}

/**
 * The same functions, as standalone JavaScript for the page's classic script block.
 * Emitted in dependency order. Nothing here may reference module scope that is not
 * also emitted, or the client copy throws at runtime while the tests stay green.
 */
export function ambientClientSource(): string {
  return [
    "var AMBIENT_FAMILY_COLORS = " + JSON.stringify(AMBIENT_FAMILY_COLORS) + ";",
    "var AMBIENT_CLEAR_COLOR = " + JSON.stringify(AMBIENT_CLEAR_COLOR) + ";",
    "var AMBIENT_UNKNOWN_COLOR = " + JSON.stringify(AMBIENT_UNKNOWN_COLOR) + ";",
    "var AMBIENT_MIN_ALPHA = " + JSON.stringify(AMBIENT_MIN_ALPHA) + ";",
    "var AMBIENT_MAX_ALPHA = " + JSON.stringify(AMBIENT_MAX_ALPHA) + ";",
    "var ambientClamp = " + ambientClamp.toString() + ";",
    "var ambientAgeHours = " + ambientAgeHours.toString() + ";",
    "var ambientRecency = " + ambientRecency.toString() + ";",
    "var ambientGlow = " + ambientGlow.toString() + ";"
  ].join("\n");
}
