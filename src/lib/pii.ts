import type { LocationStatus } from "./types";

/**
 * Deterministic PII separation. Runs entirely on our server: no model ever sees
 * the raw CV, so no model can be the thing that finds (and therefore receives) PII.
 */

export interface PiiRecord {
  candidate_name: string | null;
  name_source: "cv" | "filename" | null;
  candidate_email: string | null;
  candidate_phone: string | null;
  candidate_location: string | null;
}

export interface AnonymiseResult {
  pii: PiiRecord;
  anonymisedText: string;
  location: { status: LocationStatus; basis: string };
}

export class AnonymisationError extends Error {}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE =
  /\S*(?:https?:\/\/|www\.)\S+|\S*(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com|flowcv\.me|leetcode\.com|about\.me|notion\.site|wa\.me|calendly\.com|linktr\.ee)\S*/gi;
const PHONE_CANDIDATE_RE = /(?:\+\s?\d{1,3}[\s.-]?)?\(?\d[\d\s().-]{7,16}\d/g;
const PERSONAL_LINE_RE =
  /^\s*(?:date of birth|d\.?o\.?b\.?|birth ?date|age|gender|sex|marital status|nationality|religion|caste|father'?s name|mother'?s name|spouse|passport(?: no\.?| number)?|aadhaa?r|pan(?: no\.?| number)?|blood group)\b.*$/gim;
const ADDRESS_LINE_RE =
  /^.*\b(?:flat|apt\.?|apartment|house no\.?|h\.? ?no\.?|plot|sector \d+|road|rd\.|street|st\.|lane|nagar|colony|society|chs|tower|wing|floor|pin(?:code)?|zip)\b.*\b\d{6}\b.*$/gim;
const CONTACT_LABEL_RE = /\b(?:e-?mail|mobile|mob(?:\.| no)?|phone|tel|contact|linkedin|github|portfolio|website|address)\s*[:\-]/i;

export const INDIAN_CITIES = [
  "Mumbai", "Navi Mumbai", "Thane", "Bombay", "Pune", "Bengaluru", "Bangalore", "Chennai", "Hyderabad",
  "Delhi", "New Delhi", "Delhi NCR", "Gurugram", "Gurgaon", "Noida", "Kolkata", "Ahmedabad", "Kochi",
  "Jaipur", "Chandigarh", "Indore", "Lucknow", "Nagpur", "Coimbatore", "Surat", "Vadodara", "Bhopal",
  "Visakhapatnam", "Mysuru", "Goa", "Aurangabad", "Nashik", "Trivandrum", "Thiruvananthapuram",
];
const MUMBAI_RE = /\b(?:mumbai|navi mumbai|thane|bombay)\b/i;
const CITY_RE = new RegExp(`\\b(${INDIAN_CITIES.map((c) => c.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

const HEADER_LINES = 8;

const NOT_NAME_WORDS = new Set(
  [
    "product", "manager", "senior", "summary", "profile", "professional", "experience", "education",
    "skills", "resume", "curriculum", "vitae", "objective", "leader", "strategy", "operations", "lead",
    "engineer", "analyst", "associate", "director", "head", "founder", "consultant", "marketing",
    "growth", "core", "work", "contact", "email", "phone", "about", "synopsis", "india", "sales",
    "technical", "career", "personal", "details", "the", "and", "of", "for", "with",
    "university", "college", "institute", "institution", "technological", "technology", "school",
    "academy", "academic", "qualifications", "qualification", "major", "engineering", "bachelor",
    "master", "science", "achievements", "scholastic", "research", "publications", "company",
    "private", "limited", "pvt", "ltd", "portfolio", "linkedin", "github", "website", "mobile",
  ].map((w) => w.toLowerCase()),
);

function has(re: RegExp, s: string): boolean {
  return new RegExp(re.source, re.flags.replace("g", "")).test(s);
}

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

function isYearList(raw: string): boolean {
  return /^(?:(?:19|20)\d{2}[\s.\-–]*){2,}$/.test(raw.trim());
}

/** Phone numbers: 10–13 digits, not a year range, not a plain number with commas. */
export function findPhones(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PHONE_CANDIDATE_RE)) {
    const raw = m[0].trim();
    const d = digitsOf(raw);
    if (isYearList(raw) || /,/.test(raw)) continue;
    if (d.length > 13) {
      // PDF extraction sometimes glues a number to itself ("98222 3941598222 3941"): take the first well-formed one.
      const inner = raw.match(/(?:\+\s?\d{1,3}[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}/);
      if (inner) out.push(inner[0].trim());
      continue;
    }
    if (d.length < 10) continue;
    // Indian mobiles start 6–9 after the country code; landlines carry an area code in parens or a leading 0.
    const local = d.length > 10 ? d.slice(-10) : d;
    if (!/^[6-9]/.test(local) && !/^0|\(/.test(raw) && !raw.startsWith("+")) continue;
    out.push(raw);
  }
  return out;
}

/** Any run of 10+ digits joined only by spaces, dots, dashes or brackets — redacted and blocked regardless of shape. */
export function findDigitRuns(text: string): string[] {
  return [...text.matchAll(PHONE_CANDIDATE_RE)]
    .map((m) => m[0].trim())
    .filter((raw) => digitsOf(raw).length >= 10 && !/,/.test(raw) && !isYearList(raw));
}

export function findEmails(text: string): string[] {
  return [...text.matchAll(EMAIL_RE)].map((m) => m[0]);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const FILE_NOISE = new Set(["cv", "resume", "final", "updated", "new", "copy", "latest", "draft", "doc", "document", "file", "my", "pm", "spm", "application", "apm"]);

/** "pm_01_priya_krishnan.pdf" → "Priya Krishnan"; "07_aditya_nair.pdf" → "Aditya Nair"; "cv.pdf" → null. */
export function nameFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const words = base
    .replace(/[_\-.()\[\]]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && !FILE_NOISE.has(w.toLowerCase()));
  if (words.length < 2 || words.length > 4) return null;
  if (!words.every((w) => /^[A-Za-z']{2,}$/.test(w))) return null;
  if (words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase()))) return null;
  return titleCase(words.join(" "));
}

function looksLikeName(line: string): boolean {
  const s = line.trim();
  if (!/^[A-Za-z][A-Za-z.' ]{2,50}$/.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase().replace(/\.$/, "")))) return false;
  // Names are Title Case or ALL CAPS.
  return words.every((w) => /^[A-Z][a-z.']+$/.test(w) || /^[A-Z.']+$/.test(w));
}

function stripContact(line: string): string {
  return line.replace(EMAIL_RE, " ").replace(URL_RE, " ").replace(/[|·•,;⋄—–]/g, " ").replace(/\s+/g, " ").trim();
}

function findName(lines: string[], filename: string): { name: string | null; source: "cv" | "filename" | null } {
  const fromFile = nameFromFilename(filename);
  const fileTokens = new Set((fromFile ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  for (const line of lines.slice(0, HEADER_LINES)) {
    let candidate = stripContact(line);
    for (const p of findPhones(candidate)) candidate = candidate.replace(p, " ").trim();
    candidate = candidate.replace(CITY_RE, "").replace(/\s+/g, " ").trim();
    if (!looksLikeName(candidate)) continue;
    // When the filename carries a name, a header "name" that shares nothing with it is a heading, not a person.
    if (fileTokens.size > 0 && !candidate.toLowerCase().split(/\s+/).some((w) => fileTokens.has(w))) continue;
    return { name: titleCase(candidate), source: "cv" };
  }
  return fromFile ? { name: fromFile, source: "filename" } : { name: null, source: null };
}

/** PDFs sometimes glue the surname onto the email ("Reddysquad_5@…"): drop a leading name token. */
function cleanEmail(email: string, tokens: string[]): string {
  if (!/^[A-Z]/.test(email)) return email.toLowerCase();
  for (const t of tokens) {
    if (t.includes(" ")) continue;
    if (email.toLowerCase().startsWith(t.toLowerCase()) && email.indexOf("@") > t.length) {
      return email.slice(t.length).toLowerCase();
    }
  }
  return email.toLowerCase();
}

const CONTACT_WORDS_RE =
  /\b(?:india|maharashtra|karnataka|tamil nadu|kerala|gujarat|haryana|telangana|delhi|ncr|mh|ka|linkedin|github|portfolio|website|e-?mail|phone|mobile|mob(?:\.| no)?|tel|contact|my work|address)\b/gi;

/** A header line made only of contact data, place names and separators. */
function isContactLine(line: string): boolean {
  if (line.trim().length === 0) return false;
  if (has(EMAIL_RE, line) || findPhones(line).length > 0 || has(URL_RE, line) || CONTACT_LABEL_RE.test(line)) return true;
  const hadSignal = CITY_RE.test(line) || new RegExp(CONTACT_WORDS_RE.source, "i").test(line) || /^[\s|·•⋄—–,:/]+$/.test(line);
  const residue = line
    .replace(new RegExp(CITY_RE.source, "gi"), " ")
    .replace(CONTACT_WORDS_RE, " ")
    .replace(/[\s|·•⋄—–,:;/()\-]+/g, "");
  return hadSignal && residue.length === 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headerNameLines(lines: string[]): string[] {
  return lines
    .slice(0, HEADER_LINES)
    .map((l) => stripContact(l).replace(CITY_RE, "").replace(/\s+/g, " ").trim())
    .filter(looksLikeName);
}

function nameTokens(name: string | null, filename: string, extra: string[] = []): string[] {
  const tokens = new Set<string>();
  for (const n of [name, nameFromFilename(filename), ...extra]) {
    if (!n) continue;
    tokens.add(n);
    for (const part of n.split(/\s+/)) if (part.replace(/\./g, "").length >= 3) tokens.add(part);
  }
  // Longest first so the full name is replaced before its parts.
  return [...tokens].sort((a, b) => b.length - a.length);
}

export function assessLocation(rawText: string): { status: LocationStatus; basis: string; city: string | null } {
  const text = rawText.replace(/\s+/g, " ");
  const header = rawText.split("\n").slice(0, HEADER_LINES).join(" ");

  if (/\b(?:not|unable|un(?:willing|able))\s+(?:open\s+)?to\s+relocat|\bremote[- ]only\b|\bonly\s+remote\b/i.test(text)) {
    return { status: "Not aligned", basis: "CV states the candidate is not open to relocating or wants remote-only work.", city: header.match(CITY_RE)?.[1] ?? null };
  }
  const reloc = text.match(/\b(?:open|willing|ready|happy|looking)\s+to\s+relocat\w*(?:\s+to\s+(\w+))?|\brelocating\s+to\s+(\w+)|\bopen\s+to\s+relocation\b/i);
  const headerCity = header.match(CITY_RE)?.[1] ?? null;
  if (MUMBAI_RE.test(header)) {
    return { status: "Mumbai", basis: `CV header lists ${header.match(MUMBAI_RE)![0]}.`, city: header.match(MUMBAI_RE)![0] };
  }
  if (reloc) {
    return { status: "Willing to relocate", basis: `CV says: "${reloc[0]}".`, city: headerCity };
  }
  if (headerCity) {
    return { status: "Relocation unclear", basis: `Based in ${headerCity}; the CV does not mention relocating.`, city: headerCity };
  }
  return { status: "Relocation unclear", basis: "The CV does not state a location.", city: null };
}

/**
 * Separate PII from the CV and return text that is safe to send to a model.
 * Fails closed: if an email or phone number survives redaction, throw.
 */
export function anonymise(rawText: string, filename: string): AnonymiseResult {
  const text = rawText.replace(/\r/g, "").replace(/ /g, " ");
  const lines = text.split("\n");

  const emails = findEmails(text);
  const phones = findPhones(text);
  const { name, source } = findName(lines, filename);
  const location = assessLocation(text);

  let out = text;

  // 1. Personal characteristics and street addresses: whole lines go.
  out = out.replace(PERSONAL_LINE_RE, "").replace(ADDRESS_LINE_RE, "[address removed]");

  // 2. Header contact lines (first lines carrying contact data) are replaced wholesale — they hold city, phone, links.
  const outLines = out.split("\n");
  for (let i = 0; i < Math.min(HEADER_LINES, outLines.length); i++) {
    if (isContactLine(outLines[i])) outLines[i] = "[contact details removed]";
  }
  out = outLines.join("\n");

  // 3. Anywhere else in the document.
  out = out.replace(EMAIL_RE, "[email removed]").replace(URL_RE, "[link removed]");
  for (const p of findDigitRuns(out)) out = out.split(p).join("[phone removed]");
  // Name tokens are removed wherever they appear in name-like casing — including glued
  // extraction artefacts such as "NAIRAditya" — but not inside ordinary lowercase words.
  const tokens = nameTokens(name, filename, headerNameLines(lines));
  for (const token of tokens) {
    out = out.replace(new RegExp(escapeRe(token), "gi"), (m: string, offset: number, whole: string) => {
      const before = whole[offset - 1] ?? " ";
      const after = whole[offset + m.length] ?? " ";
      const after2 = whole[offset + m.length + 1] ?? " ";
      const isLetter = (c: string) => /[A-Za-z]/.test(c);
      const isUpper = (c: string) => /[A-Z]/.test(c);
      const isLower = (c: string) => /[a-z]/.test(c);
      // A standalone word is always redacted, whatever its case.
      if (!isLetter(before) && !isLetter(after)) return "[candidate]";
      // Glued to other letters: only at a visible case boundary, e.g. "NAIR|Aditya" or "…x|Rao".
      const titled = isUpper(m[0]) && isLower(m[1] ?? "");
      const leftOk = !isLetter(before) || (isUpper(m[0]) && (isLower(before) || (isUpper(before) && titled)));
      const rightOk = !isLetter(after) || (isUpper(after) && isLower(after2));
      return leftOk && rightOk ? "[candidate]" : m;
    });
  }
  out = out
    .replace(/(?:\[contact details removed\]\s*\n\s*){2,}/g, "[contact details removed]\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 4. Fail closed.
  if (findEmails(out).length > 0 || findDigitRuns(out).length > 0 || has(URL_RE, out)) {
    throw new AnonymisationError("Contact details survived redaction; this CV was not sent for scoring.");
  }
  for (const token of tokens) {
    if (new RegExp(`(?<![a-z])${escapeRe(token)}(?![a-z])`, "i").test(out)) {
      throw new AnonymisationError("The candidate's name survived redaction; this CV was not sent for scoring.");
    }
  }

  return {
    pii: {
      candidate_name: name,
      name_source: source,
      candidate_email: emails[0] ? cleanEmail(emails[0], nameTokens(name, filename)) : null,
      candidate_phone: phones[0] ? phones[0].replace(/\s+/g, " ").trim() : null,
      candidate_location: location.city,
    },
    anonymisedText: out,
    location: { status: location.status, basis: location.basis },
  };
}
