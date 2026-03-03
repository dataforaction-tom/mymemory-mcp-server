/**
 * Jaccard similarity on normalized word tokens.
 * Returns 0.0–1.0. No external dependencies.
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\s+/).filter(Boolean));

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/**
 * Score documents against a query using token overlap with IDF-like weighting.
 * Returns matching documents sorted by relevance score (descending).
 */
export function scoredSearch(
  query: string,
  documents: string[],
  minScore = 0.01,
): Array<{ index: number; score: number }> {
  const tokenize = (s: string): string[] =>
    s.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Simple IDF: tokens appearing in fewer documents get higher weight
  const docCount = documents.length || 1;
  const tokenDocFreq = new Map<string, number>();
  for (const doc of documents) {
    const unique = new Set(tokenize(doc));
    for (const t of unique) {
      tokenDocFreq.set(t, (tokenDocFreq.get(t) ?? 0) + 1);
    }
  }

  const results: Array<{ index: number; score: number }> = [];

  for (let i = 0; i < documents.length; i++) {
    const docTokens = tokenize(documents[i]);
    const docTokenSet = new Set(docTokens);
    let score = 0;

    for (const qt of queryTokens) {
      // Check for exact token match or substring match within tokens
      for (const dt of docTokenSet) {
        if (dt === qt) {
          const idf = Math.log(docCount / (tokenDocFreq.get(dt) ?? 1));
          score += 1.0 + idf;
        } else if (dt.includes(qt) || qt.includes(dt)) {
          const idf = Math.log(docCount / (tokenDocFreq.get(dt) ?? 1));
          score += 0.5 + idf * 0.5;
        }
      }
    }

    if (score >= minScore) {
      results.push({ index: i, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
