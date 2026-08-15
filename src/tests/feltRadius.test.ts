import { describe, expect, it } from "vitest";
import {
  AW07_ACTIVE_TECTONIC,
  AW07_STABLE_CONTINENTAL,
  MODEL_MAX_DISTANCE_KM,
  antipode,
  feltRadiusKm,
  feltRings,
  predictMmi
} from "../logic/feltRadius.js";

describe("predictMmi", () => {
  it("matches the published equation on hand-computed points", () => {
    // Worked by hand from Atkinson & Wald (2007) eq. 1 with the California column of
    // table 1, using the real M7.7 Ende, Indonesia event of 2026-08-14 (depth 10 km).
    expect(predictMmi(7.7, 10, 300)).toBeCloseTo(4.01, 1);
    expect(predictMmi(7.7, 10, 100)).toBeCloseTo(5.95, 1);
    expect(predictMmi(7.7, 10, 500)).toBeCloseTo(3.03, 1);
  });

  it("falls off monotonically with distance", () => {
    let previous = Infinity;
    for (let km = 0; km <= 500; km += 5) {
      const value = predictMmi(6.5, 20, km);
      expect(value).toBeLessThan(previous);
      previous = value;
    }
  });

  it("rises monotonically with magnitude at a fixed distance", () => {
    let previous = -Infinity;
    for (let magnitude = 3; magnitude <= 8; magnitude += 0.25) {
      const value = predictMmi(magnitude, 10, 50);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it("shakes less at the surface for a deeper event of the same magnitude", () => {
    expect(predictMmi(6.5, 10, 30)).toBeGreaterThan(predictMmi(6.5, 200, 30));
  });

  it("predicts stronger distant shaking in stable continental crust", () => {
    // The paper's headline finding: CEUS intensities run 1-2 units above California
    // beyond 100-200 km. If this ever inverts, the coefficient columns got swapped.
    expect(predictMmi(6, 10, 300, AW07_STABLE_CONTINENTAL)).toBeGreaterThan(
      predictMmi(6, 10, 300, AW07_ACTIVE_TECTONIC)
    );
  });

  it("treats a missing or negative depth as a surface source rather than NaN", () => {
    expect(predictMmi(6, Number.NaN, 50)).toBe(predictMmi(6, 0, 50));
    expect(predictMmi(6, -5, 50)).toBe(predictMmi(6, 0, 50));
  });
});

describe("feltRadiusKm", () => {
  it("solves to the distance where the model reaches the target intensity", () => {
    const solved = feltRadiusKm(7.7, 10, 4);
    expect(solved).toBeDefined();
    expect(predictMmi(7.7, 10, solved!.radiusKm)).toBeCloseTo(4, 2);
  });

  it("returns a larger radius for a weaker target intensity", () => {
    const weak = feltRadiusKm(7.7, 10, 3)!.radiusKm;
    const strong = feltRadiusKm(7.7, 10, 7)!.radiusKm;
    expect(weak).toBeGreaterThan(strong);
  });

  it("returns undefined when even the epicentre never reaches the target", () => {
    // A M2.5 does not produce MMI VIII anywhere. Undefined is the honest answer;
    // a zero radius would draw a dot and read as "felt severely, right here".
    expect(feltRadiusKm(2.5, 5, 8)).toBeUndefined();
  });

  it("clamps rather than extrapolating past the published distance range", () => {
    const solved = feltRadiusKm(8.8, 10, 2);
    expect(solved).toEqual({ radiusKm: MODEL_MAX_DISTANCE_KM, clamped: true });
  });

  it("refuses non-finite inputs instead of returning a plausible number", () => {
    expect(feltRadiusKm(Number.NaN, 10, 4)).toBeUndefined();
    expect(feltRadiusKm(6, 10, Number.NaN)).toBeUndefined();
  });
});

describe("feltRings", () => {
  it("returns strongest-shaking-first rings that nest inward", () => {
    const rings = feltRings(7.7, 10);
    expect(rings.length).toBeGreaterThan(1);
    for (let index = 1; index < rings.length; index += 1) {
      expect(rings[index].mmi).toBeLessThan(rings[index - 1].mmi);
      expect(rings[index].radiusKm).toBeGreaterThan(rings[index - 1].radiusKm);
    }
  });

  it("gives a small quake only the weak bands", () => {
    const rings = feltRings(3.8, 5.5);
    expect(rings.length).toBeGreaterThan(0);
    expect(Math.max(...rings.map((ring) => ring.mmi))).toBeLessThanOrEqual(5);
  });

  it("returns nothing at all when there is no magnitude", () => {
    expect(feltRings(undefined, 10)).toEqual([]);
    expect(feltRings(Number.NaN, 10)).toEqual([]);
  });

  it("treats a missing depth as a surface source", () => {
    expect(feltRings(6, undefined)).toEqual(feltRings(6, 0));
  });
});

describe("agreement with published USGS ShakeMap contours", () => {
  // Both numbers below were measured against the real cont_mmi.json products, not
  // assumed. They pin the model's two very different behaviours so a future edit
  // cannot quietly change either one.

  it("matches a small point-source California event closely", () => {
    // nc75417557, M3.84 San Leandro CA, depth 5.55 km. USGS DYFI reported cdi 3.8
    // and its MMI 3 contour reaches 19 km. This is the coefficient set's home turf
    // and a genuinely point-like source, so agreement here is the real test of the
    // implementation.
    expect(predictMmi(3.84, 5.55, 0)).toBeCloseTo(3.8, 1);
    const ring = feltRadiusKm(3.84, 5.55, 3)!;
    expect(ring.radiusKm).toBeGreaterThan(17);
    expect(ring.radiusKm).toBeLessThan(23);
  });

  it("under-states the felt extent of a great earthquake, because it is a point source", () => {
    // us6000tkt2, M7.7 Ende Indonesia, depth 10 km. USGS ShakeMap puts MMI 6 out to
    // 120 km and MMI 4 out to 515 km; the point-source model gives 97 km and 302 km.
    // A ~100 km rupture is felt far along strike and no circle centred on the
    // epicentre can express that. This is why the page prefers official ShakeMap
    // contours whenever USGS publishes them and only falls back to this model.
    // The assertion is deliberately on the BIAS DIRECTION: if a future edit ever made
    // the model over-state a great earthquake, the caveat shown to readers is wrong.
    expect(feltRadiusKm(7.7, 10, 6)!.radiusKm).toBeLessThan(120);
    expect(feltRadiusKm(7.7, 10, 4)!.radiusKm).toBeLessThan(515);
  });
});

describe("antipode", () => {
  it("flips latitude and shifts longitude by half a turn", () => {
    expect(antipode(0, 0)).toEqual([-0, 180]);
    expect(antipode(40, 100)).toEqual([-40, -80]);
    expect(antipode(-40, -100)).toEqual([40, 80]);
  });

  it("keeps longitude inside (-180, 180]", () => {
    for (let lon = -180; lon <= 180; lon += 1) {
      const [, antiLon] = antipode(0, lon);
      expect(antiLon).toBeGreaterThan(-180);
      expect(antiLon).toBeLessThanOrEqual(180);
    }
  });

  it("is its own inverse", () => {
    for (const point of [
      [8.7, -121.5],
      [-33.4, 151.2],
      [64.1, -21.9],
      [0, 180],
      [-8.55, 121.4]
    ] as [number, number][]) {
      const [lat, lon] = antipode(...antipode(...point));
      expect(lat).toBeCloseTo(point[0], 10);
      expect(lon).toBeCloseTo(point[1], 10);
    }
  });

  it("sends the real M7.7 Ende epicentre into the eastern Atlantic", () => {
    // 8.55S 121.40E -> 8.55N 58.60W, which is open ocean off Brazil. A sign error
    // in either axis lands it somewhere plausible-looking, so pin the actual value.
    const [lat, lon] = antipode(-8.55, 121.4);
    expect(lat).toBeCloseTo(8.55, 6);
    expect(lon).toBeCloseTo(-58.6, 6);
  });
});
