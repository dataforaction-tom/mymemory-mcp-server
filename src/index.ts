#!/usr/bin/env node

/**
 * memory-mcp-server
 * 
 * MCP server for portable LLM memory. Connect this to Claude Desktop,
 * claude.ai, or any MCP-compatible client to give every conversation
 * access to your personal memory profile.
 * 
 * Tools:
 *   --- Draft workflow (recommended) ---
 *   memory_create_facts       — Accumulate draft facts during conversation
 *   memory_review_draft_facts — Review what's been drafted this session
 *   memory_edit_draft_fact    — Edit a draft before saving
 *   memory_discard_draft_facts — Remove drafts without saving
 *   memory_save_all_facts     — Commit drafts to persistent store
 * 
 *   --- Direct storage ---
 *   memory_store_fact     — Save a single fact immediately (skip drafts)
 *   memory_store_facts    — Save multiple facts immediately (skip drafts)
 * 
 *   --- Query & manage ---
 *   memory_search         — Search existing facts
 *   memory_get_context    — Get full memory context for injection
 *   memory_update_fact    — Confirm, reject, or edit a fact
 *   memory_delete_fact    — Permanently delete a fact
 *   memory_merge_document — Merge confirmed facts into a narrative doc
 *   memory_get_document   — Retrieve a memory document by category
 *   memory_list_documents — List all memory documents
 *   memory_get_schema     — View the extraction schema/categories
 *   memory_update_schema  — Add, update, or remove schema categories
 *   memory_export         — Export all memory as markdown or JSON
 *   memory_import         — Import memory data from a JSON export
 *   memory_bulk_update    — Bulk confirm pending, delete rejected, clear category
 *   memory_stats          — Dashboard stats about your memory store
 *   memory_changelog      — View recent changes (audit trail)
 *
 * Storage: ~/.memory-mcp/store.json (flat JSON, no native deps)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoryStore } from "./store.js";
import type { FactStatus, DraftFact } from "./store.js";

// ─── Initialize ──────────────────────────────────────────────────────

const store = new MemoryStore();

const server = new McpServer({
  name: "memory-mcp-server",
  version: "0.1.0",
});

// ─── Tool: Store a single fact ───────────────────────────────────────

server.registerTool(
  "memory_store_fact",
  {
    title: "Store Memory Fact",
    description: `Store a new personal fact about the user. Use this whenever you learn something 
new about the user during conversation — their preferences, background, goals, 
relationships, work context, etc. Facts are stored locally in the user's memory 
profile and persist across conversations and LLM providers.

Args:
  - content (string): The fact to store, written as a clear statement
  - category (string): Category — one of: work, personal, technical, preferences, 
    goals, health, values, social, finance, travel, education, context
  - confidence (number, optional): How confident you are (0.0-1.0, default 0.8)
  - source_provider (string, optional): Which LLM provider this came from
  - tags (string[], optional): Searchable tags
  - supersedes (string, optional): ID of a fact this replaces (corrects)

Returns: The stored fact object with its assigned ID.

Examples:
  - content: "Works as a consultant specialising in organisational development"
  - content: "Prefers TypeScript over JavaScript for new projects"
  - content: "Currently developing a programme called TechFreedom"`,
    inputSchema: {
      content: z.string().min(3).describe("The fact to store as a clear statement"),
      category: z.string().min(2).describe("Category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
      confidence: z.number().min(0).max(1).optional()
        .describe("Confidence level 0.0-1.0 (default: 0.8)"),
      source_provider: z.string().optional()
        .describe("LLM provider name e.g. 'claude', 'chatgpt'"),
      source_conversation: z.string().optional()
        .describe("Conversation identifier if available"),
      tags: z.array(z.string()).optional()
        .describe("Searchable tags"),
      supersedes: z.string().optional()
        .describe("ID of fact this replaces/corrects"),
      expires_at: z.string().optional()
        .describe("ISO 8601 expiry date — fact is hidden after this date"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    const { fact, duplicates } = store.addFact({
      content: params.content,
      category: params.category,
      confidence: params.confidence,
      source_provider: params.source_provider,
      source_conversation: params.source_conversation,
      tags: params.tags,
      supersedes: params.supersedes,
      expires_at: params.expires_at,
    });

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
  }
);

// ─── Tool: Store multiple facts at once ──────────────────────────────

server.registerTool(
  "memory_store_facts",
  {
    title: "Store Multiple Memory Facts",
    description: `Store multiple personal facts at once. Use this after a rich conversation 
where you've learned several things about the user, rather than calling 
memory_store_fact repeatedly.

Args:
  - facts (array): Array of fact objects, each with content, category, and 
    optional confidence/tags/source_provider
  - source_provider (string, optional): Default provider for all facts

Returns: Summary of stored facts with their IDs.`,
    inputSchema: {
      facts: z.array(z.object({
        content: z.string().min(3),
        category: z.string().min(2).describe("Category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        expires_at: z.string().optional()
          .describe("ISO 8601 expiry date — fact is hidden after this date"),
      })).min(1).describe("Array of facts to store"),
      source_provider: z.string().optional()
        .describe("Default LLM provider name for all facts"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    const results = params.facts.map(f =>
      store.addFact({
        content: f.content,
        category: f.category,
        confidence: f.confidence,
        source_provider: params.source_provider,
        tags: f.tags,
        expires_at: f.expires_at,
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
  }
);

// ─── Tool: Search facts ──────────────────────────────────────────────

server.registerTool(
  "memory_create_facts",
  {
    title: "Create Draft Facts",
    description: `Accumulate draft facts during a conversation WITHOUT saving them to 
the persistent store yet. Use this throughout a conversation whenever you 
learn something new about the user. Drafts are held in memory and only 
committed when the user calls memory_save_all_facts.

This is the recommended flow:
  1. Call memory_create_facts throughout the conversation as you learn things
  2. Call memory_review_draft_facts to show the user what you've gathered
  3. Call memory_save_all_facts to commit them (or memory_discard_draft_facts to drop them)

Args:
  - facts (array): Array of facts with content, category, optional confidence/tags
  - source_provider (string, optional): Which LLM provider this came from

Returns: The draft facts with temporary IDs. These are NOT yet persisted.`,
    inputSchema: {
      facts: z.array(z.object({
        content: z.string().min(3),
        category: z.string().min(2).describe("Category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
      })).min(1).describe("Array of draft facts to create"),
      source_provider: z.string().optional()
        .describe("LLM provider name e.g. 'claude', 'chatgpt'"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    const drafts = store.createDrafts(
      params.facts,
      params.source_provider,
    );

    const allDrafts = store.getDrafts();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          created: drafts.length,
          total_drafts: allDrafts.length,
          drafts: drafts.map(d => ({
            draft_id: d.draft_id,
            content: d.content,
            category: d.category,
            confidence: d.confidence,
          })),
          hint: "These are draft facts held in memory. Call memory_save_all_facts to commit them, or memory_review_draft_facts to review first.",
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Review draft facts ────────────────────────────────────────

server.registerTool(
  "memory_review_draft_facts",
  {
    title: "Review Draft Facts",
    description: `Show all draft facts accumulated during this conversation that haven't been 
saved yet. Use this to let the user review what you've gathered before 
committing to the persistent store.

Returns: All current draft facts, grouped by category.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const drafts = store.getDrafts();

    if (drafts.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: "No draft facts in the current session. Use memory_create_facts to start collecting facts during the conversation.",
        }],
      };
    }

    // Group by category for readability
    const byCategory = new Map<string, typeof drafts>();
    for (const d of drafts) {
      const arr = byCategory.get(d.category) || [];
      arr.push(d);
      byCategory.set(d.category, arr);
    }

    const grouped: Record<string, Array<{ draft_id: string; content: string; confidence: number; tags: string[] }>> = {};
    for (const [cat, facts] of byCategory) {
      grouped[cat] = facts.map(f => ({
        draft_id: f.draft_id,
        content: f.content,
        confidence: f.confidence,
        tags: f.tags,
      }));
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          total_drafts: drafts.length,
          by_category: grouped,
          hint: "Call memory_save_all_facts to commit all, or memory_discard_draft_facts to remove specific ones.",
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Edit a draft fact ─────────────────────────────────────────

server.registerTool(
  "memory_edit_draft_fact",
  {
    title: "Edit Draft Fact",
    description: `Edit a draft fact before saving. Use this when the user wants to correct 
or refine a fact you've drafted.

Args:
  - draft_id (string): The draft fact ID to edit
  - content (string, optional): Updated content
  - category (string, optional): Updated category
  - confidence (number, optional): Updated confidence
  - tags (string[], optional): Updated tags

Returns: The updated draft fact.`,
    inputSchema: {
      draft_id: z.string().describe("Draft fact ID to edit"),
      content: z.string().min(3).optional().describe("Updated fact content"),
      category: z.string().min(2).optional().describe("Updated category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
      confidence: z.number().min(0).max(1).optional().describe("Updated confidence"),
      tags: z.array(z.string()).optional().describe("Updated tags"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const updated = store.editDraft(params.draft_id, {
      content: params.content,
      category: params.category,
      confidence: params.confidence,
      tags: params.tags,
    });

    if (!updated) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: No draft fact found with ID "${params.draft_id}". Use memory_review_draft_facts to see current drafts.`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          updated: true,
          draft: {
            draft_id: updated.draft_id,
            content: updated.content,
            category: updated.category,
            confidence: updated.confidence,
            tags: updated.tags,
          },
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Discard draft facts ───────────────────────────────────────

server.registerTool(
  "memory_discard_draft_facts",
  {
    title: "Discard Draft Facts",
    description: `Remove draft facts without saving them. Pass specific IDs to remove 
individual drafts, or call with no IDs to clear all drafts.

Args:
  - draft_ids (string[], optional): Specific draft IDs to remove. If empty/omitted, clears ALL drafts.

Returns: Confirmation of how many drafts were discarded.`,
    inputSchema: {
      draft_ids: z.array(z.string()).optional()
        .describe("Specific draft IDs to discard, or omit to clear all"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    if (params.draft_ids && params.draft_ids.length > 0) {
      let removed = 0;
      for (const id of params.draft_ids) {
        if (store.removeDraft(id)) removed++;
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            discarded: removed,
            remaining_drafts: store.getDrafts().length,
          }, null, 2),
        }],
      };
    }

    const cleared = store.clearDrafts();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          discarded: cleared,
          remaining_drafts: 0,
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Save all draft facts ──────────────────────────────────────

server.registerTool(
  "memory_save_all_facts",
  {
    title: "Save All Draft Facts",
    description: `Commit draft facts to the persistent memory store. This is the final step 
in the draft workflow — it takes the facts gathered during the conversation 
and saves them permanently.

You can save all drafts at once, or pass specific IDs to save selectively.

Args:
  - draft_ids (string[], optional): Specific drafts to save. If omitted, saves ALL drafts.
  - status (string, optional): Status to assign — "confirmed" (default) or "pending" for later review
  - source_conversation (string, optional): Conversation identifier

Returns: The saved facts with their permanent IDs.`,
    inputSchema: {
      draft_ids: z.array(z.string()).optional()
        .describe("Specific draft IDs to save, or omit to save all"),
      status: z.enum(["confirmed", "pending"]).optional()
        .describe("Status for saved facts (default: confirmed)"),
      source_conversation: z.string().optional()
        .describe("Conversation identifier"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    const drafts = store.getDrafts();

    if (drafts.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: "No draft facts to save. Use memory_create_facts during the conversation first.",
        }],
      };
    }

    const saved = store.saveDrafts({
      draft_ids: params.draft_ids,
      status: params.status as FactStatus | undefined,
      source_conversation: params.source_conversation,
    });

    const remaining = store.getDrafts();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          saved: saved.length,
          remaining_drafts: remaining.length,
          facts: saved.map(f => ({
            id: f.id,
            content: f.content,
            category: f.category,
            status: f.status,
          })),
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Search facts ──────────────────────────────────────────────

server.registerTool(
  "memory_search",
  {
    title: "Search Memory",
    description: `Search the user's memory profile for facts matching a query. Use this to 
check what you already know about the user before asking them to repeat 
themselves, or to find relevant context for the current conversation.

Args:
  - query (string, optional): Text to search for in fact content and tags
  - category (string, optional): Filter by category
  - status (string, optional): Filter by status (confirmed/pending/rejected)
  - tags (string[], optional): Filter by tags
  - limit (number, optional): Max results (default: 20)

Returns: Array of matching facts sorted by most recently updated.`,
    inputSchema: {
      query: z.string().optional().describe("Search text"),
      category: z.string().min(2).optional().describe("Filter by category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
      status: z.enum(["confirmed", "pending", "rejected"]).optional()
        .describe("Filter by fact status"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      limit: z.number().int().min(1).max(100).optional()
        .describe("Max results (default: 20)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const results = store.searchFacts({
      query: params.query,
      category: params.category,
      status: params.status as FactStatus | undefined,
      tags: params.tags,
      limit: params.limit ?? 20,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          count: results.length,
          facts: results.map(f => ({
            id: f.id,
            content: f.content,
            category: f.category,
            confidence: f.confidence,
            status: f.status,
            tags: f.tags,
            updated_at: f.updated_at,
          })),
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Get context for injection ─────────────────────────────────

server.registerTool(
  "memory_get_context",
  {
    title: "Get Memory Context",
    description: `Retrieve the user's memory profile formatted for context injection. Returns 
a text block combining narrative memory documents and confirmed facts, 
suitable for including in a system prompt or conversation context.

This is the primary tool for making conversations context-aware. Call it 
at the start of a conversation to load what you know about the user.

Args:
  - categories (string[], optional): Only include specific categories
  - max_facts (number, optional): Limit number of individual facts (default: 100)
  - include_documents (boolean, optional): Include narrative docs (default: true)

Returns: Formatted text block of the user's memory profile.`,
    inputSchema: {
      categories: z.array(z.string().min(2)).optional().describe("Filter to specific categories (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
      max_facts: z.number().int().min(1).max(500).optional()
        .describe("Max individual facts to include (default: 100)"),
      include_documents: z.boolean().optional()
        .describe("Include narrative documents (default: true)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const context = store.buildContext({
      categories: params.categories,
      max_facts: params.max_facts,
      include_documents: params.include_documents,
    });

    return {
      content: [{
        type: "text" as const,
        text: context || "(No memory context available yet. Start storing facts to build the user's profile.)",
      }],
    };
  }
);

// ─── Tool: Update fact ───────────────────────────────────────────────

server.registerTool(
  "memory_update_fact",
  {
    title: "Update Memory Fact",
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
    inputSchema: {
      id: z.string().describe("Fact ID to update"),
      content: z.string().min(3).optional().describe("Updated fact content"),
      category: z.string().min(2).optional().describe("Updated category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
      confidence: z.number().min(0).max(1).optional().describe("Updated confidence"),
      status: z.enum(["confirmed", "pending", "rejected"]).optional()
        .describe("Updated status"),
      tags: z.array(z.string()).optional().describe("Updated tags"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
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
);

// ─── Tool: Delete fact ───────────────────────────────────────────────

server.registerTool(
  "memory_delete_fact",
  {
    title: "Delete Memory Fact",
    description: `Permanently delete a fact from the memory store. Use this when the user 
explicitly asks to remove something from their memory, or to clean up 
duplicate/erroneous entries.

Args:
  - id (string): The fact ID to delete

Returns: Confirmation of deletion.`,
    inputSchema: {
      id: z.string().describe("Fact ID to permanently delete"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const deleted = store.deleteFact(params.id);

    if (!deleted) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: No fact found with ID "${params.id}".`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ deleted: true, id: params.id }, null, 2),
      }],
    };
  }
);

// ─── Tool: Merge facts into document ─────────────────────────────────

server.registerTool(
  "memory_merge_document",
  {
    title: "Merge Facts into Memory Document",
    description: `Merge confirmed facts into a narrative memory document for a category. 
Memory documents are coherent markdown narratives (not bullet lists) that 
weave together everything known about a topic. Each category has one 
document that gets updated as new facts are confirmed.

You should write the document content yourself by synthesising the 
confirmed facts for this category into a readable narrative.

Args:
  - category (string): The document category
  - title (string): Document title
  - content (string): The narrative markdown content
  - fact_ids (string[]): IDs of facts incorporated into this document

Returns: The created/updated document.`,
    inputSchema: {
      category: z.string().min(2).describe("Document category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
      title: z.string().describe("Document title"),
      content: z.string().min(10).describe("Narrative markdown content"),
      fact_ids: z.array(z.string()).describe("IDs of facts woven into this document"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    const doc = store.upsertDocument({
      category: params.category,
      title: params.title,
      content: params.content,
      fact_ids: params.fact_ids,
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          merged: true,
          document: {
            id: doc.id,
            category: doc.category,
            title: doc.title,
            version: doc.version,
            fact_count: doc.fact_ids.length,
            updated_at: doc.updated_at,
          },
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Get document ──────────────────────────────────────────────

server.registerTool(
  "memory_get_document",
  {
    title: "Get Memory Document",
    description: `Retrieve a memory document by category. Memory documents are narrative 
profiles that synthesise confirmed facts into readable text.

Args:
  - category (string): The category to retrieve

Returns: The document content, or a message if no document exists yet.`,
    inputSchema: {
      category: z.string().min(2).describe("Document category to retrieve (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    const doc = store.getDocument(params.category);

    if (!doc) {
      return {
        content: [{
          type: "text" as const,
          text: `No document exists yet for category "${params.category}". Use memory_merge_document to create one from confirmed facts.`,
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          document: {
            id: doc.id,
            category: doc.category,
            title: doc.title,
            content: doc.content,
            version: doc.version,
            fact_count: doc.fact_ids.length,
            updated_at: doc.updated_at,
          },
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: List documents ────────────────────────────────────────────

server.registerTool(
  "memory_list_documents",
  {
    title: "List Memory Documents",
    description: `List all memory documents. Returns a summary of each document without 
full content. Use memory_get_document to retrieve specific ones.

Returns: Array of document summaries.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const docs = store.listDocuments();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          count: docs.length,
          documents: docs.map(d => ({
            id: d.id,
            category: d.category,
            title: d.title,
            version: d.version,
            fact_count: d.fact_ids.length,
            updated_at: d.updated_at,
          })),
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Get schema ────────────────────────────────────────────────

server.registerTool(
  "memory_get_schema",
  {
    title: "Get Memory Schema",
    description: `View the extraction schema — the categories, hints, and examples that 
guide what facts to extract from conversations.

Returns: Array of schema categories with their extraction hints and examples.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const schema = store.getSchema();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ categories: schema }, null, 2),
      }],
    };
  }
);

// ─── Tool: Update schema ─────────────────────────────────────────────

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
      visibility: z.enum(["always", "relevant", "hidden"]).optional()
        .describe("Category visibility in auto-context: always (default), relevant, or hidden"),
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
        visibility: params.visibility,
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

// ─── Tool: Export ────────────────────────────────────────────────────

server.registerTool(
  "memory_export",
  {
    title: "Export Memory",
    description: `Export the entire memory profile. Supports markdown (human-readable 
narrative) or JSON (complete data with all metadata).

Args:
  - format (string): "markdown" for readable export, "json" for complete data

Returns: The exported memory profile.`,
    inputSchema: {
      format: z.enum(["markdown", "json"])
        .describe("Export format: 'markdown' or 'json'"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    if (params.format === "markdown") {
      return {
        content: [{
          type: "text" as const,
          text: store.exportMarkdown(),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(store.exportAll(), null, 2),
      }],
    };
  }
);

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

// ─── Tool: Review stale facts ────────────────────────────────────────

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
      category: z.string().min(2).optional().describe("Filter to category (built-in: work, personal, technical, preferences, goals, health, values, social, finance, travel, education, context)"),
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

// ─── Tool: Provider Attribution Stats ─────────────────────────────────

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

// ─── Tool: Change Log ────────────────────────────────────────────────

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

// ─── Tool: Bulk Operations ────────────────────────────────────────

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
      default: {
        const _exhaustive: never = params.action;
        throw new Error(`Unknown action: ${_exhaustive}`);
      }
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

// ─── Tool: Stats ─────────────────────────────────────────────────────

server.registerTool(
  "memory_stats",
  {
    title: "Memory Stats",
    description: `Get summary statistics about the memory store — fact counts by status, 
number of documents, active categories, etc.

Returns: Stats object.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const stats = store.getStats();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(stats, null, 2),
      }],
    };
  }
);

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

// ─── Start ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("memory-mcp-server running on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
