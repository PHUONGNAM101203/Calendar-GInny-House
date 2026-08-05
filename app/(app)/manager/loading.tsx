import { Skeleton } from "@/components/ui/skeleton";

export default function ManagerLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="mb-4 h-9 w-80 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-40 rounded-xl" />
    </div>
  );
}
