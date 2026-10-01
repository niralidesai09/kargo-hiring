# Kargo Hiring

Internal CV screening for Arjun Mehta (founder, Kargo) — Product Manager and Senior Product Manager roles.

**The system recommends. Arjun decides.** Every CV is anonymised before any AI step, scored against both rubrics with a verbatim quote behind every criterion, ranked, and given an interview brief and two email drafts. Nothing is decided, rejected or sent without Arjun's explicit action.

```
Upload CV (PDF/DOCX) + applied role
  → extract text                       (server, unpdf / mammoth)
  → separate PII, anonymise            (server, deterministic — never an AI step)
  → score vs PM rubric  ┐              (Gemini, structured JSON, 0–5 per criterion + verbatim evidence)
  → score vs SPM rubric ┘
  → weighted totals, rank              (server: (score/5)·weight, summed — never trusted from the model)
  → interview brief (3 sentences)      (Gemini, from anonymised scores/evidence only)
  → invite + rejection drafts          (Gemini; name + booking link inserted server-side afterwards)
  → Arjun: Shortlist / Hold / Not shortlist → matching draft → edit → Confirm & send
  → Resend                             (server route; email_sent only after Resend accepts)
```

## 1. File structure

```
src/
  proxy.ts                         Password gate for every page and API route (Next 16 "proxy")
  app/
    (app)/page.tsx                 Candidate list (All / PM / SPM, status filters, search, sort, batch send)
    (app)/candidates/[id]/page.tsx Candidate docket (scores, evidence, eligibility, brief, decision, email)
    (app)/upload/page.tsx          Screen a candidate (drag & drop, batch, live stages)
    (app)/settings/page.tsx        Rubric (weights validated) + connection status
    login/page.tsx
    api/
      candidates/route.ts                POST  upload file → private storage + candidate row
      candidates/[id]/process/route.ts   POST  run / retry the pipeline
      candidates/[id]/status/route.ts    GET   processing state (polled by the UI)
      candidates/[id]/route.ts           PATCH Arjun's decision (selects the matching draft)
      candidates/[id]/email/route.ts     PUT   save edited draft / mark ready
      candidates/[id]/file/route.ts      GET   60-second signed link to the original CV
      send-email/route.ts                POST  send one email via Resend
      send-batch/route.ts                POST  send the drafts Arjun marked ready (explicit list)
      auth/login, auth/logout
  lib/
    pii.ts        PII extraction + anonymisation (fails closed if anything survives)
    extract.ts    File validation by content, PDF/DOCX text extraction
    scoring.ts    Rubric validation, weighted maths, evidence verification, strength/concern
    prompts.ts    Gemini prompts + JSON schemas + validators
    gemini.ts     Gemini client: structured output, fixed seed, retries/backoff, timeouts
    pipeline.ts   The end-to-end pipeline and its processing states
    send.ts       Send flow: validation, atomic lock, idempotency key, error mapping
    mailer.ts     Resend adapter
    email.ts      Name/booking-link insertion, signature, HTML rendering
    db.ts, queries.ts, repo.ts, auth.ts, log.ts, status.ts, types.ts
  components/     Shell, candidate board, docket, score breakdown, email composer, upload flow, UI kit
supabase/
  schema.sql      Tables, indexes, triggers, RLS, private storage bucket
  rubric-v1.json  Rubric source of truth (criteria, weights, descriptions, anchors)
  seed.sql        Generated from rubric-v1.json (npm run db:seed-sql)
scripts/          db-setup, build-seed, import-cvs
tests/            Unit tests, case-corpus PII sweep, live Gemini evaluation
```

## 2. Setup

Requires Node 20.9+.

```bash
npm install
cp .env.example .env.local        # then fill it in (section 4)
```

Create the database: in Supabase → **SQL Editor → New query**, paste and run `supabase/schema.sql`, then `supabase/seed.sql`.
(Or put a Postgres connection string in `SUPABASE_DB_URL` and run `npm run db:setup`.)

```bash
npm run dev                       # http://localhost:3000
```

## 3. Supabase schema

| Table | Purpose |
|---|---|
| `rubric_criteria` | `id, role, key, criterion_name, short_label, description, weight, score_anchors, position, rubric_version, active, created_at, updated_at` — unique `(role, key, rubric_version)`. View `rubric_weight_totals` shows each role's total. |
| `candidates` | PII lives here only: `candidate_name, candidate_email, candidate_phone, candidate_location, name_source`; plus `role_applied, original_file_url` (private storage path), `original_filename, file_kind, anonymised_cv_text, processing_status, processing_error, decision, decided_at, created_at, updated_at`. |
| `candidate_scores` | One row per candidate × criterion × role: `score (0–5), evidence, evidence_verified, reason, weight (snapshot), weighted_score`. FK to `candidates` (cascade) and `rubric_criteria`. |
| `candidate_results` | `pm_score, spm_score, eligibility_status {location_status, location_basis, role_match, role_match_basis}, top_strength, main_concern, interview_brief, interview_brief_parts, email_type, email_subject, email_body, email_drafts, email_ready, email_sent, sent_at, sent_to, resend_message_id, send_lock_at, last_send_error`. |

- Row Level Security is **on with no policies**: the publishable/anon key can read nothing. Only the server, using the secret key, can.
- A trigger forbids `email_sent` from ever going back to `false`.
- CVs are stored in the private `cvs` bucket under random IDs (no names in paths).

## 4. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | |
| `SUPABASE_ANON_KEY` | listed | Publishable key. Not used for data access (RLS blocks it by design). |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Secret key (`sb_secret_…` or legacy service_role). Server only. |
| `GEMINI_API_KEY` | yes | |
| `RESEND_API_KEY` | to send | |
| `HIRING_FROM_EMAIL` | to send | Verified sender, e.g. `"Arjun at Kargo <hiring@kargo.in>"`. Testing: `onboarding@resend.dev`. |
| `APP_PASSWORD`, `SESSION_SECRET` | production | Sign-in gate. The app refuses to serve in production without them. |
| `SCHEDULING_URL` | optional | Cal.com/Calendly link inserted into interview invites. |
| `RESEND_TEST_RECIPIENT` | optional | Deliver every email here instead (testing). Shown in the UI when on. |
| `HIRING_REPLY_TO`, `GEMINI_MODEL` | optional | Model defaults to `gemini-flash-latest`. |

`.env.local` is git-ignored. No variable is `NEXT_PUBLIC_`; nothing secret reaches the browser (verified by scanning the client bundle).

## 5. Gemini architecture

- **Input is anonymised text only.** Name, email, phone, links, street address, DOB, gender, marital status, religion etc. are removed deterministically on the server. The anonymiser handles PDF artefacts (glued names/numbers/links) and **fails closed**: if an email, a 10+ digit run, a link or a name token survives, the CV is not sent to the model.
- **Four structured-JSON calls per CV**: PM scoring, SPM scoring (parallel), interview brief, email drafts. Each uses `responseJsonSchema` and is validated with zod; malformed or off-rubric output is retried, then fails with a clear status.
- **Scoring prompt** contains the role, the rubric (from the database) and the anonymised CV, and states: *"Score only evidence explicitly present in the CV. Do not infer missing evidence."* It forbids inference from title, prestige, years alone, certifications or personal characteristics, and requires a **verbatim** quote per criterion.
- **Grounding check:** each quote is matched against the anonymised CV; unmatched quotes are flagged in the UI ("quote not found verbatim"). A positive score with no quote is forced to 0.
- **Reproducibility:** temperature 0, fixed seed, bounded thinking budget. Four runs of the same CV produced identical criterion scores.
- The model never computes totals and never sees the rubric weights' arithmetic.

## 6. Scoring calculation

```
weighted_score = (criterion_score / 5) × criterion_weight      (2 dp)
overall_score  = Σ weighted_score                               (0–100)
```

Computed in `src/lib/scoring.ts`. Scoring is refused unless PM and SPM weights each total exactly 100%. Each `candidate_scores` row stores the weight used, so a score stays explainable after the rubric is recalibrated. The docket shows the sum explicitly, e.g. `25 + 12 + 20 + 16 + 9 = 82 / 100`.

Ranking: PM view ranks PM applicants by PM score; SPM view ranks SPM applicants by SPM score. Both scores are always visible, and the list flags "Stronger SPM fit" when the other rubric scores ≥10 points higher. Eligibility (location status, role match) is shown separately and never enters the score.

## 7. Resend integration

`POST /api/send-email` (server only):

1. Validates subject, body, candidate exists, email on file and syntactically valid, and that the email type matches Arjun's recorded decision.
2. Checks `RESEND_API_KEY` / `HIRING_FROM_EMAIL`.
3. **Atomic claim**: `UPDATE … SET send_lock_at = now() WHERE email_sent = false AND lock free` — only one request can win. Double clicks, two tabs and batch overlaps all resolve to one send.
4. Calls Resend with an **idempotency key** derived from candidate + content, so a retried request after a network timeout cannot double-send at Resend.
5. Only after Resend returns a message id: `email_sent = true`, `sent_at`, `sent_to`, `resend_message_id`. On failure the lock is released, status becomes `send_failed`, and the UI shows the reason with Retry.

Errors return clear messages: invalid/missing email (422), missing API key (503), Resend error (502 with Resend's message), network error (502), duplicate (409).

## 8. Local testing

```bash
npm test                 # 60 unit tests: the 12 required cases + more, no network
npm run test:corpus      # anonymisation sweep over all CVs in ../data/resumes_
npm run eval:live        # real Gemini, end-to-end pipeline on 3 case CVs (needs GEMINI_API_KEY)
npm run typecheck && npm run lint && npm run build

npm run import:cvs -- ../data/resumes_                    # screen pm_/spm_ CVs through the running app
npm run import:cvs -- ../data/resumes_ --default-role pm  # include unprefixed CVs as PM
```

Required test cases → where: strong PM, strong SPM, technical w/o PM evidence, strong discovery + weak technical, Gemini failure → `tests/pipeline.test.ts`; missing email, missing phone, PII in multiple locations → `tests/pii.test.ts`; invalid file → `tests/extract.test.ts`; Resend failure, duplicate send → `tests/send.test.ts`; weight calculation, PM = 100 %, SPM = 100 %, determinism → `tests/scoring.test.ts`.

## 9. Deploy to Vercel

1. Push to GitHub (`.env.local` stays local).
2. Vercel → **Add New → Project** → import the repo (framework: Next.js, defaults).
3. **Settings → Environment Variables**: add every variable from section 4 (including `APP_PASSWORD` and `SESSION_SECRET`).
4. Deploy. The process route sets `maxDuration = 300`; Vercel's default Fluid compute allows it.
5. Open the URL, sign in, upload a CV.

CLI alternative: `npx vercel link`, `npx vercel env add …`, `npx vercel --prod`.

## 10. Known limitations

- **Model judgement is strict and literal.** It scores only what the CV states; e.g. a strong operator whose CV never mentions cross-functional alignment scores 0 there. That is by design — the probe tells Arjun what to ask. Calibrate by editing `rubric_criteria` descriptions/anchors.
- **Rubric provenance.** Rubric v1 criteria and weights were fixed in the brief; descriptions were written from the patterns in the 8 hire profiles. The hire outcome ratings table wasn't in the provided files, so no outcome-weighted calibration was done yet.
- **Name detection** uses the CV header, falling back to the file name (marked "name taken from file name"). Unusual layouts can still produce a wrong name; Arjun sees the original CV one click away.
- **Scanned (image-only) PDFs** are rejected with a clear message — no OCR.
- **Processing is request-driven** (the upload page drives it, 2 at a time). Closing the tab mid-batch leaves remaining CVs as "Needs retry" — one click each. A queue (e.g. Vercel Queues/Inngest) would make it fully background.
- **Resend sandbox:** until a domain is verified, Resend delivers only to the account owner's address — use `RESEND_TEST_RECIPIENT`.
- **Single operator.** One shared password, no per-user audit of who clicked what (only when).
- **Gemini free tier** keeps prompts for product improvement; for real candidate data use a billed key (DPDP).
