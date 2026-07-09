import { runMigrations } from "./migrations.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations");
  process.exitCode = 1;
} else {
  runMigrations(databaseUrl).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
