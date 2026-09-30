import { describe, expect, it } from "vitest";
import {
  earthFiltersClientSource,
  familyCounts,
  isActiveMapEvent,
  passesWindow,
  selectEvents,
  sortSignals,
  sourceGroup,
  type FilterableEvent,
} from "../logic/earthFilters.js";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

function event(
  overrides: Partial<FilterableEvent> & { id: string },
): FilterableEvent {
  return {
    source: "usgs_earthquake_geojson",
    family: "earthquake",
    status: "recent",
    eventTime: hoursAgo(2),
    sourceUpdatedAt: hoursAgo(1),
    score: 50,
    mapContext: { eligible: true },
    ...overrides,
  };
}

describe("sourceGroup", () => {
  it("groups official sources the way the source dropdown does", () => {
    expect(sourceGroup("usgs_hans")).toBe("usgs");
    expect(sourceGroup("nws_alerts")).toBe("nws");
    expect(sourceGroup("nhc_current_storms")).toBe("nws");
    expect(sourceGroup("swpc_kp")).toBe("swpc");
    expect(sourceGroup("nasa_eonet")).toBe("nasa");
    expect(sourceGroup("tsunami_ptwc")).toBe("tsunami");
    expect(sourceGroup("mystery")).toBe("other");
  });
});

describe("the time window", () => {
  const quake = event({ id: "q" });
  const blockedAlert = event({
    id: "a",
    source: "nws_alerts",
    family: "weather",
    status: "current",
    mapContext: { eligible: false },
  });
  const freshAlert = event({
    id: "b",
    source: "nws_alerts",
    family: "weather",
    status: "current",
    mapContext: { eligible: true },
  });
  const forecast = event({
    id: "f",
    status: "forecast",
    eventTime: hoursAgo(-6),
  });

  it("'now' means active on the map: eligible, and an earthquake or a current signal", () => {
    expect(isActiveMapEvent(quake)).toBe(true);
    expect(isActiveMapEvent(freshAlert)).toBe(true);
    expect(isActiveMapEvent(blockedAlert)).toBe(false);
    expect(
      isActiveMapEvent(event({ id: "r", family: "weather", status: "recent" })),
    ).toBe(false);
    expect(isActiveMapEvent(event({ id: "n", mapContext: null }))).toBe(false);
    expect(passesWindow(blockedAlert, "now", NOW)).toBe(false);
  });

  it("24h, 7d and 30d are occurrence windows that never include a forecast", () => {
    expect(passesWindow(quake, "24h", NOW)).toBe(true);
    expect(
      passesWindow(event({ id: "o", eventTime: hoursAgo(30) }), "24h", NOW),
    ).toBe(false);
    expect(
      passesWindow(event({ id: "o", eventTime: hoursAgo(30) }), "7d", NOW),
    ).toBe(true);
    expect(
      passesWindow(event({ id: "o", eventTime: hoursAgo(24 * 20) }), "7d", NOW),
    ).toBe(false);
    expect(
      passesWindow(
        event({ id: "o", eventTime: hoursAgo(24 * 20) }),
        "30d",
        NOW,
      ),
    ).toBe(true);
    expect(passesWindow(forecast, "24h", NOW)).toBe(false);
    expect(passesWindow(forecast, "30d", NOW)).toBe(false);
  });

  it("'forecast' shows only forecasts and 'all' shows everything", () => {
    expect(passesWindow(forecast, "forecast", NOW)).toBe(true);
    expect(passesWindow(quake, "forecast", NOW)).toBe(false);
    expect(passesWindow(blockedAlert, "all", NOW)).toBe(true);
  });
});

describe("selectEvents and familyCounts share one predicate", () => {
  const events = [
    event({ id: "q1" }),
    event({
      id: "q2",
      source: "usgs_hans",
      family: "volcano",
      status: "current",
    }),
    event({
      id: "w1",
      source: "nws_alerts",
      family: "weather",
      status: "current",
    }),
    event({
      id: "w2",
      source: "nws_alerts",
      family: "weather",
      status: "current",
      mapContext: { eligible: false },
    }),
  ];

  it("an empty hazard set means everything, and families combine", () => {
    const base = { hazards: [] as string[], source: "all", window: "now" };
    expect(selectEvents(events, base, NOW).map((e) => e.id)).toEqual([
      "q1",
      "q2",
      "w1",
    ]);
    expect(
      selectEvents(
        events,
        { ...base, hazards: ["earthquake", "volcano"] },
        NOW,
      ).map((e) => e.id),
    ).toEqual(["q1", "q2"]);
  });

  it("source and window filters compose with the hazard filter", () => {
    expect(
      selectEvents(
        events,
        { hazards: [], source: "nws", window: "all" },
        NOW,
      ).map((e) => e.id),
    ).toEqual(["w1", "w2"]);
  });

  it("pill counts ignore the family filter but honour source and window, so they match the map", () => {
    const counts = familyCounts(
      events,
      { hazards: ["earthquake"], source: "all", window: "now" },
      NOW,
    );
    expect(counts.total).toBe(3);
    expect(counts.byFamily).toEqual({ earthquake: 1, volcano: 1, weather: 1 });
    const viaSelect = selectEvents(
      events,
      { hazards: [], source: "all", window: "now" },
      NOW,
    );
    expect(viaSelect.length).toBe(counts.total);
  });
});

describe("sortSignals", () => {
  const a = event({
    id: "a",
    score: 90,
    magnitude: 5,
    eventTime: hoursAgo(10),
  });
  const b = event({ id: "b", score: 90, magnitude: 7, eventTime: hoursAgo(1) });
  const c = event({ id: "c", score: 40, eventTime: hoursAgo(5) });

  it("ranks by score, then recency", () => {
    expect(sortSignals([a, c, b], "score").map((e) => e.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
  it("ranks by last active", () => {
    expect(sortSignals([a, c, b], "lastActive").map((e) => e.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
  it("ranks by magnitude with unreported magnitudes last", () => {
    expect(sortSignals([c, a, b], "magnitude").map((e) => e.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
  it("does not mutate its input", () => {
    const input = [a, c, b];
    sortSignals(input, "score");
    expect(input.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });
});

describe("earthFiltersClientSource", () => {
  // The page ships these by serialisation. If that ever stopped producing equivalent,
  // self-contained code the browser would filter differently from the server-rendered
  // list while every test above stayed green, so run the emitted string.
  const shipped = new Function(
    earthFiltersClientSource() +
      "\nreturn { sourceGroup: sourceGroup, isActiveMapEvent: isActiveMapEvent, passesWindow: passesWindow," +
      " hazardSelected: hazardSelected, selectEvents: selectEvents, familyCounts: familyCounts, sortSignals: sortSignals };",
  )() as {
    selectEvents: typeof selectEvents;
    familyCounts: typeof familyCounts;
    sortSignals: typeof sortSignals;
    sourceGroup: typeof sourceGroup;
  };

  const events = [
    event({ id: "q1", score: 10 }),
    event({ id: "q2", score: 80, eventTime: hoursAgo(30) }),
    event({
      id: "w1",
      source: "nws_alerts",
      family: "weather",
      status: "current",
      score: 60,
    }),
  ];

  it("selects, counts and sorts identically to the module", () => {
    for (const window of ["now", "24h", "7d", "30d", "forecast", "all"]) {
      for (const hazards of [[], ["earthquake"], ["weather", "volcano"]]) {
        const filter = { hazards, source: "all", window };
        expect(shipped.selectEvents(events, filter, NOW)).toEqual(
          selectEvents(events, filter, NOW),
        );
        expect(shipped.familyCounts(events, filter, NOW)).toEqual(
          familyCounts(events, filter, NOW),
        );
      }
    }
    for (const sort of ["score", "lastActive", "magnitude"]) {
      expect(shipped.sortSignals(events, sort)).toEqual(
        sortSignals(events, sort),
      );
    }
    expect(shipped.sourceGroup("swpc_kp")).toBe("swpc");
  });
});
