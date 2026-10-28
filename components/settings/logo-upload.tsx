"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Upload, X, Image as ImageIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { setWorkspaceLogo } from "@/app/actions/workspace-settings"
import { uploadWorkspaceLogo } from "@/app/actions/uploads"
import { resolveStorageUrl } from "@/lib/storage/refs"

/**
 * Which image: the workspace logo, the theme's light / dark logo, or the
 * favicon. Each has its own file in the workspace's `logos` folder.
 */
export type LogoVariant = "logo" | "logo-light" | "logo-dark" | "favicon"

const VARIANTS: Record<LogoVariant, { types: string[]; maxBytes: number; button: string; hint: string; empty: string }> = {
  logo: {
    types: ["image/png", "image/svg+xml", "image/jpeg", "image/webp"], maxBytes: 2 * 1024 * 1024,
    button: "Upload Logo", empty: "No logo", hint: "PNG, SVG, JPEG, or WebP. Max 2MB. Recommended: 200x40px.",
  },
  "logo-light": {
    types: ["image/png", "image/svg+xml", "image/jpeg", "image/webp"], maxBytes: 2 * 1024 * 1024,
    button: "Upload logo", empty: "No logo", hint: "Shown on light sidebars. PNG, SVG, JPEG, or WebP. Max 2MB. Recommended: 200x40px.",
  },
  "logo-dark": {
    types: ["image/png", "image/svg+xml", "image/jpeg", "image/webp"], maxBytes: 2 * 1024 * 1024,
    button: "Upload dark logo", empty: "No dark logo", hint: "Shown on dark sidebars. PNG, SVG, JPEG, or WebP. Max 2MB.",
  },
  favicon: {
    types: ["image/png", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon", "image/webp"], maxBytes: 512 * 1024,
    button: "Upload favicon", empty: "No favicon", hint: "PNG, SVG, ICO, or WebP. Max 512KB. Square, 32x32px or larger.",
  },
}

interface LogoUploadProps {
  tenantId: string
  currentLogoUrl: string | null
  /** Without settings.edit the logo is shown but cannot be changed. */
  readOnly?: boolean
  variant?: LogoVariant
  /**
   * Receive the uploaded URL (null = removed) instead of saving it as the
   * workspace logo — the theme designer keeps it in its draft.
   */
  onChange?: (url: string | null) => void
  /** Preview background (e.g. the sidebar colour the logo sits on). */
  previewBackground?: string
}

export function LogoUpload({ tenantId, currentLogoUrl, readOnly = false, variant = "logo", onChange, previewBackground }: LogoUploadProps) {
  const spec = VARIANTS[variant]
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate
    if (!spec.types.includes(file.type)) {
      setError(spec.hint)
      return
    }
    if (file.size > spec.maxBytes) {
      setError(`File must be under ${spec.maxBytes >= 1024 * 1024 ? `${spec.maxBytes / 1024 / 1024}MB` : `${spec.maxBytes / 1024}KB`}`)
      return
    }

    setUploading(true)
    setError(null)

    // Stored server-side (settings.edit) as logos/<workspace>/<variant>.<ext>,
    // replacing the previous file; the URL carries a cache-busting ?t=.
    const body = new FormData()
    body.set("file", file)
    body.set("variant", variant)
    body.set("tenant_id", tenantId)
    const uploaded = await uploadWorkspaceLogo(body)

    if (!uploaded.ok) {
      setError(uploaded.error)
      setUploading(false)
      return
    }

    const publicUrl = uploaded.data.url

    if (onChange) {
      onChange(publicUrl)
      setLogoUrl(publicUrl)
      setUploading(false)
      return
    }

    // Save to tenant branding (server action: settings.edit, merged into branding)
    const result = await setWorkspaceLogo(publicUrl)

    if ("error" in result) {
      setError(result.error)
    } else {
      setLogoUrl(publicUrl)
      router.refresh()
    }

    setUploading(false)
  }

  async function handleRemove() {
    if (onChange) {
      onChange(null)
      setLogoUrl(null)
      return
    }
    setUploading(true)
    setError(null)

    const result = await setWorkspaceLogo(null)
    if ("error" in result) {
      setError(result.error)
    } else {
      setLogoUrl(null)
      router.refresh()
    }
    setUploading(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {/* Preview */}
        <div
          className="flex h-16 w-40 items-center justify-center rounded-lg border-2 border-dashed overflow-hidden"
          style={{ borderColor: "var(--theme-surface-border)", ...(previewBackground ? { backgroundColor: previewBackground } : {}) }}
        >
          {logoUrl ? (
            <img
              src={resolveStorageUrl(logoUrl)}
              alt={variant === "favicon" ? "Favicon" : variant === "logo-dark" ? "Dark logo" : variant === "logo-light" ? "Light logo" : "Workspace logo"}
              className="max-h-14 max-w-36 object-contain"
            />
          ) : (
            <div
              className="flex flex-col items-center gap-1"
              style={{ color: "var(--theme-muted-text)" }}
            >
              <ImageIcon size={20} />
              <span className="text-[10px]">{spec.empty}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {!readOnly && <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept={spec.types.join(",")}
            aria-label={spec.button}
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={14} className="mr-1" />
            {uploading ? "Uploading..." : spec.button}
          </Button>
          {logoUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={uploading}
              className="text-red-500"
            >
              <X size={14} className="mr-1" />
              Remove
            </Button>
          )}
        </div>}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
        {readOnly
          ? "Only members who can edit workspace settings can change the logo."
          : spec.hint}
      </p>
    </div>
  )
}
