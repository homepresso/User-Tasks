import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Shared Open Graph / Twitter card renderer. Every route's
 * opengraph-image.tsx / twitter-image.tsx calls `renderOgImage` so link
 * previews share one design: cream surface, a faint user → task path drawn
 * with the mark's geometry, ink text and a bronze accent.
 *
 * Key content is centred and kept inside the middle ~640px so square crops
 * (WhatsApp, some Slack/iMessage layouts) still show the brand and title.
 */

export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'
export const OG_DEFAULT_ALT = 'UserTasks — the headless workflow engine. API · MCP · CLI · open source.'

const INK = '#17150F'
const CREAM = '#FAF8F3'
const BRONZE = '#C7A575'
const BRONZE_TEXT = '#977443'
const MUTED = '#5C564C'

type Font = { name: string; data: Buffer; weight: 500 | 700; style: 'normal' }

let fonts: Promise<Font[]> | undefined

/** DM Sans + Fraunces, bundled in lib/brand/fonts (SIL OFL). */
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all([
    ['DM Sans', 'DMSans-Medium.ttf', 500],
    ['DM Sans', 'DMSans-Bold.ttf', 700],
    ['Fraunces', 'Fraunces-Bold.ttf', 700],
  ].map(async ([name, file, weight]) => ({
    name: name as string,
    data: await readFile(join(process.cwd(), 'lib/brand/fonts', file as string)),
    weight: weight as 500 | 700,
    style: 'normal' as const,
  })))
  return fonts
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,.;:—-]+$/, '')}…`
}

/** The mark (ink tile, cream user + connector, bronze task) at `size` px. */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="15" fill={INK} />
      <circle cx="17" cy="17" r="7" fill={CREAM} />
      <path d="M17 31v6a8 8 0 0 0 8 8h6" fill="none" stroke={CREAM} strokeWidth="6" strokeLinecap="round" />
      <rect x="36" y="36" width="18" height="18" rx="5" fill={BRONZE} />
    </svg>
  )
}

/**
 * Background motif: the mark's geometry at canvas scale — a user node at the
 * top left, a workflow path running down the left edge and along the bottom
 * (below the content) through a rounded elbow, into the bronze task block at
 * the bottom right.
 */
function FlowMotif() {
  return (
    <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: 'absolute', top: 0, left: 0 }}>
      <circle cx="96" cy="112" r="30" fill={INK} fillOpacity="0.07" />
      <path d="M96 170 V458 A90 90 0 0 0 186 548 H1036" fill="none" stroke={INK} strokeOpacity="0.06" strokeWidth="20" strokeLinecap="round" />
      <rect x="1056" y="509" width="78" height="78" rx="22" fill={BRONZE} fillOpacity="0.5" />
    </svg>
  )
}

function Brand({ mark, text }: { mark: number; text: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: mark * 0.3 }}>
      <Mark size={mark} />
      <div style={{ display: 'flex', fontFamily: 'DM Sans', fontWeight: 700, fontSize: text, letterSpacing: -text * 0.025, color: INK }}>
        user<span style={{ color: BRONZE_TEXT }}>tasks</span>
      </div>
    </div>
  )
}

export type OgCard = {
  /** Small bronze label above the title, e.g. "Use case" or "Docs · Workflows". */
  eyebrow?: string
  title: string
  subtitle?: string
}

/** The default (home) card: brand, headline, and the engine's surfaces. */
export async function renderHomeOgImage(): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: CREAM, position: 'relative' }}>
        <FlowMotif />
        <div style={{ display: 'flex', marginTop: 78 }}>
          <Brand mark={76} text={56} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 44, fontFamily: 'Fraunces', fontWeight: 700, fontSize: 88, lineHeight: 1.04, letterSpacing: -2, color: INK }}>
          <span>The headless</span>
          <span>workflow engine</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 34, fontFamily: 'DM Sans', fontWeight: 500, fontSize: 32, color: MUTED }}>
          {['API', 'MCP', 'CLI', 'open source'].flatMap((label, i) => [
            ...(i ? [<div key={`dot-${label}`} style={{ width: 8, height: 8, borderRadius: 8, background: BRONZE }} />] : []),
            <span key={label}>{label}</span>,
          ])}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await loadFonts() },
  )
}

/** A page card: brand, eyebrow, page title and a one-line summary. */
export async function renderOgImage({ eyebrow, title, subtitle }: OgCard): Promise<ImageResponse> {
  const heading = truncate(title, 90)
  const size = heading.length > 60 ? 54 : heading.length > 34 ? 64 : 76
  // Satori's balanced wrapping shifts a one-line title off centre, so only
  // balance titles long enough to wrap.
  const titleWrap = heading.length > 24 ? { textWrap: 'balance' as const } : {}
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 110px 80px', background: CREAM, position: 'relative' }}>
        <FlowMotif />
        <div style={{ display: 'flex' }}>
          <Brand mark={56} text={42} />
        </div>
        {eyebrow && (
          <div style={{ display: 'flex', marginTop: 44, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 24, letterSpacing: 4, textTransform: 'uppercase', color: BRONZE_TEXT }}>
            {truncate(eyebrow, 48)}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', textAlign: 'center', ...titleWrap, maxWidth: 980, marginTop: eyebrow ? 16 : 52, fontFamily: 'Fraunces', fontWeight: 700, fontSize: size, lineHeight: 1.08, letterSpacing: -1.5, color: INK }}>
          {heading}
        </div>
        {subtitle && (
          <div style={{ display: 'flex', justifyContent: 'center', textAlign: 'center', textWrap: 'balance', maxWidth: 900, marginTop: 22, fontFamily: 'DM Sans', fontWeight: 500, fontSize: 28, lineHeight: 1.35, color: MUTED }}>
            {truncate(subtitle, 120)}
          </div>
        )}
      </div>
    ),
    { ...OG_SIZE, fonts: await loadFonts() },
  )
}
