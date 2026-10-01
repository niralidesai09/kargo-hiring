export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type CvKind = "pdf" | "docx";

export class FileValidationError extends Error {}
export class ExtractionError extends Error {}

export const MIME: Record<CvKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Decide the file type from its bytes, not its name. */
export function detectKind(bytes: Uint8Array, filename: string): CvKind {
  if (bytes.byteLength === 0) throw new FileValidationError("The file is empty.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileValidationError("The file is larger than 5 MB.");
  const head = String.fromCharCode(...bytes.slice(0, 5));
  const ext = filename.toLowerCase().split(".").pop();
  if (head === "%PDF-") return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && ext === "docx") return "docx";
  if (ext === "doc") throw new FileValidationError("Legacy .doc files aren't supported. Save it as PDF or DOCX.");
  throw new FileValidationError("Only PDF or DOCX files can be screened.");
}

const MIN_TEXT_CHARS = 200;

export async function extractText(bytes: Uint8Array, kind: CvKind): Promise<string> {
  let text = "";
  try {
    if (kind === "pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
      const result = await pdfText(pdf, { mergePages: true });
      text = result.text;
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = result.value;
    }
  } catch {
    throw new ExtractionError("The document may be corrupted or password-protected.");
  }
  text = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MIN_TEXT_CHARS) {
    throw new ExtractionError("Almost no text could be read. It may be a scanned image rather than a text document.");
  }
  return text;
}
