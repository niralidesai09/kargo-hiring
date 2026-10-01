// Bulk-screen a folder of CVs through the running app's own API (same path as the upload page).
//
//   npm run import:cvs -- ../data/resumes_                   # pm_/spm_ files only
//   npm run import:cvs -- ../data/resumes_ --default-role pm # unprefixed files as PM
//   APP_URL=https://your-app.vercel.app npm run import:cvs -- ./cvs --limit 3
//
// Files named pm_… or spm_… use that role. Others need --default-role or are skipped.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const defaultRole = flag("default-role");
const limit = Number(flag("limit") ?? Infinity);
const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CONCURRENCY = Number(flag("concurrency") ?? 2);

if (!dir || !fs.existsSync(dir)) {
  console.error("Usage: npm run import:cvs -- <folder> [--default-role pm|spm] [--limit N]");
  process.exit(1);
}

let cookie = "";
if (process.env.APP_PASSWORD) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  if (!res.ok) {
    console.error(`Sign-in failed (${res.status}).`);
    process.exit(1);
  }
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /\.(pdf|docx)$/i.test(f))
  .sort()
  .map((f) => ({ f, role: /^spm[_\-]/i.test(f) ? "spm" : /^pm[_\-]/i.test(f) ? "pm" : defaultRole }))
  .filter((x) => {
    if (!x.role) console.log(`skip  ${x.f} (no role: pass --default-role)`);
    return Boolean(x.role);
  })
  .slice(0, limit);

let ok = 0;
let failed = 0;
async function one({ f, role }) {
  const form = new FormData();
  const bytes = fs.readFileSync(path.join(dir, f));
  form.set("file", new File([bytes], f, { type: f.endsWith(".pdf") ? "application/pdf" : "application/octet-stream" }));
  form.set("role", role);
  const up = await fetch(`${base}/api/candidates`, { method: "POST", body: form, headers: { cookie } });
  const upBody = await up.json().catch(() => ({}));
  if (!up.ok) {
    failed++;
    return console.log(`fail  ${f}: ${upBody.error ?? up.status}`);
  }
  const t0 = Date.now();
  const pr = await fetch(`${base}/api/candidates/${upBody.id}/process`, { method: "POST", headers: { cookie } });
  const prBody = await pr.json().catch(() => ({}));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (pr.ok && prBody.ok) {
    ok++;
    console.log(`ok    ${f} → ${role.toUpperCase()} (${secs}s)`);
  } else {
    failed++;
    console.log(`fail  ${f}: ${prBody.status ?? pr.status} ${prBody.error ?? ""}`);
  }
}

const queue = [...files];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await one(queue.shift());
}));
console.log(`\n${ok} screened, ${failed} failed, ${files.length} total.`);
