import { describe, expect, it } from "vitest";
import { evaluateCascade } from "../logic/cascade.js";
import { normalizeHansNotice } from "../sources/usgsHans.js";
import { NOW } from "./helpers.js";

describe("HANS ingestion", () => {
  it("normalizes current elevated volcano payload fields", () => {
    const event = normalizeHansNotice(
      {
        volcano_name: "Great Sitkin",
        vnum: "311120",
        notice_identifier: "DOI-USGS-AVO-2026-07-18T19:31:29+00:00",
        sent_utc: "2026-07-18 19:40:52",
        color_code: "ORANGE",
        alert_level: "WATCH",
        notice_url: "https://volcanoes.usgs.gov/hans-public/notice/DOI-USGS-AVO-2026-07-18T19:31:29+00:00"
      },
      NOW
    );

    expect(event.source).toBe("usgs_hans");
    expect(event.externalId).toContain("DOI-USGS-AVO");
    expect(event.severity).toBe("WATCH/ORANGE");
    expect(event.officialUrl).toContain("hans-public/notice");
  });

  it("does not notify for elevated HANS volcanoes outside configured target regions", () => {
    const event = normalizeHansNotice(
      {
        volcano_name: "Great Sitkin",
        vnum: "311120",
        notice_identifier: "DOI-USGS-AVO-2026-07-18T19:31:29+00:00",
        sent_utc: "2026-07-19 16:40:52",
        color_code: "ORANGE",
        alert_level: "WATCH",
        notice_url: "https://volcanoes.usgs.gov/hans-public/notice/DOI-USGS-AVO-2026-07-18T19:31:29+00:00"
      },
      NOW
    );
    const state = evaluateCascade({ event, now: NOW });

    expect(event.region).toBeUndefined();
    expect(state.stage).toBe("S0");
    expect(state.shouldNotify).toBe(false);
  });
});
