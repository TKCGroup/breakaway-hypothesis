import { describe, expect, it } from "vitest";
import { createSpaceWeatherWindow } from "../logic/cascade.js";
import { normalizeDonkiEvent } from "../sources/donki.js";
import { NOW } from "./helpers.js";

describe("DONKI ingestion", () => {
  it("normalizes official DONKI CME events as nasa_donki space weather", () => {
    const event = normalizeDonkiEvent(
      "CME",
      {
        activityID: "2026-07-08T00:00:00-CME-001",
        startTime: "2026-07-08T00:00Z",
        submissionTime: "2026-07-08T01:00Z",
        link: "https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/CME/1"
      },
      NOW
    );

    expect(event.source).toBe("nasa_donki");
    expect(event.eventType).toBe("space_weather");
    expect(event.severity).toBe("CME");
    expect(event.officialUrl).toContain("DONKI");
  });

  it("opens an S1 window for DONKI CME impulses", () => {
    const event = normalizeDonkiEvent(
      "CME",
      {
        activityID: "2026-07-08T00:00:00-CME-001",
        startTime: "2026-07-08T00:00Z",
        submissionTime: "2026-07-08T01:00Z",
        link: "https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/CME/1"
      },
      NOW
    );

    expect(createSpaceWeatherWindow(event)).toBeDefined();
  });

  it("uses DONKI flare class as severity when available", () => {
    const event = normalizeDonkiEvent(
      "FLR",
      {
        flrID: "2026-07-08T02:00:00-FLR-001",
        beginTime: "2026-07-08T02:00Z",
        submissionTime: "2026-07-08T02:10Z",
        classType: "M6.1",
        link: "https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/FLR/1"
      },
      NOW
    );

    expect(event.severity).toBe("M6.1");
    expect(createSpaceWeatherWindow(event)).toBeDefined();
  });
});
