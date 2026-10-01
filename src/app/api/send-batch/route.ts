import { NextResponse } from "next/server";
import { handle, jsonError, UUID_RE } from "@/lib/api";
import { supabaseRepo } from "@/lib/db";
import { sendConfigFromEnv } from "@/lib/mailer";
import { sendCandidateEmail } from "@/lib/send";

export const maxDuration = 120;

/**
 * Sends the saved, ready drafts for an explicit list Arjun confirmed on screen.
 * Each send goes through the same checks and lock as a single send.
 */
export const POST = handle("send-batch", async (request: Request) => {
  const body = (await request.json().catch(() => null)) as { candidateIds?: unknown } | null;
  const ids = Array.isArray(body?.candidateIds) ? (body!.candidateIds as unknown[]).filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : [];
  if (ids.length === 0) return jsonError(422, "No candidates selected.");
  if (ids.length > 50) return jsonError(422, "Send at most 50 at a time.");

  const repo = supabaseRepo();
  const cfg = sendConfigFromEnv();
  const results: { candidateId: string; ok: boolean; error?: string }[] = [];
  for (const candidateId of [...new Set(ids)]) {
    const [candidate, r] = await Promise.all([repo.getCandidate(candidateId), repo.getResult(candidateId)]);
    if (!candidate || !r) {
      results.push({ candidateId, ok: false, error: "Candidate not found." });
      continue;
    }
    if (!r.email_ready) {
      results.push({ candidateId, ok: false, error: "Draft isn't marked ready." });
      continue;
    }
    const res = await sendCandidateEmail(repo, cfg, {
      candidateId,
      subject: r.email_subject ?? "",
      body: r.email_body ?? "",
      emailType: r.email_type ?? "interview",
    });
    results.push(res.ok ? { candidateId, ok: true } : { candidateId, ok: false, error: res.error });
    // Stay under Resend's default rate limit (2 requests/second).
    await new Promise((r) => setTimeout(r, 600));
  }
  return NextResponse.json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});
