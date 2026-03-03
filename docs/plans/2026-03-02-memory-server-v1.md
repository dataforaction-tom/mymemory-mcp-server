# memory-mcp-server v1.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Take memory-mcp-server from a v0.1 MVP to a production-quality v1.0 with duplicate detection, auto-context injection, fact editing, encryption, import/export, retention, semantic search, schema customization, provider attribution, and selective sharing.

**Architecture:** The server remains a single-process Node.js MCP server with flat-file JSON storage. New features are added as methods on `MemoryStore` (src/store.ts) and registered as tools/resources on the MCP server (src/index.ts). No external database or native dependencies. Encryption is opt-in via environment variable. Semantic search uses token-based similarity (no embeddings API). Tests use Node's built-in `node:test` runner.

**Tech Stack:** TypeScript 5.9, Node.js 18+, MCP SDK 1.27.1, Zod 4.3, `node:test` + `node:assert` for testing, `node:crypto` for AES-256-GCM encryption.

---

## Task 0: Test Infrastructure Setup

All subsequent tasks follow TDD. This task sets up the test runner so every later task can write tests first.

**Files:**
- Create: `src/store.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Step 1: Add test script to package.json**

In `package.json`, add to the `"scripts"` object:

```json
"test": "node --import tsx --test src/**/*.test.ts",
"test:watch": "node --import tsx --test --watch src/**/*.test.ts"
```

And add to `"devDependencies"`:

```json
"tsx": "^4.19.0"
```

`tsx` lets us run TypeScript tests directly without a separate compile step. `node:test` is built into Node 18+ so no test framework dependency needed.

**Step 2: Create the first test file to verify the setup works**

Create `src/store.test.ts`:

```typescript
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
```

**Step 3: Install tsx and run the tests**

Run: `npm install && npm test`
Expected: 2 tests pass.

**Step 4: Commit**

```bash
git add package.json src/store.test.ts
git commit -m "chore: add test infrastructure with node:test and tsx"
```

---

## Tier 1 — Essential for Real Daily Use

---

### Task 1: Duplicate Detection

When adding a fact, check existing confirmed facts for near-duplicates. Use normalized token overlap (Jaccard similarity) — no external dependencies. If a match is found above a threshold, return a warning with the existing fact instead of silently duplicating.

**Files:**
- Modify: `src/store.ts` (add `findSimilar()` method, modify `addFact()`)
- Modify: `src/index.ts` (update `memory_store_fact` and `memory_store_facts` tool responses to surface duplicates)
- Create: `src/similarity.ts` (token similarity utility)
- Test: `src/similarity.test.ts`
- Test: `src/store.test.ts` (add duplicate detection tests)

**Step 1: Write failing tests for token similarity**

Create `src/similarity.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokenSimilarity } from "./similarity.js";

describe("tokenSimilarity", () => {
  it("should return 1.0 for identical strings", () => {
    assert.equal(tokenSimilarity("likes typescript", "likes typescript"), 1.0);
  });

  it("should return 0.0 for completely different strings", () => {
    assert.equal(tokenSimilarity("likes typescript", "enjoys hiking mountains"), 0.0);
  });

  it("should be case-insensitive", () => {
    assert.equal(tokenSimilarity("Likes TypeScript", "likes typescript"), 1.0);
  });

  it("should return partial overlap score", () => {
    const score = tokenSimilarity(
      "works as a consultant",
      "works as a freelance consultant"
    );
    // Jaccard: intersection={works,as,a,consultant}=4, union={works,as,a,consultant,freelance}=5 → 0.8
    assert.ok(score >= 0.7 && score <= 0.9);
  });

  it("should handle empty strings", () => {
    assert.equal(tokenSimilarity("", "something"), 0.0);
    assert.equal(tokenSimilarity("", ""), 0.0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `tokenSimilarity` not found.

**Step 3: Implement similarity utility**

Create `src/similarity.ts`:

```typescript
/**
 * Jaccard similarity on normalized word tokens.
 * Returns 0.0–1.0. No external dependencies.
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\s+/).filter(Boolean));

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All similarity tests pass.

**Step 5: Write failing tests for duplicate detection in MemoryStore**

Add to `src/store.test.ts`:

```typescript
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
    const fact = store.addFact({ content: "Works as a consultant", category: "work" });
    store.updateFactStatus(fact.id, "rejected");
    const matches = store.findSimilar("Works as a consultant", "work");
    assert.equal(matches.length, 0);
  });
});
```

**Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `findSimilar` not found.

**Step 7: Implement `findSimilar()` on MemoryStore**

In `src/store.ts`, add import at top:

```typescript
import { tokenSimilarity } from "./similarity.js";
```

Add method to `MemoryStore` class (after `searchFacts`):

```typescript
  /** Find existing facts similar to the given content. Returns matches above threshold. */
  findSimilar(
    content: string,
    category: string,
    threshold = 0.7,
  ): Array<{ fact: Fact; similarity: number }> {
    const candidates = this.data.facts.filter(
      f => f.category === category && f.status !== "rejected"
    );

    const matches: Array<{ fact: Fact; similarity: number }> = [];
    for (const fact of candidates) {
      const sim = tokenSimilarity(content, fact.content);
      if (sim >= threshold) {
        matches.push({ fact, similarity: sim });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }
```

**Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass.

**Step 9: Update `addFact()` to return duplicate warnings**

Modify the return type — `addFact` now returns `{ fact: Fact; duplicates: Array<{ fact: Fact; similarity: number }> }`. Update the method in `src/store.ts`:

```typescript
  addFact(params: {
    content: string;
    category: string;
    confidence?: number;
    source_provider?: string;
    source_conversation?: string;
    status?: FactStatus;
    tags?: string[];
    supersedes?: string;
  }): { fact: Fact; duplicates: Array<{ fact: Fact; similarity: number }> } {
    // Check for duplicates before adding
    const duplicates = this.findSimilar(params.content, params.category);

    const now = new Date().toISOString();
    const fact: Fact = {
      id: randomUUID(),
      content: params.content,
      category: params.category,
      confidence: params.confidence ?? 0.8,
      source_provider: params.source_provider ?? "unknown",
      source_conversation: params.source_conversation,
      status: params.status ?? "confirmed",
      created_at: now,
      updated_at: now,
      tags: params.tags ?? [],
      supersedes: params.supersedes,
    };

    if (params.supersedes) {
      const old = this.data.facts.find(f => f.id === params.supersedes);
      if (old) {
        old.status = "rejected";
        old.updated_at = now;
      }
    }

    this.data.facts.push(fact);
    this.save();
    return { fact, duplicates };
  }
```

**Step 10: Update all callers of `addFact` in store.ts and index.ts**

In `src/store.ts`, update `saveDrafts()` — change:
```typescript
      const fact = this.addFact({...});
      saved.push(fact);
```
to:
```typescript
      const { fact } = this.addFact({...});
      saved.push(fact);
```

In `src/index.ts`, update every tool handler that calls `store.addFact()`:

For `memory_store_fact` handler — change `const fact = store.addFact(...)` to:
```typescript
    const { fact, duplicates } = store.addFact({...});

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          stored: true,
          fact: {
            id: fact.id,
            content: fact.content,
            category: fact.category,
            confidence: fact.confidence,
            status: fact.status,
          },
          ...(duplicates.length > 0 && {
            warning: "Similar facts already exist",
            similar_facts: duplicates.map(d => ({
              id: d.fact.id,
              content: d.fact.content,
              similarity: Math.round(d.similarity * 100) + "%",
            })),
          }),
        }, null, 2),
      }],
    };
```

For `memory_store_facts` handler — change `const stored = params.facts.map(f => store.addFact(...))` to extract just the facts:
```typescript
    const results = params.facts.map(f =>
      store.addFact({
        content: f.content,
        category: f.category,
        confidence: f.confidence,
        source_provider: params.source_provider,
        tags: f.tags,
      })
    );

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          stored: true,
          count: results.length,
          facts: results.map(r => ({
            id: r.fact.id,
            content: r.fact.content,
            category: r.fact.category,
          })),
          ...(results.some(r => r.duplicates.length > 0) && {
            warnings: results
              .filter(r => r.duplicates.length > 0)
              .map(r => ({
                new_fact: r.fact.content,
                similar_to: r.duplicates.map(d => ({
                  id: d.fact.id,
                  content: d.fact.content,
                  similarity: Math.round(d.similarity * 100) + "%",
                })),
              })),
          }),
        }, null, 2),
      }],
    };
```

**Step 11: Update existing tests for new return type**

In `src/store.test.ts`, update the basic "add and retrieve" test:
```typescript
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
```

**Step 12: Run tests, build, and verify**

Run: `npm test && npm run build`
Expected: All tests pass, clean build.

**Step 13: Commit**

```bash
git add src/similarity.ts src/similarity.test.ts src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add duplicate detection when storing facts

Uses Jaccard token similarity to find near-duplicate facts in the
same category. Warnings are surfaced in tool responses so the LLM
can decide whether to proceed or use the existing fact."
```

---

### Task 2: Fact Content Editing

Currently `memory_update_fact` only changes status. Add ability to edit content, category, confidence, and tags on saved facts.

**Files:**
- Modify: `src/store.ts` (expand `updateFactStatus` → `updateFact`)
- Modify: `src/index.ts` (expand `memory_update_fact` input schema and handler)
- Test: `src/store.test.ts`

**Step 1: Write failing test**

Add to `src/store.test.ts`:

```typescript
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
    const updated = store.updateFact(fact.id, { content: "Works in Manchester" });
    assert.ok(updated);
    assert.equal(updated!.content, "Works in Manchester");
    assert.notEqual(updated!.updated_at, fact.updated_at);
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `updateFact` not found.

**Step 3: Implement `updateFact()` on MemoryStore**

In `src/store.ts`, add new method (keep `updateFactStatus` for backward compat, or replace it — replacing is cleaner since nothing external depends on it):

Replace `updateFactStatus` with:

```typescript
  updateFact(id: string, updates: {
    content?: string;
    category?: string;
    confidence?: number;
    status?: FactStatus;
    tags?: string[];
  }): Fact | undefined {
    const fact = this.data.facts.find(f => f.id === id);
    if (!fact) return undefined;

    if (updates.content !== undefined) fact.content = updates.content;
    if (updates.category !== undefined) fact.category = updates.category;
    if (updates.confidence !== undefined) fact.confidence = updates.confidence;
    if (updates.status !== undefined) fact.status = updates.status;
    if (updates.tags !== undefined) fact.tags = updates.tags;
    fact.updated_at = new Date().toISOString();

    this.save();
    return fact;
  }
```

**Step 4: Update index.ts — expand `memory_update_fact` tool**

Replace the `memory_update_fact` tool registration. New input schema:

```typescript
    inputSchema: {
      id: z.string().describe("Fact ID to update"),
      content: z.string().min(3).optional().describe("Updated fact content"),
      category: z.enum([
        "work", "personal", "technical", "preferences", "goals",
        "health", "values", "social", "finance", "travel", "education", "context"
      ]).optional().describe("Updated category"),
      confidence: z.number().min(0).max(1).optional().describe("Updated confidence"),
      status: z.enum(["confirmed", "pending", "rejected"]).optional()
        .describe("Updated status"),
      tags: z.array(z.string()).optional().describe("Updated tags"),
    },
```

New handler:

```typescript
  async (params) => {
    const fact = store.updateFact(params.id, {
      content: params.content,
      category: params.category,
      confidence: params.confidence,
      status: params.status,
      tags: params.tags,
    });

    if (!fact) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: No fact found with ID "${params.id}". Use memory_search to find the correct ID.`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          updated: true,
          fact: {
            id: fact.id,
            content: fact.content,
            category: fact.category,
            confidence: fact.confidence,
            status: fact.status,
            tags: fact.tags,
            updated_at: fact.updated_at,
          },
        }, null, 2),
      }],
    };
  }
```

Also update the tool description to reflect the new capabilities:

```typescript
    description: `Update a saved fact — change its content, category, confidence, status, or tags.
Use this to correct facts, confirm pending facts, reject incorrect ones, or
recategorise facts.

Args:
  - id (string): The fact ID to update
  - content (string, optional): Updated content text
  - category (string, optional): Updated category
  - confidence (number, optional): Updated confidence (0.0-1.0)
  - status (string, optional): "confirmed", "pending", or "rejected"
  - tags (string[], optional): Updated tags

Returns: The updated fact.`,
```

**Step 5: Run tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: allow editing fact content, category, confidence, and tags

Expands memory_update_fact from status-only to full field editing.
Replaces updateFactStatus with updateFact in MemoryStore."
```

---

### Task 3: Auto-Context via MCP Resource

Register an MCP Resource at `memory://profile` that automatically exposes the user's memory context. MCP clients can subscribe to this resource to get context without the LLM needing to call a tool.

**Files:**
- Modify: `src/index.ts` (register resource after server creation)
- Test: `src/index.test.ts` (new file — test resource registration)

**Step 1: Write failing test**

Create `src/index.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they pass (these test the store, not the resource wiring)**

Run: `npm test`
Expected: Pass (these use existing `buildContext` method).

**Step 3: Register the MCP resource in index.ts**

In `src/index.ts`, after `const server = new McpServer(...)` and `const store = new MemoryStore()`, add:

```typescript
// ─── Resource: Memory profile for automatic context injection ────────

server.registerResource(
  "memory-profile",
  "memory://profile",
  {
    title: "Memory Profile",
    description:
      "The user's full memory profile — narrative documents and confirmed facts. " +
      "Subscribe to this resource for automatic context injection at conversation start.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const context = store.buildContext();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text:
            context ||
            "(No memory context available yet. Start storing facts to build the user's profile.)",
        },
      ],
    };
  }
);
```

Also remove the placeholder comment near the bottom of the file:
```typescript
// ─── Resource: Memory profile as a readable resource ─────────────────

// (Resources let clients browse data without tool calls)
```

**Step 4: Build and verify**

Run: `npm run build && timeout 3 node dist/index.js 2>&1 || true`
Expected: Clean build, server starts.

**Step 5: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: register MCP resource for auto-context injection

Exposes memory://profile as a browsable MCP resource so clients
can load the user's memory context without relying on tool calls."
```

---

## Tier 2 — Makes It Trustworthy

---

### Task 4: Encryption at Rest

Add opt-in AES-256-GCM encryption for the store file. When the env var `MEMORY_MCP_PASSPHRASE` is set, all reads/writes go through encrypt/decrypt. The file format changes to `{iv, salt, ciphertext}` JSON. If the passphrase is not set, the store operates in plaintext as before.

**Files:**
- Create: `src/crypto.ts` (encrypt/decrypt utilities)
- Create: `src/crypto.test.ts`
- Modify: `src/store.ts` (use crypto layer in load/save)
- Test: `src/store.test.ts` (add encrypted store tests)

**Step 1: Write failing tests for crypto utilities**

Create `src/crypto.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "./crypto.js";

describe("encryption", () => {
  const passphrase = "test-passphrase-123";

  it("should round-trip encrypt and decrypt", () => {
    const plaintext = '{"facts": [], "meta": {}}';
    const encrypted = encrypt(plaintext, passphrase);
    const decrypted = decrypt(encrypted, passphrase);
    assert.equal(decrypted, plaintext);
  });

  it("should produce different ciphertext each time (random IV/salt)", () => {
    const plaintext = "same data";
    const a = encrypt(plaintext, passphrase);
    const b = encrypt(plaintext, passphrase);
    assert.notEqual(a, b);
  });

  it("should fail to decrypt with wrong passphrase", () => {
    const encrypted = encrypt("secret data", passphrase);
    assert.throws(() => decrypt(encrypted, "wrong-passphrase"));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

**Step 3: Implement crypto utilities**

Create `src/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

/** Encrypt plaintext with AES-256-GCM. Returns base64 string: salt + iv + tag + ciphertext */
export function encrypt(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Pack: salt(32) + iv(16) + tag(16) + ciphertext
  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
}

/** Decrypt base64 string produced by encrypt() */
export function decrypt(packed: string, passphrase: string): string {
  const buf = Buffer.from(packed, "base64");

  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
```

**Step 4: Run crypto tests**

Run: `npm test`
Expected: All crypto tests pass.

**Step 5: Write failing test for encrypted store**

Add to `src/store.test.ts`:

```typescript
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
```

**Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — MemoryStore constructor doesn't accept passphrase.

**Step 7: Modify MemoryStore to support encryption**

In `src/store.ts`, add import:

```typescript
import { encrypt, decrypt } from "./crypto.js";
```

Modify the constructor to accept an optional passphrase:

```typescript
  private passphrase?: string;

  constructor(dataDir?: string, passphrase?: string) {
    this.dataDir = dataDir || join(homedir(), ".memory-mcp");
    this.dataFile = join(this.dataDir, "store.json");
    this.passphrase = passphrase || process.env.MEMORY_MCP_PASSPHRASE || undefined;

    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.data = this.load();
  }
```

Modify `load()`:

```typescript
  private load(): StoreData {
    if (existsSync(this.dataFile)) {
      try {
        const raw = readFileSync(this.dataFile, "utf-8");
        const json = this.passphrase ? decrypt(raw, this.passphrase) : raw;
        return JSON.parse(json) as StoreData;
      } catch {
        const backup = this.dataFile + ".backup." + Date.now();
        try {
          const raw = readFileSync(this.dataFile, "utf-8");
          writeFileSync(backup, raw);
        } catch { /* ignore backup failure */ }
      }
    }

    return {
      facts: [],
      documents: [],
      schema: DEFAULT_SCHEMA,
      meta: {
        version: 1,
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),
      }
    };
  }
```

Modify `save()`:

```typescript
  private save(): void {
    this.data.meta.last_modified = new Date().toISOString();
    const json = JSON.stringify(this.data, null, 2);
    const output = this.passphrase ? encrypt(json, this.passphrase) : json;
    writeFileSync(this.dataFile, output, "utf-8");
  }
```

**Step 8: Run all tests**

Run: `npm test && npm run build`
Expected: All pass.

**Step 9: Commit**

```bash
git add src/crypto.ts src/crypto.test.ts src/store.ts src/store.test.ts
git commit -m "feat: add opt-in AES-256-GCM encryption at rest

Set MEMORY_MCP_PASSPHRASE env var or pass passphrase to constructor
to encrypt store.json. Falls back to plaintext if unset."
```

---

### Task 5: Import Tool

Add a `memory_import` tool that accepts JSON or markdown export format and merges into the existing store with conflict resolution.

**Files:**
- Modify: `src/store.ts` (add `importData()` method)
- Modify: `src/index.ts` (register `memory_import` tool)
- Test: `src/store.test.ts`

**Step 1: Write failing tests**

Add to `src/store.test.ts`:

```typescript
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
    const source = new MemoryStore(mkdtempSync(join(tmpdir(), "memory-src-")));
    source.addFact({ content: "Fact from other machine", category: "work" });
    const exported = source.exportAll();

    const result = store.importData(exported);
    assert.equal(result.imported_facts, 1);
    assert.equal(result.skipped_duplicates, 0);
    assert.equal(store.getStats().total_facts, 1);
  });

  it("should skip duplicate facts during import", () => {
    store.addFact({ content: "Already exists here", category: "work" });

    const source = new MemoryStore(mkdtempSync(join(tmpdir(), "memory-src-")));
    source.addFact({ content: "Already exists here", category: "work" });
    const exported = source.exportAll();

    const result = store.importData(exported);
    assert.equal(result.imported_facts, 0);
    assert.equal(result.skipped_duplicates, 1);
    assert.equal(store.getStats().total_facts, 1);
  });

  it("should import documents", () => {
    const source = new MemoryStore(mkdtempSync(join(tmpdir(), "memory-src-")));
    source.upsertDocument({
      category: "work",
      title: "Work Profile",
      content: "Works as a consultant",
      fact_ids: [],
    });
    const exported = source.exportAll();

    const result = store.importData(exported);
    assert.equal(result.imported_documents, 1);
    const doc = store.getDocument("work");
    assert.ok(doc);
    assert.equal(doc!.title, "Work Profile");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `importData` not found.

**Step 3: Implement `importData()` on MemoryStore**

Add to `src/store.ts` in the MemoryStore class:

```typescript
  /** Import data from an export, merging with conflict detection */
  importData(data: {
    facts?: Fact[];
    documents?: MemoryDocument[];
  }): {
    imported_facts: number;
    skipped_duplicates: number;
    imported_documents: number;
    skipped_documents: number;
  } {
    let imported_facts = 0;
    let skipped_duplicates = 0;
    let imported_documents = 0;
    let skipped_documents = 0;

    // Import facts
    if (data.facts) {
      for (const incoming of data.facts) {
        // Skip if exact ID already exists
        if (this.data.facts.some(f => f.id === incoming.id)) {
          skipped_duplicates++;
          continue;
        }

        // Skip if content is a near-duplicate
        const similar = this.findSimilar(incoming.content, incoming.category, 0.85);
        if (similar.length > 0) {
          skipped_duplicates++;
          continue;
        }

        this.data.facts.push({ ...incoming });
        imported_facts++;
      }
    }

    // Import documents
    if (data.documents) {
      for (const incoming of data.documents) {
        const existing = this.data.documents.find(d => d.category === incoming.category);
        if (existing) {
          // Only replace if incoming is newer
          if (new Date(incoming.updated_at) > new Date(existing.updated_at)) {
            existing.title = incoming.title;
            existing.content = incoming.content;
            existing.fact_ids = [...new Set([...existing.fact_ids, ...incoming.fact_ids])];
            existing.version += 1;
            existing.updated_at = incoming.updated_at;
            imported_documents++;
          } else {
            skipped_documents++;
          }
        } else {
          this.data.documents.push({ ...incoming });
          imported_documents++;
        }
      }
    }

    this.save();

    return { imported_facts, skipped_duplicates, imported_documents, skipped_documents };
  }
```

**Step 4: Register `memory_import` tool in index.ts**

Add after the `memory_export` tool registration:

```typescript
// ─── Tool: Import ────────────────────────────────────────────────────

server.registerTool(
  "memory_import",
  {
    title: "Import Memory",
    description: `Import memory data from a JSON export. Use this to restore from a backup,
merge data from another machine, or migrate from another system.

Duplicate facts (by ID or content similarity) are automatically skipped.
Documents are merged — newer versions replace older ones.

Args:
  - data (string): JSON string of exported memory data (same format as memory_export JSON output)

Returns: Summary of what was imported and what was skipped.`,
    inputSchema: {
      data: z.string().min(2).describe("JSON string of memory data to import"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const parsed = JSON.parse(params.data);
      const result = store.importData(parsed);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            ...result,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: Invalid JSON data. ${err instanceof Error ? err.message : "Parse failed"}`,
        }],
        isError: true,
      };
    }
  }
);
```

**Step 5: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add memory_import tool for merging exported data

Supports importing JSON exports with duplicate detection and
document merge-by-recency."
```

---

### Task 6: Retention and Decay

Add optional `expires_at` field on facts. Facts past expiry are excluded from `buildContext()` and `searchFacts()` by default but not deleted (they can be reviewed). Add a `memory_review_stale` tool that surfaces old facts for re-confirmation.

**Files:**
- Modify: `src/store.ts` (add `expires_at` to Fact, filter in search/context, add `getStale()` method)
- Modify: `src/index.ts` (update `memory_store_fact` schema, add `memory_review_stale` tool)
- Test: `src/store.test.ts`

**Step 1: Write failing tests**

Add to `src/store.test.ts`:

```typescript
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

  it("should find stale facts that need review", () => {
    store.addFact({
      content: "Old fact from last year",
      category: "work",
    });
    // Manually backdate
    const facts = store.searchFacts({ category: "work", include_expired: true });
    store.updateFact(facts[0].id, {});
    // For testing, we'll use getStale with a 0-day threshold
    const stale = store.getStale(0);
    assert.ok(stale.length >= 1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `expires_at` param not accepted, `include_expired` not recognized, `getStale` not found.

**Step 3: Add `expires_at` to Fact interface and update methods**

In `src/store.ts`, add to the `Fact` interface:

```typescript
  expires_at?: string;     // ISO 8601, optional TTL
```

Update `addFact` params to accept `expires_at`:

```typescript
  addFact(params: {
    content: string;
    category: string;
    confidence?: number;
    source_provider?: string;
    source_conversation?: string;
    status?: FactStatus;
    tags?: string[];
    supersedes?: string;
    expires_at?: string;
  }): { fact: Fact; duplicates: Array<{ fact: Fact; similarity: number }> } {
```

And in the fact construction, add:

```typescript
      expires_at: params.expires_at,
```

Update `searchFacts` to accept `include_expired`:

```typescript
  searchFacts(params: {
    query?: string;
    category?: string;
    status?: FactStatus;
    tags?: string[];
    limit?: number;
    include_expired?: boolean;
  }): Fact[] {
    let results = this.data.facts;

    // Filter out expired facts by default
    if (!params.include_expired) {
      const now = new Date().getTime();
      results = results.filter(f => !f.expires_at || new Date(f.expires_at).getTime() > now);
    }
```

Update `buildContext` to exclude expired facts — add filter after the `status === "confirmed"` check:

```typescript
    const now = new Date().getTime();
    let facts = this.data.facts.filter(
      f => f.status === "confirmed"
        && !docFactIds.has(f.id)
        && (!f.expires_at || new Date(f.expires_at).getTime() > now)
    );
```

Add `getStale()` method:

```typescript
  /** Get facts older than `daysOld` days that are still confirmed — candidates for review */
  getStale(daysOld = 90): Fact[] {
    const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
    return this.data.facts.filter(
      f => f.status === "confirmed" && f.updated_at < cutoff
    );
  }
```

**Step 4: Register `memory_review_stale` tool in index.ts**

```typescript
server.registerTool(
  "memory_review_stale",
  {
    title: "Review Stale Facts",
    description: `Surface facts that haven't been updated recently and may be outdated.
Use this periodically to keep the memory store fresh and accurate.

Args:
  - days_old (number, optional): Minimum age in days (default: 90)
  - category (string, optional): Filter to a specific category

Returns: Array of stale facts that may need re-confirmation or rejection.`,
    inputSchema: {
      days_old: z.number().int().min(1).optional()
        .describe("Minimum age in days (default: 90)"),
      category: z.enum([
        "work", "personal", "technical", "preferences", "goals",
        "health", "values", "social", "finance", "travel", "education", "context"
      ]).optional().describe("Filter to category"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    let stale = store.getStale(params.days_old ?? 90);

    if (params.category) {
      stale = stale.filter(f => f.category === params.category);
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          count: stale.length,
          facts: stale.map(f => ({
            id: f.id,
            content: f.content,
            category: f.category,
            updated_at: f.updated_at,
            days_since_update: Math.floor(
              (Date.now() - new Date(f.updated_at).getTime()) / 86400000
            ),
          })),
          hint: stale.length > 0
            ? "Review these facts — confirm if still accurate, reject or update if not."
            : "All facts are recently updated.",
        }, null, 2),
      }],
    };
  }
);
```

Also update `memory_store_fact` and `memory_create_facts` input schemas to accept `expires_at`:

```typescript
      expires_at: z.string().optional()
        .describe("ISO 8601 expiry date — fact is hidden after this date"),
```

**Step 5: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add retention/decay with expires_at and stale fact review

Facts can now have an optional expiry date. Expired facts are excluded
from search and context by default. memory_review_stale surfaces old
facts for periodic review."
```

---

## Tier 3 — Makes It Powerful

---

### Task 7: Semantic Search with Token Scoring

Upgrade search from pure substring matching to a scored token-based search. Uses TF-IDF-like weighting on word tokens. No external API calls, no embeddings — pure local computation.

**Files:**
- Modify: `src/similarity.ts` (add `scoredSearch()` function)
- Modify: `src/store.ts` (use scored search in `searchFacts` when query is provided)
- Test: `src/similarity.test.ts`
- Test: `src/store.test.ts`

**Step 1: Write failing tests for scored search**

Add to `src/similarity.test.ts`:

```typescript
import { scoredSearch } from "./similarity.js";

describe("scoredSearch", () => {
  const documents = [
    "Works as a consultant in organisational development",
    "Prefers TypeScript over JavaScript",
    "Lives in North East England",
    "Building a consultancy platform for clients",
  ];

  it("should rank exact keyword matches highest", () => {
    const results = scoredSearch("consultant", documents);
    assert.ok(results[0].index === 0 || results[0].index === 3);
    assert.ok(results[0].score > 0);
  });

  it("should find partial word matches", () => {
    const results = scoredSearch("TypeScript", documents);
    assert.ok(results.length > 0);
    assert.equal(results[0].index, 1);
  });

  it("should return empty for no matches", () => {
    const results = scoredSearch("quantum physics", documents);
    assert.equal(results.length, 0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL.

**Step 3: Implement `scoredSearch()`**

Add to `src/similarity.ts`:

```typescript
/**
 * Score documents against a query using token overlap with IDF-like weighting.
 * Returns matching documents sorted by relevance score (descending).
 */
export function scoredSearch(
  query: string,
  documents: string[],
  minScore = 0.01,
): Array<{ index: number; score: number }> {
  const tokenize = (s: string): string[] =>
    s.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Simple IDF: tokens appearing in fewer documents get higher weight
  const docCount = documents.length || 1;
  const tokenDocFreq = new Map<string, number>();
  for (const doc of documents) {
    const unique = new Set(tokenize(doc));
    for (const t of unique) {
      tokenDocFreq.set(t, (tokenDocFreq.get(t) ?? 0) + 1);
    }
  }

  const results: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < documents.length; i++) {
    const docTokens = tokenize(documents[i]);
    const docTokenSet = new Set(docTokens);
    let score = 0;

    for (const qt of queryTokens) {
      // Check for exact token match or substring match within tokens
      for (const dt of docTokenSet) {
        if (dt === qt) {
          const idf = Math.log(docCount / (tokenDocFreq.get(dt) ?? 1));
          score += 1.0 + idf;
        } else if (dt.includes(qt) || qt.includes(dt)) {
          const idf = Math.log(docCount / (tokenDocFreq.get(dt) ?? 1));
          score += 0.5 + idf * 0.5;
        }
      }
    }

    if (score >= minScore) {
      results.push({ index: i, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
```

**Step 4: Update `searchFacts` in store.ts to use scored search**

Replace the query filtering block in `searchFacts`:

```typescript
    if (params.query) {
      const contents = results.map(f => f.content + " " + f.tags.join(" "));
      const scored = scoredSearch(params.query, contents);
      const scoredIndices = new Set(scored.map(s => s.index));

      // Reorder results by relevance score
      const scoredResults = scored.map(s => results[s.index]);
      results = scoredResults;
    } else {
      // Sort by most recently updated when no query
      results.sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    }
```

Add import at top of store.ts:

```typescript
import { tokenSimilarity, scoredSearch } from "./similarity.js";
```

Remove the old sort that was after the query block (since we now sort inside the branch).

**Step 5: Add store-level search test**

Add to `src/store.test.ts`:

```typescript
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
```

**Step 6: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 7: Commit**

```bash
git add src/similarity.ts src/similarity.test.ts src/store.ts src/store.test.ts
git commit -m "feat: upgrade search to scored token matching with IDF weighting

Replaces substring-only search with token-based relevance scoring.
Results are ranked by relevance when a query is provided."
```

---

### Task 8: Multi-Provider Attribution

Add a `memory_provider_stats` tool that shows which providers contributed which facts, and surfaces contradictions between providers.

**Files:**
- Modify: `src/store.ts` (add `getProviderStats()` method)
- Modify: `src/index.ts` (register `memory_provider_stats` tool)
- Test: `src/store.test.ts`

**Step 1: Write failing test**

Add to `src/store.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL.

**Step 3: Implement `getProviderStats()`**

Add to `src/store.ts`:

```typescript
  getProviderStats(): {
    providers: Record<string, {
      fact_count: number;
      categories: string[];
      latest_fact: string;
    }>;
    total_providers: number;
  } {
    const providerMap = new Map<string, { facts: Fact[] }>();

    for (const f of this.data.facts) {
      if (f.status === "rejected") continue;
      const entry = providerMap.get(f.source_provider) ?? { facts: [] };
      entry.facts.push(f);
      providerMap.set(f.source_provider, entry);
    }

    const providers: Record<string, {
      fact_count: number;
      categories: string[];
      latest_fact: string;
    }> = {};

    for (const [name, entry] of providerMap) {
      const cats = [...new Set(entry.facts.map(f => f.category))];
      const latest = entry.facts.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];

      providers[name] = {
        fact_count: entry.facts.length,
        categories: cats,
        latest_fact: latest.created_at,
      };
    }

    return { providers, total_providers: providerMap.size };
  }
```

**Step 4: Register `memory_provider_stats` tool in index.ts**

```typescript
server.registerTool(
  "memory_provider_stats",
  {
    title: "Provider Attribution Stats",
    description: `Show which LLM providers have contributed facts to the memory store,
how many facts each has contributed, and which categories they cover.

Returns: Provider breakdown with fact counts and categories.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const stats = store.getProviderStats();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(stats, null, 2),
      }],
    };
  }
);
```

**Step 5: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add provider attribution stats tool

Shows which LLM providers contributed facts and their coverage
across categories."
```

---

### Task 9: Schema Customization

Add `memory_update_schema` tool to add/edit/remove categories. Changes persist in the store.

**Files:**
- Modify: `src/store.ts` (add `addCategory()`, `updateCategory()`, `removeCategory()`)
- Modify: `src/index.ts` (register `memory_update_schema` tool)
- Test: `src/store.test.ts`

**Step 1: Write failing tests**

Add to `src/store.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL.

**Step 3: Implement schema methods**

Add to `src/store.ts` in MemoryStore class:

```typescript
  addCategory(category: SchemaCategory): boolean {
    if (this.data.schema.some(c => c.name === category.name)) return false;
    this.data.schema.push(category);
    this.save();
    return true;
  }

  updateCategory(name: string, updates: Partial<Omit<SchemaCategory, "name">>): boolean {
    const cat = this.data.schema.find(c => c.name === name);
    if (!cat) return false;
    if (updates.description !== undefined) cat.description = updates.description;
    if (updates.hints !== undefined) cat.hints = updates.hints;
    if (updates.examples !== undefined) cat.examples = updates.examples;
    this.save();
    return true;
  }

  removeCategory(name: string): boolean {
    const idx = this.data.schema.findIndex(c => c.name === name);
    if (idx === -1) return false;
    this.data.schema.splice(idx, 1);
    this.save();
    return true;
  }
```

**Step 4: Register `memory_update_schema` tool in index.ts**

```typescript
server.registerTool(
  "memory_update_schema",
  {
    title: "Update Memory Schema",
    description: `Add, update, or remove a category from the memory schema.

Actions:
  - "add": Create a new custom category
  - "update": Modify an existing category's description, hints, or examples
  - "remove": Delete a category from the schema

Args:
  - action (string): "add", "update", or "remove"
  - name (string): Category name (lowercase, no spaces)
  - description (string, optional): Category description (required for "add")
  - hints (string[], optional): Extraction hints for the LLM
  - examples (string[], optional): Example facts

Returns: Updated schema or error.`,
    inputSchema: {
      action: z.enum(["add", "update", "remove"]).describe("Action to perform"),
      name: z.string().min(2).max(30).describe("Category name"),
      description: z.string().optional().describe("Category description"),
      hints: z.array(z.string()).optional().describe("Extraction hints"),
      examples: z.array(z.string()).optional().describe("Example facts"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    if (params.action === "add") {
      if (!params.description) {
        return {
          content: [{ type: "text" as const, text: "Error: description is required when adding a category." }],
          isError: true,
        };
      }
      const ok = store.addCategory({
        name: params.name,
        description: params.description,
        hints: params.hints ?? [],
        examples: params.examples ?? [],
      });
      if (!ok) {
        return {
          content: [{ type: "text" as const, text: `Error: Category "${params.name}" already exists.` }],
          isError: true,
        };
      }
    } else if (params.action === "update") {
      const ok = store.updateCategory(params.name, {
        description: params.description,
        hints: params.hints,
        examples: params.examples,
      });
      if (!ok) {
        return {
          content: [{ type: "text" as const, text: `Error: Category "${params.name}" not found.` }],
          isError: true,
        };
      }
    } else {
      const ok = store.removeCategory(params.name);
      if (!ok) {
        return {
          content: [{ type: "text" as const, text: `Error: Category "${params.name}" not found.` }],
          isError: true,
        };
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          action: params.action,
          category: params.name,
          schema: store.getSchema(),
        }, null, 2),
      }],
    };
  }
);
```

**Important:** With custom categories, the hardcoded `z.enum(["work", "personal", ...])` in every tool's input schema becomes a limitation. For now, change those to `z.string()` so custom categories can be used. Update the description text to list the built-in categories as guidance but accept any string. This is a find-and-replace across `src/index.ts`:

Replace every instance of:
```typescript
z.enum([
  "work", "personal", "technical", "preferences", "goals",
  "health", "values", "social", "finance", "travel", "education", "context"
])
```
with:
```typescript
z.string().min(2)
```

And update the `.describe()` calls to mention built-in categories as examples, e.g.:
```typescript
.describe("Category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)")
```

**Step 5: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add schema customization — add/update/remove categories

Custom categories are now supported. Category validation switched
from hardcoded enum to free-form string to support user-defined
categories."
```

---

### Task 10: Selective Sharing / Category Visibility

Add per-category visibility settings. Categories can be "always" (default), "relevant" (only included in context when the topic matches), or "hidden" (excluded from context, only returned by explicit search).

**Files:**
- Modify: `src/store.ts` (add visibility to SchemaCategory, filter in `buildContext`)
- Modify: `src/index.ts` (add visibility param to `memory_update_schema`)
- Test: `src/store.test.ts`

**Step 1: Write failing tests**

Add to `src/store.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `visibility` not accepted by `updateCategory`.

**Step 3: Add visibility to SchemaCategory**

In `src/store.ts`, update the `SchemaCategory` interface:

```typescript
export interface SchemaCategory {
  name: string;
  description: string;
  hints: string[];
  examples: string[];
  visibility?: "always" | "relevant" | "hidden";  // default: "always"
}
```

Update `updateCategory` to accept `visibility`:

```typescript
  updateCategory(name: string, updates: Partial<Omit<SchemaCategory, "name">>): boolean {
    const cat = this.data.schema.find(c => c.name === name);
    if (!cat) return false;
    if (updates.description !== undefined) cat.description = updates.description;
    if (updates.hints !== undefined) cat.hints = updates.hints;
    if (updates.examples !== undefined) cat.examples = updates.examples;
    if (updates.visibility !== undefined) cat.visibility = updates.visibility;
    this.save();
    return true;
  }
```

Update `buildContext` to respect visibility. When `categories` param is provided, include those regardless of visibility (explicit request overrides). When not provided, exclude "hidden" categories:

In the `buildContext` method, add a helper at the top:

```typescript
    // Determine which categories to include
    const hiddenCategories = new Set(
      this.data.schema
        .filter(c => c.visibility === "hidden")
        .map(c => c.name)
    );

    const isExplicitRequest = params?.categories && params.categories.length > 0;
```

Then in the documents filter, add:

```typescript
    if (includeDocuments) {
      let docs = this.data.documents;
      if (params?.categories) {
        docs = docs.filter(d => params.categories!.includes(d.category));
      } else {
        docs = docs.filter(d => !hiddenCategories.has(d.category));
      }
```

And in the facts filter:

```typescript
    if (params?.categories) {
      facts = facts.filter(f => params.categories!.includes(f.category));
    } else {
      facts = facts.filter(f => !hiddenCategories.has(f.category));
    }
```

**Step 4: Update `memory_update_schema` tool to include visibility option**

Add to the input schema:

```typescript
      visibility: z.enum(["always", "relevant", "hidden"]).optional()
        .describe("Category visibility in auto-context: always (default), relevant, or hidden"),
```

And pass it through in the update action:

```typescript
    } else if (params.action === "update") {
      const ok = store.updateCategory(params.name, {
        description: params.description,
        hints: params.hints,
        examples: params.examples,
        visibility: params.visibility,
      });
```

**Step 5: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add per-category visibility controls

Categories can be set to always (default), relevant, or hidden.
Hidden categories are excluded from auto-context but still
searchable with explicit queries."
```

---

## Tier 4 — Nice to Have

---

### Task 11: Change Log / Audit Trail

Track all mutations as a log. Each entry records what changed, when, and by which provider. Stored as a separate `changelog.json` alongside `store.json`.

**Files:**
- Create: `src/changelog.ts`
- Create: `src/changelog.test.ts`
- Modify: `src/store.ts` (emit log entries on mutations)
- Modify: `src/index.ts` (add `memory_changelog` tool)

**Step 1: Write failing tests**

Create `src/changelog.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL.

**Step 3: Implement ChangeLog**

Create `src/changelog.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ChangeEntry {
  timestamp: string;
  action: string;
  fact_id?: string;
  provider?: string;
  details?: Record<string, unknown>;
}

export class ChangeLog {
  private file: string;
  private entries: ChangeEntry[];

  constructor(dataDir: string) {
    this.file = join(dataDir, "changelog.json");
    this.entries = this.load();
  }

  private load(): ChangeEntry[] {
    if (existsSync(this.file)) {
      try {
        return JSON.parse(readFileSync(this.file, "utf-8"));
      } catch {
        return [];
      }
    }
    return [];
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2), "utf-8");
  }

  append(entry: Omit<ChangeEntry, "timestamp">): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    this.save();
  }

  getRecent(limit = 50): ChangeEntry[] {
    return [...this.entries].reverse().slice(0, limit);
  }
}
```

**Step 4: Wire into MemoryStore**

In `src/store.ts`, import and create a ChangeLog:

```typescript
import { ChangeLog } from "./changelog.js";
```

Add field and initialize in constructor:

```typescript
  private changelog: ChangeLog;

  constructor(dataDir?: string, passphrase?: string) {
    // ... existing code ...
    this.changelog = new ChangeLog(this.dataDir);
  }
```

Add `this.changelog.append(...)` calls in mutation methods:
- `addFact`: `this.changelog.append({ action: "add_fact", fact_id: fact.id, provider: params.source_provider });`
- `updateFact`: `this.changelog.append({ action: "update_fact", fact_id: id });`
- `deleteFact`: `this.changelog.append({ action: "delete_fact", fact_id: id });`
- `upsertDocument`: `this.changelog.append({ action: "upsert_document", details: { category: params.category } });`
- `importData`: `this.changelog.append({ action: "import", details: { imported_facts, imported_documents } });`

Expose the log for index.ts:

```typescript
  getChangelog(limit?: number): ChangeEntry[] {
    return this.changelog.getRecent(limit);
  }
```

**Step 5: Register `memory_changelog` tool in index.ts**

```typescript
server.registerTool(
  "memory_changelog",
  {
    title: "Memory Change Log",
    description: `View recent changes to the memory store — fact additions, updates,
deletions, imports, etc. Useful for understanding what changed and when.

Args:
  - limit (number, optional): How many entries to return (default: 50)

Returns: Array of change log entries, most recent first.`,
    inputSchema: {
      limit: z.number().int().min(1).max(500).optional()
        .describe("Max entries (default: 50)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const entries = store.getChangelog(params.limit);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ count: entries.length, entries }, null, 2),
      }],
    };
  }
);
```

**Step 6: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 7: Commit**

```bash
git add src/changelog.ts src/changelog.test.ts src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add change log for audit trail

All mutations (add, update, delete, import) are logged to
changelog.json. New memory_changelog tool exposes the log."
```

---

### Task 12: Bulk Operations

Add a `memory_bulk_update` tool for common batch operations: confirm all pending, delete all rejected, delete by category, etc.

**Files:**
- Modify: `src/store.ts` (add `bulkUpdate()` method)
- Modify: `src/index.ts` (register `memory_bulk_update` tool)
- Test: `src/store.test.ts`

**Step 1: Write failing tests**

Add to `src/store.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL.

**Step 3: Implement bulk methods**

Add to `src/store.ts`:

```typescript
  bulkUpdate(params: {
    from_status: FactStatus;
    to_status: FactStatus;
    category?: string;
  }): number {
    const now = new Date().toISOString();
    let count = 0;
    for (const fact of this.data.facts) {
      if (fact.status !== params.from_status) continue;
      if (params.category && fact.category !== params.category) continue;
      fact.status = params.to_status;
      fact.updated_at = now;
      count++;
    }
    if (count > 0) {
      this.save();
      this.changelog.append({
        action: "bulk_update",
        details: { count, from: params.from_status, to: params.to_status },
      });
    }
    return count;
  }

  bulkDelete(params: {
    status?: FactStatus;
    category?: string;
  }): number {
    const before = this.data.facts.length;
    this.data.facts = this.data.facts.filter(f => {
      if (params.status && f.status === params.status) {
        if (!params.category || f.category === params.category) return false;
      }
      if (params.category && !params.status && f.category === params.category) return false;
      return true;
    });
    const removed = before - this.data.facts.length;
    if (removed > 0) {
      this.save();
      this.changelog.append({
        action: "bulk_delete",
        details: { count: removed, ...params },
      });
    }
    return removed;
  }
```

**Step 4: Register `memory_bulk_update` tool in index.ts**

```typescript
server.registerTool(
  "memory_bulk_update",
  {
    title: "Bulk Memory Operations",
    description: `Perform bulk operations on the memory store.

Actions:
  - "confirm_pending": Confirm all pending facts
  - "delete_rejected": Delete all rejected facts
  - "delete_category": Delete all facts in a category

Args:
  - action (string): The bulk action
  - category (string, optional): Filter to a specific category

Returns: Number of facts affected.`,
    inputSchema: {
      action: z.enum(["confirm_pending", "delete_rejected", "delete_category"])
        .describe("Bulk action to perform"),
      category: z.string().optional()
        .describe("Category to filter (required for delete_category)"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    let count: number;

    switch (params.action) {
      case "confirm_pending":
        count = store.bulkUpdate({
          from_status: "pending",
          to_status: "confirmed",
          category: params.category,
        });
        break;
      case "delete_rejected":
        count = store.bulkDelete({ status: "rejected", category: params.category });
        break;
      case "delete_category":
        if (!params.category) {
          return {
            content: [{ type: "text" as const, text: "Error: category is required for delete_category." }],
            isError: true,
          };
        }
        count = store.bulkDelete({ category: params.category });
        break;
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          action: params.action,
          affected: count,
          category: params.category ?? "all",
        }, null, 2),
      }],
    };
  }
);
```

**Step 5: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add bulk operations — confirm pending, delete rejected, clear category"
```

---

### Task 13: Per-Category MCP Resources

Register a dynamic MCP resource template `memory://category/{name}` so clients can browse individual category profiles.

**Files:**
- Modify: `src/index.ts` (register resource template)

**Step 1: Add resource template registration**

In `src/index.ts`, after the `memory://profile` resource, add:

```typescript
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

// ─── Resource: Per-category memory profiles ──────────────────────────

server.registerResource(
  "memory-category",
  new ResourceTemplate("memory://category/{name}", { list: undefined }),
  {
    title: "Memory Category",
    description: "Memory profile for a specific category",
    mimeType: "text/plain",
  },
  async (uri, variables) => {
    const name = variables.name as string;
    const context = store.buildContext({ categories: [name] });
    return {
      contents: [{
        uri: uri.href,
        mimeType: "text/plain",
        text: context || `(No facts in category "${name}" yet.)`,
      }],
    };
  }
);
```

**Step 2: Build and verify**

Run: `npm run build && timeout 3 node dist/index.js 2>&1 || true`
Expected: Clean build, server starts.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add per-category MCP resource template

Exposes memory://category/{name} for browsing individual
category profiles."
```

---

### Task 14: Write Rate Limiting

Prevent runaway LLMs from flooding the store in a single session. Limit to N writes per minute (default 30).

**Files:**
- Modify: `src/store.ts` (add rate limiter)
- Test: `src/store.test.ts`

**Step 1: Write failing test**

Add to `src/store.test.ts`:

```typescript
describe("rate limiting", () => {
  let store: MemoryStore;
  let dir: string;

  beforeEach(() => {
    ({ store, dir } = makeTempStore());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should throw after exceeding write limit", () => {
    // Set a very low limit for testing
    store.setRateLimit(3, 60000);

    store.addFact({ content: "Fact 1", category: "work" });
    store.addFact({ content: "Fact 2", category: "work" });
    store.addFact({ content: "Fact 3", category: "work" });

    assert.throws(
      () => store.addFact({ content: "Fact 4", category: "work" }),
      /rate limit/i
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL.

**Step 3: Implement rate limiter**

Add to `src/store.ts`:

```typescript
  private writeTimestamps: number[] = [];
  private rateLimit = 30;
  private rateWindow = 60000; // 1 minute in ms

  setRateLimit(limit: number, windowMs: number): void {
    this.rateLimit = limit;
    this.rateWindow = windowMs;
  }

  private checkRateLimit(): void {
    const now = Date.now();
    this.writeTimestamps = this.writeTimestamps.filter(t => now - t < this.rateWindow);
    if (this.writeTimestamps.length >= this.rateLimit) {
      throw new Error(`Rate limit exceeded: ${this.rateLimit} writes per ${this.rateWindow / 1000}s`);
    }
    this.writeTimestamps.push(now);
  }
```

Then add `this.checkRateLimit()` as the first line in:
- `addFact()` (before duplicate check)
- `upsertDocument()`
- `bulkUpdate()` (before the loop)
- `bulkDelete()` (before the filter)

**Step 4: Update tool handlers in index.ts to catch rate limit errors**

Wrap mutating tool handlers in try/catch. For example in `memory_store_fact`:

```typescript
  async (params) => {
    try {
      const { fact, duplicates } = store.addFact({...});
      // ... existing response
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        }],
        isError: true,
      };
    }
  }
```

Apply the same pattern to: `memory_store_facts`, `memory_save_all_facts`, `memory_merge_document`, `memory_bulk_update`, `memory_import`.

**Step 5: Run all tests and build**

Run: `npm test && npm run build`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/store.ts src/store.test.ts src/index.ts
git commit -m "feat: add per-session write rate limiting

Default 30 writes per minute. Prevents runaway LLMs from
flooding the store. Configurable via setRateLimit()."
```

---

### Task 15: Final — Version Bump and README Update

**Files:**
- Modify: `package.json` (version → "1.0.0")
- Modify: `src/index.ts` (version in McpServer → "1.0.0")
- Modify: `README.md` (update tool count, add new features, update roadmap)

**Step 1: Bump version**

In `package.json`, change `"version": "0.1.0"` to `"version": "1.0.0"`.

In `src/index.ts`, change `version: "0.1.0"` to `version: "1.0.0"`.

**Step 2: Update README.md**

Update the tool table to include all new tools:
- `memory_import` — Import from JSON export
- `memory_review_stale` — Surface old facts for review
- `memory_provider_stats` — Provider attribution breakdown
- `memory_update_schema` — Add/edit/remove categories
- `memory_bulk_update` — Bulk confirm/delete operations
- `memory_changelog` — View mutation history

Update the "What it does" section to mention encryption, duplicate detection, and retention.

Update the roadmap to check off completed items and add any remaining future work.

Update the architecture diagram tool count.

**Step 3: Run full test suite and build**

Run: `npm test && npm run build`
Expected: All pass, clean build.

**Step 4: Commit and tag**

```bash
git add package.json src/index.ts README.md
git commit -m "release: v1.0.0

Major features since v0.1.0:
- Duplicate detection with token similarity
- Full fact editing (content, category, tags)
- Auto-context MCP resource
- AES-256-GCM encryption at rest
- Import with conflict resolution
- Retention and expiry
- Scored token search
- Provider attribution
- Custom categories
- Category visibility controls
- Change log audit trail
- Bulk operations
- Per-category MCP resources
- Write rate limiting"
git tag v1.0.0
```

---

## Summary

| Tier | Task | What it adds |
|------|------|-------------|
| 0 | Test infrastructure | `node:test` + tsx, temp-dir isolation |
| **1** | Duplicate detection | Jaccard similarity, duplicate warnings on write |
| **1** | Fact content editing | Full field editing on saved facts |
| **1** | Auto-context resource | `memory://profile` MCP resource |
| **2** | Encryption at rest | AES-256-GCM via env var passphrase |
| **2** | Import tool | Merge exported JSON with conflict resolution |
| **2** | Retention/decay | `expires_at` field, stale fact review |
| **3** | Semantic search | IDF-weighted token scoring |
| **3** | Provider attribution | Per-provider stats tool |
| **3** | Schema customization | Add/edit/remove categories |
| **3** | Selective sharing | Per-category visibility controls |
| **4** | Change log | Audit trail for all mutations |
| **4** | Bulk operations | Batch confirm/delete |
| **4** | Per-category resources | `memory://category/{name}` template |
| **4** | Rate limiting | 30 writes/minute session cap |
| **4** | Version bump + README | Ship v1.0.0 |

**New files created:** `src/similarity.ts`, `src/similarity.test.ts`, `src/crypto.ts`, `src/crypto.test.ts`, `src/changelog.ts`, `src/changelog.test.ts`, `src/index.test.ts`

**Total new tools:** 5 (`memory_import`, `memory_review_stale`, `memory_provider_stats`, `memory_update_schema`, `memory_bulk_update`, `memory_changelog`) — bringing the total from 17 to 23.
