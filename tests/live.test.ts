import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createGeminiModel, type JsonModel } from "@/lib/gemini";
import { runPipeline } from "@/lib/pipeline";
import { fixture, MemoryRepo } from "./helpers";

/**
 * Live evaluation against the real Gemini API: `npm run eval:live`.
 * Uses the real pipeline end to end (extraction → anonymisation → scoring → brief → email),
 * with an in-memory store instead of Supabase. Skipped unless LIVE=1 and a key is present.
 */
if (process.env.LIVE === "1" && fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const enabled = process.env.LIVE === "1" && Boolean(process.env.GEMINI_API_KEY);

function recording(model: JsonModel, prompts: string[]): JsonModel {
  return {
    generateJson(req) {
      prompts.push(req.system + "\n" + req.prompt);
      return model.generateJson(req);
    },
  };
}

async function screen(file: string, role: "pm" | "spm") {
  const repo = new MemoryRepo();
  const prompts: string[] = [];
  repo.addCandidate("c", role, file, fixture(file));
  const outcome = await runPipeline("c", { repo, model: recording(createGeminiModel(), prompts), schedulingUrl: "https://cal.com/kargo/interview" });
  return { outcome, repo, prompts, c: repo.candidates.get("c")!, r: repo.results.get("c")! };
}

describe.skipIf(!enabled)("live Gemini evaluation", { timeout: 240_000 }, () => {
  it("screens the case CVs end to end with valid JSON, grounded evidence and sensible ranking", async () => {
    const [priya, siddharth, aditya] = await Promise.all([
      screen("pm_01_priya_krishnan.pdf", "pm"),
      screen("spm_16_siddharth_rao.pdf", "spm"),
      screen("07_aditya_nair.pdf", "pm"),
    ]);

    for (const [name, x] of [["Priya", priya], ["Siddharth", siddharth], ["Aditya", aditya]] as const) {
      expect(x.outcome, `${name} pipeline`).toEqual({ ok: true });
      expect(x.repo.scores).toHaveLength(10);
      const verified = x.repo.scores.filter((s) => !s.evidence || s.evidence_verified).length;
      console.log(
        `${name}: PM ${x.r.pm_score} · SPM ${x.r.spm_score} · strength "${x.r.top_strength}" · concern "${x.r.main_concern}" · ` +
          `${verified}/10 quotes verified · role match ${x.r.eligibility_status?.role_match}\n  brief: ${x.r.interview_brief}\n  subject: ${x.r.email_subject}`,
      );
      expect(verified).toBeGreaterThanOrEqual(8);
      // No PII in anything sent to the model.
      const leak = new RegExp([x.c.candidate_name, ...(x.c.candidate_name ?? "").split(" "), x.c.candidate_email, x.c.candidate_phone].filter(Boolean).map((s) => s!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
      for (const p of x.prompts) expect(p).not.toMatch(leak);
      // Name inserted server-side.
      expect(x.r.email_body).toMatch(new RegExp(`^Hi ${x.c.candidate_name!.split(" ")[0]},`));
      expect(x.r.interview_brief_parts?.probe.length).toBeGreaterThan(20);
    }

    // Ranking sanity: product-evidence CVs outrank the engineering CV on the PM rubric.
    expect(priya.r.pm_score!).toBeGreaterThan(aditya.r.pm_score!);
    expect(siddharth.r.spm_score!).toBeGreaterThan(aditya.r.spm_score!);
  });
});
