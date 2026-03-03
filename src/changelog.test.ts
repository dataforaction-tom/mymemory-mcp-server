import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChangeLog } from "./changelog.js";

describe("ChangeLog", () => {
  let log: ChangeLog;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memory-mcp-test-log-"));
    log = new ChangeLog(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should record and retrieve entries", () => {
    log.append({ action: "add_fact", fact_id: "abc", provider: "claude" });
    log.append({ action: "delete_fact", fact_id: "abc", provider: "claude" });

    const entries = log.getRecent(10);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].action, "delete_fact");
    assert.equal(entries[1].action, "add_fact");
  });

  it("should persist across instances", () => {
    log.append({ action: "add_fact", fact_id: "abc", provider: "claude" });

    const log2 = new ChangeLog(dir);
    const entries = log2.getRecent(10);
    assert.equal(entries.length, 1);
  });
});
