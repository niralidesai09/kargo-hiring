import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { extractText } from "@/lib/extract";
import { anonymise, findDigitRuns, findEmails } from "@/lib/pii";

/**
 * Opt-in sweep over the full case corpus: CV_CORPUS_DIR=../data/resumes_ npx vitest run tests/corpus.test.ts
 * Every CV must anonymise without leaking its name, email, phone or links.
 */
const dir = process.env.CV_CORPUS_DIR;

describe.skipIf(!dir)("case corpus", () => {
  const files = dir ? fs.readdirSync(dir).filter((f) => /\.(pdf|docx)$/i.test(f)).sort() : [];
  it.each(files)("%s", async (f) => {
    const raw = await extractText(new Uint8Array(fs.readFileSync(`${dir}/${f}`)), f.endsWith(".pdf") ? "pdf" : "docx");
    const { pii, anonymisedText } = anonymise(raw, f);
    expect(pii.candidate_name).toBeTruthy();
    expect(findEmails(anonymisedText)).toEqual([]);
    expect(findDigitRuns(anonymisedText)).toEqual([]);
    expect(anonymisedText).not.toMatch(/linkedin\.com|github\.com|https?:\/\//i);
    for (const part of pii.candidate_name!.split(" ")) {
      expect(anonymisedText).not.toMatch(new RegExp(`(?<![A-Za-z])${part}(?![a-z])`));
    }
    expect(anonymisedText.length).toBeGreaterThan(raw.length * 0.8);
  });
});
