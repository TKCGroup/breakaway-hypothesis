import { describe, expect, it } from "vitest";
import { evaluateStaleGate } from "../logic/staleGate.js";
import { eventFixture, NOW } from "./helpers.js";

describe("stale gate", () => {
  it("rejects 2025 Rainier article when current date is 2026-07-08", () => {
    const result = evaluateStaleGate(
      eventFixture({
        source: "news",
        title: "Mount Rainier earthquake swarm reported in July 2025",
        body: "Search result snippet from 2025.",
        eventTime: new Date("2025-07-08T11:00:00.000Z"),
        sourceUpdatedAt: NOW,
        officialUrl: "https://example-news.invalid/rainier"
      }),
      { now: NOW }
    );

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("source_not_whitelisted:news");
    expect(result.reasons).toContain("snippet_or_unofficial_url");
    expect(result.eventFresh).toBe(false);
  });

  it("rejects event if official timestamp is older than max_event_age_hours", () => {
    const result = evaluateStaleGate(
      eventFixture({
        eventTime: new Date("2026-07-07T20:00:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:45:00.000Z")
      }),
      { now: NOW }
    );

    expect(result.passed).toBe(false);
    expect(result.reasons.some((reason) => reason.startsWith("event_time_outside_max_age"))).toBe(true);
  });

  it("rejects event if source is not in official whitelist", () => {
    const result = evaluateStaleGate(
      eventFixture({
        source: "search",
        officialUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test"
      }),
      { now: NOW }
    );

    expect(result.passed).toBe(false);
    expect(result.sourceOfficial).toBe(false);
  });

  it("rejects event if title/body date conflicts with feed timestamp", () => {
    const result = evaluateStaleGate(
      eventFixture({
        title: "2025 Rainier swarm from archived article",
        eventTime: new Date("2026-07-08T11:00:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:05:00.000Z")
      }),
      { now: NOW }
    );

    expect(result.passed).toBe(false);
    expect(result.titleDateConsistent).toBe(false);
  });

  it("accepts fresh USGS quake event with current event_time and source_updated_at", () => {
    const result = evaluateStaleGate(eventFixture(), { now: NOW });

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("accepts official NASA DONKI webtools links", () => {
    const result = evaluateStaleGate(
      eventFixture({
        source: "nasa_donki",
        eventType: "space_weather",
        title: "NASA DONKI CME",
        eventTime: new Date("2026-07-08T11:00:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:15:00.000Z"),
        officialUrl: "https://webtools.ccmc.gsfc.nasa.gov/DONKI/view/CME/123"
      }),
      { now: NOW }
    );

    expect(result.passed).toBe(true);
  });

  it("accepts official NOAA/NWS API links", () => {
    const result = evaluateStaleGate(
      eventFixture({
        source: "nws_alerts",
        eventType: "weather_alert",
        title: "Severe Thunderstorm Warning",
        eventTime: new Date("2026-07-08T11:30:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:45:00.000Z"),
        officialUrl: "https://api.weather.gov/alerts/urn:oid:test"
      }),
      { now: NOW }
    );

    expect(result.passed).toBe(true);
    expect(result.snippetOnly).toBe(false);
  });

  it("accepts official NASA EONET links", () => {
    const result = evaluateStaleGate(
      eventFixture({
        source: "nasa_eonet",
        eventType: "natural_event",
        title: "Official NASA EONET event",
        eventTime: new Date("2026-07-08T11:30:00.000Z"),
        sourceUpdatedAt: new Date("2026-07-08T11:45:00.000Z"),
        officialUrl: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_TEST"
      }),
      { now: NOW }
    );

    expect(result.passed).toBe(true);
    expect(result.snippetOnly).toBe(false);
  });
});
