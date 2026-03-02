import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "./store.js";

describe("auto-context resource", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memory-mcp-test-"));
    store = new MemoryStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should build context that includes confirmed facts", () => {
    store.addFact({ content: "Works as a consultant", category: "work" });
    store.addFact({ content: "Lives in Newcastle", category: "personal" });

    const context = store.buildContext();
    assert.ok(context.includes("Works as a consultant"));
    assert.ok(context.includes("Lives in Newcastle"));
  });

  it("should exclude rejected facts from context", () => {
    const { fact } = store.addFact({ content: "Likes Java", category: "technical" });
    store.updateFact(fact.id, { status: "rejected" });

    const context = store.buildContext();
    assert.ok(!context.includes("Likes Java"));
  });
});
