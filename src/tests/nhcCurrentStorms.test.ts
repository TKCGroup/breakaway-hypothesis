import { describe, expect, it, vi } from "vitest";
import {
  NHC_CURRENT_STORMS_URL,
  fetchNhcCurrentStorms,
  normalizeNhcStorm
} from "../sources/nhcCurrentStorms.js";
import { NOW } from "./helpers.js";

describe("NHC CurrentStorms source", () => {
  it("normalizes EPAC hurricane position, intensity, and official advisory URL", () => {
    const event = normalizeNhcStorm(
      {
        id: "ep172026",
        binNumber: "EP2",
        name: "Polo",
        classification: "HU",
        intensity: "150",
        pressure: "900",
        latitude: "14.6N",
        longitude: "101.4W",
        latitudeNumeric: 14.6,
        longitudeNumeric: -101.4,
        movementDir: 90,
        movementSpeed: 1,
        lastUpdate: "2026-09-23T00:00:00.000Z",
        publicAdvisory: {
          advNum: "012",
          issuance: "2026-09-23T00:00:00.000Z",
          url: "https://www.nhc.noaa.gov/text/MIATCPEP2.shtml"
        }
      },
      NOW
    );

    expect(event).toMatchObject({
      source: "nhc_current_storms",
      externalId: "ep172026",
      eventType: "tropical_cyclone",
      title: "Hurricane Polo",
      lat: 14.6,
      lon: -101.4,
      magnitude: 150,
      severity: "HU/150 kt/900 mb/EPAC",
      officialUrl: "https://www.nhc.noaa.gov/text/MIATCPEP2.shtml"
    });
    expect(event.eventTime.toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(event.body).toContain("EPAC");
  });

  it("normalizes CPAC and Atlantic basin tags from storm id", () => {
    const cpac = normalizeNhcStorm(
      {
        id: "cp012026",
        binNumber: "CP1",
        name: "Lala",
        classification: "TS",
        intensity: 45,
        latitudeNumeric: 20,
        longitudeNumeric: -160,
        lastUpdate: "2026-09-22T18:00:00.000Z"
      },
      NOW
    );
    const atlantic = normalizeNhcStorm(
      {
        id: "al062026",
        binNumber: "AT1",
        name: "Fay",
        classification: "PTC",
        intensity: 30,
        latitudeNumeric: 30.8,
        longitudeNumeric: -35.3,
        lastUpdate: "2026-09-22T21:00:00.000Z"
      },
      NOW
    );

    expect(cpac.severity).toContain("CPAC");
    expect(cpac.title).toBe("Tropical Storm Lala");
    expect(atlantic.severity).toContain("Atlantic");
    expect(atlantic.title).toBe("Potential Tropical Cyclone Fay");
  });

  it("fetches the official NHC CurrentStorms.json feed", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ activeStorms: [] }), {
          headers: { "content-type": "application/json" }
        })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await fetchNhcCurrentStorms(NOW);
      expect(fetchMock.mock.calls[0][0]).toBe(NHC_CURRENT_STORMS_URL);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.headers).toMatchObject({
        accept: "application/json"
      });
      expect((init.headers as Record<string, string>)["user-agent"]).toContain(
        "breakaway-hypothesis-watcher"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
