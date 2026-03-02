import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "./store.js";

/** Create a throwaway temp directory for each test so we never touch the real store */
function makeTempStore(): { store: MemoryStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "memory-mcp-test-"));
  return { store: new MemoryStore(dir), dir };
}

describe("MemoryStore basics", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should start with zero facts", () => {
    const stats = store.getStats();
    assert.equal(stats.total_facts, 0);
  });

  it("should add and retrieve a fact", () => {
    const fact = store.addFact({
      content: "Likes TypeScript",
      category: "technical",
    });
    assert.ok(fact.id);
    assert.equal(fact.content, "Likes TypeScript");
    assert.equal(fact.status, "confirmed");

    const found = store.getFact(fact.id);
    assert.deepEqual(found, fact);
  });
});
