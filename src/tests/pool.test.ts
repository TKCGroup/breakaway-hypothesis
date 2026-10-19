import { afterEach, describe, expect, it } from "vitest";
import * as createRepositoryModule from "../db/createRepository.js";
import * as postgresRepositoryModule from "../db/postgresRepository.js";
import { PostgresWatcherRepository } from "../db/postgresRepository.js";

// pg's Pool does not connect until the first query, so these tests construct
// real pools against an unroutable URL without touching a database.
const URL_A = "postgres://user:pass@127.0.0.1:1/a";

describe("one pool per process", () => {
  afterEach(async () => {
    const close = (createRepositoryModule as Record<string, unknown>).closeSharedRepositories;
    if (typeof close === "function") {
      await (close as () => Promise<void>)();
    }
  });

  it("hands every request the same repository, and a request's close does not end it", async () => {
    const shared = (createRepositoryModule as Record<string, unknown>).sharedRepository as
      | ((url?: string) => createRepositoryModule.RepositoryHandle)
      | undefined;
    expect(shared, "sharedRepository is not exported: the server still builds a pool per request").toBeTypeOf("function");

    const first = shared!(URL_A);
    await first.close();
    const second = shared!(URL_A);

    expect(second.repo).toBe(first.repo);
    const pool = (first.repo as unknown as { pool: { ending: boolean } }).pool;
    expect(pool.ending).toBe(false);
  });

  it("names its sessions and bounds every statement server-side", () => {
    const poolConfig = (postgresRepositoryModule as Record<string, unknown>).poolConfig as
      | ((url: string, env?: NodeJS.ProcessEnv) => Record<string, unknown>)
      | undefined;
    expect(poolConfig, "poolConfig is not exported: the pool has no application_name or statement_timeout").toBeTypeOf(
      "function"
    );

    const config = poolConfig!(URL_A, {});
    expect(config.application_name).toBe("breakaway-watcher");
    expect(config.statement_timeout).toBe(20_000);
    expect(config.max).toBe(5);

    const repo = PostgresWatcherRepository.fromConnectionString(URL_A);
    const options = (repo as unknown as { pool: { options: Record<string, unknown> } }).pool.options;
    expect(options.application_name).toBe("breakaway-watcher");
    expect(options.statement_timeout).toBe(20_000);
    void repo.close();
  });

  it("falls back to the default when the timeout env is not a positive number", () => {
    const poolConfig = (postgresRepositoryModule as Record<string, unknown>).poolConfig as
      | ((url: string, env?: NodeJS.ProcessEnv) => Record<string, unknown>)
      | undefined;
    expect(poolConfig).toBeTypeOf("function");
    expect(poolConfig!(URL_A, { PG_STATEMENT_TIMEOUT_MS: "nope" }).statement_timeout).toBe(20_000);
    expect(poolConfig!(URL_A, { PG_STATEMENT_TIMEOUT_MS: "0" }).statement_timeout).toBe(20_000);
    expect(poolConfig!(URL_A, { PG_STATEMENT_TIMEOUT_MS: "5000" }).statement_timeout).toBe(5_000);
  });
});
