import { forwardRef } from "react"
import { cn } from "@/lib/utils"
import { controlClass } from "./input"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

/** Multi-line text control with the Input look (padding 8px 10px, min 3 rows). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, rows = 3, ...props }, ref) => (
  <textarea ref={ref} rows={rows} className={cn(controlClass, "min-h-16 px-2.5 py-2 leading-5", className)} {...props} />
))
Textarea.displayName = "Textarea"
