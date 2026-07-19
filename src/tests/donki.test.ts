import { describe, expect, it, vi } from "vitest";
import { createSpaceWeatherWindow } from "../logic/cascade.js";
import { fetchDonkiEvents, normalizeDonkiEvent } from "../sources/donki.js";
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

  it("retries transient DONKI 5xx responses before giving up on an endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              activityID: "2026-07-08T00:00:00-CME-001",
              startTime: "2026-07-08T00:00Z",
              submissionTime: "2026-07-08T01:00Z",
              link: "https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/CME/1"
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const events = await fetchDonkiEvents("test-key", NOW, ["CME"]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe("nasa_donki");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
