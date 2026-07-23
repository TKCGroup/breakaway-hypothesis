import { describe, expect, it, vi } from "vitest";
import {
  NWS_ALERTS_URL,
  fetchNwsAlerts,
  normalizeNwsAlert
} from "../sources/nwsAlerts.js";
import { NOW } from "./helpers.js";

describe("NOAA/NWS alerts source", () => {
  it("normalizes explicit onset, expiration, severity, and official URL", () => {
    const event = normalizeNwsAlert(
      {
        id: "https://api.weather.gov/alerts/test",
        properties: {
          id: "test-alert",
          event: "Tornado Warning",
          areaDesc: "Test County",
          sent: "2026-07-08T11:55:00Z",
          effective: "2026-07-08T11:55:00Z",
          onset: "2026-07-08T12:15:00Z",
          expires: "2026-07-08T13:00:00Z",
          severity: "Extreme",
          certainty: "Observed",
          urgency: "Immediate",
          headline: "Tornado Warning issued for Test County",
          "@id": "https://api.weather.gov/alerts/test"
        }
      },
      NOW
    );

    expect(event).toMatchObject({
      source: "nws_alerts",
      externalId: "test-alert",
      eventType: "weather_alert",
      title: "Tornado Warning: Test County",
      severity: "Extreme/Observed/Immediate",
      officialUrl: "https://api.weather.gov/alerts/test"
    });
    expect(event.eventTime.toISOString()).toBe("2026-07-08T12:15:00.000Z");
  });

  it("requests only active actual severe and extreme official alerts", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ features: [] }), {
          headers: { "content-type": "application/geo+json" }
        })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await fetchNwsAlerts(NOW);
      expect(fetchMock.mock.calls[0][0]).toBe(NWS_ALERTS_URL);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.headers).toMatchObject({
        accept: "application/geo+json"
      });
      expect((init.headers as Record<string, string>)["user-agent"]).toContain(
        "breakaway-hypothesis-watcher"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
