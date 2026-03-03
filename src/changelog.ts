import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ChangeEntry {
  timestamp: string;
  action: string;
  fact_id?: string;
  provider?: string;
  details?: Record<string, unknown>;
}

export class ChangeLog {
  private file: string;
  private entries: ChangeEntry[];

  constructor(dataDir: string) {
    this.file = join(dataDir, "changelog.json");
    this.entries = this.load();
  }

  private load(): ChangeEntry[] {
    if (existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, "utf-8"));
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2), "utf-8");
  }

  private static MAX_ENTRIES = 10_000;

  append(entry: Omit<ChangeEntry, "timestamp">): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (this.entries.length > ChangeLog.MAX_ENTRIES) {
      this.entries = this.entries.slice(-ChangeLog.MAX_ENTRIES);
    }
    this.save();
  }

  getRecent(limit = 50): ChangeEntry[] {
    return [...this.entries].reverse().slice(0, limit);
  }
}
