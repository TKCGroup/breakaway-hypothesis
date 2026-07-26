import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { loadConfig, type WatcherConfig } from "./config.js";
import { createRepository, type RepositoryHandle } from "./db/createRepository.js";
import { runMigrations } from "./db/migrations.js";
import {
  buildDashboardData,
  dashboardHtml,
  loadDashboardSnapshot
} from "./dashboard.js";
import { buildEarthWatchData, earthWatchHtml } from "./earth.js";
import { barkleyVisualizationHtml } from "./visualizations.js";
import { runOnce } from "./worker.js";

const config = loadConfig();
const port = Number(process.env.PORT ?? 8080);
const threeAssetPaths = new Map([
  [
    "/assets/three-0.180.0/three.module.js",
    fileURLToPath(
      new URL("../node_modules/three/build/three.module.min.js", import.meta.url)
    )
  ],
  [
    "/assets/three-0.180.0/three.core.min.js",
    fileURLToPath(
      new URL("../node_modules/three/build/three.core.min.js", import.meta.url)
    )
  ]
]);
const threeAssetSources = new Map<string, Promise<string>>();
let running = false;

interface ServerContext {
  config: WatcherConfig;
  createRepositoryHandle: () => RepositoryHandle;
}

export interface WatcherServerOptions {
  config?: WatcherConfig;
  createRepositoryHandle?: () => RepositoryHandle;
}

async function handleRun(req: IncomingMessage, res: ServerResponse, context: ServerContext): Promise<void> {
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
  const handle = context.createRepositoryHandle();
  running = true;

  try {
    await runOnce(startedAt, handle.repo);
    writeJson(res, 200, {
      ok: true,
      dryRun: context.config.dryRun,
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

async function handleDashboardApi(req: IncomingMessage, res: ServerResponse, context: ServerContext): Promise<void> {
  if (req.method !== "GET") {
    writeJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const handle = context.createRepositoryHandle();
  try {
    const data = await buildDashboardData(handle.repo, context.config);
    writeJson(res, 200, data);
  } catch (error) {
    writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    await handle.close();
  }
}

async function handleEarthApi(req: IncomingMessage, res: ServerResponse, context: ServerContext): Promise<void> {
  if (req.method !== "GET") {
    writeJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const handle = context.createRepositoryHandle();
  try {
    const snapshot = await loadDashboardSnapshot(handle.repo);
    writeJson(
      res,
      200,
      buildEarthWatchData(snapshot, context.config),
      "public, max-age=0, s-maxage=60, stale-while-revalidate=30"
    );
  } catch (error) {
    writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    await handle.close();
  }
}

export function createWatcherServer(options: WatcherServerOptions = {}) {
  const context: ServerContext = {
    config: options.config ?? config,
    createRepositoryHandle: options.createRepositoryHandle ?? createRepository
  };

  return createServer((req, res) => {
    void route(req, res, context);
  });
}

async function route(req: IncomingMessage, res: ServerResponse, context: ServerContext): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/" || pathname === "/healthz") {
    writeJson(res, 200, { ok: true, dryRun: context.config.dryRun });
    return;
  }

  if (pathname === "/dashboard") {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    writeHtml(res, 200, dashboardHtml());
    return;
  }

  if (pathname === "/api/dashboard") {
    await handleDashboardApi(req, res, context);
    return;
  }

  if (pathname === "/earth") {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    writeHtml(
      res,
      200,
      earthWatchHtml(),
      "public, max-age=0, s-maxage=300, stale-while-revalidate=60"
    );
    return;
  }

  if (pathname === "/visualizations" || pathname === "/earth/visualizations") {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    writeHtml(
      res,
      200,
      barkleyVisualizationHtml(),
      "public, max-age=0, s-maxage=300, stale-while-revalidate=60"
    );
    return;
  }

  const threeAssetPath = threeAssetPaths.get(pathname);
  if (threeAssetPath) {
    if (req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    try {
      const source =
        threeAssetSources.get(pathname) ?? readFile(threeAssetPath, "utf8");
      threeAssetSources.set(pathname, source);
      writeJavaScript(
        res,
        200,
        await source,
        "public, max-age=31536000, immutable"
      );
    } catch (error) {
      threeAssetSources.delete(pathname);
      writeJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (pathname === "/api/earth") {
    await handleEarthApi(req, res, context);
    return;
  }

  if (pathname === "/run") {
    await handleRun(req, res, context);
    return;
  }

  writeJson(res, 404, { ok: false, error: "not_found" });
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  cacheControl = "no-store"
): void {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": cacheControl
  });
  res.end(JSON.stringify(body));
}

function writeHtml(
  res: ServerResponse,
  statusCode: number,
  body: string,
  cacheControl = "no-store"
): void {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
    "content-security-policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src https://fonts.gstatic.com",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: https://unpkg.com https://*.nationalmap.gov https://*.basemaps.cartocdn.com",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com"
    ].join("; "),
    "permissions-policy": "camera=(), microphone=(), geolocation=(self)",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
  res.end(body);
}

function writeJavaScript(
  res: ServerResponse,
  statusCode: number,
  body: string,
  cacheControl: string
): void {
  res.writeHead(statusCode, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff"
  });
  res.end(body);
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
