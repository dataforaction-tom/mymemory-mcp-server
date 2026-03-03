# memory-mcp-server

MCP server for portable LLM memory. Connect it to Claude Desktop, claude.ai, or any MCP-compatible client to give every conversation access to your personal memory profile.

Your facts, your machine, your control. No cloud, no account, no telemetry.

## What it does

Instead of each LLM provider maintaining its own siloed memory about you, this MCP server acts as a **single, local memory store** that any provider can read from and write to. When you tell Claude something about yourself, it gets stored locally. When you later open ChatGPT (once it supports MCP), that context is already there.

**v1.0 highlights:**

- **Duplicate detection** — token-similarity matching prevents redundant facts from accumulating
- **Full fact editing** — update content, category, tags, and confidence on any saved fact
- **Auto-context MCP resource** — clients can subscribe to `memory://profile` for automatic context injection
- **AES-256-GCM encryption at rest** — set `MEMORY_ENCRYPTION_KEY` to encrypt your store file
- **Import with conflict resolution** — round-trip import/export with skip, overwrite, or merge strategies
- **Retention and expiry** — facts can carry an `expires_at` date; stale-fact review surfaces old entries
- **Scored token search** — search results are ranked by token overlap relevance
- **Provider attribution** — track which LLM provider contributed each fact
- **Custom categories** — add, edit, or remove schema categories beyond the 12 built-in ones
- **Category visibility controls** — mark categories as hidden to exclude them from context injection
- **Change log audit trail** — every mutation is recorded in an append-only log
- **Bulk operations** — confirm all pending, delete all rejected, or clear a category in one call
- **Per-category MCP resources** — browse `memory://category/{name}` for category-specific profiles
- **Write rate limiting** — configurable throttle to prevent runaway writes

This is a companion to the [LLM Memory Extractor](https://github.com/dataforaction-tom/llm-memory-extractor) browser extension, offering an alternative capture path via MCP rather than DOM scraping.

## How it relates to the browser extension

The browser extension captures conversations **after the fact** by watching the page. This MCP server flips the model — the LLM itself stores facts **during the conversation** via tool calls. Both feed into compatible memory stores.

| | Browser Extension | MCP Server |
|---|---|---|
| **Capture method** | DOM scraping | LLM tool calls |
| **Works with** | Web UIs (Claude, ChatGPT, etc.) | Any MCP client (Claude Desktop, etc.) |
| **Extraction** | Separate LLM pass after capture | Inline during conversation |
| **Apps support** | Browser only | Desktop apps, mobile (as MCP spreads) |
| **User action needed** | Toggle capture on/off | Just connect once |

## Quick start

### 1. Build

```bash
git clone https://github.com/dataforaction-tom/memory-mcp-server
cd memory-mcp-server
npm install
npm run build
```

### 2. Connect to Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

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

To enable encryption at rest, add an environment variable:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/memory-mcp-server/dist/index.js"],
      "env": {
        "MEMORY_ENCRYPTION_KEY": "your-secret-key-here"
      }
    }
  }
}
```

### 3. Use it

Once connected, Claude has access to **23 tools** across several workflows, plus **2 MCP resources** for automatic context injection.

#### Draft workflow (recommended)

The draft workflow separates "gathering" from "saving" — facts accumulate in memory during the conversation and only get persisted when you're ready. This mirrors how the browser extension works (capture -> review -> confirm).

| Tool | What it does |
|---|---|
| `memory_create_facts` | Accumulate draft facts during conversation (not yet saved) |
| `memory_review_draft_facts` | Show all drafts gathered this session |
| `memory_edit_draft_fact` | Edit a draft before saving |
| `memory_discard_draft_facts` | Remove specific drafts or clear all |
| `memory_save_all_facts` | Commit drafts to the persistent store |

**Example flow:**
1. During conversation, Claude calls `memory_create_facts` as it learns things
2. Near the end, you say "what did you pick up about me?"
3. Claude calls `memory_review_draft_facts` and shows you the list
4. You say "remove the one about X, and save the rest"
5. Claude calls `memory_discard_draft_facts` then `memory_save_all_facts`

#### Direct storage (skip drafts)

For quick one-off saves when you don't need a review step:

| Tool | What it does |
|---|---|
| `memory_store_fact` | Save a single fact immediately |
| `memory_store_facts` | Save multiple facts immediately |

#### Query and manage

| Tool | What it does |
|---|---|
| `memory_search` | Search existing facts (scored by token relevance) |
| `memory_get_context` | Load full memory profile for context |
| `memory_update_fact` | Confirm, reject, or edit a fact (content, category, tags, confidence) |
| `memory_delete_fact` | Permanently remove a fact |
| `memory_merge_document` | Merge facts into a narrative document |
| `memory_get_document` | Retrieve a memory document |
| `memory_list_documents` | List all memory documents |
| `memory_get_schema` | View extraction categories and hints |
| `memory_update_schema` | Add, update, or remove schema categories |
| `memory_export` | Export as markdown or JSON |
| `memory_import` | Import from a JSON export (skip, overwrite, or merge conflicts) |
| `memory_bulk_update` | Bulk confirm pending, delete rejected, or clear a category |
| `memory_stats` | Dashboard statistics |

#### Maintenance and insights

| Tool | What it does |
|---|---|
| `memory_review_stale` | Surface old facts that may need re-confirmation |
| `memory_provider_stats` | Provider attribution breakdown (who contributed what) |
| `memory_changelog` | View recent mutations (audit trail) |

#### MCP Resources

| Resource URI | What it provides |
|---|---|
| `memory://profile` | Full memory profile — subscribe for auto-context injection |
| `memory://category/{name}` | Per-category profile for targeted context |

### Example prompts

- "Save the fact that I'm a consultant based in North East England"
- "What do you know about my work from memory?"
- "Export my full memory profile as markdown"
- "Search my memory for anything about TechFreedom"
- "Store these facts: I use Next.js, I prefer Tailwind, I deploy on Vercel"
- "What facts have you picked up about me in this conversation?"
- "Save everything you've gathered about me"
- "Drop the one about my location, save the rest"
- "Show me stale facts that might be outdated"
- "Which providers have contributed to my memory?"
- "Show me the change log for recent updates"
- "Bulk confirm all pending facts"
- "Import my exported memory backup"

## Storage

Everything lives in `~/.memory-mcp/store.json` — a single JSON file you can inspect, back up, sync via git, or share. No database, no native dependencies, no compilation step.

When encryption is enabled (`MEMORY_ENCRYPTION_KEY`), the store file is encrypted with AES-256-GCM. The change log is stored separately in `~/.memory-mcp/changelog.json`.

### Data model

**Facts** are atomic statements about the user:
```json
{
  "id": "uuid",
  "content": "Runs a consultancy called The Good Ship",
  "category": "work",
  "confidence": 0.9,
  "source_provider": "claude",
  "status": "confirmed",
  "tags": ["consulting", "organisation"],
  "expires_at": null
}
```

**Documents** are narrative profiles that synthesise facts into readable text — one per category, versioned, with diff-trackable history.

**Schema** defines the 12 built-in categories (plus any custom ones you add) with extraction hints that guide what the LLM looks for.

**Change log** records every mutation (add, update, delete, import, bulk operation) with timestamps and metadata.

## Categories

| Category | What it covers |
|---|---|
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

Custom categories can be added at runtime via `memory_update_schema`.

## Architecture

```
┌─────────────────────────────────┐
│  Claude Desktop / claude.ai     │
│  (or any MCP-compatible client) │
└──────────────┬──────────────────┘
               │ MCP (stdio)
┌──────────────▼──────────────────┐
│      memory-mcp-server v1.0     │
│                                 │
│  23 tools + 2 resources for     │
│  storing, searching, merging,   │
│  importing, and exporting memory│
├─────────────────────────────────┤
│  MemoryStore (JSON file-based)  │
│  AES-256-GCM encryption (opt.)  │
│  ~/.memory-mcp/store.json       │
├─────────────────────────────────┤
│  ChangeLog (append-only audit)  │
│  ~/.memory-mcp/changelog.json   │
└─────────────────────────────────┘
```

## Roadmap

- [x] MCP Resources for browsable memory profiles
- [x] Import from browser extension's IndexedDB export
- [x] Encryption at rest (AES-256-GCM)
- [x] Schema customisation via MCP tools
- [x] Conflict resolution for multi-provider writes
- [x] Duplicate detection with token similarity
- [x] Full fact editing (content, category, tags)
- [x] Auto-context resource for conversation start
- [x] Retention and expiry
- [x] Scored token search
- [x] Provider attribution
- [x] Category visibility controls
- [x] Change log audit trail
- [x] Bulk operations
- [x] Per-category MCP resources
- [x] Write rate limiting
- [ ] HTTP transport for remote/multi-client scenarios
- [ ] Shareable memory links (as in My Memory v2)
- [ ] Android companion app with share-sheet integration

## Development

```bash
npm run dev     # watch mode
npm run build   # compile TypeScript
npm start       # run the server
npm test        # run the test suite
```

## Licence

MIT
