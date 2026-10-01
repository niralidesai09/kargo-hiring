import { NextResponse } from "next/server";
import { handle, jsonError, UUID_RE } from "@/lib/api";
import { db } from "@/lib/db";
import { getCandidateDetail } from "@/lib/queries";

/** Processing state; once ready, also a short summary so the upload page can show the outcome in place. */
export const GET = handle("status", async (_req: Request, ctx: RouteContext<"/api/candidates/[id]/status">) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError(404, "Candidate not found.");
  const { data, error } = await db().from("candidates").select("processing_status,processing_error").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return jsonError(404, "Candidate not found.");

  let summary = null;
  if (data.processing_status === "ready_for_review" || data.processing_status === "sent") {
    const d = await getCandidateDetail(id);
    if (d?.result) {
      const role = d.candidate.role_applied;
      summary = {
        name: d.candidate.candidate_name,
        role,
        score: role === "pm" ? d.result.pm_score : d.result.spm_score,
        rank: d.rank,
        strength: d.result.top_strength,
        concern: d.result.main_concern,
        probe: d.result.interview_brief_parts?.probe ?? null,
        location: d.result.eligibility_status?.location_status ?? null,
        hasEmail: Boolean(d.candidate.candidate_email),
      };
    }
  }
  return NextResponse.json({ ...data, summary }, { headers: { "cache-control": "no-store" } });
});
