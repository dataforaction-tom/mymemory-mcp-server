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
