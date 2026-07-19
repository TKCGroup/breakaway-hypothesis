import { describe, expect, it } from "vitest";
import { normalizeSwpcKpRow } from "../sources/swpc.js";
import { NOW } from "./helpers.js";

describe("SWPC ingestion", () => {
  it("normalizes current object-shaped Kp rows", () => {
    const event = normalizeSwpcKpRow(
      {
        time_tag: "2026-07-12T12:00:00",
        Kp: 4.67,
        a_running: 39,
        station_count: 8
      },
      NOW
    );

    expect(event?.source).toBe("swpc_kp");
    expect(event?.eventType).toBe("space_weather");
    expect(event?.eventTime.toISOString()).toBe("2026-07-12T12:00:00.000Z");
    expect(event?.severity).toBe("Kp4.67");
  });

  it("still supports legacy array-shaped Kp rows", () => {
    const event = normalizeSwpcKpRow(["2026-07-12T15:00:00", "6"], NOW);

    expect(event?.severity).toBe("Kp6/G2");
  });
});
