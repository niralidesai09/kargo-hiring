import { z } from "zod";
import type { Role, RoleScore, RubricCriterion } from "./types";
import { ROLE_LABEL } from "./types";

/* ------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* ------------------------------------------------------------------------- */

export const SCORING_SYSTEM = `You are an evidence auditor screening CVs for Kargo, a logistics SaaS company in Mumbai.
You score one anonymised CV against one fixed rubric. The rubric is given to you; you may not change, add, drop, merge or reweight criteria.

Rules:
- Score only evidence explicitly present in the CV. Do not infer missing evidence.
- Score each criterion as an integer 0–5 using its anchors: 0 = no evidence, 1 = minimal, 2 = weak, 3 = moderate, 4 = strong, 5 = exceptional.
- If the CV contains no evidence for a criterion, score 0, set evidence to "" and say in the reason that the CV does not show it. Absence of evidence is not evidence of a weakness: never describe the candidate negatively because something is missing.
- Never infer capability from job title, company prestige, university prestige, years of experience alone, certifications alone, or any personal characteristic (age, gender, religion, caste, ethnicity, health, marital status, photographs, contact information).
- "evidence" must be copied verbatim from the CV: one contiguous quote of at most 300 characters. Do not paraphrase, merge or correct it.
- "reason" is one plain sentence explaining why that evidence earns that score against that criterion's anchors.
- Do not compute totals, averages or weighted scores.
- Personal details have been replaced with markers such as [candidate]; ignore them.`;

export function scoringPrompt(role: Role, rubric: RubricCriterion[], anonymisedCv: string, appliedRole: Role | null): string {
  const criteria = rubric
    .filter((c) => c.role === role)
    .sort((a, b) => a.position - b.position)
    .map(
      (c) =>
        `- key: ${c.key}\n  name: ${c.criterion_name}\n  what strong looks like: ${c.description}\n  anchors:\n${Object.entries(c.score_anchors)
          .map(([s, a]) => `    ${s}: ${a}`)
          .join("\n")}`,
    )
    .join("\n");
  return `ROLE BEING SCORED: ${ROLE_LABEL[role]}
ROLE THE CANDIDATE APPLIED FOR: ${appliedRole ? ROLE_LABEL[appliedRole] : "not stated"}

Score only evidence explicitly present in the CV. Do not infer missing evidence.

RUBRIC (fixed, do not modify):
${criteria}

Also judge role_match for the role being scored — does the CV's work history show the kind of work this role does?
- "Strong": the CV shows directly comparable product work.
- "Partial": adjacent work (e.g. operations, engineering, analytics, consulting) that overlaps with the role.
- "Unclear": the CV does not show enough to tell.
Give a one-sentence basis that cites what the CV shows, not what it lacks.

ANONYMISED CV:
"""
${anonymisedCv}
"""`;
}

export function scoringJsonSchema(keys: string[]) {
  return {
    type: "object",
    properties: {
      criteria: {
        type: "array",
        minItems: keys.length,
        maxItems: keys.length,
        items: {
          type: "object",
          properties: {
            criterion: { type: "string", enum: keys },
            score: { type: "integer", minimum: 0, maximum: 5 },
            evidence: { type: "string" },
            reason: { type: "string" },
          },
          required: ["criterion", "score", "evidence", "reason"],
          propertyOrdering: ["criterion", "evidence", "reason", "score"],
        },
      },
      role_match: {
        type: "object",
        properties: {
          value: { type: "string", enum: ["Strong", "Partial", "Unclear"] },
          basis: { type: "string" },
        },
        required: ["value", "basis"],
      },
    },
    required: ["criteria", "role_match"],
  };
}

export const scoringValidator = z.object({
  criteria: z.array(
    z.object({
      criterion: z.string(),
      score: z.number(),
      evidence: z.string(),
      reason: z.string(),
    }),
  ),
  role_match: z.object({
    value: z.enum(["Strong", "Partial", "Unclear"]),
    basis: z.string(),
  }),
});
export type ScoringOutput = z.infer<typeof scoringValidator>;

/* ------------------------------------------------------------------------- */
/* Interview brief                                                            */
/* ------------------------------------------------------------------------- */

export const BRIEF_SYSTEM = `You write interview briefs for a busy founder who reads them 30 seconds before an interview.
You receive an anonymised candidate's rubric scores with the verbatim CV evidence behind each score.
Use only that material. Do not invent employers, numbers, projects or traits that are not in the evidence.
Write exactly three sentences, one per field, each under 35 words, plain and specific. No praise words like "impressive" or "stellar".`;

export function briefPrompt(score: RoleScore, concernKey: string | null): string {
  const lines = score.criteria
    .map(
      (c) =>
        `- ${c.criterion_name} (weight ${c.weight}%): ${c.score}/5\n  evidence: ${c.evidence ? `"${c.evidence}"` : "(none in CV)"}\n  reason: ${c.reason}`,
    )
    .join("\n");
  const concern = score.criteria.find((c) => c.key === concernKey);
  return `ROLE: ${ROLE_LABEL[score.role]}

SCORES:
${lines}

Fields:
- why: why this candidate scored as they did, naming the criteria that drove the score.
- strongest_evidence: the single strongest piece of evidence, paraphrasing the quote closely.
- probe: one specific question topic for the interview that tests ${concern ? `"${concern.criterion_name}" (scored ${concern.score}/5${concern.evidence ? "" : ", no evidence in the CV"})` : "the least-evidenced criterion"}. Phrase it as what to ask, grounded in what the CV does or does not show.`;
}

export const briefJsonSchema = {
  type: "object",
  properties: {
    why: { type: "string" },
    strongest_evidence: { type: "string" },
    probe: { type: "string" },
  },
  required: ["why", "strongest_evidence", "probe"],
  propertyOrdering: ["why", "strongest_evidence", "probe"],
};

export const briefValidator = z.object({
  why: z.string().min(10),
  strongest_evidence: z.string().min(10),
  probe: z.string().min(10),
});

/* ------------------------------------------------------------------------- */
/* Emails                                                                     */
/* ------------------------------------------------------------------------- */

export const EMAIL_SYSTEM = `You draft short candidate emails for Arjun Mehta, founder of Kargo (logistics SaaS, Mumbai).
You never see the candidate's name. Write the literal placeholder {{first_name}} wherever the name goes.
Rules:
- Interview invite: 90–140 words, warm and professional. Mention at most one specific thing from the evidence, stated factually. Include the literal placeholder {{scheduling_link}} on its own line where the candidate books a slot. Do not write any sentence about links, booking, calendars or picking times; that line is filled in automatically. Say the interview is a 45-minute conversation with Arjun.
- Rejection: 60–100 words, respectful and neutral. Thank them for applying to the named role. Do not give or invent reasons. Do not promise future roles.
- Never claim to be impressed or excited unless the evidence given scores 4 or 5.
- No sign-off or signature; it is added automatically. No subject prefixes like "Re:".
- Plain text only. No markdown, no bullet points, no emojis.`;

export function emailPrompt(score: RoleScore): string {
  const strongest = [...score.criteria].sort((a, b) => b.weighted_score - a.weighted_score)[0];
  const usable = strongest && strongest.score >= 3 && strongest.evidence;
  return `ROLE APPLIED FOR: ${ROLE_LABEL[score.role]}
${usable ? `STRONGEST EVIDENCE (${strongest.criterion_name}, ${strongest.score}/5): "${strongest.evidence}"` : "STRONGEST EVIDENCE: none strong enough to cite — keep the invite general."}

Draft both emails.`;
}

export const emailJsonSchema = {
  type: "object",
  properties: {
    interview: {
      type: "object",
      properties: { subject: { type: "string" }, body: { type: "string" } },
      required: ["subject", "body"],
    },
    rejection: {
      type: "object",
      properties: { subject: { type: "string" }, body: { type: "string" } },
      required: ["subject", "body"],
    },
  },
  required: ["interview", "rejection"],
};

export const emailValidator = z.object({
  interview: z.object({ subject: z.string().min(3), body: z.string().min(40) }),
  rejection: z.object({ subject: z.string().min(3), body: z.string().min(40) }),
});
