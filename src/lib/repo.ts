import type {
  Decision,
  Eligibility,
  EmailDrafts,
  EmailType,
  InterviewBriefParts,
  ProcessingState,
  Role,
  RubricCriterion,
} from "./types";

export interface CandidateRow {
  id: string;
  candidate_name: string | null;
  candidate_email: string | null;
  candidate_phone: string | null;
  candidate_location: string | null;
  name_source: "cv" | "filename" | null;
  role_applied: Role;
  original_file_url: string | null;
  original_filename: string | null;
  file_kind: "pdf" | "docx" | null;
  anonymised_cv_text: string | null;
  processing_status: ProcessingState;
  processing_error: string | null;
  decision: Decision;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResultRow {
  id: string;
  candidate_id: string;
  pm_score: number | null;
  spm_score: number | null;
  eligibility_status: Eligibility | null;
  top_strength: string | null;
  main_concern: string | null;
  interview_brief: string | null;
  interview_brief_parts: InterviewBriefParts | null;
  email_type: EmailType | null;
  email_subject: string | null;
  email_body: string | null;
  email_drafts: EmailDrafts | null;
  email_ready: boolean;
  email_sent: boolean;
  sent_at: string | null;
  sent_to: string | null;
  resend_message_id: string | null;
  send_lock_at: string | null;
  last_send_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoreRow {
  candidate_id: string;
  role: Role;
  criterion_id: string;
  score: number;
  evidence: string;
  evidence_verified: boolean;
  reason: string;
  weight: number;
  weighted_score: number;
}

/** Everything the pipeline and the send flow need from storage. */
export interface Repo {
  getRubric(): Promise<RubricCriterion[]>;
  getCandidate(id: string): Promise<CandidateRow | null>;
  updateCandidate(id: string, patch: Partial<CandidateRow>): Promise<void>;
  replaceScores(candidateId: string, rows: ScoreRow[]): Promise<void>;
  getResult(candidateId: string): Promise<ResultRow | null>;
  upsertResult(candidateId: string, patch: Partial<ResultRow>): Promise<void>;
  /** Atomically take the send lock. False if already sent or another send holds a fresh lock. */
  claimSend(candidateId: string, staleBefore: Date): Promise<boolean>;
  downloadFile(path: string): Promise<Uint8Array>;
}
