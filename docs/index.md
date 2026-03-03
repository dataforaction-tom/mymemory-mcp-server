# memory-mcp-server

A local memory store for LLMs. Connect it to Claude Desktop, claude.ai, or any MCP-compatible client and give every conversation access to a shared profile of facts about you — your preferences, background, goals, and context.

Your facts live on your machine. No cloud, no account, no telemetry.

## Why it exists

Every LLM provider keeps its own siloed memory about you. memory-mcp-server replaces those silos with a single, portable store that any provider can read from and write to. Tell Claude something about yourself today, and it's available in every future conversation — across providers.

## How it works

The server exposes 23 tools and 2 browsable resources over MCP. During a conversation the LLM stores facts about you (either as reviewed drafts or directly), and retrieves them when context is needed. Facts are organised by category, searchable by keyword, and can be merged into narrative documents for richer context injection.

## Getting started

1. **Build** the project (`npm install && npm run build`)
2. **Connect** it to your MCP client (see the [User Guide](user-guide.md) for setup instructions)
3. **Talk naturally** — the LLM will store and retrieve facts as the conversation flows

## Need help?

Report issues at [github.com/dataforaction-tom/memory-mcp-server](https://github.com/dataforaction-tom/memory-mcp-server/issues).
