import { describe, expect, it } from "vitest";
import {
  assertRubricValid, concernLabel, evidenceAppearsInCv, mainConcern, ModelOutputError, RubricError,
  scoreRole, strengthLabel, sumWeights, topStrength, weightedScore,
} from "@/lib/scoring";
import { loadRubric } from "./helpers";

const rubric = loadRubric();
const CV = `Sole PM responsible for shipment tracking, exception management, and carrier integration modules — no PM
manager above, decisions owned end-to-end
Shipped 7 features in 14 months; killed 3 after post-launch data showed <8% adoption`;

const all = (role: "pm" | "spm", score: number, evidence = "Shipped 7 features in 14 months") =>
  rubric.filter((c) => c.role === role).map((c) => ({ criterion: c.key, score, evidence, reason: "r" }));

describe("12. weight calculation", () => {
  it("PM weights total exactly 100%", () => {
    expect(sumWeights(rubric.filter((c) => c.role === "pm"))).toBe(100);
    expect(() => assertRubricValid("pm", rubric)).not.toThrow();
  });

  it("SPM weights total exactly 100%", () => {
    expect(sumWeights(rubric.filter((c) => c.role === "spm"))).toBe(100);
    expect(() => assertRubricValid("spm", rubric)).not.toThrow();
  });

  it("uses the exact v1 criteria and weights", () => {
    const pm = rubric.filter((c) => c.role === "pm").map((c) => [c.criterion_name, c.weight]);
    expect(pm).toEqual([
      ["End-to-End Product Ownership", 25], ["Customer & Problem Discovery", 20], ["Shipping & Outcome Orientation", 20],
      ["Operating Without Structure", 20], ["Technical & Systems Fluency", 15],
    ]);
    const spm = rubric.filter((c) => c.role === "spm").map((c) => [c.criterion_name, c.weight]);
    expect(spm).toEqual([
      ["Platform / Integration Ownership", 25], ["Independent Product Decision-Making", 25],
      ["Cross-Functional Influence & Alignment", 20], ["Reliability, Data & Systems Thinking", 15],
      ["Building Product Operating Systems", 15],
    ]);
  });

  it("refuses to score when weights don't total 100", () => {
    const broken = rubric.map((c) => (c.key === "pm_ownership" ? { ...c, weight: 30 } : c));
    expect(() => assertRubricValid("pm", broken)).toThrow(RubricError);
    expect(() => scoreRole("pm", broken, all("pm", 3), CV)).toThrow(/105%/);
  });

  it("weighted_score = (score / 5) * weight", () => {
    expect(weightedScore(4, 25)).toBe(20);
    expect(weightedScore(3, 20)).toBe(12);
    expect(weightedScore(5, 15)).toBe(15);
    expect(weightedScore(0, 25)).toBe(0);
    expect(weightedScore(1, 15)).toBe(3);
  });

  it("overall = sum of weighted scores; a perfect CV scores 100 and an empty one 0", () => {
    expect(scoreRole("pm", rubric, all("pm", 5), CV).overall).toBe(100);
    expect(scoreRole("pm", rubric, all("pm", 0, ""), CV).overall).toBe(0);
    const mixed = scoreRole("pm", rubric, [
      { criterion: "pm_ownership", score: 4, evidence: "Sole PM responsible for shipment tracking", reason: "" },
      { criterion: "pm_discovery", score: 3, evidence: "Shipped 7 features in 14 months", reason: "" },
      { criterion: "pm_shipping", score: 5, evidence: "killed 3 after post-launch data", reason: "" },
      { criterion: "pm_ambiguity", score: 2, evidence: "no PM manager above", reason: "" },
      { criterion: "pm_technical", score: 1, evidence: "carrier integration modules", reason: "" },
    ], CV);
    // 20 + 12 + 20 + 8 + 3
    expect(mixed.overall).toBe(63);
    expect(mixed.criteria.map((c) => c.weighted_score)).toEqual([20, 12, 20, 8, 3]);
  });

  it("is deterministic: identical inputs give byte-identical output", () => {
    const input = all("spm", 3, "Sole PM responsible for shipment tracking");
    const a = JSON.stringify(scoreRole("spm", rubric, input, CV));
    for (let i = 0; i < 20; i++) expect(JSON.stringify(scoreRole("spm", rubric, input, CV))).toBe(a);
  });

  it("ignores any total the model returns — the backend recomputes", () => {
    const withTotal = all("pm", 2).map((c) => ({ ...c, weighted_score: 99, overall: 100 }));
    expect(scoreRole("pm", rubric, withTotal, CV).overall).toBe(40);
  });
});

describe("model output validation", () => {
  it("rejects scores outside 0–5 or non-integers", () => {
    expect(() => scoreRole("pm", rubric, all("pm", 6), CV)).toThrow(ModelOutputError);
    expect(() => scoreRole("pm", rubric, all("pm", 2.5), CV)).toThrow(ModelOutputError);
  });

  it("rejects a missing, unknown or duplicated criterion", () => {
    expect(() => scoreRole("pm", rubric, all("pm", 3).slice(1), CV)).toThrow(/did not score/);
    expect(() => scoreRole("pm", rubric, [...all("pm", 3), { criterion: "charisma", score: 5, evidence: "x", reason: "" }], CV)).toThrow(/unknown criterion/);
    const dup = all("pm", 3);
    dup[1] = { ...dup[0] };
    expect(() => scoreRole("pm", rubric, dup, CV)).toThrow(/twice/);
  });

  it("forces a score to 0 when no evidence is quoted", () => {
    const out = scoreRole("pm", rubric, all("pm", 4, ""), CV);
    expect(out.criteria.every((c) => c.score === 0 && c.weighted_score === 0)).toBe(true);
    expect(out.criteria[0].reason).toMatch(/no evidence/i);
  });

  it("flags evidence that isn't a real quote from the CV", () => {
    expect(evidenceAppearsInCv("Shipped 7 features in 14 months", CV)).toBe(true);
    expect(evidenceAppearsInCv("carrier integration modules — no PM manager above", CV)).toBe(true); // spans a line break
    expect(evidenceAppearsInCv("Led a team of 40 engineers at Google", CV)).toBe(false);
    const out = scoreRole("pm", rubric, all("pm", 4, "Led a team of 40 engineers at Google"), CV);
    expect(out.criteria[0].evidence_verified).toBe(false);
  });

  it("derives strength and concern labels from weighted contribution", () => {
    const s = scoreRole("pm", rubric, [
      { criterion: "pm_ownership", score: 5, evidence: "Sole PM responsible", reason: "" },
      { criterion: "pm_discovery", score: 0, evidence: "", reason: "" },
      { criterion: "pm_shipping", score: 4, evidence: "Shipped 7 features", reason: "" },
      { criterion: "pm_ambiguity", score: 3, evidence: "no PM", reason: "" },
      { criterion: "pm_technical", score: 3, evidence: "carrier integration", reason: "" },
    ], CV);
    expect(strengthLabel(topStrength(s.criteria))).toBe("Exceptional ownership");
    expect(concernLabel(mainConcern(s.criteria))).toBe("No discovery evidence");
  });
});
