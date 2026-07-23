import { describe, expect, it, vi } from "vitest";
import {
  EONET_EVENTS_URL,
  fetchEonetEvents,
  normalizeEonetEvent
} from "../sources/eonet.js";
import { NOW } from "./helpers.js";

describe("NASA EONET source", () => {
  it("normalizes official event category, magnitude context, and coordinates", () => {
    const event = normalizeEonetEvent(
      {
        id: "EONET_21584",
        title: "Wildfire TEN MILE, Oregon",
        link: `${EONET_EVENTS_URL}/EONET_21584`,
        closed: null,
        categories: [{ id: "wildfires", title: "Wildfires" }],
        geometry: [
          {
            magnitudeValue: 800,
            magnitudeUnit: "acres",
            date: "2026-07-08T10:00:00Z",
            type: "Point",
            coordinates: [-121.0143, 44.7964]
          }
        ]
      },
      NOW
    );

    expect(event).toMatchObject({
      source: "nasa_eonet",
      externalId: "EONET_21584",
      eventType: "natural_event",
      severity: "Wildfires",
      lat: 44.7964,
      lon: -121.0143,
      officialUrl: `${EONET_EVENTS_URL}/EONET_21584`
    });
    expect(event.eventTime.toISOString()).toBe("2026-07-08T10:00:00.000Z");
  });

  it("fetches the official 30-day open and closed event window", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ events: [] }), {
          headers: { "content-type": "application/json" }
        })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await fetchEonetEvents(NOW);
      const url = new URL(String(fetchMock.mock.calls[0][0]));
      expect(url.origin + url.pathname).toBe(EONET_EVENTS_URL);
      expect(url.searchParams.get("status")).toBe("all");
      expect(url.searchParams.get("days")).toBe("30");
      expect(url.searchParams.get("limit")).toBe("500");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
