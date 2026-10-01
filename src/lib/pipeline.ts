import { anonymise, AnonymisationError } from "./pii";
import { extractText, ExtractionError } from "./extract";
import type { JsonModel } from "./gemini";
import { ModelError } from "./gemini";
import {
  BRIEF_SYSTEM, briefJsonSchema, briefPrompt, briefValidator,
  EMAIL_SYSTEM, emailJsonSchema, emailPrompt, emailValidator,
  SCORING_SYSTEM, scoringJsonSchema, scoringPrompt, scoringValidator,
} from "./prompts";
import type { Repo, ScoreRow } from "./repo";
import {
  assertRubricValid, concernLabel, mainConcern, ModelOutputError, RubricError,
  scoreRole, strengthLabel, topStrength,
} from "./scoring";
import { renderDrafts } from "./email";
import type { Eligibility, ProcessingState, Role, RoleScore, RubricCriterion } from "./types";
import { log } from "./log";

export const SPM_BAR = 55;

export interface PipelineDeps {
  repo: Repo;
  model: JsonModel;
  schedulingUrl?: string;
}

export type PipelineOutcome = { ok: true } | { ok: false; status: ProcessingState; error: string };

class StageError extends Error {
  constructor(readonly status: ProcessingState, message: string) {
    super(message);
  }
}

async function scoreWithModel(
  model: JsonModel, role: Role, rubric: RubricCriterion[], cv: string, applied: Role | null,
): Promise<{ score: RoleScore; roleMatch: { value: Eligibility["role_match"]; basis: string } }> {
  const keys = rubric.filter((c) => c.role === role).sort((a, b) => a.position - b.position).map((c) => c.key);
  // One re-ask if the model's JSON is well-formed but doesn't fit the rubric (e.g. a skipped criterion).
  for (let attempt = 0; ; attempt++) {
    const out = await model.generateJson({
      label: `${role.toUpperCase()} scoring`,
      system: SCORING_SYSTEM,
      prompt: scoringPrompt(role, rubric, cv, applied),
      jsonSchema: scoringJsonSchema(keys),
      validator: scoringValidator,
    });
    try {
      return { score: scoreRole(role, rubric, out.criteria, cv), roleMatch: out.role_match };
    } catch (err) {
      if (err instanceof ModelOutputError && attempt === 0) continue;
      throw err;
    }
  }
}

/**
 * Upload → extract → anonymise → score PM + SPM → brief → email drafts → ready_for_review.
 * Idempotent: re-running replaces scores and drafts. Never touches a candidate already sent.
 */
export async function runPipeline(candidateId: string, deps: PipelineDeps): Promise<PipelineOutcome> {
  const { repo, model } = deps;
  const setStatus = (processing_status: ProcessingState, processing_error: string | null = null) =>
    repo.updateCandidate(candidateId, { processing_status, processing_error });

  const candidate = await repo.getCandidate(candidateId);
  if (!candidate) return { ok: false, status: "extraction_failed", error: "Candidate not found." };
  const existing = await repo.getResult(candidateId);
  if (existing?.email_sent || candidate.processing_status === "sending") {
    return { ok: false, status: candidate.processing_status, error: "This candidate's email has already been sent or is sending." };
  }

  try {
    // 1. Extract
    await setStatus("extracting");
    if (!candidate.original_file_url || !candidate.file_kind) throw new StageError("extraction_failed", "The original file is missing.");
    let raw: string;
    try {
      const bytes = await repo.downloadFile(candidate.original_file_url);
      raw = await extractText(bytes, candidate.file_kind);
    } catch (err) {
      throw new StageError("extraction_failed", err instanceof ExtractionError ? err.message : "The original file could not be read.");
    }
    await setStatus("extracted");

    // 2. Separate PII — the only text that leaves this server is anonymisedText.
    await setStatus("anonymising");
    let anon: ReturnType<typeof anonymise>;
    try {
      anon = anonymise(raw, candidate.original_filename ?? "");
    } catch (err) {
      throw new StageError("extraction_failed", err instanceof AnonymisationError ? err.message : "Personal details could not be separated safely.");
    }
    await repo.updateCandidate(candidateId, {
      candidate_name: anon.pii.candidate_name,
      name_source: anon.pii.name_source,
      candidate_email: anon.pii.candidate_email,
      candidate_phone: anon.pii.candidate_phone,
      candidate_location: anon.pii.candidate_location,
      anonymised_cv_text: anon.anonymisedText,
    });

    // 3. Score against both rubrics. Weighted numbers are computed here, never by the model.
    await setStatus("scoring");
    const auto = Boolean(existing?.eligibility_status?.role_auto);
    let applied: Role = candidate.role_applied;
    let pm: Awaited<ReturnType<typeof scoreWithModel>>;
    let spm: Awaited<ReturnType<typeof scoreWithModel>>;
    try {
      const rubric = await repo.getRubric();
      assertRubricValid("pm", rubric);
      assertRubricValid("spm", rubric);
      [pm, spm] = await Promise.all([
        scoreWithModel(model, "pm", rubric, anon.anonymisedText, auto ? null : applied),
        scoreWithModel(model, "spm", rubric, anon.anonymisedText, auto ? null : applied),
      ]);
    } catch (err) {
      if (err instanceof RubricError || err instanceof ModelError || err instanceof ModelOutputError) {
        throw new StageError("scoring_failed", err.message);
      }
      throw err;
    }
    const rows: ScoreRow[] = [pm.score, spm.score].flatMap((rs) =>
      rs.criteria.map((c) => ({
        candidate_id: candidateId, role: rs.role, criterion_id: c.criterion_id, score: c.score,
        evidence: c.evidence, evidence_verified: c.evidence_verified, reason: c.reason,
        weight: c.weight, weighted_score: c.weighted_score,
      })),
    );
    await repo.replaceScores(candidateId, rows);

    // "Let Kargo decide": the SPM rubric is stricter, so a CV is filed as Senior PM only when it clears
    // SPM_BAR on that rubric; otherwise Product Manager. The reason is stored and shown to Arjun.
    let roleBasis: string | undefined;
    if (auto) {
      applied = spm.score.overall >= SPM_BAR ? "spm" : "pm";
      roleBasis =
        applied === "spm"
          ? `Scores ${spm.score.overall} on the Senior PM rubric, above the ${SPM_BAR} bar (Product Manager: ${pm.score.overall}).`
          : `Scores ${spm.score.overall} on the Senior PM rubric, below the ${SPM_BAR} bar, so filed as Product Manager (${pm.score.overall}).`;
      await repo.updateCandidate(candidateId, { role_applied: applied });
    }
    const appliedScore = applied === "pm" ? pm.score : spm.score;
    const appliedMatch = applied === "pm" ? pm.roleMatch : spm.roleMatch;
    const concern = mainConcern(appliedScore.criteria);
    const eligibility: Eligibility = {
      location_status: anon.location.status,
      location_basis: anon.location.basis,
      role_match: appliedMatch.value,
      role_match_basis: appliedMatch.basis,
      ...(auto ? { role_auto: true, role_basis: roleBasis } : {}),
    };
    await repo.upsertResult(candidateId, {
      pm_score: pm.score.overall,
      spm_score: spm.score.overall,
      eligibility_status: eligibility,
      top_strength: strengthLabel(topStrength(appliedScore.criteria)),
      main_concern: concernLabel(concern),
    });

    // 4. Interview brief
    await setStatus("generating_brief");
    let brief;
    try {
      brief = await model.generateJson({
        label: "Interview brief",
        system: BRIEF_SYSTEM,
        prompt: briefPrompt(appliedScore, concern?.key ?? null),
        jsonSchema: briefJsonSchema,
        validator: briefValidator,
      });
    } catch (err) {
      throw new StageError("generation_failed", err instanceof Error ? err.message : "Interview brief could not be generated.");
    }
    const tidy = (s: string) => {
      const t = s.trim().replace(/\s+/g, " ");
      return /[.?!]$/.test(t) ? t : `${t}.`;
    };
    const parts = { why: tidy(brief.why), strongest_evidence: tidy(brief.strongest_evidence), probe: tidy(brief.probe) };
    await repo.upsertResult(candidateId, {
      interview_brief: `${parts.why} ${parts.strongest_evidence} ${parts.probe}`,
      interview_brief_parts: parts,
    });

    // 5. Email drafts. The model never sees the name; it is inserted here from the stored PII record.
    await setStatus("generating_email");
    let drafts;
    try {
      drafts = await model.generateJson({
        label: "Email drafts",
        system: EMAIL_SYSTEM,
        prompt: emailPrompt(appliedScore),
        jsonSchema: emailJsonSchema,
        validator: emailValidator,
      });
    } catch (err) {
      throw new StageError("generation_failed", err instanceof Error ? err.message : "Email drafts could not be generated.");
    }
    const rendered = renderDrafts(drafts, anon.pii.candidate_name, deps.schedulingUrl);
    const current = await repo.getCandidate(candidateId);
    const type = current?.decision === "not_shortlisted" ? "rejection" : "interview";
    await repo.upsertResult(candidateId, {
      email_drafts: rendered,
      email_type: type,
      email_subject: rendered[type].subject,
      email_body: rendered[type].body,
      email_ready: false,
    });

    await setStatus("ready_for_review");
    log.info("pipeline.ready", { candidateId });
    return { ok: true };
  } catch (err) {
    const status: ProcessingState = err instanceof StageError ? err.status : "generation_failed";
    const message = err instanceof StageError ? err.message : "Something unexpected went wrong while processing this CV.";
    if (!(err instanceof StageError)) log.error("pipeline.unexpected", { candidateId, error: (err as Error)?.message });
    else log.warn("pipeline.failed", { candidateId, status });
    await setStatus(status, message).catch(() => {});
    return { ok: false, status, error: message };
  }
}
