import { describe, expect, it } from "vitest";
import { detectKind, extractText, ExtractionError, FileValidationError, MAX_FILE_BYTES } from "@/lib/extract";
import { fixture, makePdf } from "./helpers";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("8. invalid file", () => {
  it("rejects a plain text file renamed to .pdf", () => {
    expect(() => detectKind(bytes("Name: Test\nExperience: lots"), "cv.pdf")).toThrow(FileValidationError);
  });
  it("rejects empty and oversized files", () => {
    expect(() => detectKind(new Uint8Array(), "cv.pdf")).toThrow(/empty/);
    expect(() => detectKind(new Uint8Array(MAX_FILE_BYTES + 1), "cv.pdf")).toThrow(/5 MB/);
  });
  it("rejects legacy .doc and images", () => {
    expect(() => detectKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "cv.doc")).toThrow(/Legacy/);
    expect(() => detectKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "cv.png")).toThrow(/PDF or DOCX/);
  });
  it("rejects a zip that isn't named .docx", () => {
    expect(() => detectKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "cv.zip")).toThrow(FileValidationError);
  });
  it("reports a corrupted PDF as an extraction failure, not a crash", async () => {
    const corrupt = bytes("%PDF-1.7\n this is not really a pdf \n%%EOF");
    expect(detectKind(corrupt, "cv.pdf")).toBe("pdf");
    await expect(extractText(corrupt, "pdf")).rejects.toThrow(ExtractionError);
  });
  it("reports a PDF with almost no text (e.g. a scan) clearly", async () => {
    await expect(extractText(makePdf(["Scanned page"]), "pdf")).rejects.toThrow(/scanned image/);
  });
});

describe("valid files", () => {
  it("accepts and reads a real case CV", async () => {
    const pdf = fixture("spm_16_siddharth_rao.pdf");
    expect(detectKind(pdf, "spm_16_siddharth_rao.pdf")).toBe("pdf");
    const text = await extractText(pdf, "pdf");
    expect(text).toContain("JNPT container tracking integration");
  });
});
