/**
 * Where the sun is, so the map can shade night.
 *
 * Low-precision solar position from the Astronomical Almanac's "Approximate Solar
 * Coordinates" (the same formulation NOAA publishes for solar-calculator use).
 * Declination is good to roughly 0.01 degrees over 1950-2050, which is far finer
 * than a twilight band is wide.
 *
 * Every function here is self-contained on purpose: `solarClientSource()` serialises
 * them into the browser bundle so the page and the tests run byte-identical code.
 * Do not add imports, closures, or module-scope references to this file.
 */

export interface SubsolarPoint {
  /** Geographic latitude directly under the sun, degrees north. */
  lat: number;
  /** Geographic longitude directly under the sun, degrees east, in (-180, 180]. */
  lon: number;
}

/** Twilight boundaries in degrees of solar elevation, brightest first. */
export const TWILIGHT_BANDS = [
  { id: "day", floorDeg: 0, label: "Daylight" },
  { id: "civil", floorDeg: -6, label: "Civil twilight — sunrise / sunset" },
  { id: "nautical", floorDeg: -12, label: "Nautical twilight — dusk / dawn" },
  { id: "astronomical", floorDeg: -18, label: "Astronomical twilight" },
  { id: "night", floorDeg: -90, label: "Night" }
] as const;

export function subsolarPoint(when: Date): SubsolarPoint {
  var days = when.getTime() / 86400000 + 2440587.5 - 2451545;
  var meanLongitude = 280.46 + 0.9856474 * days;
  var meanAnomaly = (357.528 + 0.9856003 * days) * (Math.PI / 180);
  var eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) *
    (Math.PI / 180);
  var obliquity = (23.439 - 0.0000004 * days) * (Math.PI / 180);
  var declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  var rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude)
  );
  var siderealTime = 280.46061837 + 360.98564736629 * days;
  var lon = rightAscension * (180 / Math.PI) - siderealTime;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: declination * (180 / Math.PI), lon: lon };
}

/** Solar elevation above the horizon at a point, in degrees. Negative is below. */
export function solarElevationDeg(lat: number, lon: number, sun: SubsolarPoint): number {
  var toRad = Math.PI / 180;
  var sinElevation =
    Math.sin(lat * toRad) * Math.sin(sun.lat * toRad) +
    Math.cos(lat * toRad) * Math.cos(sun.lat * toRad) * Math.cos((lon - sun.lon) * toRad);
  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) * (180 / Math.PI);
}

/**
 * How dark a point is, 0 (full day) to 1 (full night), ramping smoothly through
 * the twilight bands so the overlay reads as a gradient rather than a hard edge.
 */
export function nightFraction(elevationDeg: number): number {
  if (elevationDeg >= 0) return 0;
  if (elevationDeg <= -18) return 1;
  return -elevationDeg / 18;
}

/** Which named band a solar elevation falls in. */
export function twilightBand(elevationDeg: number): string {
  if (elevationDeg >= 0) return "day";
  if (elevationDeg >= -6) return "civil";
  if (elevationDeg >= -12) return "nautical";
  if (elevationDeg >= -18) return "astronomical";
  return "night";
}

/**
 * Local solar clock at a longitude, as a 0-24 hour number. Drives the
 * morning / afternoon / evening wording rather than the shading itself.
 */
export function localSolarHour(lon: number, sun: SubsolarPoint): number {
  var offset = lon - sun.lon;
  offset = ((((offset + 180) % 360) + 360) % 360) - 180;
  return (offset / 15 + 12 + 24) % 24;
}

export function solarPhaseLabel(elevationDeg: number, solarHour: number): string {
  if (elevationDeg < -18) return "night";
  if (elevationDeg < 0) return solarHour < 12 ? "dawn" : "dusk";
  if (solarHour < 11) return "morning";
  if (solarHour < 14) return "midday";
  if (solarHour < 17) return "afternoon";
  return "evening";
}

export interface UnitVector {
  x: number;
  y: number;
  z: number;
}

/**
 * Cartesian position of a lat/lon on the globe, in the frame that
 * THREE.SphereGeometry uses for an equirectangular texture.
 *
 * three.js generates `uv.x = u` with `phi = u * 2PI` and `uv.y = 1 - v` with
 * `theta = v * PI`, so an equirectangular image maps as `u = lon/360 + 0.5` and
 * `v = (90 - lat)/180`. Substituting those into the generator's vertex formula and
 * simplifying gives what is below. It is derived from that convention rather than
 * guessed, and the tests pin the cardinal points: a sign error here would place
 * every earthquake somewhere plausible-looking but wrong.
 */
export function geoToVector(lat: number, lon: number, radius?: number): UnitVector {
  var theta = ((90 - lat) * Math.PI) / 180;
  var lonRad = (lon * Math.PI) / 180;
  var r = radius === undefined ? 1 : radius;
  return {
    x: r * Math.sin(theta) * Math.cos(lonRad),
    y: r * Math.cos(theta),
    z: -r * Math.sin(theta) * Math.sin(lonRad)
  };
}

/**
 * The same functions above, serialised for the browser.
 *
 * One source of truth: the page and the vitest suite execute the identical bodies,
 * so a change to the maths cannot silently apply to only one of them. This is only
 * safe because nothing here closes over module scope — `solar.test.ts` evaluates the
 * emitted string and re-runs the numeric assertions against it to prove that holds.
 */
export function solarClientSource(): string {
  return [
    "var TWILIGHT_BANDS = " + JSON.stringify(TWILIGHT_BANDS) + ";",
    "var subsolarPoint = " + subsolarPoint.toString() + ";",
    "var solarElevationDeg = " + solarElevationDeg.toString() + ";",
    "var nightFraction = " + nightFraction.toString() + ";",
    "var twilightBand = " + twilightBand.toString() + ";",
    "var localSolarHour = " + localSolarHour.toString() + ";",
    "var solarPhaseLabel = " + solarPhaseLabel.toString() + ";",
    "var geoToVector = " + geoToVector.toString() + ";"
  ].join("\n");
}
