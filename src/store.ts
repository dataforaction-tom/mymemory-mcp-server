/**
 * Memory Store — flat-file JSON storage for facts and documents.
 * 
 * Deliberately avoids native dependencies (no SQLite compilation needed).
 * Data is stored in ~/.memory-mcp/ as JSON files, making it trivially
 * portable, inspectable, and syncable via git/Syncthing/etc.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { tokenSimilarity } from "./similarity.js";

// ─── Types ───────────────────────────────────────────────────────────

export type FactStatus = "pending" | "confirmed" | "rejected";

export interface Fact {
  id: string;
  content: string;
  category: string;
  confidence: number;       // 0.0 – 1.0
  source_provider: string;  // e.g. "claude", "chatgpt", "manual"
  source_conversation?: string;
  status: FactStatus;
  created_at: string;       // ISO 8601
  updated_at: string;
  tags: string[];
  supersedes?: string;      // id of fact this replaces
}

/** Draft facts live in memory only — not persisted until explicitly saved */
export interface DraftFact {
  draft_id: string;
  content: string;
  category: string;
  confidence: number;
  source_provider: string;
  tags: string[];
  created_at: string;
}

export interface MemoryDocument {
  id: string;
  category: string;
  title: string;
  content: string;          // markdown narrative
  fact_ids: string[];       // facts woven into this doc
  version: number;
  created_at: string;
  updated_at: string;
}

export interface SchemaCategory {
  name: string;
  description: string;
  hints: string[];          // extraction hints for the LLM
  examples: string[];       // few-shot example facts
}

interface StoreData {
  facts: Fact[];
  documents: MemoryDocument[];
  schema: SchemaCategory[];
  meta: {
    version: number;
    created_at: string;
    last_modified: string;
  };
}

// ─── Default Schema ──────────────────────────────────────────────────

const DEFAULT_SCHEMA: SchemaCategory[] = [
  {
    name: "work",
    description: "Professional role, employer, projects, skills, work patterns",
    hints: ["job title", "employer", "projects", "deadlines", "colleagues", "work style"],
    examples: ["Runs a consultancy called The Good Ship", "Charges £650/day for consulting"]
  },
  {
    name: "personal",
    description: "Name, age, location, family, relationships, living situation",
    hints: ["name", "location", "family members", "pets", "housing"],
    examples: ["Lives in North East England", "Has a brother who enjoys American football"]
  },
  {
    name: "technical",
    description: "Programming languages, tools, frameworks, technical preferences",
    hints: ["languages", "frameworks", "tools", "platforms", "architecture preferences"],
    examples: ["Skilled full-stack developer", "Maintains 17+ active Vercel projects"]
  },
  {
    name: "preferences",
    description: "Likes, dislikes, communication style, aesthetic taste",
    hints: ["food", "music", "communication preferences", "tool preferences"],
    examples: ["Prefers practical solutions over perfect architecture", "Works openly by default"]
  },
  {
    name: "goals",
    description: "Current objectives, aspirations, things being worked toward",
    hints: ["projects in progress", "ambitions", "targets", "upcoming plans"],
    examples: ["Developing TechFreedom cohort programme", "Building My Memory v2 platform"]
  },
  {
    name: "health",
    description: "Health conditions, exercise, diet, wellbeing patterns",
    hints: ["conditions", "medications", "exercise habits", "diet"],
    examples: []
  },
  {
    name: "values",
    description: "Beliefs, principles, ethical positions, causes",
    hints: ["political views", "ethical stances", "causes supported", "philosophies"],
    examples: ["Embraces uncertainty", "Believes in open by default"]
  },
  {
    name: "social",
    description: "Friends, social circles, community involvement, networks",
    hints: ["friends", "communities", "networks", "social activities"],
    examples: ["Works with Doug Belshaw on TechFreedom"]
  },
  {
    name: "finance",
    description: "Financial situation, spending patterns, financial goals",
    hints: ["income", "spending", "investments", "financial goals"],
    examples: []
  },
  {
    name: "travel",
    description: "Travel history, planned trips, favourite places",
    hints: ["past trips", "planned travel", "favourite destinations"],
    examples: []
  },
  {
    name: "education",
    description: "Qualifications, learning interests, courses, reading",
    hints: ["degrees", "courses", "books", "learning goals"],
    examples: []
  },
  {
    name: "context",
    description: "Current situation, what's top of mind, temporary context",
    hints: ["current mood", "recent events", "temporary circumstances"],
    examples: ["Transitioning focus to expanding product portfolio"]
  }
];

// ─── Store Implementation ────────────────────────────────────────────

export class MemoryStore {
  private dataDir: string;
  private dataFile: string;
  private data: StoreData;

  /** In-memory draft facts — not persisted until save_all is called */
  private drafts: DraftFact[] = [];

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(homedir(), ".memory-mcp");
    this.dataFile = join(this.dataDir, "store.json");

    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    this.data = this.load();
  }

  private load(): StoreData {
    if (existsSync(this.dataFile)) {
      try {
        const raw = readFileSync(this.dataFile, "utf-8");
        return JSON.parse(raw) as StoreData;
      } catch {
        // Corrupted file — start fresh but back up old
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

  private save(): void {
    this.data.meta.last_modified = new Date().toISOString();
    writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ─── Draft Facts (in-memory only) ────────────────────────────────

  createDraft(params: {
    content: string;
    category: string;
    confidence?: number;
    source_provider?: string;
    tags?: string[];
  }): DraftFact {
    const draft: DraftFact = {
      draft_id: randomUUID(),
      content: params.content,
      category: params.category,
      confidence: params.confidence ?? 0.8,
      source_provider: params.source_provider ?? "unknown",
      tags: params.tags ?? [],
      created_at: new Date().toISOString(),
    };
    this.drafts.push(draft);
    return draft;
  }

  createDrafts(facts: Array<{
    content: string;
    category: string;
    confidence?: number;
    tags?: string[];
  }>, source_provider?: string): DraftFact[] {
    return facts.map(f => this.createDraft({
      ...f,
      source_provider,
    }));
  }

  getDrafts(): DraftFact[] {
    return [...this.drafts];
  }

  removeDraft(draft_id: string): boolean {
    const idx = this.drafts.findIndex(d => d.draft_id === draft_id);
    if (idx === -1) return false;
    this.drafts.splice(idx, 1);
    return true;
  }

  editDraft(draft_id: string, updates: {
    content?: string;
    category?: string;
    confidence?: number;
    tags?: string[];
  }): DraftFact | undefined {
    const draft = this.drafts.find(d => d.draft_id === draft_id);
    if (!draft) return undefined;
    if (updates.content !== undefined) draft.content = updates.content;
    if (updates.category !== undefined) draft.category = updates.category;
    if (updates.confidence !== undefined) draft.confidence = updates.confidence;
    if (updates.tags !== undefined) draft.tags = updates.tags;
    return draft;
  }

  clearDrafts(): number {
    const count = this.drafts.length;
    this.drafts = [];
    return count;
  }

  /**
   * Commit all drafts (or specific ones) to the persistent store.
   * Returns the saved Facts. Clears committed drafts from the buffer.
   */
  saveDrafts(params?: {
    draft_ids?: string[];
    status?: FactStatus;
    source_conversation?: string;
  }): Fact[] {
    const status = params?.status ?? "confirmed";
    let toSave: DraftFact[];

    if (params?.draft_ids && params.draft_ids.length > 0) {
      const idSet = new Set(params.draft_ids);
      toSave = this.drafts.filter(d => idSet.has(d.draft_id));
    } else {
      toSave = [...this.drafts];
    }

    const saved: Fact[] = [];
    for (const draft of toSave) {
      const { fact } = this.addFact({
        content: draft.content,
        category: draft.category,
        confidence: draft.confidence,
        source_provider: draft.source_provider,
        source_conversation: params?.source_conversation,
        status,
        tags: draft.tags,
      });
      saved.push(fact);
    }

    // Remove committed drafts from buffer
    const savedIds = new Set(toSave.map(d => d.draft_id));
    this.drafts = this.drafts.filter(d => !savedIds.has(d.draft_id));

    return saved;
  }

  // ─── Facts ───────────────────────────────────────────────────────

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

    // If superseding, mark old fact as rejected
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

  getFact(id: string): Fact | undefined {
    return this.data.facts.find(f => f.id === id);
  }

  searchFacts(params: {
    query?: string;
    category?: string;
    status?: FactStatus;
    tags?: string[];
    limit?: number;
  }): Fact[] {
    let results = this.data.facts;

    if (params.status) {
      results = results.filter(f => f.status === params.status);
    }
    if (params.category) {
      results = results.filter(f => f.category === params.category);
    }
    if (params.tags && params.tags.length > 0) {
      results = results.filter(f =>
        params.tags!.some(t => f.tags.includes(t))
      );
    }
    if (params.query) {
      const q = params.query.toLowerCase();
      results = results.filter(f =>
        f.content.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort by most recently updated
    results.sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    return results.slice(0, params.limit ?? 20);
  }

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

  updateFactStatus(id: string, status: FactStatus): Fact | undefined {
    const fact = this.data.facts.find(f => f.id === id);
    if (fact) {
      fact.status = status;
      fact.updated_at = new Date().toISOString();
      this.save();
    }
    return fact;
  }

  deleteFact(id: string): boolean {
    const idx = this.data.facts.findIndex(f => f.id === id);
    if (idx === -1) return false;
    this.data.facts.splice(idx, 1);
    this.save();
    return true;
  }

  // ─── Documents ───────────────────────────────────────────────────

  getDocument(category: string): MemoryDocument | undefined {
    return this.data.documents.find(d => d.category === category);
  }

  upsertDocument(params: {
    category: string;
    title: string;
    content: string;
    fact_ids: string[];
  }): MemoryDocument {
    const now = new Date().toISOString();
    const existing = this.data.documents.find(d => d.category === params.category);

    if (existing) {
      existing.title = params.title;
      existing.content = params.content;
      existing.fact_ids = [...new Set([...existing.fact_ids, ...params.fact_ids])];
      existing.version += 1;
      existing.updated_at = now;
      this.save();
      return existing;
    }

    const doc: MemoryDocument = {
      id: randomUUID(),
      category: params.category,
      title: params.title,
      content: params.content,
      fact_ids: params.fact_ids,
      version: 1,
      created_at: now,
      updated_at: now,
    };

    this.data.documents.push(doc);
    this.save();
    return doc;
  }

  listDocuments(): MemoryDocument[] {
    return this.data.documents;
  }

  // ─── Schema ──────────────────────────────────────────────────────

  getSchema(): SchemaCategory[] {
    return this.data.schema;
  }

  // ─── Export ──────────────────────────────────────────────────────

  exportAll(): StoreData {
    return structuredClone(this.data);
  }

  exportMarkdown(): string {
    const lines: string[] = [
      "# Memory Profile",
      "",
      `*Last updated: ${this.data.meta.last_modified}*`,
      "",
    ];

    // Documents first (narrative form)
    if (this.data.documents.length > 0) {
      for (const doc of this.data.documents) {
        lines.push(`## ${doc.title}`);
        lines.push("");
        lines.push(doc.content);
        lines.push("");
      }
    }

    // Then any confirmed facts not yet in documents
    const docFactIds = new Set(this.data.documents.flatMap(d => d.fact_ids));
    const orphanFacts = this.data.facts.filter(
      f => f.status === "confirmed" && !docFactIds.has(f.id)
    );

    if (orphanFacts.length > 0) {
      // Group by category
      const byCategory = new Map<string, Fact[]>();
      for (const f of orphanFacts) {
        const arr = byCategory.get(f.category) || [];
        arr.push(f);
        byCategory.set(f.category, arr);
      }

      lines.push("## Unmerged Facts");
      lines.push("");
      for (const [cat, facts] of byCategory) {
        lines.push(`### ${cat}`);
        lines.push("");
        for (const f of facts) {
          lines.push(`- ${f.content}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  getStats(): {
    total_facts: number;
    confirmed_facts: number;
    pending_facts: number;
    rejected_facts: number;
    documents: number;
    categories: string[];
  } {
    return {
      total_facts: this.data.facts.length,
      confirmed_facts: this.data.facts.filter(f => f.status === "confirmed").length,
      pending_facts: this.data.facts.filter(f => f.status === "pending").length,
      rejected_facts: this.data.facts.filter(f => f.status === "rejected").length,
      documents: this.data.documents.length,
      categories: [...new Set(this.data.facts.map(f => f.category))],
    };
  }

  /** Build a context string suitable for injecting into an LLM system prompt */
  buildContext(params?: {
    categories?: string[];
    max_facts?: number;
    include_documents?: boolean;
  }): string {
    const includeDocuments = params?.include_documents ?? true;
    const maxFacts = params?.max_facts ?? 100;

    const lines: string[] = [];

    // Include narrative documents
    if (includeDocuments) {
      let docs = this.data.documents;
      if (params?.categories) {
        docs = docs.filter(d => params.categories!.includes(d.category));
      }
      for (const doc of docs) {
        lines.push(`[${doc.category}] ${doc.content}`);
      }
    }

    // Include confirmed facts not covered by documents
    const docFactIds = new Set(this.data.documents.flatMap(d => d.fact_ids));
    let facts = this.data.facts.filter(
      f => f.status === "confirmed" && !docFactIds.has(f.id)
    );

    if (params?.categories) {
      facts = facts.filter(f => params.categories!.includes(f.category));
    }

    facts = facts.slice(0, maxFacts);

    if (facts.length > 0) {
      lines.push("");
      lines.push("Additional confirmed facts:");
      for (const f of facts) {
        lines.push(`- [${f.category}] ${f.content}`);
      }
    }

    return lines.join("\n");
  }
}
