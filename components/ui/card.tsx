import { cn } from "@/lib/utils"

export function Card({
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border p-6 transition-all duration-200", className)}
      style={{
        boxShadow: 'var(--shadow-md)',
        backgroundColor: "var(--theme-card-bg)",
        borderColor: "var(--theme-surface-border)",
        color: "var(--theme-card-text)",
        ...style,
      }}
      {...props}
    />
  )
}
