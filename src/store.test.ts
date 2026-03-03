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
    const { fact } = store.addFact({
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

describe("duplicate detection", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should find similar existing facts", () => {
    store.addFact({ content: "Works as a consultant in London", category: "work" });
    const matches = store.findSimilar("Works as a consultant based in London", "work");
    assert.ok(matches.length > 0);
    assert.ok(matches[0].similarity >= 0.7);
  });

  it("should not match across different categories by default", () => {
    store.addFact({ content: "Works as a consultant", category: "work" });
    const matches = store.findSimilar("Works as a consultant", "personal");
    assert.equal(matches.length, 0);
  });

  it("should not match rejected facts", () => {
    const { fact } = store.addFact({ content: "Works as a consultant", category: "work" });
    store.updateFact(fact.id, { status: "rejected" });
    const matches = store.findSimilar("Works as a consultant", "work");
    assert.equal(matches.length, 0);
  });
});

describe("fact editing", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should update fact content", () => {
    const { fact } = store.addFact({ content: "Works in London", category: "work" });
    // Nudge the original timestamp into the past so the update always differs
    fact.updated_at = "2000-01-01T00:00:00.000Z";
    const updated = store.updateFact(fact.id, { content: "Works in Manchester" });
    assert.ok(updated);
    assert.equal(updated!.content, "Works in Manchester");
    assert.notEqual(updated!.updated_at, "2000-01-01T00:00:00.000Z");
  });

  it("should update fact category and tags", () => {
    const { fact } = store.addFact({ content: "Enjoys hiking", category: "personal" });
    const updated = store.updateFact(fact.id, {
      category: "health",
      tags: ["exercise", "outdoors"],
    });
    assert.ok(updated);
    assert.equal(updated!.category, "health");
    assert.deepEqual(updated!.tags, ["exercise", "outdoors"]);
  });

  it("should return undefined for non-existent fact", () => {
    const updated = store.updateFact("non-existent-id", { content: "test" });
    assert.equal(updated, undefined);
  });
});

describe("encrypted store", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should persist and reload with encryption", () => {
    dir = mkdtempSync(join(tmpdir(), "memory-mcp-test-enc-"));
    const store1 = new MemoryStore(dir, "my-secret");
    store1.addFact({ content: "Encrypted fact", category: "work" });

    // Reload from disk
    const store2 = new MemoryStore(dir, "my-secret");
    const stats = store2.getStats();
    assert.equal(stats.total_facts, 1);

    const results = store2.searchFacts({ query: "Encrypted" });
    assert.equal(results[0].content, "Encrypted fact");
  });

  it("should fail to load with wrong passphrase", () => {
    dir = mkdtempSync(join(tmpdir(), "memory-mcp-test-enc-"));
    const store1 = new MemoryStore(dir, "correct-pass");
    store1.addFact({ content: "Secret", category: "work" });

    // Should start fresh (corrupted decrypt = new store)
    const store2 = new MemoryStore(dir, "wrong-pass");
    assert.equal(store2.getStats().total_facts, 0);
  });
});
