import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-8">
      <h1 className="text-xl font-semibold">This candidate doesn’t exist.</h1>
      <p className="mt-2 text-md text-ink-2">The link may be old, or the record was removed.</p>
      <Link href="/" className="mt-5 inline-block text-base underline decoration-rule-strong hover:decoration-ink">Back to candidates</Link>
    </div>
  );
}
