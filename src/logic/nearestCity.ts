/**
 * "How far is this from people?"
 *
 * A magnitude alone does not tell a reader whether an earthquake matters. M7.7 in
 * the open ocean and M7.7 under a city are the same number and completely different
 * events. This answers the question the number leaves open, at two scales: the
 * nearest town of any size worth naming, and the nearest genuinely large population.
 */

import { CITY_ATTRIBUTION, CITY_TABLE, COUNTRY_NAMES } from "../data/cities.js";

export interface City {
  name: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
}

export interface NearbyCity extends City {
  /** Great-circle distance from the query point, kilometres. */
  distanceKm: number;
  /** Compass direction from the city TO the event, e.g. "NNW". */
  bearing: string;
}

export interface NearestPopulation {
  /** Closest place of at least NEARBY_MIN_POPULATION. */
  nearest?: NearbyCity;
  /** Closest place of at least MAJOR_MIN_POPULATION, when that is a different city. */
  major?: NearbyCity;
}

/** Small enough to be local context, large enough to be a recognisable place. */
export const NEARBY_MIN_POPULATION = 50_000;
/** "A major population" in the sense a reader means it. */
export const MAJOR_MIN_POPULATION = 250_000;

export { CITY_ATTRIBUTION };

let parsed: City[] | undefined;

/** Parsed once, on first use. */
export function cities(): City[] {
  if (parsed) return parsed;
  const rows: City[] = [];
  for (const line of CITY_TABLE.split("\n")) {
    if (!line) continue;
    const [name, countryCode, lat, lon, population] = line.split("\t");
    const latitude = Number(lat);
    const longitude = Number(lon);
    const people = Number(population);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    rows.push({
      name,
      countryCode,
      country: COUNTRY_NAMES[countryCode] ?? countryCode,
      lat: latitude,
      lon: longitude,
      population: Number.isFinite(people) ? people : 0
    });
  }
  parsed = rows;
  return parsed;
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): number {
  const earthRadiusKm = 6371;
  const toRad = Math.PI / 180;
  const dLat = (toLat - fromLat) * toRad;
  const dLon = (toLon - fromLon) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(fromLat * toRad) * Math.cos(toLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
];

/** Compass direction from one point to another, to 16 points like USGS uses. */
export function bearingFrom(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): string {
  const toRad = Math.PI / 180;
  const dLon = (toLon - fromLon) * toRad;
  const y = Math.sin(dLon) * Math.cos(toLat * toRad);
  const x =
    Math.cos(fromLat * toRad) * Math.sin(toLat * toRad) -
    Math.sin(fromLat * toRad) * Math.cos(toLat * toRad) * Math.cos(dLon);
  const degrees = (Math.atan2(y, x) / toRad + 360) % 360;
  return COMPASS[Math.round(degrees / 22.5) % 16];
}

/** Kilometres per degree of latitude. Longitude degrees shrink toward the poles; latitude degrees do not. */
const KM_PER_DEGREE_LATITUDE = (Math.PI / 180) * 6371;

/**
 * Nearest city at or above a population floor.
 *
 * Widening latitude boxes rather than one pass over all 12,366 rows: an event in a
 * populated region resolves inside the first box, and an event in the middle of the
 * Pacific still gets a true answer from the last one instead of a null.
 *
 * The subtlety, and it is the whole correctness argument: finding a city inside the
 * box is NOT enough to stop. Any city outside a box of half-height S is at least
 * S * 111.19 km away, so the in-box winner can only be accepted once its distance is
 * within that bound. Without the check the search returns the nearest city *in the
 * band*, which at high latitude can be much further away in longitude than a city
 * just outside it — at 71N 25E it answered Bergen when the true answer is Glasgow.
 * That was caught by the test that compares this against an exhaustive scan, not by
 * reading the code.
 */
export function nearestCityAbove(
  lat: number,
  lon: number,
  minPopulation: number,
  table = cities()
): NearbyCity | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  for (const latitudeSpan of [5, 15, 45, 180]) {
    let best: City | undefined;
    let bestDistance = Infinity;
    for (const city of table) {
      if (city.population < minPopulation) continue;
      if (Math.abs(city.lat - lat) > latitudeSpan) continue;
      const distance = distanceKm(lat, lon, city.lat, city.lon);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = city;
      }
    }
    const provenBest = best && bestDistance <= latitudeSpan * KM_PER_DEGREE_LATITUDE;
    // The last span covers the whole planet, so nothing can lie outside it.
    if (best && (provenBest || latitudeSpan >= 180)) {
      return {
        ...best,
        distanceKm: Math.round(bestDistance),
        bearing: bearingFrom(best.lat, best.lon, lat, lon)
      };
    }
  }
  return undefined;
}

/**
 * Both scales at once. `major` is omitted when it would just repeat `nearest` —
 * a quake next to a big city should say so once, not twice.
 */
export function nearestPopulation(
  lat: number,
  lon: number,
  table = cities()
): NearestPopulation | undefined {
  const nearest = nearestCityAbove(lat, lon, NEARBY_MIN_POPULATION, table);
  const major = nearestCityAbove(lat, lon, MAJOR_MIN_POPULATION, table);
  if (!nearest && !major) return undefined;
  const sameCity =
    nearest && major && nearest.name === major.name && nearest.countryCode === major.countryCode;
  return { nearest, major: sameCity ? undefined : major };
}
