import { CandidateBoard } from "@/components/candidate-board";
import { SetupNotice } from "@/components/setup-notice";
import { ConfigError } from "@/lib/db";
import { listCandidates } from "@/lib/queries";

export default async function HiringPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const role = sp.role === "pm" || sp.role === "spm" ? sp.role : null;
  let items;
  let setupProblem: string | null = null;
  try {
    items = await listCandidates();
  } catch (err) {
    if (err instanceof ConfigError) setupProblem = err.message;
    else if (/relation .* does not exist|schema cache|Could not find the table/i.test((err as Error).message)) {
      setupProblem = "The database tables don’t exist yet. Apply the schema and rubric seed.";
    } else throw err;
  }
  if (setupProblem || !items) return <SetupNotice problem={setupProblem ?? "Candidates couldn’t be loaded."} />;
  return <CandidateBoard items={items} role={role} />;
}
