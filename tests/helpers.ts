import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import type { JsonModel } from "@/lib/gemini";
import type { CandidateRow, Repo, ResultRow, ScoreRow } from "@/lib/repo";
import type { Mailer } from "@/lib/send";
import type { Role, RubricCriterion } from "@/lib/types";

const root = path.resolve(import.meta.dirname, "..");

export function loadRubric(): RubricCriterion[] {
  const json = JSON.parse(fs.readFileSync(path.join(root, "supabase/rubric-v1.json"), "utf8"));
  return json.criteria.map((c: Record<string, unknown>, i: number) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    role: c.role,
    key: c.key,
    criterion_name: c.criterion_name,
    short_label: c.short_label,
    description: c.description,
    weight: c.weight,
    score_anchors: json.scale,
    position: c.position,
    rubric_version: json.version,
  }));
}

export function fixture(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(root, "tests/fixtures", name)));
}

/** A minimal but valid single-page PDF containing the given lines of text. */
export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 10 Tf 50 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

export class MemoryRepo implements Repo {
  candidates = new Map<string, CandidateRow>();
  results = new Map<string, ResultRow>();
  scores: ScoreRow[] = [];
  files = new Map<string, Uint8Array>();
  constructor(public rubric: RubricCriterion[] = loadRubric()) {}

  addCandidate(id: string, role: Role, filename: string, bytes: Uint8Array, patch: Partial<CandidateRow> = {}) {
    const now = new Date().toISOString();
    this.files.set(`${id}.pdf`, bytes);
    this.candidates.set(id, {
      id, candidate_name: null, candidate_email: null, candidate_phone: null, candidate_location: null, name_source: null,
      role_applied: role, original_file_url: `${id}.pdf`, original_filename: filename, file_kind: "pdf",
      anonymised_cv_text: null, processing_status: "uploaded", processing_error: null, decision: "review",
      decided_at: null, created_at: now, updated_at: now, ...patch,
    });
    this.results.set(id, blankResult(id));
  }

  async getRubric() { return this.rubric; }
  async getCandidate(id: string) { return this.candidates.get(id) ?? null; }
  async updateCandidate(id: string, patch: Partial<CandidateRow>) {
    const c = this.candidates.get(id);
    if (c) this.candidates.set(id, { ...c, ...patch });
  }
  async replaceScores(candidateId: string, rows: ScoreRow[]) {
    this.scores = this.scores.filter((s) => s.candidate_id !== candidateId).concat(rows);
  }
  async getResult(candidateId: string) { return this.results.get(candidateId) ?? null; }
  async upsertResult(candidateId: string, patch: Partial<ResultRow>) {
    const r = this.results.get(candidateId) ?? blankResult(candidateId);
    if (r.email_sent && patch.email_sent === false) throw new Error("email_sent cannot be reset once true");
    this.results.set(candidateId, { ...r, ...patch });
  }
  async claimSend(candidateId: string, staleBefore: Date) {
    const r = this.results.get(candidateId);
    if (!r || r.email_sent) return false;
    if (r.send_lock_at && new Date(r.send_lock_at) >= staleBefore) return false;
    this.results.set(candidateId, { ...r, send_lock_at: new Date().toISOString() });
    return true;
  }
  async downloadFile(p: string) {
    const f = this.files.get(p);
    if (!f) throw new Error("missing file");
    return f;
  }
}

export function blankResult(candidateId: string): ResultRow {
  const now = new Date().toISOString();
  return {
    id: `r-${candidateId}`, candidate_id: candidateId, pm_score: null, spm_score: null, eligibility_status: null,
    top_strength: null, main_concern: null, interview_brief: null, interview_brief_parts: null, email_type: null,
    email_subject: null, email_body: null, email_drafts: null, email_ready: false, email_sent: false, sent_at: null,
    sent_to: null, resend_message_id: null, send_lock_at: null, last_send_error: null, created_at: now, updated_at: now,
  };
}

type Scores = Record<string, [number, string]>; // key → [score, evidence]

/**
 * Scripted model: returns fixed per-criterion scores, records every prompt it was sent,
 * and can be told to fail. Evidence strings should be real quotes from the fixture CV.
 */
export class ScriptedModel implements JsonModel {
  prompts: string[] = [];
  constructor(
    private scores: { pm: Scores; spm: Scores },
    private opts: { fail?: "scoring" | "brief" | "email"; roleMatch?: "Strong" | "Partial" | "Unclear" } = {},
  ) {}

  async generateJson<T>(req: { label: string; prompt: string; validator: z.ZodType<T> }): Promise<T> {
    this.prompts.push(req.prompt);
    const role = req.label.startsWith("SPM") ? "spm" : req.label.startsWith("PM") ? "pm" : null;
    const kind = role ? "scoring" : req.label.startsWith("Interview") ? "brief" : "email";
    if (this.opts.fail === kind) throw Object.assign(new (await import("@/lib/gemini")).ModelError(`${req.label}: Gemini request failed (503).`, true));
    let out: unknown;
    if (role) {
      out = {
        criteria: Object.entries(this.scores[role]).map(([criterion, [score, evidence]]) => ({
          criterion, score, evidence, reason: `Scored ${score} from the quoted line.`,
        })),
        role_match: { value: this.opts.roleMatch ?? "Strong", basis: "Directly comparable product work." },
        overall_score: 99, // a total the backend must ignore
      };
    } else if (kind === "brief") {
      out = { why: "Scored well on ownership and shipping", strongest_evidence: "Sole PM for tracking modules", probe: "Ask how priorities were set without discovery data" };
    } else {
      out = {
        interview: { subject: "Interview for Product Manager at Kargo", body: "Hi {{first_name}},\n\nThanks for applying. I'd like to meet for a 45-minute conversation.\n\n{{scheduling_link}}" },
        rejection: { subject: "Your application to Kargo", body: "Hi {{first_name}},\n\nThank you for applying for the Product Manager role. We won't be moving forward this time.\n\n{{scheduling_link}}" },
      };
    }
    return req.validator.parse(out);
  }
}

export class FakeMailer implements Mailer {
  sent: Parameters<Mailer["send"]>[0][] = [];
  constructor(private behaviour: "ok" | "resend_error" | "network_error" | "slow" = "ok") {}
  async send(msg: Parameters<Mailer["send"]>[0]) {
    const { MailerError } = await import("@/lib/send");
    if (this.behaviour === "resend_error") throw new MailerError("The gmail.com domain is not verified.", "resend", 403);
    if (this.behaviour === "network_error") throw new MailerError("fetch failed", "network");
    if (this.behaviour === "slow") await new Promise((r) => setTimeout(r, 50));
    this.sent.push(msg);
    return { id: `msg_${this.sent.length}` };
  }
}
