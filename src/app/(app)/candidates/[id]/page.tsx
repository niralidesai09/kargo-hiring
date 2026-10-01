import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Docket } from "@/components/docket";
import { UUID_RE } from "@/lib/api";
import { configStatus, getCandidateDetail } from "@/lib/queries";

export const metadata: Metadata = { title: "Candidate" };

export default async function CandidatePage({ params }: PageProps<"/candidates/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const detail = await getCandidateDetail(id);
  if (!detail) notFound();
  const cfg = configStatus();
  return <Docket d={detail} config={{ testRecipient: cfg.testRecipient, sendingConfigured: cfg.resend && Boolean(cfg.from) }} />;
}
