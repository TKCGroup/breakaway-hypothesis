import { describe, expect, it } from "vitest";
import {
  geoToVector,
  localSolarHour,
  nightFraction,
  solarClientSource,
  solarElevationDeg,
  solarPhaseLabel,
  subsolarPoint,
  twilightBand
} from "../logic/solar.js";

const near = (value: number, target: number) => expect(value).toBeCloseTo(target, 10);

describe("subsolarPoint", () => {
  it("puts the sun over the Tropic of Cancer at the June solstice", () => {
    const sun = subsolarPoint(new Date("2026-06-21T12:00:00Z"));
    expect(sun.lat).toBeGreaterThan(23.2);
    expect(sun.lat).toBeLessThan(23.5);
  });

  it("puts the sun over the Tropic of Capricorn at the December solstice", () => {
    const sun = subsolarPoint(new Date("2026-12-21T12:00:00Z"));
    expect(sun.lat).toBeLessThan(-23.2);
    expect(sun.lat).toBeGreaterThan(-23.5);
  });

  it("puts the sun near the equator at the equinoxes", () => {
    expect(Math.abs(subsolarPoint(new Date("2026-03-20T12:00:00Z")).lat)).toBeLessThan(0.6);
    expect(Math.abs(subsolarPoint(new Date("2026-09-22T20:00:00Z")).lat)).toBeLessThan(0.6);
  });

  it("puts the sun near the prime meridian at noon UTC", () => {
    // The equation of time swings solar noon up to ~16 minutes (4 degrees) either way.
    const sun = subsolarPoint(new Date("2026-08-14T12:00:00Z"));
    expect(Math.abs(sun.lon)).toBeLessThan(5);
  });

  it("advances the subsolar longitude westward by about 15 degrees per hour", () => {
    const noon = subsolarPoint(new Date("2026-08-14T12:00:00Z"));
    const later = subsolarPoint(new Date("2026-08-14T15:00:00Z"));
    let drift = noon.lon - later.lon;
    drift = ((((drift + 180) % 360) + 360) % 360) - 180;
    expect(drift).toBeGreaterThan(44);
    expect(drift).toBeLessThan(46);
  });

  it("always returns a longitude inside (-180, 180]", () => {
    for (let hour = 0; hour < 48; hour += 1) {
      const sun = subsolarPoint(new Date(Date.UTC(2026, 0, 1, hour)));
      expect(sun.lon).toBeGreaterThan(-180);
      expect(sun.lon).toBeLessThanOrEqual(180);
    }
  });
});

describe("solarElevationDeg", () => {
  it("is 90 degrees directly beneath the sun and -90 on the far side", () => {
    const sun = subsolarPoint(new Date("2026-08-14T12:00:00Z"));
    expect(solarElevationDeg(sun.lat, sun.lon, sun)).toBeCloseTo(90, 5);
    const antiLon = sun.lon > 0 ? sun.lon - 180 : sun.lon + 180;
    expect(solarElevationDeg(-sun.lat, antiLon, sun)).toBeCloseTo(-90, 5);
  });

  it("is near zero on the terminator, 90 degrees of longitude from the subsolar point", () => {
    const sun = { lat: 0, lon: 0 };
    expect(Math.abs(solarElevationDeg(0, 90, sun))).toBeLessThan(1e-9);
    expect(Math.abs(solarElevationDeg(0, -90, sun))).toBeLessThan(1e-9);
  });

  it("keeps the summer pole lit around the clock at the solstice", () => {
    const sun = subsolarPoint(new Date("2026-06-21T12:00:00Z"));
    for (let lon = -180; lon < 180; lon += 30) {
      expect(solarElevationDeg(89, lon, sun)).toBeGreaterThan(0);
      expect(solarElevationDeg(-89, lon, sun)).toBeLessThan(0);
    }
  });
});

describe("nightFraction", () => {
  it("reads full day above the horizon and full night below astronomical twilight", () => {
    expect(nightFraction(10)).toBe(0);
    expect(nightFraction(0)).toBe(0);
    expect(nightFraction(-18)).toBe(1);
    expect(nightFraction(-40)).toBe(1);
  });

  it("ramps monotonically through the twilight bands", () => {
    let previous = -1;
    for (let elevation = 0; elevation >= -18; elevation -= 0.5) {
      const value = nightFraction(elevation);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBe(1);
  });
});

describe("twilightBand", () => {
  it("names each band at its boundary", () => {
    expect(twilightBand(1)).toBe("day");
    expect(twilightBand(0)).toBe("day");
    expect(twilightBand(-3)).toBe("civil");
    expect(twilightBand(-6)).toBe("civil");
    expect(twilightBand(-9)).toBe("nautical");
    expect(twilightBand(-15)).toBe("astronomical");
    expect(twilightBand(-19)).toBe("night");
  });
});

describe("localSolarHour", () => {
  it("reads 12:00 beneath the sun and 00:00 on the far side", () => {
    const sun = { lat: 0, lon: 0 };
    expect(localSolarHour(0, sun)).toBeCloseTo(12, 6);
    expect(localSolarHour(180, sun)).toBeCloseTo(0, 6);
    expect(localSolarHour(-90, sun)).toBeCloseTo(6, 6);
    expect(localSolarHour(90, sun)).toBeCloseTo(18, 6);
  });

  it("stays inside a 24 hour day for every longitude", () => {
    const sun = subsolarPoint(new Date("2026-08-14T03:17:00Z"));
    for (let lon = -180; lon <= 180; lon += 7) {
      const hour = localSolarHour(lon, sun);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThan(24);
    }
  });
});

describe("solarPhaseLabel", () => {
  it("separates dawn from dusk using the solar clock, not the elevation alone", () => {
    expect(solarPhaseLabel(-3, 5)).toBe("dawn");
    expect(solarPhaseLabel(-3, 19)).toBe("dusk");
  });

  it("walks morning through evening while the sun is up", () => {
    expect(solarPhaseLabel(20, 8)).toBe("morning");
    expect(solarPhaseLabel(60, 12)).toBe("midday");
    expect(solarPhaseLabel(30, 15)).toBe("afternoon");
    expect(solarPhaseLabel(5, 18)).toBe("evening");
    expect(solarPhaseLabel(-30, 2)).toBe("night");
  });
});

describe("geoToVector", () => {
  // The globe places every marker with this function and shades night with it too,
  // so a flipped sign would put earthquakes somewhere plausible-looking and wrong.
  // Pin the cardinal points explicitly rather than trusting the derivation.
  it("puts the null island on the +x axis", () => {
    const v = geoToVector(0, 0);
    near(v.x, 1);
    near(v.y, 0);
    near(v.z, 0);
  });

  it("puts the north pole on +y and the south pole on -y at every longitude", () => {
    for (const lon of [-180, -90, 0, 90, 180]) {
      near(geoToVector(90, lon).y, 1);
      near(geoToVector(-90, lon).y, -1);
    }
  });

  it("runs east into -z, matching the texture's u = lon/360 + 0.5 convention", () => {
    near(geoToVector(0, 90).z, -1);
    near(geoToVector(0, -90).z, 1);
    near(geoToVector(0, 180).x, -1);
    near(geoToVector(0, -180).x, -1);
  });

  it("returns a unit vector everywhere, and scales by radius", () => {
    for (let lat = -90; lat <= 90; lat += 15) {
      for (let lon = -180; lon <= 180; lon += 30) {
        const v = geoToVector(lat, lon);
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
        const scaled = geoToVector(lat, lon, 3);
        expect(Math.hypot(scaled.x, scaled.y, scaled.z)).toBeCloseTo(3, 12);
      }
    }
  });

  it("agrees with the solar elevation model about which side faces the sun", () => {
    // Independent cross-check: the dot product of a point's vector with the subsolar
    // point's vector must have the same sign as its computed solar elevation. If the
    // globe's geometry and the map's shading ever disagreed, the same instant would
    // render as day on one view and night on the other.
    const when = new Date("2026-08-14T21:58:21Z");
    const sun = subsolarPoint(when);
    const sunVector = geoToVector(sun.lat, sun.lon);
    for (let lat = -75; lat <= 75; lat += 15) {
      for (let lon = -180; lon < 180; lon += 20) {
        const point = geoToVector(lat, lon);
        const dot = point.x * sunVector.x + point.y * sunVector.y + point.z * sunVector.z;
        const elevation = solarElevationDeg(lat, lon, sun);
        expect(Math.asin(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI)).toBeCloseTo(
          elevation,
          8
        );
      }
    }
  });
});

describe("solarClientSource", () => {
  // The page ships these functions by serialising them. If serialisation ever stopped
  // producing runnable, equivalent code the map would shade night wrongly while every
  // test above stayed green, so the emitted string is executed and re-checked here.
  const evaluated = new Function(
    solarClientSource() +
      "\nreturn { subsolarPoint: subsolarPoint, solarElevationDeg: solarElevationDeg," +
      " nightFraction: nightFraction, twilightBand: twilightBand," +
      " localSolarHour: localSolarHour, solarPhaseLabel: solarPhaseLabel," +
      " TWILIGHT_BANDS: TWILIGHT_BANDS };"
  )() as {
    subsolarPoint: typeof subsolarPoint;
    solarElevationDeg: typeof solarElevationDeg;
    nightFraction: typeof nightFraction;
    twilightBand: typeof twilightBand;
    localSolarHour: typeof localSolarHour;
    solarPhaseLabel: typeof solarPhaseLabel;
    TWILIGHT_BANDS: unknown;
  };

  it("emits a runnable subsolar point identical to the module", () => {
    for (const iso of [
      "2026-01-05T00:00:00Z",
      "2026-03-20T12:00:00Z",
      "2026-06-21T18:30:00Z",
      "2026-08-14T21:58:21Z",
      "2026-12-21T06:00:00Z"
    ]) {
      const when = new Date(iso);
      expect(evaluated.subsolarPoint(when)).toEqual(subsolarPoint(when));
    }
  });

  it("emits elevation, night, band, clock and phase identical to the module", () => {
    const sun = subsolarPoint(new Date("2026-08-14T21:58:21Z"));
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lon = -180; lon < 180; lon += 45) {
        const elevation = solarElevationDeg(lat, lon, sun);
        expect(evaluated.solarElevationDeg(lat, lon, sun)).toBe(elevation);
        expect(evaluated.nightFraction(elevation)).toBe(nightFraction(elevation));
        expect(evaluated.twilightBand(elevation)).toBe(twilightBand(elevation));
        const hour = localSolarHour(lon, sun);
        expect(evaluated.localSolarHour(lon, sun)).toBe(hour);
        expect(evaluated.solarPhaseLabel(elevation, hour)).toBe(solarPhaseLabel(elevation, hour));
      }
    }
  });

  it("carries the twilight band table across", () => {
    expect(evaluated.TWILIGHT_BANDS).toEqual(JSON.parse(JSON.stringify(TWILIGHT_BANDS_SNAPSHOT)));
  });
});

const TWILIGHT_BANDS_SNAPSHOT = [
  { id: "day", floorDeg: 0, label: "Daylight" },
  { id: "civil", floorDeg: -6, label: "Civil twilight — sunrise / sunset" },
  { id: "nautical", floorDeg: -12, label: "Nautical twilight — dusk / dawn" },
  { id: "astronomical", floorDeg: -18, label: "Astronomical twilight" },
  { id: "night", floorDeg: -90, label: "Night" }
];
