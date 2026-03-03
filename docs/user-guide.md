# User Guide

This guide covers everything you need to know about setting up and using memory-mcp-server.

---

## Installation

```bash
git clone https://github.com/dataforaction-tom/memory-mcp-server
cd memory-mcp-server
npm install
npm run build
```

Requires Node.js 18 or later.

---

## Connecting to an MCP client

### Claude Desktop (stdio)

Add the server to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/memory-mcp-server/dist/index.js"]
    }
  }
}
```

### Remote clients over HTTP

For platforms that connect to MCP servers over the network — such as Mistral Le Chat, OpenAI, and Google Gemini Enterprise — run the server in HTTP mode:

```bash
# Local development (localhost only, port 3000)
memory-mcp-server --http

# Custom port
memory-mcp-server --http --port 8080

# Bind to all interfaces with authentication
MEMORY_MCP_API_KEY=your-secret-key memory-mcp-server --http --host 0.0.0.0
```

Then point your platform at `https://your-server.example.com/mcp` (see [Platform-specific setup](#platform-specific-setup) below).

#### CLI options

| Flag | Description | Default |
|------|-------------|---------|
| `--http` | Start in HTTP mode instead of stdio | _(off — stdio)_ |
| `--port <number>` | Port to listen on | `3000` |
| `--host <address>` | Bind address | `127.0.0.1` |

#### Environment variables

| Variable | Description |
|----------|-------------|
| `MEMORY_MCP_API_KEY` | Bearer token for HTTP authentication. Required for any deployment exposed to the network. |
| `MCP_PORT` | HTTP port (overridden by `--port`) |
| `MCP_HOST` | Bind address (overridden by `--host`) |

#### Platform-specific setup

**Mistral Le Chat:** Add a Custom Connector. Set the URL to your server's `/mcp` endpoint and choose "HTTP Bearer Token" as the authentication method.

**OpenAI:** Configure a remote MCP server with the `/mcp` URL and your bearer token.

**Google Gemini Enterprise:** Add a custom MCP server using the Streamable HTTP URL.

> For remote deployments, place a reverse proxy (Caddy, nginx, or Cloudflare Tunnel) in front of the server to handle HTTPS. The server itself speaks plain HTTP.

---

## Storing facts

There are two ways to save facts about yourself: the **draft workflow** (recommended) and **direct storage**.

### Draft workflow

The draft workflow lets you accumulate facts during a conversation and review them before saving. This is the recommended approach.

1. **During the conversation**, the LLM calls `memory_create_facts` whenever it learns something new about you. These are held in memory as drafts — nothing is saved to disk yet.
2. **When you're ready**, ask something like _"What did you pick up about me?"_ The LLM calls `memory_review_draft_facts` to show you a summary.
3. **Edit if needed.** Ask to correct or remove individual drafts.
4. **Save.** Say _"Save everything you've gathered"_ and the drafts are committed to your permanent store.

### Direct storage

If you don't need a review step, you can save facts immediately:

- _"Save the fact that I'm a consultant based in North East England"_ — stores one fact
- _"Store these facts: I use Next.js, I prefer Tailwind, I deploy on Vercel"_ — stores several at once

### Duplicate detection

When a new fact is stored, the server checks for similar existing facts using token-overlap matching. If a near-duplicate is found, it's still saved but you'll see a warning with the similar entries so you can clean up if needed.

---

## Searching and retrieving memory

### Keyword search

Ask the LLM to search your memory:

- _"Search my memory for anything about TechFreedom"_
- _"What do you know about my work?"_

Results are ranked by token relevance, so the most closely matching facts appear first. You can filter by category, status, or tags.

### Full context injection

At the start of a conversation, the LLM can load your entire memory profile in one call. This pulls together narrative documents and confirmed facts into a single block of context. You can also subscribe to the `memory://profile` resource for automatic injection.

### Per-category resources

Browse `memory://category/{name}` (e.g. `memory://category/work`) to get context for a single category.

---

## Managing facts

### Editing

You can update any saved fact — change its wording, move it to a different category, adjust confidence, add tags, or change its status (confirmed, pending, rejected):

- _"Update that fact to say I'm now a senior consultant"_
- _"Reject the fact about my location — it's outdated"_

### Deleting

Remove facts permanently when they're no longer relevant:

- _"Delete the fact about my old phone number"_

### Bulk operations

For housekeeping at scale:

- **Confirm all pending** — approve everything in one go
- **Delete all rejected** — clear out facts you've marked as incorrect
- **Clear a category** — wipe all facts in a specific category

---

## Memory documents

Facts are atomic statements. Memory documents are longer, narrative profiles that weave those facts together into readable text — one document per category, versioned, with a history of changes.

Ask the LLM to _"Merge my work facts into a document"_ and it will synthesise your confirmed facts into a coherent summary. Next time context is loaded, the document provides richer background than raw facts alone.

You can list all documents, retrieve a specific one by category, or ask the LLM to update an existing document with newly confirmed facts.

---

## Categories

Facts are organised into categories. Twelve are built in:

| Category | What it covers |
|----------|---------------|
| work | Role, employer, projects, skills, work patterns |
| personal | Name, location, family, relationships |
| technical | Languages, tools, frameworks, architecture preferences |
| preferences | Likes, dislikes, communication style |
| goals | Current objectives, aspirations |
| health | Conditions, exercise, diet, wellbeing |
| values | Beliefs, principles, causes |
| social | Friends, communities, networks |
| finance | Financial situation, spending, goals |
| travel | Travel history, planned trips |
| education | Qualifications, learning interests |
| context | Current situation, what's top of mind |

### Custom categories

You can add your own categories at any time. Each category has a name, description, extraction hints (to guide the LLM), and example facts. You can also update or remove categories you've added.

### Visibility controls

Categories can be set to one of three visibility levels:

- **always** — included in automatic context injection (default)
- **relevant** — included only when explicitly requested
- **hidden** — excluded from context injection entirely, but still searchable

This lets you control what the LLM sees by default without deleting data.

---

## Encryption

To encrypt your memory store at rest, set the `MEMORY_MCP_PASSPHRASE` environment variable. The server uses AES-256-GCM encryption.

In Claude Desktop config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/memory-mcp-server/dist/index.js"],
      "env": {
        "MEMORY_MCP_PASSPHRASE": "your-secret-key-here"
      }
    }
  }
}
```

When encryption is enabled, the store file is encrypted on every write and decrypted on load. The change log is stored separately and is not encrypted.

---

## Import and export

### Exporting

Export your entire memory profile in two formats:

- **Markdown** — a human-readable narrative, useful for sharing or archiving
- **JSON** — the complete data with all metadata, suitable for backup or migration

### Importing

Import from a JSON export to restore a backup, merge data from another machine, or migrate from a different system. Duplicate facts (by ID or content similarity) are automatically skipped. Documents are merged — newer versions replace older ones.

---

## Maintenance tools

### Stale fact review

Facts that haven't been updated in a while may be outdated. The stale-fact review surfaces entries older than a threshold (default: 90 days) so you can confirm, update, or reject them.

### Provider attribution

See which LLM providers have contributed facts to your memory, how many each has added, and which categories they cover.

### Change log

Every mutation — additions, updates, deletions, imports, bulk operations — is recorded in an append-only audit log. Review it any time to understand what changed and when.

### Statistics

Get a dashboard view of your memory store: total facts by status, number of documents, active categories, and more.

---

## Storage

Everything lives in `~/.memory-mcp/store.json` — a single JSON file you can inspect, back up, or sync via git. No database, no native dependencies.

The change log is stored in `~/.memory-mcp/changelog.json`.

---

## Example prompts

- _"Save the fact that I'm a consultant based in North East England"_
- _"What do you know about my work from memory?"_
- _"Export my full memory profile as markdown"_
- _"Search my memory for anything about TechFreedom"_
- _"Store these facts: I use Next.js, I prefer Tailwind, I deploy on Vercel"_
- _"What facts have you picked up about me in this conversation?"_
- _"Save everything you've gathered about me"_
- _"Show me stale facts that might be outdated"_
- _"Which providers have contributed to my memory?"_
- _"Bulk confirm all pending facts"_
