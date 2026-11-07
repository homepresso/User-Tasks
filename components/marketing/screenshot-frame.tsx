import type { ReactNode } from "react"

/**
 * The one frame every product screenshot on the public site and in the docs
 * sits in (ui-polish-spec §5.16): card radius, elevation 3, a 1px hairline and
 * a 28px fake window bar with three dots. Card thumbnails (landing feature
 * cards) are cropped previews, not screenshots, and don't use it.
 */
export function ScreenshotFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) shadow-elev-3 ${className}`}>
      <div aria-hidden="true" className="flex h-7 items-center gap-1.5 border-b border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand) px-3">
        <span className="size-2.5 rounded-full bg-(color:--mkt-ink)/15" />
        <span className="size-2.5 rounded-full bg-(color:--mkt-ink)/15" />
        <span className="size-2.5 rounded-full bg-(color:--mkt-ink)/15" />
      </div>
      {children}
    </div>
  )
}
