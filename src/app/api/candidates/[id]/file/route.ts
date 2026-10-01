import { NextResponse } from "next/server";
import { handle, jsonError, UUID_RE } from "@/lib/api";
import { CV_BUCKET, db } from "@/lib/db";

/** Short-lived signed link to the original CV. The bucket itself is private. */
export const GET = handle("file", async (_req: Request, ctx: RouteContext<"/api/candidates/[id]/file">) => {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return jsonError(404, "Candidate not found.");
  const s = db();
  const { data } = await s.from("candidates").select("original_file_url").eq("id", id).maybeSingle();
  if (!data?.original_file_url) return jsonError(404, "The original file isn't available.");
  const signed = await s.storage.from(CV_BUCKET).createSignedUrl(data.original_file_url, 60);
  if (signed.error || !signed.data) return jsonError(502, "Couldn't open the file.");
  return NextResponse.redirect(signed.data.signedUrl);
});
