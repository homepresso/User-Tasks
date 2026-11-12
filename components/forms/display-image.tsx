import { DISPLAY_IMAGE_MAX_WIDTH_PX, displayImageSrcProblem, type DisplayImageConfig } from '@/lib/forms/media-fields'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { cn } from '@/lib/utils'

/**
 * A Display image element (lib/forms/media-fields.ts): a static picture or
 * logo in the form's layout — its alt text announced, its width (sm / md /
 * lg / full) and alignment from the field. Nothing shows without a usable
 * source (the designer flags it).
 */
export function DisplayImage({ config, fieldKey }: { config: DisplayImageConfig | undefined; fieldKey: string }) {
  if (!config || displayImageSrcProblem(config.src)) return null
  const src = config.src.startsWith('data:') ? config.src : resolveStorageUrl(config.src)
  const max = DISPLAY_IMAGE_MAX_WIDTH_PX[config.width ?? 'md']
  return (
    <figure className={cn('m-0 flex', config.align === 'center' ? 'justify-center' : config.align === 'right' ? 'justify-end' : 'justify-start')} data-display-image={fieldKey}>
      {/* eslint-disable-next-line @next/next/no-img-element -- author-provided picture (own storage or https) */}
      <img src={src} alt={config.alt ?? ''} loading="lazy" referrerPolicy="no-referrer" className="h-auto max-w-full rounded-md" style={max ? { width: '100%', maxWidth: max } : { width: '100%' }} />
    </figure>
  )
}
