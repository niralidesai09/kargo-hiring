import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-20 pt-5 sm:px-8 lg:pt-7" aria-busy="true" aria-label="Loading candidate">
      <Skeleton className="h-4 w-24" />
      <div className="mt-4 border-b border-rule pb-5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-9 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-56" />
        <Skeleton className="mt-5 h-4 w-[28rem] max-w-full" />
      </div>
      <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        <div className="space-y-4">
          <div className="flex gap-10"><Skeleton className="h-12 w-24" /><Skeleton className="h-12 w-24" /><Skeleton className="h-12 w-60" /></div>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
        <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>
      </div>
    </div>
  );
}
