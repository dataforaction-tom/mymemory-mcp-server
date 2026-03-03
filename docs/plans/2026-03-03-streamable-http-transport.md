# Streamable HTTP Transport — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Streamable HTTP transport so the server works with Mistral Le Chat, OpenAI, and Google Gemini Enterprise.

**Architecture:** Extract tool/resource registration into a `createServer(store)` factory. Add `src/transports.ts` with `startStdio()` and `startHttp()`. Slim down `index.ts` to CLI arg parsing. No new dependencies — Express ships with the MCP SDK.

**Tech Stack:** `@modelcontextprotocol/sdk` (StreamableHTTPServerTransport, createMcpExpressApp), Express (transitive dep), Node.js >=18

**Design doc:** `docs/plans/2026-03-03-streamable-http-transport-design.md`

---

### Task 1: Extract server factory into `src/server.ts`

**Files:**
- Create: `src/server.ts`
- Modify: `src/index.ts` (lines 41-1479 — gut most of the file)

**Step 1: Create `src/server.ts`**

Move all tool and resource registration out of `index.ts` into a factory function. The file should:

1. Import `McpServer`, `ResourceTemplate`, `z`, `MemoryStore`, types
2. Export `function createServer(store: MemoryStore): McpServer`
3. Inside the function: create `new McpServer(...)`, register all 23 tools and 2 resources (copy verbatim from `index.ts`), return the server

The key structural change:
```typescript
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemoryStore } from "./store.js";
import type { FactStatus, DraftFact } from "./store.js";

export function createServer(store: MemoryStore): McpServer {
  const server = new McpServer({
    name: "memory-mcp-server",
    version: "1.0.0",
  });

  // ... all 23 server.registerTool(...) calls ...
  // ... all 2 server.registerResource(...) calls ...

  return server;
}
```

Copy the entire body (lines 58-1466 of current `index.ts`) into the function. Every `server.registerTool(...)` and `server.registerResource(...)` call moves verbatim — no logic changes.

**Step 2: Slim down `src/index.ts`**

Replace the entire file with a minimal entry point:

```typescript
#!/usr/bin/env node

import { MemoryStore } from "./store.js";
import { startStdio } from "./transports.js";

const store = new MemoryStore();

async function main(): Promise<void> {
  await startStdio(store);
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

Note: this will NOT compile yet because `transports.ts` doesn't exist. That's Task 2.

**Step 3: Verify the refactor compiles**

Skip this step — we'll compile after Task 2.

**Step 4: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "refactor: extract server factory into src/server.ts"
```

---

### Task 2: Create `src/transports.ts` with stdio transport

**Files:**
- Create: `src/transports.ts`

**Step 1: Create `src/transports.ts` with stdio only**

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore } from "./store.js";
import { createServer } from "./server.js";

export async function startStdio(store: MemoryStore): Promise<void> {
  const server = createServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("memory-mcp-server running on stdio");
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 3: Run existing tests**

Run: `npm test`
Expected: All tests pass. The refactor doesn't change any behavior — just moves code between files.

**Step 4: Commit**

```bash
git add src/transports.ts
git commit -m "refactor: add transports module with stdio support"
```

---

### Task 3: Add HTTP transport to `src/transports.ts`

**Files:**
- Modify: `src/transports.ts`

**Step 1: Add `startHttp` function**

Append to `src/transports.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
```

Add these imports at the top of the file alongside the existing ones.

Then add the function:

```typescript
export interface HttpOptions {
  port: number;
  host: string;
  apiKey?: string;
}

export async function startHttp(store: MemoryStore, options: HttpOptions): Promise<void> {
  const { port, host, apiKey } = options;

  const app = createMcpExpressApp({
    host: host === "0.0.0.0" || host === "::" ? undefined : host,
    allowedHosts: host === "0.0.0.0" || host === "::" ? undefined : undefined,
  });

  // Bearer token auth middleware
  if (apiKey) {
    app.use("/mcp", (req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${apiKey}`) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id: null,
        });
        return;
      }
      next();
    });
  }

  // Session transport map
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // POST /mcp — handle all MCP requests
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport;
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
          }
        };

        const server = createServer(store);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET /mcp — SSE stream for server-initiated messages
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // DELETE /mcp — session termination
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      console.error("Error handling session termination:", error);
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination");
      }
    }
  });

  // Start listening
  app.listen(port, host, () => {
    console.error(`memory-mcp-server running on http://${host}:${port}/mcp`);
    if (apiKey) {
      console.error("Bearer token authentication enabled");
    }
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down...");
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close();
        delete transports[sid];
      } catch (error) {
        console.error(`Error closing session ${sid}:`, error);
      }
    }
    process.exit(0);
  });
}
```

**Step 2: Build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Commit**

```bash
git add src/transports.ts
git commit -m "feat: add Streamable HTTP transport for remote MCP clients"
```

---

### Task 4: Wire up CLI arg parsing in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

**Step 1: Update `src/index.ts` with arg parsing**

Replace the file with:

```typescript
#!/usr/bin/env node

import { MemoryStore } from "./store.js";
import { startStdio, startHttp } from "./transports.js";

function getFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function getFlagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const store = new MemoryStore();

async function main(): Promise<void> {
  if (getFlag("http")) {
    const port = Number(getFlagValue("port") ?? process.env.MCP_PORT ?? "3000");
    const host = getFlagValue("host") ?? process.env.MCP_HOST ?? "127.0.0.1";
    const apiKey = process.env.MEMORY_MCP_API_KEY;
    await startHttp(store, { port, host, apiKey });
  } else {
    await startStdio(store);
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Step 2: Build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add --http CLI flag with --port and --host options"
```

---

### Task 5: Manual smoke test — stdio

**Step 1: Verify stdio still works**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node dist/index.js 2>/dev/null | head -1`

Expected: JSON response containing `"result"` with server info and `"protocolVersion"`.

**Step 2: No commit needed**

---

### Task 6: Manual smoke test — HTTP

**Step 1: Start the HTTP server in background**

Run: `node dist/index.js --http --port 3001 &`
Expected: stderr prints `memory-mcp-server running on http://127.0.0.1:3001/mcp`

**Step 2: Send an initialize request**

Run:
```bash
curl -s -X POST http://127.0.0.1:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
```

Expected: JSON or SSE response containing `"result"` with server info, `"protocolVersion"`, and an `mcp-session-id` response header.

**Step 3: Test auth rejection**

Stop the server, restart with: `MEMORY_MCP_API_KEY=secret123 node dist/index.js --http --port 3001 &`

Run:
```bash
curl -s -X POST http://127.0.0.1:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
```

Expected: 401 response with `"Unauthorized"`.

Run with token:
```bash
curl -s -X POST http://127.0.0.1:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer secret123" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}'
```

Expected: Successful initialize response.

**Step 4: Kill background server**

Run: `kill %1` (or the PID)

**Step 5: No commit needed**

---

### Task 7: Update README

**Files:**
- Modify: `README.md`

**Step 1: Add HTTP transport section to README**

After the existing "Quick start" / installation section, add a new section:

```markdown
## HTTP Transport (Remote Access)

To use memory-mcp-server with Mistral Le Chat, OpenAI, or Google Gemini Enterprise,
run it in HTTP mode:

```bash
# Local development
memory-mcp-server --http

# Custom port
memory-mcp-server --http --port 8080

# Remote deployment (all interfaces + auth)
MEMORY_MCP_API_KEY=your-secret-key memory-mcp-server --http --host 0.0.0.0
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MEMORY_MCP_API_KEY` | Bearer token for HTTP authentication (optional — required for remote deployments) |
| `MCP_PORT` | HTTP port (default: 3000, overridden by `--port`) |
| `MCP_HOST` | Bind address (default: 127.0.0.1, overridden by `--host`) |

### Connecting from Platforms

**Mistral Le Chat:** Add a Custom Connector with URL `https://your-server.example.com/mcp` and select "HTTP Bearer Token" authentication.

**OpenAI:** Configure as a remote MCP server with URL `https://your-server.example.com/mcp` and your bearer token.

**Google Gemini Enterprise:** Add as a custom MCP server with the Streamable HTTP URL `https://your-server.example.com/mcp`.

> **Note:** For remote deployments, use a reverse proxy (Caddy, nginx, Cloudflare Tunnel) to terminate HTTPS. The server speaks plain HTTP.
```

**Step 2: Update the roadmap checklist**

Change `- [ ] HTTP transport for remote/multi-client scenarios` to `- [x] HTTP transport for remote/multi-client scenarios`.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add HTTP transport usage and platform setup guides"
```

---

### Task 8: Final verification

**Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: Clean compilation.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit (if any fixes were needed)**

Only commit if fixes were made during verification.
