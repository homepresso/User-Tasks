"use client"

import { createContext, useContext, type ReactNode } from "react"
import { isStyled, resolveWidgetStyle, styleCss, type AppStyle, type StyleCss } from "@/lib/apps/style"
import type { AppWidget } from "@/lib/apps/schema"

/**
 * Widget styling at run time (lib/apps/style.ts): the app's style (default +
 * presets) for every widget on the page, and each widget's value colours
 * (charts, badges) for its body. Styles become CSS custom properties on the
 * widget's card / container — components keep reading theme tokens.
 */

const AppStyleContext = createContext<AppStyle | null>(null)
export function AppStyleProvider({ value, children }: { value: AppStyle | null | undefined; children: ReactNode }) {
  return <AppStyleContext.Provider value={value ?? null}>{children}</AppStyleContext.Provider>
}
export const useAppStyle = () => useContext(AppStyleContext)

const ValueColorsContext = createContext<Record<string, string>>({})
export function ValueColorsProvider({ value, children }: { value: Record<string, string>; children: ReactNode }) {
  return <ValueColorsContext.Provider value={value}>{children}</ValueColorsContext.Provider>
}
/** Value → colour for this widget (chart categories, status / badge values), lower-cased keys. */
export const useValueColors = () => useContext(ValueColorsContext)

/** A widget's resolved style as CSS (null when nothing is overridden). */
export function widgetStyleCss(widget: Pick<AppWidget, "style">, app: AppStyle | null | undefined): StyleCss | null {
  const s = resolveWidgetStyle(app, widget.style)
  return isStyled(s) ? styleCss(s) : null
}

/** Grid lookup helper: a page's widgets → their card styles. */
export function styleLookup(widgets: readonly AppWidget[], app: AppStyle | null | undefined) {
  const map = new Map(widgets.map((w) => [w.id, widgetStyleCss(w, app)]))
  return (id: string) => map.get(id) ?? null
}
