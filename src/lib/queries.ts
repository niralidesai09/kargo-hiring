import "server-only";
import { db, normaliseResult } from "./db";
import type { CandidateRow, ResultRow } from "./repo";
import { FAILED_STATES, IN_PROGRESS_STATES, type Role, type RubricCriterion, type WorkflowStatus } from "./types";

export function workflowStatus(c: Pick<CandidateRow, "processing_status" | "decision">, r: Pick<ResultRow, "email_sent" | "email_ready"> | null): WorkflowStatus {
  if (r?.email_sent || c.processing_status === "sent") return "sent";
  if (IN_PROGRESS_STATES.includes(c.processing_status)) return "processing";
  if (FAILED_STATES.includes(c.processing_status)) return "failed";
  if (r?.email_ready && (c.decision === "shortlisted" || c.decision === "not_shortlisted")) return "email_ready";
  return c.decision;
}

export interface CandidateListItem {
  id: string;
  name: string;
  role_applied: Role;
  processing_status: CandidateRow["processing_status"];
  processing_error: string | null;
  decision: CandidateRow["decision"];
  status: WorkflowStatus;
  score: number | null; // applied-role score
  pm_score: number | null;
  spm_score: number | null;
  top_strength: string | null;
  main_concern: string | null;
  email_type: ResultRow["email_type"];
  has_email: boolean;
  send_failed: boolean;
  created_at: string;
  updated_at: string;
  rank: number | null;
}

type ListRow = Pick<
  CandidateRow,
  "id" | "candidate_name" | "candidate_email" | "role_applied" | "processing_status" | "processing_error" | "decision" | "created_at" | "updated_at"
> & { candidate_results: Record<string, unknown> | Record<string, unknown>[] | null };

export async function listCandidates(): Promise<CandidateListItem[]> {
  const { data, error } = await db()
    .from("candidates")
    .select(
      "id,candidate_name,candidate_email,role_applied,processing_status,processing_error,decision,created_at,updated_at,candidate_results(pm_score,spm_score,top_strength,main_concern,email_type,email_ready,email_sent,sent_at,updated_at)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Loading candidates: ${error.message}`);

  const items: CandidateListItem[] = (data as ListRow[]).map((row) => {
    const raw = Array.isArray(row.candidate_results) ? row.candidate_results[0] ?? null : row.candidate_results;
    const r = normaliseResult(raw);
    const score = r ? (row.role_applied === "pm" ? r.pm_score : r.spm_score) : null;
    const updated = [row.updated_at, r?.updated_at].filter(Boolean).sort().pop() as string;
    return {
      id: row.id,
      name: row.candidate_name ?? "Unnamed candidate",
      role_applied: row.role_applied,
      processing_status: row.processing_status,
      processing_error: row.processing_error,
      decision: row.decision,
      status: workflowStatus(row, r),
      score,
      pm_score: r?.pm_score ?? null,
      spm_score: r?.spm_score ?? null,
      top_strength: r?.top_strength ?? null,
      main_concern: r?.main_concern ?? null,
      email_type: r?.email_type ?? null,
      has_email: Boolean(row.candidate_email),
      send_failed: row.processing_status === "send_failed",
      created_at: row.created_at,
      updated_at: updated,
      rank: null,
    };
  });

  // Rank within each applied role by that role's score. Ties share order by upload time.
  for (const role of ["pm", "spm"] as Role[]) {
    items
      .filter((i) => i.role_applied === role && i.score != null)
      .sort((a, b) => b.score! - a.score! || a.created_at.localeCompare(b.created_at))
      .forEach((i, idx) => (i.rank = idx + 1));
  }
  return items;
}

export interface CriterionDetail {
  criterion_id: string;
  key: string;
  criterion_name: string;
  short_label: string;
  description: string;
  position: number;
  score: number;
  weight: number;
  weighted_score: number;
  evidence: string;
  evidence_verified: boolean;
  reason: string;
}

export interface CandidateDetail {
  candidate: CandidateRow;
  result: ResultRow | null;
  status: WorkflowStatus;
  scores: Record<Role, CriterionDetail[]>;
  rank: { position: number; of: number } | null;
}

export async function getCandidateDetail(id: string): Promise<CandidateDetail | null> {
  const s = db();
  const [{ data: candidate, error: e1 }, { data: result, error: e2 }, { data: scores, error: e3 }] = await Promise.all([
    s.from("candidates").select("*").eq("id", id).maybeSingle(),
    s.from("candidate_results").select("*").eq("candidate_id", id).maybeSingle(),
    s
      .from("candidate_scores")
      .select("role,criterion_id,score,evidence,evidence_verified,reason,weight,weighted_score,rubric_criteria(key,criterion_name,short_label,description,position)")
      .eq("candidate_id", id),
  ]);
  if (e1 || e2 || e3) throw new Error(`Loading candidate: ${(e1 ?? e2 ?? e3)!.message}`);
  if (!candidate) return null;

  const grouped: Record<Role, CriterionDetail[]> = { pm: [], spm: [] };
  for (const row of (scores ?? []) as Record<string, unknown>[]) {
    const rc = (Array.isArray(row.rubric_criteria) ? row.rubric_criteria[0] : row.rubric_criteria) as Record<string, unknown>;
    grouped[row.role as Role].push({
      criterion_id: row.criterion_id as string,
      key: rc.key as string,
      criterion_name: rc.criterion_name as string,
      short_label: rc.short_label as string,
      description: rc.description as string,
      position: rc.position as number,
      score: row.score as number,
      weight: Number(row.weight),
      weighted_score: Number(row.weighted_score),
      evidence: row.evidence as string,
      evidence_verified: row.evidence_verified as boolean,
      reason: row.reason as string,
    });
  }
  grouped.pm.sort((a, b) => a.position - b.position);
  grouped.spm.sort((a, b) => a.position - b.position);

  const r = normaliseResult(result as Record<string, unknown> | null);
  const c = candidate as CandidateRow;

  let rank: CandidateDetail["rank"] = null;
  const own = c.role_applied === "pm" ? r?.pm_score : r?.spm_score;
  if (own != null) {
    const col = c.role_applied === "pm" ? "pm_score" : "spm_score";
    const { data: peers } = await s.from("candidates").select(`id,created_at,candidate_results(${col})`).eq("role_applied", c.role_applied);
    const scored = ((peers ?? []) as Record<string, unknown>[])
      .map((p) => {
        const pr = (Array.isArray(p.candidate_results) ? p.candidate_results[0] : p.candidate_results) as Record<string, unknown> | null;
        return { id: p.id as string, created_at: p.created_at as string, score: pr?.[col] == null ? null : Number(pr[col]) };
      })
      .filter((p) => p.score != null)
      .sort((a, b) => b.score! - a.score! || a.created_at.localeCompare(b.created_at));
    rank = { position: scored.findIndex((p) => p.id === id) + 1, of: scored.length };
  }

  return { candidate: c, result: r, status: workflowStatus(c, r), scores: grouped, rank };
}

export async function getRubricForSettings(): Promise<RubricCriterion[]> {
  const { data, error } = await db().from("rubric_criteria").select("*").eq("active", true).order("role").order("position");
  if (error) throw new Error(`Loading rubric: ${error.message}`);
  return (data as RubricCriterion[]).map((r) => ({ ...r, weight: Number(r.weight) }));
}

/** Which integrations are configured — booleans only, never values. */
export function configStatus() {
  const set = (k: string) => Boolean(process.env[k]?.trim());
  return {
    supabase: set("SUPABASE_URL") && (set("SUPABASE_SERVICE_ROLE_KEY") || set("SUPABASE_ANON_KEY")),
    serviceRole: set("SUPABASE_SERVICE_ROLE_KEY"),
    gemini: set("GEMINI_API_KEY"),
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest",
    resend: set("RESEND_API_KEY"),
    from: process.env.HIRING_FROM_EMAIL?.trim() || null,
    testRecipient: process.env.RESEND_TEST_RECIPIENT?.trim() || null,
    schedulingUrl: process.env.SCHEDULING_URL?.trim() || null,
    auth: set("APP_PASSWORD") && set("SESSION_SECRET"),
  };
}
