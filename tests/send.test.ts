import { beforeEach, describe, expect, it } from "vitest";
import { sendCandidateEmail, type SendConfig } from "@/lib/send";
import { FakeMailer, MemoryRepo } from "./helpers";

const ID = "c1";
let repo: MemoryRepo;

function setup(patch: Parameters<MemoryRepo["addCandidate"]>[4] = {}) {
  repo = new MemoryRepo();
  repo.addCandidate(ID, "pm", "cv.pdf", new Uint8Array(), {
    candidate_name: "Priya Krishnan",
    candidate_email: "squad_1@pg27.mesaschool.co",
    processing_status: "ready_for_review",
    decision: "shortlisted",
    ...patch,
  });
}

const input = { candidateId: ID, subject: "Interview at Kargo", body: "Hi Priya,\n\nLet's talk.\n\nArjun Mehta\nFounder, Kargo", emailType: "interview" as const };
const cfg = (mailer: FakeMailer | null, extra: Partial<SendConfig> = {}): SendConfig => ({ mailer, from: "Arjun at Kargo <hiring@kargo.test>", ...extra });

beforeEach(() => setup());

describe("successful send", () => {
  it("marks email_sent and sent_at only after Resend accepts", async () => {
    const mailer = new FakeMailer();
    const res = await sendCandidateEmail(repo, cfg(mailer), input);
    expect(res.ok).toBe(true);
    const r = repo.results.get(ID)!;
    expect(r.email_sent).toBe(true);
    expect(r.sent_at).toBeTruthy();
    expect(r.resend_message_id).toBe("msg_1");
    expect(r.send_lock_at).toBeNull();
    expect(repo.candidates.get(ID)!.processing_status).toBe("sent");
    expect(mailer.sent[0]).toMatchObject({ to: "squad_1@pg27.mesaschool.co", subject: "Interview at Kargo" });
    expect(mailer.sent[0].html).toContain("<p");
  });

  it("routes to RESEND_TEST_RECIPIENT when set", async () => {
    const mailer = new FakeMailer();
    await sendCandidateEmail(repo, cfg(mailer, { testRecipient: "me@example.com" }), input);
    expect(mailer.sent[0].to).toBe("me@example.com");
    expect(repo.results.get(ID)!.sent_to).toBe("me@example.com");
  });
});

describe("10. Resend failure", () => {
  it("Resend error → send_failed, email_sent stays false, lock released so Retry works", async () => {
    const res = await sendCandidateEmail(repo, cfg(new FakeMailer("resend_error")), input);
    expect(res).toMatchObject({ ok: false, status: 502, code: "resend_error" });
    if (!res.ok) expect(res.error).toMatch(/domain is not verified/);
    const r = repo.results.get(ID)!;
    expect(r.email_sent).toBe(false);
    expect(r.sent_at).toBeNull();
    expect(r.send_lock_at).toBeNull();
    expect(repo.candidates.get(ID)!.processing_status).toBe("send_failed");
    // Retry succeeds.
    expect((await sendCandidateEmail(repo, cfg(new FakeMailer()), input)).ok).toBe(true);
  });

  it("network error → clear message", async () => {
    const res = await sendCandidateEmail(repo, cfg(new FakeMailer("network_error")), input);
    expect(res).toMatchObject({ ok: false, code: "network_error" });
    if (!res.ok) expect(res.error).toMatch(/Couldn't reach Resend/);
  });

  it("missing API key → 503 before anything is locked", async () => {
    const res = await sendCandidateEmail(repo, cfg(null), input);
    expect(res).toMatchObject({ ok: false, status: 503, code: "missing_api_key" });
    expect(repo.results.get(ID)!.send_lock_at).toBeNull();
  });
});

describe("11. duplicate send", () => {
  it("a second send after success is refused", async () => {
    const mailer = new FakeMailer();
    await sendCandidateEmail(repo, cfg(mailer), input);
    const again = await sendCandidateEmail(repo, cfg(mailer), input);
    expect(again).toMatchObject({ ok: false, status: 409, code: "already_sent" });
    expect(mailer.sent).toHaveLength(1);
  });

  it("two simultaneous clicks send exactly one email", async () => {
    const mailer = new FakeMailer("slow");
    const [a, b] = await Promise.all([sendCandidateEmail(repo, cfg(mailer), input), sendCandidateEmail(repo, cfg(mailer), input)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it("uses a content-based idempotency key so a retried request can't double-send at Resend", async () => {
    const mailer = new FakeMailer();
    await sendCandidateEmail(repo, cfg(mailer), input);
    expect(mailer.sent[0].idempotencyKey).toMatch(/^kargo-c1-[0-9a-f]{24}$/);
  });

  it("the sent flag can't be reset", async () => {
    await sendCandidateEmail(repo, cfg(new FakeMailer()), input);
    await expect(repo.upsertResult(ID, { email_sent: false })).rejects.toThrow();
  });
});

describe("validation", () => {
  it("5. missing email on the candidate", async () => {
    setup({ candidate_email: null });
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer()), input)).toMatchObject({ ok: false, code: "missing_email" });
  });
  it("invalid email address", async () => {
    setup({ candidate_email: "priya@@kargo" });
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer()), input)).toMatchObject({ ok: false, code: "invalid_email" });
  });
  it("unknown candidate", async () => {
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer()), { ...input, candidateId: "nope" })).toMatchObject({ ok: false, status: 404 });
  });
  it("empty subject or body", async () => {
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer()), { ...input, subject: "  " })).toMatchObject({ code: "missing_subject" });
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer()), { ...input, body: "" })).toMatchObject({ code: "missing_body" });
  });
  it("won't send before Arjun decides, or an email that contradicts his decision", async () => {
    setup({ decision: "review" });
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer()), input)).toMatchObject({ code: "no_decision" });
    setup({ decision: "not_shortlisted" });
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer()), input)).toMatchObject({ code: "decision_mismatch" });
    expect((await sendCandidateEmail(repo, cfg(new FakeMailer()), { ...input, emailType: "rejection" })).ok).toBe(true);
  });
  it("missing from address", async () => {
    expect(await sendCandidateEmail(repo, cfg(new FakeMailer(), { from: undefined }), input)).toMatchObject({ code: "missing_from" });
  });
});
