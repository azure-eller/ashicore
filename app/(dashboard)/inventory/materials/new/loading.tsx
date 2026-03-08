import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

function FieldSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-3xl">
        <Card className="w-full">
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-6">
            <FieldSkeleton />
            <div className="grid grid-cols-2 gap-4">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <FieldSkeleton />
            <Skeleton className="h-px w-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-72" />
              <div className="grid grid-cols-2 gap-4 pt-2">
                <FieldSkeleton />
                <FieldSkeleton />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-3">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
