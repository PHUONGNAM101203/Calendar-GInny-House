import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r px-4 py-5 lg:flex">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-56 w-full rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
      </aside>
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="flex-1" />
      </div>
    </div>
  );
}
