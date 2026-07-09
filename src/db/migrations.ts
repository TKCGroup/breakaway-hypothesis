import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));

export function loadSchemaSql(): string {
  return readFileSync(join(here, "schema.sql"), "utf8");
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(loadSchemaSql());
  } finally {
    await pool.end();
  }
}
