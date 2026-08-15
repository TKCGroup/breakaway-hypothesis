import { describe, expect, it } from "vitest";
import {
  MAJOR_MIN_POPULATION,
  NEARBY_MIN_POPULATION,
  bearingFrom,
  cities,
  distanceKm,
  nearestCityAbove,
  nearestPopulation
} from "../logic/nearestCity.js";

describe("city table", () => {
  it("parses every row into a usable record", () => {
    const table = cities();
    expect(table.length).toBeGreaterThan(10_000);
    for (const city of table) {
      expect(city.name.length).toBeGreaterThan(0);
      expect(city.lat).toBeGreaterThanOrEqual(-90);
      expect(city.lat).toBeLessThanOrEqual(90);
      expect(city.lon).toBeGreaterThanOrEqual(-180);
      expect(city.lon).toBeLessThanOrEqual(180);
      expect(city.population).toBeGreaterThanOrEqual(NEARBY_MIN_POPULATION);
    }
  });

  it("resolves country codes to names", () => {
    const table = cities();
    const jakarta = table.find((city) => city.name === "Jakarta");
    expect(jakarta?.country).toBe("Indonesia");
    // A code with no entry must fall back to the code, never to undefined.
    expect(table.every((city) => typeof city.country === "string" && city.country.length)).toBe(true);
  });

  it("returns the same array on repeated calls rather than reparsing", () => {
    expect(cities()).toBe(cities());
  });
});

describe("distanceKm", () => {
  it("is zero at the same point and symmetric", () => {
    expect(distanceKm(10, 20, 10, 20)).toBe(0);
    expect(distanceKm(10, 20, -30, 140)).toBeCloseTo(distanceKm(-30, 140, 10, 20), 9);
  });

  it("matches known great-circle distances", () => {
    // London Heathrow to JFK is about 5,555 km; Sydney to Auckland about 2,155 km.
    expect(distanceKm(51.47, -0.4543, 40.6413, -73.7781)).toBeGreaterThan(5500);
    expect(distanceKm(51.47, -0.4543, 40.6413, -73.7781)).toBeLessThan(5620);
    expect(distanceKm(-33.8688, 151.2093, -36.8485, 174.7633)).toBeGreaterThan(2100);
    expect(distanceKm(-33.8688, 151.2093, -36.8485, 174.7633)).toBeLessThan(2210);
  });

  it("measures across the antimeridian the short way", () => {
    // 179E to 179W is 2 degrees apart, not 358.
    expect(distanceKm(0, 179, 0, -179)).toBeLessThan(250);
  });

  it("gets a quarter of the way round the planet from equator to pole", () => {
    expect(distanceKm(0, 0, 90, 0)).toBeCloseTo((Math.PI / 2) * 6371, 0);
  });
});

describe("bearingFrom", () => {
  it("names the cardinal directions", () => {
    expect(bearingFrom(0, 0, 10, 0)).toBe("N");
    expect(bearingFrom(0, 0, -10, 0)).toBe("S");
    expect(bearingFrom(0, 0, 0, 10)).toBe("E");
    expect(bearingFrom(0, 0, 0, -10)).toBe("W");
  });

  it("names an intercardinal direction", () => {
    expect(bearingFrom(0, 0, 10, 10)).toBe("NE");
  });
});

describe("nearestCityAbove", () => {
  it("finds the town beside the M7.7 Ende epicentre", () => {
    // A point in the M7.7 rupture area, roughly 43 km from Ende (pop 87,269).
    // The exact published epicentre is pinned separately in the next test.
    const city = nearestCityAbove(-8.55, 121.4, NEARBY_MIN_POPULATION)!;
    expect(city.name).toBe("Ende");
    expect(city.country).toBe("Indonesia");
    expect(city.distanceKm).toBeGreaterThan(20);
    expect(city.distanceKm).toBeLessThan(70);
  });

  it("reproduces USGS's own distance and bearing for the M7.7", () => {
    // USGS titles that event "M 7.7 - 68 km NNW of Ende, Indonesia", from an
    // epicentre it publishes as 8.3101S 121.3517E. Our distance and bearing are
    // computed from scratch against a different dataset, so matching USGS to the
    // kilometre is an independent check of both functions rather than a check of
    // this code against itself.
    //
    // The first version of this test used the rounded 8.55S 121.40E from an earlier
    // note and got 43 km. The code was right and the test's input was wrong, which
    // is exactly why the expected value here is USGS's own published epicentre.
    const city = nearestCityAbove(-8.3101, 121.3517, NEARBY_MIN_POPULATION)!;
    expect(city.name).toBe("Ende");
    expect(city.distanceKm).toBe(68);
    expect(city.bearing).toBe("NNW");
  });

  it("finds a genuinely large population further away for the same event", () => {
    const city = nearestCityAbove(-8.55, 121.4, MAJOR_MIN_POPULATION)!;
    expect(city.population).toBeGreaterThanOrEqual(MAJOR_MIN_POPULATION);
    // Whatever the answer is, it must be further than the small-town answer.
    expect(city.distanceKm).toBeGreaterThan(
      nearestCityAbove(-8.55, 121.4, NEARBY_MIN_POPULATION)!.distanceKm
    );
  });

  it("still answers in the middle of an ocean instead of giving up", () => {
    // Point Nemo, the oceanic pole of inaccessibility. The widening search has to
    // fall all the way through to the last box rather than returning undefined.
    const city = nearestCityAbove(-48.876, -123.393, MAJOR_MIN_POPULATION);
    expect(city).toBeDefined();
    expect(city!.distanceKm).toBeGreaterThan(3000);
  });

  it("agrees with an exhaustive scan across the whole planet", () => {
    // The widening-box search is an optimisation, and a wrong answer from it is a
    // plausible-looking city rather than an error. A handful of sample points is not
    // evidence it is correct: the first version of this test used eight, and the one
    // that failed (71N 25E) only appeared because northern Norway happened to be in
    // the list. So sweep a global grid and compare every answer against a plain scan.
    const table = cities();
    const points: [number, number][] = [];
    for (let lat = -85; lat <= 85; lat += 10) {
      for (let lon = -170; lon <= 170; lon += 20) points.push([lat, lon]);
    }
    // Plus the named cases worth keeping legible in the failure output.
    points.push([-8.55, 121.4], [37.755, -122.15], [35.68, 139.69], [71.0, 25.0]);
    expect(points.length).toBeGreaterThan(300);

    for (const [lat, lon] of points) {
      for (const floor of [NEARBY_MIN_POPULATION, MAJOR_MIN_POPULATION]) {
        let best;
        let bestDistance = Infinity;
        for (const city of table) {
          if (city.population < floor) continue;
          const distance = distanceKm(lat, lon, city.lat, city.lon);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = city;
          }
        }
        const found = nearestCityAbove(lat, lon, floor, table);
        expect(found?.name).toBe(best?.name);
        expect(found?.distanceKm).toBe(Math.round(bestDistance));
      }
    }
  });

  it("refuses non-finite coordinates rather than returning a random city", () => {
    expect(nearestCityAbove(Number.NaN, 10, NEARBY_MIN_POPULATION)).toBeUndefined();
    expect(nearestCityAbove(10, Number.NaN, NEARBY_MIN_POPULATION)).toBeUndefined();
  });
});

describe("nearestPopulation", () => {
  it("reports both scales when they are different places", () => {
    const result = nearestPopulation(-8.55, 121.4)!;
    expect(result.nearest?.name).toBe("Ende");
    expect(result.major).toBeDefined();
    expect(result.major!.name).not.toBe("Ende");
  });

  it("does not repeat one city as both answers", () => {
    // Directly under Tokyo: the nearest town and the nearest major population are
    // the same place, and saying it twice reads as two separate facts.
    const result = nearestPopulation(35.68, 139.69)!;
    expect(result.nearest).toBeDefined();
    expect(result.major).toBeUndefined();
  });
});
