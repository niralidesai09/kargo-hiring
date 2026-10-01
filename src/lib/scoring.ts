import type {
  ModelCriterionScore,
  Role,
  RoleScore,
  RubricCriterion,
  ScoredCriterion,
} from "./types";

export class RubricError extends Error {}
export class ModelOutputError extends Error {}

const EPSILON = 1e-6;

/** Rubric weights for a role must sum to exactly 100. Throws otherwise. */
export function assertRubricValid(role: Role, criteria: RubricCriterion[]): void {
  const own = criteria.filter((c) => c.role === role);
  if (own.length === 0) throw new RubricError(`No rubric criteria found for ${role.toUpperCase()}.`);
  for (const c of own) {
    if (!(c.weight > 0 && c.weight <= 100)) {
      throw new RubricError(`${c.criterion_name} has an invalid weight (${c.weight}).`);
    }
  }
  const total = sumWeights(own);
  if (Math.abs(total - 100) > EPSILON) {
    throw new RubricError(
      `${role.toUpperCase()} rubric weights add up to ${total}%, not 100%. Fix rubric_criteria before scoring.`,
    );
  }
  const keys = new Set(own.map((c) => c.key));
  if (keys.size !== own.length) throw new RubricError(`${role.toUpperCase()} rubric has duplicate criterion keys.`);
}

export function sumWeights(criteria: Pick<RubricCriterion, "weight">[]): number {
  return round2(criteria.reduce((sum, c) => sum + Number(c.weight), 0));
}

/** weighted_score = (score / 5) * weight. Rounded to 2 dp so repeated runs are byte-identical. */
export function weightedScore(score: number, weight: number): number {
  return round2((score / 5) * weight);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[•·▪–—\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the quoted evidence actually appears in the anonymised CV.
 * Tolerates whitespace, bullet and quote-style differences and a trailing ellipsis.
 */
export function evidenceAppearsInCv(evidence: string, cvText: string): boolean {
  const quote = normalise(evidence.replace(/^["'\s]+|["'\s.…]+$/g, ""));
  if (quote.length === 0) return false;
  const cv = normalise(cvText);
  if (cv.includes(quote)) return true;
  // Evidence may join two fragments with "…" — every fragment must be present.
  const parts = evidence
    .split(/\.\.\.|…/)
    .map((p) => normalise(p.replace(/^["'\s]+|["'\s.]+$/g, "")))
    .filter((p) => p.length >= 12);
  return parts.length > 1 && parts.every((p) => cv.includes(p));
}

/**
 * Validate the model's per-criterion output against the stored rubric and compute
 * every weighted number server-side. Any total the model might return is ignored.
 */
export function scoreRole(
  role: Role,
  rubric: RubricCriterion[],
  modelScores: ModelCriterionScore[],
  anonymisedCv: string,
): RoleScore {
  assertRubricValid(role, rubric);
  const own = rubric.filter((c) => c.role === role).sort((a, b) => a.position - b.position);

  const byKey = new Map<string, ModelCriterionScore>();
  for (const m of modelScores) {
    const match = own.find((c) => c.key === m.criterion || c.criterion_name === m.criterion);
    if (!match) throw new ModelOutputError(`Model returned an unknown criterion "${m.criterion}".`);
    if (byKey.has(match.key)) throw new ModelOutputError(`Model scored "${match.criterion_name}" twice.`);
    byKey.set(match.key, m);
  }

  const criteria: ScoredCriterion[] = own.map((c) => {
    const m = byKey.get(c.key);
    if (!m) throw new ModelOutputError(`Model did not score "${c.criterion_name}".`);
    if (!Number.isInteger(m.score) || m.score < 0 || m.score > 5) {
      throw new ModelOutputError(`Score for "${c.criterion_name}" must be an integer 0–5, got ${m.score}.`);
    }
    const evidence = (m.evidence ?? "").trim();
    const reason = (m.reason ?? "").trim();
    // A positive score with no quote is not traceable: treat as no evidence.
    const hasEvidence = evidence.length > 0 && !/^no evidence/i.test(evidence);
    const score = hasEvidence ? m.score : 0;
    return {
      criterion_id: c.id,
      key: c.key,
      criterion_name: c.criterion_name,
      short_label: c.short_label,
      score,
      weight: Number(c.weight),
      weighted_score: weightedScore(score, Number(c.weight)),
      evidence: hasEvidence ? evidence : "",
      evidence_verified: hasEvidence ? evidenceAppearsInCv(evidence, anonymisedCv) : true,
      reason: hasEvidence
        ? reason
        : m.score > 0
          ? "No evidence was quoted from the CV, so this criterion scores 0."
          : reason || "The CV contains no evidence for this criterion.",
    };
  });

  return {
    role,
    overall: round2(criteria.reduce((s, c) => s + c.weighted_score, 0)),
    criteria,
  };
}

/** Highest weighted contribution with at least moderate evidence. */
export function topStrength(criteria: ScoredCriterion[]): ScoredCriterion | null {
  const eligible = criteria.filter((c) => c.score >= 3);
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => b.weighted_score - a.weighted_score || b.weight - a.weight)[0];
}

/** Criterion that loses the most weighted points. */
export function mainConcern(criteria: ScoredCriterion[]): ScoredCriterion | null {
  const lost = criteria
    .map((c) => ({ c, lost: c.weight - c.weighted_score }))
    .filter((x) => x.c.score <= 3)
    .sort((a, b) => b.lost - a.lost || b.c.weight - a.c.weight);
  return lost[0]?.c ?? null;
}

export function strengthLabel(c: ScoredCriterion | null): string {
  if (!c) return "No strong evidence";
  return c.score === 5 ? `Exceptional ${c.short_label.toLowerCase()}` : `Strong ${c.short_label.toLowerCase()}`;
}

export function concernLabel(c: ScoredCriterion | null): string {
  if (!c) return "None flagged";
  if (c.score === 0) return `No ${c.short_label.toLowerCase()} evidence`;
  if (c.score <= 2) return `Limited ${c.short_label.toLowerCase()} evidence`;
  return `Moderate ${c.short_label.toLowerCase()} evidence`;
}

export function evidenceStrength(score: number): string {
  return ["No evidence", "Minimal evidence", "Weak evidence", "Moderate evidence", "Strong evidence", "Exceptional evidence"][score] ?? "";
}
