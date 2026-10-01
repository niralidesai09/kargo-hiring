import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handle, jsonError } from "@/lib/api";
import { CV_BUCKET, db } from "@/lib/db";
import { detectKind, FileValidationError, MIME } from "@/lib/extract";
import type { Role } from "@/lib/types";

/** Store the file and create the candidate. Processing is started separately (POST …/process). */
export const POST = handle("upload", async (request: Request) => {
  const form = await request.formData().catch(() => null);
  if (!form) return jsonError(400, "Send the CV as multipart form data.");
  const file = form.get("file");
  const role = form.get("role");
  if (role !== "pm" && role !== "spm" && role !== "auto") return jsonError(422, "Choose the role this candidate applied for.");
  const auto = role === "auto";
  if (!(file instanceof File)) return jsonError(422, "Attach a CV file.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let kind;
  try {
    kind = detectKind(bytes, file.name);
  } catch (err) {
    if (err instanceof FileValidationError) return jsonError(422, err.message, "invalid_file");
    throw err;
  }

  const s = db();
  const id = randomUUID();
  const path = `${id}.${kind}`; // no names in storage paths
  const up = await s.storage.from(CV_BUCKET).upload(path, bytes, { contentType: MIME[kind], upsert: false });
  if (up.error) return jsonError(502, `Couldn't store the file: ${up.error.message}`);

  const ins = await s.from("candidates").insert({
    id,
    role_applied: (auto ? "pm" : role) as Role, // provisional when auto; the pipeline sets it after scoring
    original_file_url: path,
    original_filename: file.name.slice(0, 200),
    file_kind: kind,
    processing_status: "uploaded",
  });
  if (ins.error) {
    await s.storage.from(CV_BUCKET).remove([path]);
    return jsonError(500, `Couldn't create the candidate: ${ins.error.message}`);
  }
  await s.from("candidate_results").insert({ candidate_id: id, eligibility_status: auto ? { role_auto: true } : null });
  return NextResponse.json({ id }, { status: 201 });
});
