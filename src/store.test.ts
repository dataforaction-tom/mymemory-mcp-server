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

describe("import", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should import facts from JSON export", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "memory-src-"));
    const source = new MemoryStore(srcDir);
    source.addFact({ content: "Fact from other machine", category: "work" });
    const exported = source.exportAll();
    rmSync(srcDir, { recursive: true, force: true });

    const result = store.importData(exported);
    assert.equal(result.imported_facts, 1);
    assert.equal(result.skipped_duplicates, 0);
    assert.equal(store.getStats().total_facts, 1);
  });

  it("should skip duplicate facts during import", () => {
    store.addFact({ content: "Already exists here", category: "work" });

    const srcDir = mkdtempSync(join(tmpdir(), "memory-src-"));
    const source = new MemoryStore(srcDir);
    source.addFact({ content: "Already exists here", category: "work" });
    const exported = source.exportAll();
    rmSync(srcDir, { recursive: true, force: true });

    const result = store.importData(exported);
    assert.equal(result.imported_facts, 0);
    assert.equal(result.skipped_duplicates, 1);
    assert.equal(store.getStats().total_facts, 1);
  });

  it("should import documents", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "memory-src-"));
    const source = new MemoryStore(srcDir);
    source.upsertDocument({
      category: "work",
      title: "Work Profile",
      content: "Works as a consultant",
      fact_ids: [],
    });
    const exported = source.exportAll();
    rmSync(srcDir, { recursive: true, force: true });

    const result = store.importData(exported);
    assert.equal(result.imported_documents, 1);
    const doc = store.getDocument("work");
    assert.ok(doc);
    assert.equal(doc!.title, "Work Profile");
  });
});

describe("retention and decay", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should exclude expired facts from search by default", () => {
    const { fact } = store.addFact({
      content: "Currently interviewing at Acme",
      category: "context",
      expires_at: new Date(Date.now() - 86400000).toISOString(), // yesterday
    });

    const results = store.searchFacts({ query: "Acme" });
    assert.equal(results.length, 0);
  });

  it("should include expired facts when explicitly requested", () => {
    store.addFact({
      content: "Currently interviewing at Acme",
      category: "context",
      expires_at: new Date(Date.now() - 86400000).toISOString(),
    });

    const results = store.searchFacts({ query: "Acme", include_expired: true });
    assert.equal(results.length, 1);
  });

  it("should exclude expired facts from buildContext", () => {
    store.addFact({
      content: "Expired fact",
      category: "context",
      expires_at: new Date(Date.now() - 86400000).toISOString(),
    });
    store.addFact({ content: "Current fact", category: "context" });

    const context = store.buildContext();
    assert.ok(!context.includes("Expired fact"));
    assert.ok(context.includes("Current fact"));
  });

  it("should not consider fresh facts as stale", () => {
    store.addFact({
      content: "Just learned this today",
      category: "work",
    });
    const stale = store.getStale(1);
    assert.equal(stale.length, 0, "a fact created just now should not be stale at 1-day threshold");
  });

  it("should find stale facts that need review", () => {
    store.addFact({
      content: "Old fact from last year",
      category: "work",
    });
    // getStale uses updated_at < cutoff. With a negative daysOld, the cutoff
    // moves into the future, so any fact updated now will be "stale".
    // This lets us verify the method works without needing to manipulate time.
    const stale = store.getStale(-1);
    assert.ok(stale.length >= 1, "fact should be stale when cutoff is in the future");
    assert.equal(stale[0].content, "Old fact from last year");
  });
});

describe("semantic search", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
    store.addFact({ content: "Works as a consultant in organisational development", category: "work" });
    store.addFact({ content: "Prefers TypeScript over JavaScript", category: "technical" });
    store.addFact({ content: "Lives in North East England", category: "personal" });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should find facts by keyword relevance", () => {
    const results = store.searchFacts({ query: "consultant" });
    assert.ok(results.length > 0);
    assert.ok(results[0].content.includes("consultant"));
  });

  it("should match across tags too", () => {
    store.addFact({ content: "Uses VS Code", category: "technical", tags: ["editor", "IDE"] });
    const results = store.searchFacts({ query: "editor" });
    assert.ok(results.length > 0);
  });
});

describe("schema customization", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should add a custom category", () => {
    const result = store.addCategory({
      name: "recipes",
      description: "Favourite recipes and cooking notes",
      hints: ["ingredients", "cooking methods"],
      examples: ["Makes a great risotto"],
    });
    assert.ok(result);
    const schema = store.getSchema();
    assert.ok(schema.some(c => c.name === "recipes"));
  });

  it("should reject duplicate category names", () => {
    const result = store.addCategory({
      name: "work",
      description: "duplicate",
      hints: [],
      examples: [],
    });
    assert.equal(result, false);
  });

  it("should update an existing category", () => {
    store.updateCategory("work", { description: "Updated work description" });
    const schema = store.getSchema();
    const work = schema.find(c => c.name === "work");
    assert.equal(work!.description, "Updated work description");
  });

  it("should remove a custom category", () => {
    store.addCategory({ name: "custom", description: "test", hints: [], examples: [] });
    const removed = store.removeCategory("custom");
    assert.ok(removed);
    assert.ok(!store.getSchema().some(c => c.name === "custom"));
  });
});

describe("selective sharing", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should exclude hidden categories from buildContext", () => {
    store.addFact({ content: "Has diabetes", category: "health" });
    store.addFact({ content: "Likes TypeScript", category: "technical" });
    store.updateCategory("health", { visibility: "hidden" });

    const context = store.buildContext();
    assert.ok(!context.includes("diabetes"));
    assert.ok(context.includes("TypeScript"));
  });

  it("should include hidden categories when explicitly requested", () => {
    store.addFact({ content: "Has diabetes", category: "health" });
    store.updateCategory("health", { visibility: "hidden" });

    const context = store.buildContext({ categories: ["health"] });
    assert.ok(context.includes("diabetes"));
  });

  it("should still return hidden facts in explicit search", () => {
    store.addFact({ content: "Salary is 80k", category: "finance" });
    store.updateCategory("finance", { visibility: "hidden" });

    const results = store.searchFacts({ query: "salary" });
    assert.ok(results.length > 0);
  });
});

describe("bulk operations", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should confirm all pending facts", () => {
    store.addFact({ content: "Fact 1", category: "work", status: "pending" });
    store.addFact({ content: "Fact 2", category: "work", status: "pending" });
    store.addFact({ content: "Fact 3", category: "work", status: "confirmed" });

    const count = store.bulkUpdate({ from_status: "pending", to_status: "confirmed" });
    assert.equal(count, 2);
    assert.equal(store.getStats().pending_facts, 0);
    assert.equal(store.getStats().confirmed_facts, 3);
  });

  it("should delete all rejected facts", () => {
    store.addFact({ content: "Good", category: "work" });
    const { fact } = store.addFact({ content: "Bad", category: "work" });
    store.updateFact(fact.id, { status: "rejected" });

    const count = store.bulkDelete({ status: "rejected" });
    assert.equal(count, 1);
    assert.equal(store.getStats().total_facts, 1);
  });

  it("should delete by category", () => {
    store.addFact({ content: "Work fact", category: "work" });
    store.addFact({ content: "Personal fact", category: "personal" });

    const count = store.bulkDelete({ category: "work" });
    assert.equal(count, 1);
    assert.equal(store.getStats().total_facts, 1);
  });
});

describe("provider attribution", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should track facts per provider", () => {
    store.addFact({ content: "Fact A", category: "work", source_provider: "claude" });
    store.addFact({ content: "Fact B", category: "work", source_provider: "claude" });
    store.addFact({ content: "Fact C", category: "work", source_provider: "chatgpt" });

    const stats = store.getProviderStats();
    assert.equal(stats.providers["claude"].fact_count, 2);
    assert.equal(stats.providers["chatgpt"].fact_count, 1);
  });

  it("should list categories per provider", () => {
    store.addFact({ content: "Work fact", category: "work", source_provider: "claude" });
    store.addFact({ content: "Personal fact", category: "personal", source_provider: "claude" });

    const stats = store.getProviderStats();
    assert.ok(stats.providers["claude"].categories.includes("work"));
    assert.ok(stats.providers["claude"].categories.includes("personal"));
  });
});
