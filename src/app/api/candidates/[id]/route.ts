import { NextResponse } from "next/server";
import { handle, jsonError, UUID_RE } from "@/lib/api";
import { supabaseRepo } from "@/lib/db";
import type { Decision, EmailType } from "@/lib/types";

const DECISIONS: Decision[] = ["review", "shortlisted", "hold", "not_shortlisted"];

/**
 * Arjun's decision. It also selects the matching draft: Shortlist → interview invite,
 * Not Shortlist → rejection. Choosing a decision never sends anything.
 */
export const PATCH = handle("decision", async (request: Request, ctx: RouteContext<"/api/candidates/[id]">) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError(404, "Candidate not found.");
  const body = (await request.json().catch(() => null)) as { decision?: string } | null;
  const decision = body?.decision as Decision;
  if (!DECISIONS.includes(decision)) return jsonError(422, "Unknown decision.");

  const repo = supabaseRepo();
  const candidate = await repo.getCandidate(id);
  if (!candidate) return jsonError(404, "Candidate not found.");
  const result = await repo.getResult(id);
  if (result?.email_sent) return jsonError(409, "The email has already been sent; the decision is final.");

  await repo.updateCandidate(id, { decision, decided_at: decision === "review" ? null : new Date().toISOString() });

  const target: EmailType | null = decision === "shortlisted" ? "interview" : decision === "not_shortlisted" ? "rejection" : null;
  if (result?.email_drafts) {
    const type = target ?? result.email_type ?? "interview";
    await repo.upsertResult(id, {
      email_type: type,
      email_subject: result.email_drafts[type].subject,
      email_body: result.email_drafts[type].body,
      email_ready: false,
    });
  }
  return NextResponse.json({ ok: true, decision });
});
