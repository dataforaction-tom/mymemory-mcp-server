import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { MemoryStore } from "./store.js";
import { createServer } from "./server.js";

// Express req/res types (Express 5 doesn't ship .d.ts; these cover the subset we use)
type Req = IncomingMessage & { headers: Record<string, string | string[] | undefined>; body?: unknown };
type Res = ServerResponse & {
  status(code: number): Res;
  json(body: unknown): void;
  send(body: string): void;
  headersSent: boolean;
};
type NextFn = () => void;

export async function startStdio(store: MemoryStore): Promise<void> {
  const server = createServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("memory-mcp-server running on stdio");
}

export interface HttpOptions {
  port: number;
  host: string;
  apiKey?: string;
}

export async function startHttp(store: MemoryStore, options: HttpOptions): Promise<void> {
  const { port, host, apiKey } = options;

  const app = createMcpExpressApp({
    host: host === "0.0.0.0" || host === "::" ? undefined : host,
  });

  // Bearer token auth middleware
  if (apiKey) {
    app.use("/mcp", (req: Req, res: Res, next: NextFn) => {
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
  app.post("/mcp", async (req: Req, res: Res) => {
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
  app.get("/mcp", async (req: Req, res: Res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // DELETE /mcp — session termination
  app.delete("/mcp", async (req: Req, res: Res) => {
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
