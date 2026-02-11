import { cn } from "@/lib/utils"

interface ProgressProps {
  className?: string
  value: number
}

function Progress({ className, value }: ProgressProps) {
  const clampedValue = Math.max(0, Math.min(100, value))

  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full bg-primary transition-all"
        style={{ transform: `translateX(-${100 - clampedValue}%)` }}
      />
    </div>
  )
}

export { Progress }
