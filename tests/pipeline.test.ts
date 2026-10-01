import { describe, expect, it } from "vitest";
import { runPipeline } from "@/lib/pipeline";
import { fixture, MemoryRepo, ScriptedModel } from "./helpers";

/*
 * The pipeline runs for real here: real PDF extraction, real anonymisation, real scoring
 * maths and persistence. Only the Gemini call is scripted, so these tests pin down what
 * the backend does with a given set of model judgements. `npm run eval:live` runs the
 * same CVs through the real Gemini API.
 */

const PRIYA = {
  pm: {
    pm_ownership: [5, "Sole PM responsible for shipment tracking, exception management, and carrier integration modules"],
    pm_discovery: [4, "spending 2 weeks embedded with the operations teams of 3 freight forwarder clients"],
    pm_shipping: [5, "Shipped 7 features in 14 months; killed 3 after post-launch data showed <8% adoption"],
    pm_ambiguity: [4, "no PM manager above, decisions owned end-to-end"],
    pm_technical: [3, "API documentation in collaboration with engineering"],
  },
  spm: {
    spm_platform: [3, "carrier integration modules"],
    spm_decisions: [3, "no PM manager above, decisions owned end-to-end"],
    spm_influence: [1, "fed findings directly into sprint planning"],
    spm_reliability: [0, ""],
    spm_operating: [1, "Built a carrier performance tracking sheet"],
  },
} as const;

const SIDDHARTH = {
  pm: {
    pm_ownership: [5, "Led the product function as the sole senior PM for 2.5 years"],
    pm_discovery: [4, "decision made after 3 months of customer discovery"],
    pm_shipping: [5, "Shipped 12 features in 3 years; killed 4 post-launch based on usage data"],
    pm_ambiguity: [4, "Built the shift's first digital container dwell-time tracker"],
    pm_technical: [4, "Designed the JNPT container tracking integration"],
  },
  spm: {
    spm_platform: [5, "Led the integration with ICEGATE for automated customs filing status"],
    spm_decisions: [5, "Rebuilt the entire product architecture from a single monolith to a modular suite"],
    spm_influence: [3, "sat in on every new customer onboarding in the first year"],
    spm_reliability: [3, "reduced the most common client support ticket by 60%"],
    spm_operating: [2, "owned roadmap, discovery, and delivery with no PM manager"],
  },
} as const;

const ADITYA = {
  pm: {
    pm_ownership: [2, "Designed, developed, and deployed a full-scale enterprise ERP system"],
    pm_discovery: [1, "Worked directly with operations, finance, and sales teams to define requirements"],
    pm_shipping: [2, "taking it from MVP to production-ready deploy"],
    pm_ambiguity: [1, "Contributed to building an operating system for slow-moving industrial vehicles"],
    pm_technical: [5, "Worked hands-on with ROS2 nodes, simulators, and physical vehicles"],
  },
  spm: {
    spm_platform: [2, "Integrated ROS2-based automation pipelines with backend services and databases"],
    spm_decisions: [0, ""],
    spm_influence: [1, "Worked directly with operations, finance, and sales teams"],
    spm_reliability: [2, "ensuring safe, responsive, and intuitive teleoperation"],
    spm_operating: [0, ""],
  },
} as const;

type Script = { pm: Record<string, readonly [number, string]>; spm: Record<string, readonly [number, string]> };
const mutable = (s: Script) => JSON.parse(JSON.stringify(s));

async function run(file: string, role: "pm" | "spm", script: Script, opts: ConstructorParameters<typeof ScriptedModel>[1] = {}) {
  const repo = new MemoryRepo();
  const model = new ScriptedModel(mutable(script), opts);
  repo.addCandidate("c1", role, file, fixture(file));
  const outcome = await runPipeline("c1", { repo, model, schedulingUrl: "https://cal.com/arjun/kargo" });
  return { repo, model, outcome, c: repo.candidates.get("c1")!, r: repo.results.get("c1")! };
}

describe("1. strong PM candidate", () => {
  it("scores high on PM, ranks by PM score, and drafts an invite with the real name", async () => {
    const { outcome, c, r, repo, model } = await run("pm_01_priya_krishnan.pdf", "pm", PRIYA);
    expect(outcome).toEqual({ ok: true });
    expect(c.processing_status).toBe("ready_for_review");
    // 25 + 16 + 20 + 16 + 9
    expect(r.pm_score).toBe(86);
    // 15 + 15 + 4 + 0 + 3
    expect(r.spm_score).toBe(37);
    expect(r.top_strength).toBe("Exceptional ownership");
    expect(r.main_concern).toBe("Moderate technical evidence");
    expect(r.eligibility_status).toMatchObject({ location_status: "Mumbai", role_match: "Strong" });
    // Every score is traceable and verified against the CV text.
    const pmRows = repo.scores.filter((s) => s.role === "pm");
    expect(pmRows).toHaveLength(5);
    expect(pmRows.every((s) => s.evidence_verified)).toBe(true);
    expect(repo.scores.filter((s) => s.role === "spm")).toHaveLength(5);
    // Name inserted server-side; model never saw it.
    expect(r.email_body).toMatch(/^Hi Priya,/);
    expect(r.email_body).toContain("https://cal.com/arjun/kargo");
    expect(r.email_body).toMatch(/Arjun Mehta\nFounder, Kargo$/);
    for (const p of model.prompts) expect(p).not.toMatch(/Priya|Krishnan|squad_1@|98442|31075/);
    // Brief is exactly three sentences.
    expect(r.interview_brief!.match(/[.?!](\s|$)/g)).toHaveLength(3);
    // Nothing is decided or sent by the system.
    expect(c.decision).toBe("review");
    expect(r.email_sent).toBe(false);
    expect(r.email_ready).toBe(false);
  });
});

describe("2. strong SPM candidate", () => {
  it("scores high on SPM and is still scored against PM", async () => {
    const { r, repo } = await run("spm_16_siddharth_rao.pdf", "spm", SIDDHARTH);
    // 25 + 25 + 12 + 9 + 6
    expect(r.spm_score).toBe(77);
    // 25 + 16 + 20 + 16 + 12
    expect(r.pm_score).toBe(89);
    expect(r.top_strength).toMatch(/^Exceptional (platform|decisions)$/);
    expect(r.main_concern).toBe("Limited operating system evidence");
    expect(repo.scores.filter((s) => s.role === "pm")).toHaveLength(5);
  });
});

describe("3. technical candidate without PM evidence", () => {
  it("gets a low PM score driven by missing product evidence, not by the strong technical score", async () => {
    const { r } = await run("07_aditya_nair.pdf", "pm", ADITYA, { roleMatch: "Partial" });
    // 10 + 4 + 8 + 4 + 15
    expect(r.pm_score).toBe(41);
    expect(r.top_strength).toBe("Exceptional technical");
    // Discovery loses 16 of 20 points; ownership loses 15 of 25.
    expect(r.main_concern).toBe("Limited discovery evidence");
    expect(r.eligibility_status).toMatchObject({ role_match: "Partial", location_status: "Relocation unclear" });
  });
});

describe("4. PM with strong discovery but weak technical evidence", () => {
  it("surfaces discovery as the strength and technical as the concern", async () => {
    const script = mutable(PRIYA);
    script.pm.pm_ownership = [3, "Sole PM responsible for shipment tracking"];
    script.pm.pm_shipping = [3, "Shipped 7 features in 14 months"];
    script.pm.pm_ambiguity = [3, "no PM manager above"];
    script.pm.pm_discovery = [5, "Ran fortnightly discovery sessions with freight forwarder ops teams"];
    script.pm.pm_technical = [0, ""];
    const { r, repo } = await run("pm_01_priya_krishnan.pdf", "pm", script);
    // 15 + 20 + 12 + 12 + 0
    expect(r.pm_score).toBe(59);
    expect(r.top_strength).toBe("Exceptional discovery");
    expect(r.main_concern).toBe("No technical evidence");
    const tech = repo.scores.find((s) => s.role === "pm" && s.weight === 15)!;
    expect(tech.score).toBe(0);
    expect(tech.reason).not.toMatch(/weak|poor|lacks skill/i);
  });
});

describe("9. Gemini failure", () => {
  it("scoring failure → scoring_failed with a clear message, no partial scores", async () => {
    const { outcome, c, repo, r } = await run("pm_01_priya_krishnan.pdf", "pm", PRIYA, { fail: "scoring" });
    expect(outcome).toMatchObject({ ok: false, status: "scoring_failed" });
    expect(c.processing_status).toBe("scoring_failed");
    expect(c.processing_error).toMatch(/Gemini request failed/);
    expect(repo.scores).toHaveLength(0);
    expect(r.pm_score).toBeNull();
    // PII was still separated and stored, so Retry can pick up from here.
    expect(c.candidate_email).toBe("squad_1@pg27.mesaschool.co");
  });

  it("brief failure → generation_failed; scores are kept", async () => {
    const { c, r } = await run("pm_01_priya_krishnan.pdf", "pm", PRIYA, { fail: "brief" });
    expect(c.processing_status).toBe("generation_failed");
    expect(r.pm_score).toBe(86);
  });

  it("retry after a failure completes the pipeline", async () => {
    const repo = new MemoryRepo();
    repo.addCandidate("c1", "pm", "pm_01_priya_krishnan.pdf", fixture("pm_01_priya_krishnan.pdf"));
    await runPipeline("c1", { repo, model: new ScriptedModel(mutable(PRIYA), { fail: "email" }) });
    expect(repo.candidates.get("c1")!.processing_status).toBe("generation_failed");
    const retry = await runPipeline("c1", { repo, model: new ScriptedModel(mutable(PRIYA)) });
    expect(retry.ok).toBe(true);
    expect(repo.scores.filter((s) => s.candidate_id === "c1")).toHaveLength(10); // replaced, not duplicated
  });
});

describe("pipeline guards", () => {
  it("never reprocesses a candidate whose email was sent", async () => {
    const repo = new MemoryRepo();
    repo.addCandidate("c1", "pm", "pm_01_priya_krishnan.pdf", fixture("pm_01_priya_krishnan.pdf"));
    await repo.upsertResult("c1", { email_sent: true });
    const out = await runPipeline("c1", { repo, model: new ScriptedModel(mutable(PRIYA)) });
    expect(out.ok).toBe(false);
  });

  it("an unreadable file fails at extraction and never reaches the model", async () => {
    const repo = new MemoryRepo();
    const model = new ScriptedModel(mutable(PRIYA));
    repo.addCandidate("c1", "pm", "broken.pdf", new TextEncoder().encode("%PDF-1.7 garbage"));
    const out = await runPipeline("c1", { repo, model });
    expect(out).toMatchObject({ ok: false, status: "extraction_failed" });
    expect(model.prompts).toHaveLength(0);
  });
});
