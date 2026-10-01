export type Role = "pm" | "spm";

export const ROLES: Role[] = ["pm", "spm"];

export const ROLE_LABEL: Record<Role, string> = {
  pm: "Product Manager",
  spm: "Senior Product Manager",
};

export const PROCESSING_STATES = [
  "uploaded",
  "extracting",
  "extracted",
  "anonymising",
  "scoring",
  "generating_brief",
  "generating_email",
  "ready_for_review",
  "sending",
  "sent",
  "extraction_failed",
  "scoring_failed",
  "generation_failed",
  "send_failed",
] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

export const FAILED_STATES: ProcessingState[] = [
  "extraction_failed",
  "scoring_failed",
  "generation_failed",
];

export const IN_PROGRESS_STATES: ProcessingState[] = [
  "uploaded",
  "extracting",
  "extracted",
  "anonymising",
  "scoring",
  "generating_brief",
  "generating_email",
];

export type Decision = "review" | "shortlisted" | "hold" | "not_shortlisted";

/** What Arjun sees as the candidate's workflow status. Always derived, never set by AI. */
export type WorkflowStatus =
  | "processing"
  | "failed"
  | "review"
  | "shortlisted"
  | "hold"
  | "not_shortlisted"
  | "email_ready"
  | "sent";

export type EmailType = "interview" | "rejection";

export type LocationStatus =
  | "Mumbai"
  | "Willing to relocate"
  | "Relocation unclear"
  | "Not aligned";

export type RoleMatch = "Strong" | "Partial" | "Unclear";

export interface Eligibility {
  location_status: LocationStatus;
  location_basis: string;
  role_match: RoleMatch;
  role_match_basis: string;
  /** Set when Kargo chose the role because the uploader picked "let Kargo decide". */
  role_auto?: boolean;
  role_basis?: string;
}

export interface ScoreAnchors {
  [score: string]: string;
}

export interface RubricCriterion {
  id: string;
  role: Role;
  key: string;
  criterion_name: string;
  short_label: string;
  description: string;
  weight: number;
  score_anchors: ScoreAnchors;
  position: number;
  rubric_version: string;
}

/** One criterion as returned by the model: no weights, no totals. */
export interface ModelCriterionScore {
  criterion: string;
  score: number;
  evidence: string;
  reason: string;
}

export interface ScoredCriterion {
  criterion_id: string;
  key: string;
  criterion_name: string;
  short_label: string;
  score: number;
  weight: number;
  weighted_score: number;
  evidence: string;
  evidence_verified: boolean;
  reason: string;
}

export interface RoleScore {
  role: Role;
  overall: number;
  criteria: ScoredCriterion[];
}

export interface InterviewBriefParts {
  why: string;
  strongest_evidence: string;
  probe: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface EmailDrafts {
  interview: EmailDraft;
  rejection: EmailDraft;
}
