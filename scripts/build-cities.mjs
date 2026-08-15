/**
 * Regenerates src/data/cities.ts from the GeoNames export.
 *
 *   node scripts/build-cities.mjs
 *
 * Pulls cities15000 + countryInfo, keeps places of 50,000 or more, and writes a
 * single string literal. GeoNames is CC BY 4.0: attribution ships on the page.
 *
 * Committed so the dataset is reproducible rather than a mystery blob — a future
 * reader can see exactly which threshold and which columns produced it.
 */
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const MIN_POPULATION = 50_000;
const OUTPUT = new URL("../src/data/cities.ts", import.meta.url).pathname;

const work = mkdtempSync(join(tmpdir(), "geonames-"));
console.log("workdir", work);

execFileSync("curl", [
  "-sL", "https://download.geonames.org/export/dump/cities15000.zip",
  "-o", join(work, "cities15000.zip")
]);
execFileSync("unzip", ["-o", "-q", join(work, "cities15000.zip"), "-d", work]);
execFileSync("curl", [
  "-sL", "https://download.geonames.org/export/dump/countryInfo.txt",
  "-o", join(work, "countryInfo.txt")
]);

const { readFileSync } = await import("node:fs");

const countries = {};
for (const line of readFileSync(join(work, "countryInfo.txt"), "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const columns = line.split("\t");
  if (columns[0] && columns[4]) countries[columns[0]] = columns[4];
}

const rows = [];
for (const line of readFileSync(join(work, "cities15000.txt"), "utf8").split("\n")) {
  if (!line) continue;
  const columns = line.split("\t");
  const population = Number(columns[14]) || 0;
  if (population < MIN_POPULATION) continue;
  const name = (columns[1] || columns[2] || "").trim();
  const latitude = Number(columns[4]);
  const longitude = Number(columns[5]);
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
  // A tab or newline in a name would corrupt the row format silently.
  if (name.includes("\t") || name.includes("\n")) continue;
  rows.push(
    `${name}\t${columns[8]}\t${latitude.toFixed(3)}\t${longitude.toFixed(3)}\t${population}`
  );
}
// Largest first, so the common "nearest big city" answer is found early.
rows.sort((a, b) => Number(b.split("\t")[4]) - Number(a.split("\t")[4]));

const table = rows.join("\n");
writeFileSync(
  OUTPUT,
  `/**
 * Populated places of ${MIN_POPULATION.toLocaleString("en-US")} or more, for answering "how far is this from people?".
 *
 * Source: GeoNames cities15000 (https://download.geonames.org/export/dump/),
 * licensed CC BY 4.0. Attribution is required and is rendered on the page, in the
 * sources strip alongside the official hazard feeds.
 *
 * Held as ONE string literal rather than an array of objects on purpose: ${rows.length.toLocaleString("en-US")}
 * object literals measurably slow tsc, and this parses once at module load.
 * Columns are name, ISO country code, latitude, longitude, population.
 *
 * Regenerate with scripts/build-cities.mjs. Do not hand-edit.
 */
export const CITY_TABLE = ${JSON.stringify(table)};

/** ISO 3166-1 alpha-2 to country name, from the same GeoNames export. */
export const COUNTRY_NAMES: Record<string, string> = ${JSON.stringify(countries)};

export const CITY_ATTRIBUTION = "City populations: GeoNames (CC BY 4.0)";
`
);
console.log(`wrote ${rows.length} cities to ${OUTPUT}`);
