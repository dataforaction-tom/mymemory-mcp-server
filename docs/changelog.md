# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — 2026-03-02

### Added

- **Draft workflow** for gathering facts during a conversation and reviewing them before saving — create, review, edit, discard, or save drafts in one go
- **Direct storage** for saving one or many facts immediately without the draft step
- **Keyword search** with scored token matching — results are ranked by relevance, not just filtered
- **Full context injection** that combines narrative documents and confirmed facts into a single context block
- **Auto-context MCP resource** (`memory://profile`) so clients can subscribe and receive your memory profile automatically
- **Per-category MCP resources** (`memory://category/{name}`) for browsing memory by topic
- **Memory documents** — narrative profiles that synthesise confirmed facts into readable text, one per category, versioned
- **12 built-in categories** covering work, personal, technical, preferences, goals, health, values, social, finance, travel, education, and context
- **Custom categories** — add, update, or remove your own categories with extraction hints and examples
- **Category visibility controls** — mark categories as always visible, relevant-only, or hidden from context injection
- **Duplicate detection** using token-similarity matching to prevent redundant facts from accumulating
- **Full fact editing** — update content, category, tags, confidence, and status on any saved fact
- **AES-256-GCM encryption at rest** — set `MEMORY_MCP_PASSPHRASE` to encrypt your store file
- **Import and export** — round-trip JSON export/import with automatic duplicate skipping, plus markdown export for human-readable output
- **Retention and expiry** — facts can carry an `expires_at` date; stale-fact review surfaces entries that may need re-confirmation
- **Provider attribution** — track which LLM provider contributed each fact
- **Change log audit trail** — every mutation is recorded with timestamps and metadata
- **Bulk operations** — confirm all pending, delete all rejected, or clear an entire category in one call
- **Write rate limiting** — configurable throttle to prevent runaway writes
- **Dashboard statistics** — fact counts by status, document count, active categories

## [Unreleased]

### Added

- **HTTP transport** — run the server in HTTP mode with `--http` for use with Mistral Le Chat, OpenAI, Google Gemini Enterprise, and other remote MCP clients
- **Bearer token authentication** — set `MEMORY_MCP_API_KEY` to require a token for HTTP connections
- **CLI options** — `--http`, `--port`, and `--host` flags, plus `MCP_PORT` and `MCP_HOST` environment variables
- **Per-session server instances** in HTTP mode — each client session gets its own isolated MCP server
- **Graceful shutdown** — active HTTP sessions are closed cleanly on SIGINT
