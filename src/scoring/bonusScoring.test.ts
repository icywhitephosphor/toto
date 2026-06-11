import { describe, it, expect } from "vitest";
import { normalizePlayerName, scoreTopScorer } from "./bonusScoring";

describe("normalizePlayerName", () => {
  it("folds case, trims, and collapses internal whitespace", () => {
    expect(normalizePlayerName("  Килиан   Мбаппе ")).toBe("килиан мбаппе");
  });

  it("strips Latin diacritics (Mbappé == Mbappe)", () => {
    expect(normalizePlayerName("Mbappé")).toBe(normalizePlayerName("Mbappe"));
  });

  it("treats Russian ё and е as equal", () => {
    expect(normalizePlayerName("Дембелё")).toBe(normalizePlayerName("Дембеле"));
  });

  it("does NOT corrupt Cyrillic й into и", () => {
    expect(normalizePlayerName("Андрей")).toBe("андрей");
    expect(normalizePlayerName("Андрей")).not.toBe(normalizePlayerName("Андреи"));
  });

  it("keeps genuinely different names distinct", () => {
    expect(normalizePlayerName("Харри Кейн")).not.toBe(normalizePlayerName("Килиан Мбаппе"));
  });
});

describe("scoreTopScorer", () => {
  it("awards points for a cosmetically-different but equal name", () => {
    expect(scoreTopScorer(" килиан  мбаппе ", "Килиан Мбаппе", 7)).toBe(7);
    expect(scoreTopScorer("Mbappé", "Mbappe", 7)).toBe(7);
  });

  it("returns 0 for a wrong player and for an unsettled category", () => {
    expect(scoreTopScorer("Харри Кейн", "Килиан Мбаппе", 7)).toBe(0);
    expect(scoreTopScorer("Килиан Мбаппе", null, 7)).toBe(0);
  });
});
