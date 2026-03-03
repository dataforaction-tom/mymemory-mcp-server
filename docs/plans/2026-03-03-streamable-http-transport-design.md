# Streamable HTTP Transport for memory-mcp-server

> Date: 2026-03-03
> Status: Approved

## Problem

The server only supports stdio transport. Mistral Le Chat, OpenAI (ChatGPT/Apps SDK), and Google Gemini Enterprise all require remote HTTP-based MCP servers. Our SDK (`@modelcontextprotocol/sdk@1.27.1`) already ships `StreamableHTTPServerTransport` and Express — we just need to wire it up.

## Compatibility Target

| Platform                 | Required Transport           | After This Work |
|--------------------------|------------------------------|-----------------|
| Claude Code/Desktop      | stdio                        | Yes (unchanged) |
| Google Gemini CLI         | stdio, SSE, or HTTP          | Yes (unchanged) |
| Mistral Le Chat          | streamable-http (remote URL) | Yes             |
| OpenAI ChatGPT/Apps SDK  | SSE or Streamable HTTP       | Yes             |
| Google Gemini Enterprise  | Streamable HTTP              | Yes             |

## Design Decisions

- **Single-user** — one MemoryStore, same as today. No multi-tenancy.
- **One transport at a time** — CLI flag selects stdio (default) or HTTP. No dual mode.
- **Bearer token auth** — via `MEMORY_MCP_API_KEY` env var. When set, all HTTP requests require `Authorization: Bearer <key>`. When unset, no auth (local use).
- **Stateful sessions** — each client gets its own MCP session (`sessionIdGenerator: () => randomUUID()`), all sharing the same MemoryStore.
- **No new dependencies** — Express ships with the MCP SDK.

## File Structure

```
src/
  index.ts          # CLI entry point: parse args, delegate to transport
  server.ts         # NEW: createServer(store) factory — registers all 23 tools & 2 resources
  transports.ts     # NEW: startStdio(store) and startHttp(store, options) functions
  store.ts          # Unchanged
  store.test.ts     # Unchanged
```

### src/server.ts

Exports `createServer(store: MemoryStore): McpServer`. Extracts all tool and resource registration from current `index.ts`. Called once for stdio, once per session for HTTP (SDK requires one McpServer per transport connection).

### src/transports.ts

**`startStdio(store)`** — creates StdioServerTransport, connects a single McpServer. Identical to current behavior.

**`startHttp(store, { port, host, apiKey? })`** — uses `createMcpExpressApp()` from SDK. Sets up:

- `POST /mcp` — MCP request handler. Creates new `StreamableHTTPServerTransport` + `createServer(store)` on initialize requests. Reuses existing transport for subsequent requests (by `mcp-session-id` header).
- `GET /mcp` — SSE stream for server-initiated messages. Looks up transport by session ID.
- `DELETE /mcp` — session termination and cleanup.
- Bearer auth middleware (when `MEMORY_MCP_API_KEY` is set).
- SIGINT handler for graceful shutdown of all active transports.

### src/index.ts

Slim entry point:

```
parse CLI args
if --http: startHttp(store, { port, host, apiKey })
else: startStdio(store)
```

## CLI Interface

```
memory-mcp-server                          # stdio (default, backwards compatible)
memory-mcp-server --http                   # HTTP on port 3000, localhost only
memory-mcp-server --http --port 8080       # HTTP on custom port
memory-mcp-server --http --host 0.0.0.0    # HTTP, all interfaces (remote deploy)
```

Env vars: `MEMORY_MCP_API_KEY`, `MCP_PORT`, `MCP_HOST`. CLI flags take precedence.

## Out of Scope

- OAuth 2.1 (future enhancement)
- EventStore / resumability (clients reconnect)
- HTTP-level rate limiting (MemoryStore rate limiting still applies)
- HTTPS termination (reverse proxy handles this)
- CORS (all target clients are server-side)
- New dependencies

## Verification

- `npm test` — no regressions from refactor
- `npm run build` — clean compilation
- Manual stdio test — `node dist/index.js` works as before
- Manual HTTP test — `node dist/index.js --http`, curl initialize request
- Bearer token rejection when key is set but not provided
- README update with HTTP usage examples for Mistral, OpenAI, Google
