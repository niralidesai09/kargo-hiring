/**
 * Structured logging that only ever carries ids, stages and error messages.
 * Never pass names, emails, phone numbers, CV text or API keys to it.
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

const SECRET_RE = /(?:AIza[0-9A-Za-z_-]{20,}|re_[0-9A-Za-z_]{16,}|eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+|sk_[0-9A-Za-z]{16,})/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function scrub(v: Fields[string]) {
  return typeof v === "string" ? v.replace(SECRET_RE, "[redacted-key]").replace(EMAIL_RE, "[redacted-email]") : v;
}

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const safe: Fields = {};
  for (const [k, v] of Object.entries(fields)) safe[k] = scrub(v);
  const line = JSON.stringify({ level, event, ...safe, at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (process.env.NODE_ENV !== "test") console.log(line);
}

export const log = {
  info: (e: string, f?: Fields) => emit("info", e, f),
  warn: (e: string, f?: Fields) => emit("warn", e, f),
  error: (e: string, f?: Fields) => emit("error", e, f),
};
