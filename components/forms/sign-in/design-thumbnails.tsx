import type { CSSProperties } from 'react'
import { BRAND_COLORS } from '@/components/brand/logo'
import { shade, signInDesign, type SignInColors } from '@/lib/forms/sign-in-page'

/**
 * A miniature of each sign-in design for the picker (Settings → Forms →
 * Form sign-in page): blocks only, in the chosen accent. Decorative — the
 * picker's radio labels carry the names.
 */
export function DesignThumbnail({ design, colors }: { design: number; colors: SignInColors }) {
  const d = signInDesign(design)
  const card = (style: CSSProperties = {}) => (
    <div className="flex flex-col gap-[3px] rounded-[4px] bg-white p-[5px] shadow-sm" style={{ width: '46%', ...style }}>
      <span className="h-[3px] w-1/2 rounded-full bg-zinc-800" />
      <span className="h-[4px] rounded-sm border border-zinc-300" />
      <span className="h-[4px] rounded-sm border border-zinc-300" />
      <span className="h-[5px] rounded-sm" style={{ backgroundColor: colors.accent }} />
    </div>
  )
  const box = 'relative flex h-full w-full items-center justify-center overflow-hidden'
  switch (d.key) {
    case 'split':
      return <div className={box}><div className="h-full w-1/2" style={{ backgroundColor: colors.accent }} /><div className="flex h-full w-1/2 items-center justify-center bg-white">{card({ width: '80%', boxShadow: 'none' })}</div></div>
    case 'minimal':
      return <div className={`${box} bg-white`}>{card({ boxShadow: 'none', width: '50%' })}</div>
    case 'gradient':
      return <div className={box} style={{ backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentDeep})` }}>{card()}</div>
    case 'rail':
      return <div className={`${box} justify-start bg-zinc-50`}><div className="h-full w-[14%]" style={{ backgroundColor: colors.accent }} /><div className="flex flex-1 items-center pl-[10%]">{card({ boxShadow: 'none', width: '60%' })}</div></div>
    case 'glass':
      return <div className={box} style={{ backgroundColor: colors.accentDeep, backgroundImage: `radial-gradient(circle at 25% 25%, ${colors.accent} 0, transparent 50%), radial-gradient(rgba(255,255,255,.3) 1px, transparent 1px)`, backgroundSize: 'auto, 6px 6px' }}>{card({ opacity: 0.9 })}</div>
    case 'banner':
      return <div className={`${box} flex-col justify-start bg-zinc-50`}><div className="h-[40%] w-full" style={{ backgroundColor: colors.accent }} />{card({ marginTop: '-14%' })}</div>
    case 'dark':
      return <div className={box} style={{ backgroundColor: '#0b0f19', backgroundImage: `radial-gradient(ellipse at 50% 0, ${colors.accent}88, transparent 70%)` }}>{card({ backgroundColor: '#18181b' })}</div>
    case 'soft':
      return <div className={box} style={{ backgroundColor: shade(colors.accent, 0.9) }}><span className="absolute -left-2 -top-2 size-8 rounded-full" style={{ backgroundColor: shade(colors.accent, 0.55) }} /><span className="absolute -bottom-3 -right-2 size-10 rounded-[40%]" style={{ backgroundColor: shade(colors.accent, 0.4) }} />{card({ borderRadius: 8 })}</div>
    case 'compact':
      return <div className={`${box} bg-[#faf8f3]`}>{card({ width: '58%' })}</div>
    default:
      // The UserTasks look: a white brand panel (ink mark, a headline) beside the form on cream.
      return (
        <div className={box} style={{ backgroundColor: '#faf8f3' }}>
          <div className="flex h-full w-1/2 flex-col justify-between border-r border-[#e6e1d5] bg-white p-[6px]">
            <span className="size-[9px] rounded-[3px]" style={{ backgroundColor: BRAND_COLORS.ink }} />
            <span className="flex flex-col gap-[3px]"><span className="h-[4px] w-4/5 rounded-full bg-zinc-800" /><span className="h-[4px] w-3/5 rounded-full bg-zinc-800" /></span>
            <span className="h-[2px] w-1/4 rounded-full" style={{ backgroundColor: BRAND_COLORS.bronze }} />
          </div>
          <div className="flex h-full w-1/2 items-center justify-center">{card({ width: '78%', boxShadow: 'none', backgroundColor: 'transparent' })}</div>
        </div>
      )
  }
}
