// Applies supabase/schema.sql and supabase/seed.sql using a direct Postgres connection.
// Needs SUPABASE_DB_URL in .env.local (Supabase → Project Settings → Database → Connection string).
// Alternative with no connection string: paste both files into the Supabase SQL editor.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set. Add it to .env.local, or paste supabase/schema.sql then supabase/seed.sql into the Supabase SQL editor.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const file of ["schema.sql", "seed.sql"]) {
    await client.query(fs.readFileSync(path.join(root, "supabase", file), "utf8"));
    console.log(`Applied supabase/${file}`);
  }
  const { rows } = await client.query("select role, total_weight, criteria from public.rubric_weight_totals order by role");
  for (const r of rows) console.log(`  ${r.role.toUpperCase()}: ${r.criteria} criteria, weights total ${Number(r.total_weight)}%`);
} finally {
  await client.end();
}
