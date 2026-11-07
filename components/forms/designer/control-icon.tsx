import {
  BarChart3, Calendar, Camera, Check, CircleDot, Clock, Code, Palette, Edit3, FileText, Gauge, Globe, Grid3x3, Hash, Heart, Image, Layers,
  List, MapPin, Mic, PenTool, Puzzle, QrCode, Search, Signature, SlidersHorizontal, Smile, Star, Table, Tag, ThumbsUp, ToggleLeft, Type,
  Upload, User, Users, Map as MapIcon, Info, ListChecks, FileChartColumn, TextCursorInput, type LucideIcon,
} from 'lucide-react'

/**
 * Icons a custom form control's manifest may name (kebab case). Anything
 * else — or no icon — shows the puzzle piece; a manifest may also give a
 * small SVG data URI, drawn as an image (never inline markup).
 */
export const CONTROL_ICONS: Record<string, LucideIcon> = {
  'bar-chart': BarChart3, calendar: Calendar, camera: Camera, check: Check, 'circle-dot': CircleDot, clock: Clock, code: Code, palette: Palette,
  edit: Edit3, 'file-text': FileText, gauge: Gauge, globe: Globe, grid: Grid3x3, hash: Hash, heart: Heart, image: Image, layers: Layers,
  list: List, 'map-pin': MapPin, mic: Mic, 'pen-tool': PenTool, puzzle: Puzzle, 'qr-code': QrCode, search: Search, signature: Signature,
  sliders: SlidersHorizontal, smile: Smile, star: Star, table: Table, tag: Tag, 'thumbs-up': ThumbsUp, toggle: ToggleLeft, type: Type,
  upload: Upload, user: User, users: Users, map: MapIcon, info: Info, 'list-checks': ListChecks, 'file-chart': FileChartColumn,
  'text-cursor': TextCursorInput,
}

export function ControlIcon({ icon, size = 13, style, className }: { icon?: string | null; size?: number; style?: React.CSSProperties; className?: string }) {
  if (icon?.startsWith('data:image/svg+xml')) {
    // eslint-disable-next-line @next/next/no-img-element -- a manifest's small SVG icon (data URI, drawn as an image)
    return <img src={icon} alt="" width={size} height={size} className={className} style={{ width: size, height: size, ...style }} aria-hidden />
  }
  const Icon = (icon && CONTROL_ICONS[icon]) || Puzzle
  return <Icon size={size} className={className} style={style} aria-hidden />
}
