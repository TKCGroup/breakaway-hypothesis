import { describe, expect, it, vi } from "vitest";
import { createSpaceWeatherWindow } from "../logic/cascade.js";
import { DONKI_KINDS, donkiUrl, fetchDonkiEvents, normalizeDonkiEvent } from "../sources/donki.js";
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

  const cme = {
    activityID: "2026-10-14T00:00:00-CME-001",
    startTime: "2026-10-14T00:00Z",
    submissionTime: "2026-10-14T01:00Z",
    link: "https://ccmc.gsfc.nasa.gov/DONKI/view/CME/1"
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  async function withFetch<T>(impl: (url: string, init?: RequestInit) => Promise<Response>, run: (mock: ReturnType<typeof vi.fn>) => Promise<T>): Promise<T> {
    const originalFetch = globalThis.fetch;
    const mock = vi.fn(impl);
    globalThis.fetch = mock as unknown as typeof fetch;
    try {
      return await run(mock);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it("calls the CCMC web service with no API key", () => {
    const url = donkiUrl("CME", new Date("2026-10-08T00:00Z"), new Date("2026-10-15T00:00Z"));
    expect(url).toBe("https://ccmc.gsfc.nasa.gov/DONKI/WS/get/CME?startDate=2026-10-08&endDate=2026-10-15");
    expect(url).not.toContain("api_key");
  });

  it("rejects when every kind is redirected (the 2026-09-30 move), so the run records an error", async () => {
    await withFetch(
      async () => new Response("", { status: 301, headers: { location: "https://ccmc.gsfc.nasa.gov/news/major-updates" } }),
      async (mock) => {
        await expect(fetchDonkiEvents(undefined, NOW)).rejects.toThrow(/all 6 kinds failed.*moved: 301/);
        expect(mock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.redirect === "manual")).toBe(true);
      }
    );
  });

  it("rejects an HTML page served with 200 instead of reading it as an empty week", async () => {
    await withFetch(
      async () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      async () => {
        await expect(fetchDonkiEvents(undefined, NOW)).rejects.toThrow(/not JSON/);
      }
    );
  });

  it("rejects JSON that is not an array", async () => {
    await withFetch(async () => json({ error: "nope" }), async () => {
      await expect(fetchDonkiEvents(undefined, NOW, ["CME"])).rejects.toThrow(/not an array/);
    });
  });

  it("keeps the kinds that answered when only some fail", async () => {
    await withFetch(
      async (url) => (url.includes("/CME?") ? json([cme]) : new Response("", { status: 404, statusText: "Not Found" })),
      async () => {
        const events = await fetchDonkiEvents(undefined, NOW);
        expect(events).toHaveLength(1);
        expect(events[0].externalId).toBe(cme.activityID);
      }
    );
  });

  it("treats a real empty week (every kind answers []) as success with no events", async () => {
    await withFetch(async () => json([]), async (mock) => {
      await expect(fetchDonkiEvents(undefined, NOW)).resolves.toEqual([]);
      expect(mock).toHaveBeenCalledTimes(DONKI_KINDS.length);
    });
  });
});
