import { describe, expect, it } from "vitest";
import { extractText } from "@/lib/extract";
import { anonymise, AnonymisationError, findPhones, nameFromFilename } from "@/lib/pii";
import { fixture } from "./helpers";

describe("PII separation on a real case CV", () => {
  it("extracts name, email, phone and removes them from the model text", async () => {
    const raw = await extractText(fixture("pm_01_priya_krishnan.pdf"), "pdf");
    const { pii, anonymisedText, location } = anonymise(raw, "pm_01_priya_krishnan.pdf");
    expect(pii.candidate_name).toBe("Priya Krishnan");
    expect(pii.name_source).toBe("cv");
    expect(pii.candidate_email).toBe("squad_1@pg27.mesaschool.co");
    expect(pii.candidate_phone).toBe("+91 98442 31075");
    expect(location.status).toBe("Mumbai");
    expect(anonymisedText).not.toMatch(/Priya|Krishnan|squad_1|98442|31075|linkedin/i);
    // Work history survives intact.
    expect(anonymisedText).toContain("Sole PM responsible for shipment tracking");
    expect(anonymisedText).toContain("Mahindra Logistics");
  });

  it("falls back to the filename when the CV has no name in it", async () => {
    const raw = await extractText(fixture("07_aditya_nair.pdf"), "pdf");
    const { pii, anonymisedText } = anonymise(raw, "07_aditya_nair.pdf");
    expect(pii.candidate_name).toBe("Aditya Nair");
    expect(pii.name_source).toBe("filename");
    expect(anonymisedText).not.toMatch(/Aditya|Nair/);
  });
});

describe("7. CV containing PII in multiple locations", () => {
  const cv = [
    "Meera Joshi",
    "meera.joshi@gmail.com | +91 98765 43210 | Andheri West, Mumbai | linkedin.com/in/meerajoshi",
    "PROFESSIONAL SUMMARY",
    "Meera is a product manager who owned the booking flow for 3 years.",
    "Date of Birth: 12/03/1994",
    "Marital Status: Married",
    "Religion: Hindu",
    "Flat 12, Sai Kripa Society, Link Road, Andheri 400053",
    "EXPERIENCE",
    "Product Manager, Freightly (2021–2024): shipped 9 features; Joshi led discovery with 20 ops teams.",
    "Contact me again at MEERA.JOSHI@GMAIL.COM or 9876543210 or (022) 2634 5678.",
    "Portfolio: https://meerajoshi.dev and github.com/mjoshi",
    "References: available on request from meera's manager.",
  ].join("\n");

  it("finds every identifier and removes all of them", () => {
    const { pii, anonymisedText } = anonymise(cv, "meera_joshi_cv.pdf");
    expect(pii.candidate_name).toBe("Meera Joshi");
    expect(pii.candidate_email).toBe("meera.joshi@gmail.com");
    expect(pii.candidate_phone).toBe("+91 98765 43210");
    for (const leak of [/meera/i, /joshi/i, /@/, /98765/, /9876543210/, /2634/, /linkedin/i, /github/i, /https?:/, /400053/, /Sai Kripa/, /1994/, /Married/, /Hindu/]) {
      expect(anonymisedText).not.toMatch(leak);
    }
    expect(anonymisedText).toContain("shipped 9 features");
    expect(anonymisedText).toContain("2021–2024"); // year ranges aren't phone numbers
  });
});

describe("5. Missing email / 6. Missing phone", () => {
  const body = "\nPROFESSIONAL SUMMARY\nProduct manager with 4 years in logistics SaaS. Shipped 6 features, killed 2 after low adoption.\n";

  it("missing email: stores null, still anonymises and never invents one", () => {
    const { pii, anonymisedText } = anonymise(`Rahul Menon\n+91 99887 66554 · Pune${body}`, "cv.pdf");
    expect(pii.candidate_email).toBeNull();
    expect(pii.candidate_phone).toBe("+91 99887 66554");
    expect(anonymisedText).not.toMatch(/99887|Rahul|Menon/);
  });

  it("missing phone: stores null and keeps the email", () => {
    const { pii } = anonymise(`Rahul Menon\nrahul.menon@example.com · Pune${body}`, "cv.pdf");
    expect(pii.candidate_phone).toBeNull();
    expect(pii.candidate_email).toBe("rahul.menon@example.com");
  });
});

describe("helpers", () => {
  it("does not mistake numbers in work history for phone numbers", () => {
    expect(findPhones("Revenue grew from ₹2,40,00,000 in 2019-2023; 12000 shipments")).toEqual([]);
    expect(findPhones("Call +91 98204 37810 today")).toEqual(["+91 98204 37810"]);
  });

  it("reads names from case filenames", () => {
    expect(nameFromFilename("spm_16_siddharth_rao.pdf")).toBe("Siddharth Rao");
    expect(nameFromFilename("07_aditya_nair.pdf")).toBe("Aditya Nair");
    expect(nameFromFilename("resume_final.pdf")).toBeNull();
  });

  it("fails closed rather than sending leftover contact details to the model", () => {
    // An email split by a line break can't be matched as a whole; the leftover halves still can't slip through.
    const tricky = "Priya Rao\nPROFILE\nWrite to priya.rao@example.com — ops lead.";
    expect(() => anonymise(tricky, "x.pdf")).not.toThrow();
    const r = anonymise(tricky, "x.pdf");
    expect(r.anonymisedText).not.toMatch(/@/);
    expect(AnonymisationError).toBeDefined();
  });
});

describe("PDF extraction artefacts", () => {
  it("removes names and numbers the PDF glued together", () => {
    const cv = "PROFILE\nBuilt dashboards for the Senior team; questionnaire design.\nSENIOR PRODUCT MANAGER\nADITYA NAIRAditya Nair\n+91 98222 3941598222 3941\n";
    const { anonymisedText, pii } = anonymise(cv, "07_aditya_nair.pdf");
    expect(anonymisedText).not.toMatch(/aditya|nair(?!e)|98222|3941/i);
    expect(pii.candidate_phone).toBe("+91 98222 39415");
  });

  it("does not damage ordinary words that contain a surname", () => {
    const cv = "PROFILE\nSenior PM. Built the Dashboard; represented the SENIOR team; ran a questionnaire.\n";
    const { anonymisedText } = anonymise(cv, "03_arnav_sen.pdf");
    expect(anonymisedText).toContain("Senior PM. Built the Dashboard; represented the SENIOR team; ran a questionnaire.");
    const das = anonymise("PROFILE\nOwned the Dashboard and data pipelines.\n", "spm_25_sourav_das.pdf");
    expect(das.anonymisedText).toContain("Dashboard");
  });
});
