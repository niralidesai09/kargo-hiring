"use client";

import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from "react";

/* ------------------------------------------------------------------------- */
/* Button                                                                     */
/* ------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover border border-transparent",
  secondary: "bg-sheet text-ink border border-rule-strong hover:bg-sheet-2 hover:border-ink-4",
  ghost: "text-ink-2 hover:text-ink hover:bg-sheet-3 border border-transparent",
  danger: "bg-sheet text-bad border border-rule-strong hover:border-bad hover:bg-bad-wash",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5",
  md: "h-9 px-3.5 text-base gap-2",
};

/** Button styling for links that navigate (never nest a <button> in an <a>). */
export function buttonClasses(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return clsx(
    "inline-flex select-none items-center justify-center whitespace-nowrap rounded-[var(--radius)] font-medium",
    "transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-45",
    variants[variant],
    sizes[size],
    className,
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------------- */
/* Stamp — status as an ink stamp: a word in a hairline box.                   */
/* ------------------------------------------------------------------------- */

export type StampTone = "neutral" | "accent" | "ok" | "warn" | "bad" | "muted";
const tones: Record<StampTone, string> = {
  neutral: "text-ink-2 border-rule-strong",
  accent: "text-accent border-accent/40 bg-accent-wash",
  ok: "text-ok border-ok/35 bg-ok-wash",
  warn: "text-warn border-warn/35 bg-warn-wash",
  bad: "text-bad border-bad/35 bg-bad-wash",
  muted: "text-ink-3 border-dashed border-rule-strong",
};

export function Stamp({ tone = "neutral", children, className }: { tone?: StampTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center rounded-[var(--radius-sm)] border px-1.5 text-2xs font-semibold uppercase tracking-[0.06em] whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* Score visuals — they reinforce a number, they never replace it.            */
/* ------------------------------------------------------------------------- */

/** Five ticks for a 0–5 criterion score. */
export function ScoreTicks({ score, className }: { score: number; className?: string }) {
  return (
    <span aria-hidden className={clsx("inline-flex gap-[3px]", className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={clsx("h-2.5 w-[7px] rounded-[1px]", i <= score ? "bg-ink" : "bg-rule-strong/70")} />
      ))}
    </span>
  );
}

/** Thin 0–100 rule under a score. */
export function ScoreRule({ value, className }: { value: number; className?: string }) {
  return (
    <span aria-hidden className={clsx("block h-[3px] w-12 overflow-hidden rounded-full bg-rule", className)}>
      <span className="block h-full rounded-full bg-ink-3" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function formatScore(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/* ------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* ------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  value, onChange, options, label, size = "md", disabled,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; hint?: string }[];
  label: string;
  size?: Size;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx("inline-flex rounded-[var(--radius)] border border-rule-strong bg-sheet p-0.5", disabled && "opacity-50")}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.hint}
            disabled={disabled}
            tabIndex={selected || (idx === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next = (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
              refs.current[next]?.focus();
              onChange(options[next].value);
            }}
            className={clsx(
              "rounded-[calc(var(--radius)-2px)] font-medium transition-colors duration-[var(--dur-fast)]",
              size === "sm" ? "h-6 px-2 text-sm" : "h-8 px-3 text-base",
              selected ? "bg-ink text-sheet" : "text-ink-2 hover:bg-sheet-3 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Dialog — native <dialog> for focus trapping and Escape.                    */
/* ------------------------------------------------------------------------- */

export function Dialog({
  open, onClose, title, children, footer, labelledBy = "dialog-title",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-rule bg-sheet p-0 text-ink shadow-pop"
    >
      <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
        <h2 id={labelledBy} className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="-m-1 rounded p-1 text-ink-3 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-sheet-2 px-5 py-3">{footer}</div>
    </dialog>
  );
}

/* ------------------------------------------------------------------------- */
/* Toast                                                                      */
/* ------------------------------------------------------------------------- */

type ToastItem = { id: number; message: string; tone: "ok" | "bad" | "neutral" };
const ToastCtx = createContext<(message: string, tone?: ToastItem["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem["tone"] = "neutral") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "bad" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto max-w-md rounded-[var(--radius)] border bg-sheet px-3.5 py-2.5 text-base shadow-pop",
              "animate-[toast-in_var(--dur)_var(--ease-out)]",
              t.tone === "bad" ? "border-bad/40 text-bad" : t.tone === "ok" ? "border-ok/40 text-ink" : "border-rule text-ink",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ------------------------------------------------------------------------- */
/* Skeleton / Empty                                                           */
/* ------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("block animate-pulse rounded-[var(--radius-sm)] bg-sheet-3", className)} />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-6 py-14 sm:items-center sm:text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-md text-ink-2">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
