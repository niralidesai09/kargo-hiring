import { NextResponse } from "next/server";
import { handle, jsonError, UUID_RE } from "@/lib/api";
import { supabaseRepo } from "@/lib/db";
import { createGeminiModel, ModelError } from "@/lib/gemini";
import { runPipeline } from "@/lib/pipeline";

// Extraction + two scoring calls + brief + email can take a while under rate limits.
export const maxDuration = 300;

/** Run (or re-run) the full pipeline for one candidate. Used for first processing and Retry. */
export const POST = handle("process", async (_req: Request, ctx: RouteContext<"/api/candidates/[id]/process">) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError(404, "Candidate not found.");
  let model;
  try {
    model = createGeminiModel();
  } catch (err) {
    if (err instanceof ModelError) return jsonError(503, err.message, "config");
    throw err;
  }
  const outcome = await runPipeline(id, {
    repo: supabaseRepo(),
    model,
    schedulingUrl: process.env.SCHEDULING_URL?.trim() || undefined,
  });
  if (outcome.ok) return NextResponse.json({ ok: true, status: "ready_for_review" });
  return NextResponse.json({ ok: false, status: outcome.status, error: outcome.error }, { status: 200 });
});
