import { afterEach, describe, expect, it } from "vitest";
import { createWatcherServer } from "../server.js";

describe("watcher HTTP server", () => {
  const originalSecret = process.env.SCHEDULER_SHARED_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SCHEDULER_SHARED_SECRET;
    } else {
      process.env.SCHEDULER_SHARED_SECRET = originalSecret;
    }
  });

  it("returns health without scheduler auth", async () => {
    delete process.env.SCHEDULER_SHARED_SECRET;
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, dryRun: true });
    } finally {
      await close();
    }
  });

  it("returns health for root and normalized health probe paths", async () => {
    const { url, close } = await listen();

    try {
      await expect(fetch(`${url}/`).then((response) => response.status)).resolves.toBe(200);
      await expect(fetch(`${url}/healthz/`).then((response) => response.status)).resolves.toBe(200);
      await expect(fetch(`${url}/healthz?source=probe`).then((response) => response.status)).resolves.toBe(200);
    } finally {
      await close();
    }
  });

  it("rejects /run when scheduler secret is unset", async () => {
    delete process.env.SCHEDULER_SHARED_SECRET;
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/run`, { method: "POST" });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: "scheduler_secret_unset" });
    } finally {
      await close();
    }
  });

  it("rejects /run when X-BREAKAWAY-CRON-KEY does not match", async () => {
    process.env.SCHEDULER_SHARED_SECRET = "expected-secret";
    const { url, close } = await listen();

    try {
      const response = await fetch(`${url}/run`, {
        method: "POST",
        headers: { "X-BREAKAWAY-CRON-KEY": "wrong-secret" }
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ ok: false, error: "unauthorized" });
    } finally {
      await close();
    }
  });
});

async function listen(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createWatcherServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
