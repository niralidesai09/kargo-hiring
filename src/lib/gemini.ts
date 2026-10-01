import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { log } from "./log";

export class ModelError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface JsonModel {
  generateJson<T>(req: {
    label: string;
    system: string;
    prompt: string;
    jsonSchema: object;
    validator: z.ZodType<T>;
  }): Promise<T>;
}

const DEFAULT_MODEL = "gemini-flash-latest";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 60_000;
const BASE_SEED = 20260930;
// Bounded reasoning keeps every call well inside the timeout; scoring needs judgement, not long deliberation.
const THINKING_BUDGET = 2048;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

/** Google returns "retryDelay": "17s" inside 429 bodies. Honour it, capped. */
function retryDelayMs(err: unknown, attempt: number): number {
  const msg = String((err as Error)?.message ?? "");
  const m = msg.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/);
  if (m) return Math.min(Number(m[1]) * 1000 + 500, 45_000);
  return Math.min(2000 * 2 ** attempt, 20_000);
}

export function createGeminiModel(apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || DEFAULT_MODEL): JsonModel {
  if (!apiKey) throw new ModelError("GEMINI_API_KEY is not configured on the server.");
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateJson<T>({ label, system, prompt, jsonSchema, validator }: {
      label: string;
      system: string;
      prompt: string;
      jsonSchema: object;
      validator: z.ZodType<T>;
    }): Promise<T> {
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
              systemInstruction: system,
              temperature: 0,
              topP: 1,
              // Fixed seed: same CV + same rubric → the same judgement. A retry uses a new seed so a
              // generation that timed out isn't replayed exactly.
              seed: BASE_SEED + attempt,
              thinkingConfig: { thinkingBudget: THINKING_BUDGET },
              responseMimeType: "application/json",
              responseJsonSchema: jsonSchema,
              abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            },
          });
          const text = res.text;
          if (!text) throw new ModelError(`${label}: the model returned an empty response.`, true);
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new ModelError(`${label}: the model returned malformed JSON.`, true);
          }
          const result = validator.safeParse(parsed);
          if (!result.success) {
            throw new ModelError(`${label}: the model's JSON did not match the expected shape (${result.error.issues[0]?.path.join(".")}: ${result.error.issues[0]?.message}).`, true);
          }
          return result.data;
        } catch (err) {
          lastError = err;
          const status = statusOf(err);
          const retryable =
            (err instanceof ModelError && err.retryable) ||
            status === 429 || status === 500 || status === 502 || status === 503 || status === 504 ||
            (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError" ||
            /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(String((err as Error)?.message));
          log.warn("gemini.attempt_failed", {
            label, attempt, status: statusOf(err) ?? null, name: (err as Error)?.name ?? null,
            message: String((err as Error)?.message ?? "").slice(0, 160),
          });
          if (!retryable || attempt === MAX_ATTEMPTS - 1) break;
          await sleep(retryDelayMs(err, attempt));
        }
      }
      throw toModelError(label, lastError);
    },
  };
}

function toModelError(label: string, err: unknown): ModelError {
  if (err instanceof ModelError) return err;
  const status = statusOf(err);
  if (status === 400) return new ModelError(`${label}: Gemini rejected the request (400). Check GEMINI_MODEL.`);
  if (status === 401 || status === 403) return new ModelError(`${label}: Gemini rejected the API key (${status}).`);
  if (status === 404) return new ModelError(`${label}: the configured Gemini model was not found. Set GEMINI_MODEL.`);
  if (status === 429) return new ModelError(`${label}: Gemini rate limit reached. Retry in a minute.`, true);
  if ((err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError") return new ModelError(`${label}: Gemini did not respond in time.`, true);
  return new ModelError(`${label}: Gemini request failed${status ? ` (${status})` : ""}.`, true);
}
