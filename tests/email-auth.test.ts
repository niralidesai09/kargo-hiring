import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, verifySessionToken } from "@/lib/auth";
import { isValidEmail, renderDrafts } from "@/lib/email";

describe("email rendering", () => {
  const drafts = {
    interview: { subject: "Interview — {{first_name}}", body: "Thanks for applying, {{first_name}}.\n{{scheduling_link}}\n\nBest regards,\nThe team" },
    rejection: { subject: "Your application", body: "Hi {{first_name}},\n\nThank you for applying. {{unknown}}" },
  };

  it("inserts the stored first name, the booking link and the signature server-side", () => {
    const out = renderDrafts(drafts, "priya krishnan", "https://cal.com/arjun");
    expect(out.interview.body).toMatch(/^Hi Priya,\n\nThanks for applying, Priya\./);
    expect(out.interview.body).toContain("Book a time that suits you: https://cal.com/arjun");
    expect(out.interview.body).not.toMatch(/Best regards|The team/);
    expect(out.interview.body.endsWith("Arjun Mehta\nFounder, Kargo")).toBe(true);
    expect(out.interview.subject).toBe("Interview — Priya");
    expect(out.rejection.body).not.toMatch(/\{\{|\}\}/);
  });

  it("without a scheduling URL, asks the candidate to reply with times", () => {
    expect(renderDrafts(drafts, "Priya", undefined).interview.body).toContain("Reply to this email with two or three times");
  });

  it("validates addresses", () => {
    expect(isValidEmail("squad_1@pg27.mesaschool.co")).toBe(true);
    for (const bad of ["", "a@b", "a b@c.com", "a@@b.com", null]) expect(isValidEmail(bad)).toBe(false);
  });
});

describe("session tokens", () => {
  afterEach(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.APP_PASSWORD;
  });

  it("accepts its own token, rejects tampered and expired ones", async () => {
    process.env.SESSION_SECRET = "test-secret-please-change";
    const t = await createSessionToken();
    expect(await verifySessionToken(t)).toBe(true);
    expect(await verifySessionToken(t.replace(/.$/, (c) => (c === "a" ? "b" : "a")))).toBe(false);
    expect(await verifySessionToken(t, Date.now() + 15 * 24 * 3600 * 1000)).toBe(false);
    process.env.SESSION_SECRET = "different";
    expect(await verifySessionToken(t)).toBe(false);
  });

  it("checks the password", async () => {
    process.env.SESSION_SECRET = "s";
    process.env.APP_PASSWORD = "correct horse";
    expect(await passwordMatches("correct horse")).toBe(true);
    expect(await passwordMatches("wrong")).toBe(false);
  });
});

describe("sign-off handling", () => {
  it("keeps body lines that merely start with 'Thanks'", () => {
    const out = renderDrafts({
      interview: { subject: "s", body: "Hi {{first_name}},\n\nThanks for applying for the Product Manager role.\n\n{{scheduling_link}}\n\nThanks,\nArjun" },
      rejection: { subject: "s", body: "Thank you for applying.\nWe won't move forward.\n\nKind regards" },
    }, "Priya", "https://cal.com/a");
    expect(out.interview.body).toBe("Hi Priya,\n\nThanks for applying for the Product Manager role.\n\nBook a time that suits you: https://cal.com/a\n\nArjun Mehta\nFounder, Kargo");
    expect(out.rejection.body).toBe("Hi Priya,\n\nThank you for applying.\nWe won't move forward.\n\nArjun Mehta\nFounder, Kargo");
  });
});

describe("booking line", () => {
  it("removes a model-written lead-in so the invite doesn't contradict itself", () => {
    const out = renderDrafts({
      interview: { subject: "s", body: "Hi {{first_name}},\n\nLet's talk.\n\nPlease pick a time that works for you using the link below:\n\n{{scheduling_link}}\n\nLooking forward to it." },
      rejection: { subject: "s", body: "Hi {{first_name}},\n\nThanks." },
    }, "Virat Patel", undefined);
    expect(out.interview.body).toBe("Hi Virat,\n\nLet's talk.\n\nReply to this email with two or three times that suit you this week.\n\nLooking forward to it.\n\nArjun Mehta\nFounder, Kargo");
  });
});
