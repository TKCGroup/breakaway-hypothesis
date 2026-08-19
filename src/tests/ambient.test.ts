/**
 * Ambient glow — the sleeping-room signal.
 *
 * Tyler's ask, verbatim: "add a subtle overlay that glows certain colors around the
 * edges depending on the most serious event type happening most recently. The more
 * recent, the more filled in and noticeable. I will see the glow when I'm sleeping,
 * so if the glow is a subtle red, i know what that means - if it's purple, i know
 * what that means, blue, green, etc."
 *
 * Two things that shaped the design:
 *
 * 1. Red / purple / blue / green are ALREADY this page's hazard-family colours
 *    (weather / volcano / earthquake / clear). So the glow reuses the existing
 *    legend rather than inventing a second colour language to learn half-asleep.
 *
 * 2. The page is light-only (--paper:#F1F3EF). A near-white full-screen page in a
 *    dark bedroom is itself a lamp, and a subtle edge glow on white is invisible.
 *    So the glow ships with an idle-triggered low-light state — otherwise the
 *    feature cannot do the one job it was asked to do.
 *
 * The maths lives here as pure exported functions and is shipped to the browser via
 * `.toString()` interpolation (the same pattern as solarClientSource), so there is
 * exactly ONE definition of the severity rule rather than a TS copy and a client
 * copy that can drift.
 *
 * Run: pnpm exec vitest run src/tests/ambient.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  AMBIENT_FAMILY_COLORS,
  AMBIENT_CLEAR_COLOR,
  ambientGlow,
  ambientClientSource
} from "../logic/ambient.js";

const NOW = new Date("2026-08-19T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const ev = (over: Partial<{ family: string; eventTime: string; score: number; magnitude: number; title: string }> = {}) => ({
  family: "earthquake",
  eventTime: hoursAgo(0),
  score: 50,
  ...over
});

describe("colour vocabulary", () => {
  it("covers every hazard family the page can render, so nothing ever glows undefined", () => {
    // These six are HAZARD_FAMILIES in earth.ts. A family with no colour would
    // produce `background: undefined` and silently render no glow at all — the
    // failure mode would be an all-quiet room during a live event.
    for (const key of ["earthquake", "weather", "volcano", "tsunami", "natural", "space_weather"]) {
      expect(AMBIENT_FAMILY_COLORS[key], `no colour for family ${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("keeps the four colours Tyler named bound to the meanings he named", () => {
    expect(AMBIENT_FAMILY_COLORS.earthquake).toBe("#347FAC"); // blue
    expect(AMBIENT_FAMILY_COLORS.weather).toBe("#BE2618");    // red
    expect(AMBIENT_FAMILY_COLORS.volcano).toBe("#7A4D91");    // purple
    expect(AMBIENT_CLEAR_COLOR).toBe("#2F7D57");              // green = nothing to report
  });

  it("gives every family a visually distinct colour", () => {
    const hexes = Object.values(AMBIENT_FAMILY_COLORS);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe("which event the glow speaks for", () => {
  it("is green and at its dimmest when there is nothing to report", () => {
    const g = ambientGlow([], NOW);
    expect(g.family).toBeNull();
    expect(g.color).toBe(AMBIENT_CLEAR_COLOR);
    expect(g.intensity).toBe(0);
  });

  it("speaks for the MOST SERIOUS event, not the most recent one", () => {
    // The ask says "most serious event type happening most recently" — seriousness
    // selects, recency modulates. A trivial event minutes ago must not outrank a
    // major one from this morning.
    const g = ambientGlow([
      ev({ family: "natural", score: 12, eventTime: hoursAgo(0) }),
      ev({ family: "weather", score: 88, eventTime: hoursAgo(6) })
    ], NOW);
    expect(g.family).toBe("weather");
    expect(g.color).toBe("#BE2618");
  });

  it("uses recency only to break a tie between equally serious events", () => {
    const g = ambientGlow([
      ev({ family: "volcano", score: 70, eventTime: hoursAgo(9) }),
      ev({ family: "tsunami", score: 70, eventTime: hoursAgo(1) })
    ], NOW);
    expect(g.family).toBe("tsunami");
  });

  it("falls back to a real colour for a family it has never heard of", () => {
    const g = ambientGlow([ev({ family: "sharknado", score: 60 })], NOW);
    expect(g.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("more recent = more filled in", () => {
  it("glows harder for a fresh event than the same event a day later", () => {
    const fresh = ambientGlow([ev({ score: 80, eventTime: hoursAgo(0) })], NOW);
    const stale = ambientGlow([ev({ score: 80, eventTime: hoursAgo(24) })], NOW);
    expect(fresh.intensity).toBeGreaterThan(stale.intensity);
    expect(fresh.reach).toBeGreaterThan(stale.reach);
    expect(fresh.alpha).toBeGreaterThan(stale.alpha);
  });

  it("decays monotonically — never brightens as an event ages", () => {
    let prev = Infinity;
    for (const h of [0, 1, 3, 6, 12, 18, 24, 36, 48]) {
      const g = ambientGlow([ev({ score: 80, eventTime: hoursAgo(h) })], NOW);
      expect(g.intensity).toBeLessThanOrEqual(prev);
      prev = g.intensity;
    }
  });

  it("does NOT blaze for a trivial event that merely just happened", () => {
    // Otherwise every M1.2 tremor lights the room. Seriousness gates brightness;
    // recency alone must not be able to max it out.
    const trivialNow = ambientGlow([ev({ score: 5, eventTime: hoursAgo(0) })], NOW);
    expect(trivialNow.intensity).toBeLessThan(0.2);
  });

  it("a severe event still registers after a day rather than going dark", () => {
    // Going fully dark would be indistinguishable from all-clear, which is the one
    // thing this overlay must never get wrong.
    const g = ambientGlow([ev({ score: 95, eventTime: hoursAgo(30) })], NOW);
    expect(g.intensity).toBeGreaterThan(0);
    expect(g.family).toBe("earthquake");
  });

  it("treats a future/forecast timestamp as fully current, not as negative age", () => {
    const g = ambientGlow([ev({ score: 60, eventTime: hoursAgo(-5) })], NOW);
    expect(g.intensity).toBeGreaterThan(0);
    expect(g.intensity).toBeLessThanOrEqual(1);
  });

  it("survives a garbage timestamp without going NaN", () => {
    // A NaN intensity would reach CSS as `opacity: NaN` and render nothing —
    // silent darkness during a live event.
    const g = ambientGlow([{ family: "weather", eventTime: "not-a-date", score: 90 }], NOW);
    expect(Number.isFinite(g.intensity)).toBe(true);
    expect(Number.isFinite(g.alpha)).toBe(true);
    expect(Number.isFinite(g.reach)).toBe(true);
  });
});

describe("it stays subtle enough to sleep next to", () => {
  it("never exceeds a gentle alpha even at maximum severity and recency", () => {
    const worst = ambientGlow([ev({ score: 100, eventTime: hoursAgo(0) })], NOW);
    expect(worst.alpha).toBeLessThanOrEqual(0.62);
    expect(worst.intensity).toBeLessThanOrEqual(1);
  });

  it("keeps every output inside its declared range for absurd inputs", () => {
    for (const score of [-50, 0, 50, 100, 5000, NaN]) {
      const g = ambientGlow([ev({ score: score as number })], NOW);
      expect(g.intensity).toBeGreaterThanOrEqual(0);
      expect(g.intensity).toBeLessThanOrEqual(1);
      expect(g.alpha).toBeGreaterThan(0);
      expect(g.alpha).toBeLessThanOrEqual(0.62);
      expect(g.reach).toBeGreaterThan(0);
    }
  });

  it("reserves the loud pulse for genuinely critical, genuinely recent events", () => {
    expect(ambientGlow([ev({ score: 97, eventTime: hoursAgo(0) })], NOW).pulse).toBe(true);
    expect(ambientGlow([ev({ score: 97, eventTime: hoursAgo(20) })], NOW).pulse).toBe(false);
    expect(ambientGlow([ev({ score: 30, eventTime: hoursAgo(0) })], NOW).pulse).toBe(false);
    expect(ambientGlow([], NOW).pulse).toBe(false);
  });
});

describe("the client gets the SAME maths, not a copy of it", () => {
  it("ships the real function bodies rather than a reimplementation", () => {
    const src = ambientClientSource();
    // If someone reimplements the rule in the page template, this stops agreeing
    // with the unit-tested version above and the glow starts lying.
    expect(src).toContain(ambientGlow.name);
    expect(src).toContain("AMBIENT_FAMILY_COLORS");
    expect(src).toContain(AMBIENT_CLEAR_COLOR);
  });

  it("is syntactically valid standalone JavaScript", async () => {
    const vm = await import("node:vm");
    expect(() => new vm.Script(ambientClientSource())).not.toThrow();
  });

  it("evaluates in a bare sandbox and returns the same answer as the TS export", async () => {
    const vm = await import("node:vm");
    const ctx: any = {};
    vm.createContext(ctx);
    new vm.Script(ambientClientSource() + "\n__out = ambientGlow(__events, new Date(__now));").runInContext(
      Object.assign(ctx, {
        __events: [ev({ family: "volcano", score: 77, eventTime: hoursAgo(2) })],
        __now: NOW.toISOString()
      }) && ctx
    );
    const expected = ambientGlow([ev({ family: "volcano", score: 77, eventTime: hoursAgo(2) })], NOW);
    expect(ctx.__out.color).toBe(expected.color);
    expect(ctx.__out.family).toBe(expected.family);
    expect(ctx.__out.intensity).toBeCloseTo(expected.intensity, 10);
  });
});

describe("against a slice of REAL /api/earth data", () => {
  // This block exists because the hand-written fixtures above all passed while the
  // feature was wrong on production data. 457 live weather alerts tie at score 100
  // — the oldest 26 days back — and the map's actual lead is an M7.7 earthquake at
  // score 98. Ranking by raw score therefore chose a month-old weather alert: the
  // room would have glowed RED all night for something long over, while a genuine
  // M7.7 sat on the map in blue.
  //
  // A fixture you invent tests your assumption of the payload. This one is trimmed
  // from the wire.
  const live = JSON.parse(
    readFileSync(new URL("./fixtures/earth-live-slice.json", import.meta.url), "utf8")
  );

  it("speaks for the same event the map opened on, not the highest raw score", () => {
    const g = ambientGlow(live.events, new Date("2026-08-19T12:00:00Z"), live.focus.eventIds[0]);
    expect(g.family).toBe("earthquake");
    expect(g.color).toBe(AMBIENT_FAMILY_COLORS.earthquake);
  });

  it("would have picked the wrong event without the map's lead — the bug, pinned", () => {
    const g = ambientGlow(live.events, new Date("2026-08-19T12:00:00Z"));
    expect(g.family).toBe("weather");
  });

  it("dims a five-day-old M7.7 rather than blazing", () => {
    const g = ambientGlow(live.events, new Date("2026-08-19T12:00:00Z"), live.focus.eventIds[0]);
    expect(g.intensity).toBeLessThan(0.35);
    expect(g.intensity).toBeGreaterThan(0);
    expect(g.pulse).toBe(false);
  });

  it("ignores a lead id that is not in the event list instead of going all-clear", () => {
    const g = ambientGlow(live.events, new Date("2026-08-19T12:00:00Z"), "no-such-id");
    expect(g.family).not.toBeNull();
  });
});
