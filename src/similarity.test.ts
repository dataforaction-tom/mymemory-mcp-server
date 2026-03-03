import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokenSimilarity, scoredSearch } from "./similarity.js";

describe("tokenSimilarity", () => {
  it("should return 1.0 for identical strings", () => {
    assert.equal(tokenSimilarity("likes typescript", "likes typescript"), 1.0);
  });

  it("should return 0.0 for completely different strings", () => {
    assert.equal(tokenSimilarity("likes typescript", "enjoys hiking mountains"), 0.0);
  });

  it("should be case-insensitive", () => {
    assert.equal(tokenSimilarity("Likes TypeScript", "likes typescript"), 1.0);
  });

  it("should return partial overlap score", () => {
    const score = tokenSimilarity(
      "works as a consultant",
      "works as a freelance consultant"
    );
    // Jaccard: intersection={works,as,a,consultant}=4, union={works,as,a,consultant,freelance}=5 → 0.8
    assert.ok(score >= 0.7 && score <= 0.9);
  });

  it("should handle empty strings", () => {
    assert.equal(tokenSimilarity("", "something"), 0.0);
    assert.equal(tokenSimilarity("", ""), 0.0);
  });
});

describe("scoredSearch", () => {
  const documents = [
    "Works as a consultant in organisational development",
    "Prefers TypeScript over JavaScript",
    "Lives in North East England",
    "Building a consultancy platform for clients",
  ];

  it("should rank exact keyword matches highest", () => {
    const results = scoredSearch("consultant", documents);
    assert.ok(results[0].index === 0 || results[0].index === 3);
    assert.ok(results[0].score > 0);
  });

  it("should find partial word matches", () => {
    const results = scoredSearch("TypeScript", documents);
    assert.ok(results.length > 0);
    assert.equal(results[0].index, 1);
  });

  it("should return empty for no matches", () => {
    const results = scoredSearch("quantum physics", documents);
    assert.equal(results.length, 0);
  });
});
