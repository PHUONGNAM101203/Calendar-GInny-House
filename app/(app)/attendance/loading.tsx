import { Skeleton } from "@/components/ui/skeleton";

export default function AttendanceLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-20 rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}
