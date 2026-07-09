import { describe, expect, it } from "vitest";
import { matchRegion } from "../logic/regionMatcher.js";

describe("region matcher", () => {
  it("maps Mt Rainier summit quake to CASCADE_VOLCANOES_RAINIER", () => {
    expect(matchRegion(46.8523, -121.7603)).toBe("CASCADE_VOLCANOES_RAINIER");
  });

  it("maps St Helens summit quake to CASCADE_VOLCANOES_ST_HELENS", () => {
    expect(matchRegion(46.1912, -122.1944)).toBe("CASCADE_VOLCANOES_ST_HELENS");
  });

  it("maps offshore Blanco/Mendocino events to the offshore bucket", () => {
    expect(matchRegion(43.1, -127.4)).toBe("NORCAL_OFFSHORE_MENDOCINO_BLANCO");
  });

  it("maps Yellowstone caldera events to YELLOWSTONE", () => {
    expect(matchRegion(44.43, -110.67)).toBe("YELLOWSTONE");
  });
});
