# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Pinned by the user: Next.js (App Router) + TypeScript + Tailwind CSS, Supabase (Postgres + Storage), Gemini API (Flash) for all AI steps, Resend for email, deployed on Vercel. All sensitive operations run in server-side route handlers; no API key reaches the browser.

## Users

Arjun Mehta, founder of Kargo (Series A logistics SaaS, Mumbai, 40 → 70 people). No HR function; he is the hiring manager for every role. He reviews CVs late at night in 45-minute windows between other work. He is the only operator of this tool.

## Product Purpose

Screen applicants for two open roles — Product Manager and Senior Product Manager — so Arjun can make an offer before year end. The system extracts each CV, strips PII before any AI step, scores every CV against both role rubrics with quoted evidence, ranks candidates, prepares a three-sentence interview brief, and drafts the email that matches Arjun's decision. Success: a shortlist he trusts, every applicant hears back, and every score can be explained criterion by criterion.

## Positioning

The system recommends; Arjun decides. The rubric is derived from what Kargo's own successful hires had in common, not from the job spec, and every point of every score traces to a quoted line of the CV. Nothing is sent and nobody is rejected without Arjun's explicit confirmation.

## Operating Context

- Upload a CV (PDF or DOCX), choose applied role → pipeline runs automatically.
- Review ranked list per role; open a candidate; read evidence, concern, probe; decide Shortlist / Hold / Not Shortlist.
- Decision selects the email draft (invite or rejection); Arjun edits if needed and clicks Confirm & Send; Resend delivers.
- Candidate emails in the case data are MESA test addresses (`*@pg27.mesaschool.co`).

## Capabilities and Constraints

- Rubric v1 is fixed and stored in the database (`rubric_criteria`); weights must sum to 100 per role; the model may never alter it.
- Scores 0–5 per criterion, evidence-only; weighted totals computed server-side, never by the model.
- Eligibility (location status, role match) is shown separately and never mixed into the score.
- Workflow statuses: Review, Shortlist, Hold, Not Shortlisted, Email Ready, Sent — set only by Arjun.
- Duplicate sends must be impossible.
- Invite emails carry a scheduling link (configured URL) so shortlisted candidates book themselves.
- Batch send is allowed only behind one explicit, itemised confirmation.

## Brand Commitments

User-pinned: minimal, calm, editorial, operational, restrained. Warm off-white ground, white surfaces, near-black text, muted grey secondary, very subtle borders, one restrained accent, semantic status colour only. No gradients, glass, glow, decorative illustration, AI-chatbot styling, radar/donut charts, or giant metric cards. Quality references (not to copy): Linear, Ramp, Stripe Dashboard, Notion, Vercel.

## Evidence on Hand

- 60 applicant CVs (PDF): `../data/resumes_/`
- 8 past-hire CVs: `../data/hires_/` (outcome ratings table not provided — do not invent outcomes)
- 2 JDs: `../data/jds_/`
- No real candidate outcomes, offers or testimonials exist; none may be fabricated.

## Product Principles

1. Evidence outranks the number: a score is never shown without the CV line behind it.
2. AI recommends, Arjun decides: decisions and sends are always his explicit action.
3. Absence of evidence is not a negative trait: missing evidence scores 0 and is labelled as missing, not as weakness.
4. Every applicant hears back: the tool makes closing the loop cheaper than ignoring it.
5. PII never reaches the model.

## Accessibility & Inclusion

Keyboard operable, visible focus, WCAG AA contrast, status never communicated by colour alone, semantic HTML.
