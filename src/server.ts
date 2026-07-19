import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { createRepository } from "./db/createRepository.js";
import { runMigrations } from "./db/migrations.js";
import { runOnce } from "./worker.js";

const config = loadConfig();
const port = Number(process.env.PORT ?? 8080);
let running = false;

async function handleRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    writeJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const schedulerSecret = process.env.SCHEDULER_SHARED_SECRET;
  if (!schedulerSecret) {
    writeJson(res, 503, { ok: false, error: "scheduler_secret_unset" });
    return;
  }

  if (req.headers["x-breakaway-cron-key"] !== schedulerSecret) {
    writeJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  if (running) {
    writeJson(res, 409, { ok: false, error: "run_already_in_progress" });
    return;
  }

  const startedAt = new Date();
  const handle = createRepository();
  running = true;

  try {
    await runOnce(startedAt, handle.repo);
    writeJson(res, 200, {
      ok: true,
      dryRun: config.dryRun,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString()
    });
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString()
    });
  } finally {
    running = false;
    await handle.close();
  }
}

export function createWatcherServer() {
  return createServer((req, res) => {
    void route(req, res);
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/" || pathname === "/healthz") {
    writeJson(res, 200, { ok: true, dryRun: config.dryRun });
    return;
  }

  if (pathname === "/run") {
    await handleRun(req, res);
    return;
  }

  writeJson(res, 404, { ok: false, error: "not_found" });
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function start(): Promise<void> {
  if (process.env.RUN_MIGRATIONS_ON_START === "true") {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required when RUN_MIGRATIONS_ON_START=true");
    }
    await runMigrations(process.env.DATABASE_URL);
  }

  createWatcherServer().listen(port, () => {
    console.log(`geospace watcher listening on :${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
