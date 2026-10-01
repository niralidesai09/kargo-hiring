import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-6 sm:px-8 lg:pt-9" aria-busy="true" aria-label="Loading candidates">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-8 flex gap-5 border-b border-rule pb-3">
        {["w-20", "w-24", "w-20", "w-16"].map((w, i) => <Skeleton key={i} className={`h-4 ${w}`} />)}
      </div>
      <div className="mt-8 overflow-hidden rounded-[var(--radius-lg)] border border-rule bg-sheet">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-rule px-5 py-4 last:border-0">
            <Skeleton className="h-4 w-5" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="hidden h-4 w-36 md:block" />
            <Skeleton className="hidden h-4 w-40 lg:block" />
            <Skeleton className="ml-auto h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
