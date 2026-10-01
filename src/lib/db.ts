import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CandidateRow, Repo, ResultRow, ScoreRow } from "./repo";
import type { RubricCriterion } from "./types";

export const CV_BUCKET = "cvs";

export class ConfigError extends Error {}

let client: SupabaseClient | null = null;

/** Server-only Supabase client. Prefers the service role key; RLS blocks the anon key by design. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new ConfigError("Supabase isn't configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return client;
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export function normaliseResult(r: Record<string, unknown> | null): ResultRow | null {
  if (!r) return null;
  return { ...(r as unknown as ResultRow), pm_score: num(r.pm_score), spm_score: num(r.spm_score) };
}

export function supabaseRepo(): Repo {
  const s = db();
  return {
    async getRubric() {
      const rows = must(
        await s.from("rubric_criteria").select("*").eq("active", true).order("role").order("position"),
        "Loading rubric",
      );
      return (rows as RubricCriterion[]).map((r) => ({ ...r, weight: Number(r.weight) }));
    },
    async getCandidate(id) {
      const res = await s.from("candidates").select("*").eq("id", id).maybeSingle();
      return must(res, "Loading candidate") as CandidateRow | null;
    },
    async updateCandidate(id, patch) {
      must(await s.from("candidates").update(patch).eq("id", id), "Updating candidate");
    },
    async replaceScores(candidateId, rows: ScoreRow[]) {
      must(await s.from("candidate_scores").delete().eq("candidate_id", candidateId), "Clearing scores");
      if (rows.length) must(await s.from("candidate_scores").insert(rows), "Saving scores");
    },
    async getResult(candidateId) {
      const res = await s.from("candidate_results").select("*").eq("candidate_id", candidateId).maybeSingle();
      return normaliseResult(must(res, "Loading result") as Record<string, unknown> | null);
    },
    async upsertResult(candidateId, patch) {
      must(
        await s.from("candidate_results").upsert({ candidate_id: candidateId, ...patch }, { onConflict: "candidate_id" }),
        "Saving result",
      );
    },
    async claimSend(candidateId, staleBefore) {
      const res = await s
        .from("candidate_results")
        .update({ send_lock_at: new Date().toISOString() })
        .eq("candidate_id", candidateId)
        .eq("email_sent", false)
        .or(`send_lock_at.is.null,send_lock_at.lt.${staleBefore.toISOString()}`)
        .select("id");
      return (must(res, "Claiming send") as unknown[]).length === 1;
    },
    async downloadFile(path) {
      const { data, error } = await s.storage.from(CV_BUCKET).download(path);
      if (error || !data) throw new Error(`Downloading CV: ${error?.message ?? "no data"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
