import type { ReactNode } from "react"

/** The page heading of a signed-out page: Fraunces title (a public brand moment) and a muted line. */
export function AuthHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-2xl font-semibold text-fg">{title}</h1>
      {description != null && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
    </div>
  )
}
