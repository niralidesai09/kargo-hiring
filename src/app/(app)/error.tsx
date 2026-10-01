"use client";

import { Button } from "@/components/ui";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-8">
      <h1 className="text-xl font-semibold">This page didn’t load.</h1>
      <p className="mt-2 text-md text-ink-2">The database or network may be briefly unavailable. Your data is safe.</p>
      <Button className="mt-5" onClick={reset}>Try again</Button>
    </div>
  );
}
