import { describe, expect, it } from "vitest";
import { InMemoryWatcherRepository } from "../db/repository.js";
import { payloadHash } from "../logic/payloadHash.js";
import { eventFixture } from "./helpers.js";

describe("payload hash", () => {
  it("ignores key order and undefined members, and sees any value change", () => {
    expect(payloadHash({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(payloadHash({ b: { d: "x", c: [1, 2] }, a: 1, e: undefined }));
    expect(payloadHash({ a: 1, b: { c: [1, 2] } })).not.toBe(payloadHash({ a: 1, b: { c: [2, 1] } }));
    expect(payloadHash({ severity: "Moderate" })).not.toBe(payloadHash({ severity: "Severe" }));
  });

  it("updates a row whose payload changed under the same sourceUpdatedAt", async () => {
    const repo = new InMemoryWatcherRepository();
    expect((await repo.upsertEvent(eventFixture({ rawJson: { severity: "Moderate", area: "A" } }))).status).toBe("inserted");

    const changed = await repo.upsertEvent(eventFixture({ rawJson: { severity: "Severe", area: "A" } }));
    expect(changed.status).toBe("updated");
    expect((await repo.listEvents())[0].rawJson).toEqual({ severity: "Severe", area: "A" });

    // Same document, keys in another order: not a change.
    expect((await repo.upsertEvent(eventFixture({ rawJson: { area: "A", severity: "Severe" } }))).status).toBe("unchanged");
  });
});
