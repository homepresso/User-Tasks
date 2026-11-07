import {
  AlignLeft, ArrowDownUp, Calendar, Gauge, Grid3x3, Images, ListOrdered, SlidersHorizontal, Smile, Star, ToggleLeft, MousePointerClick, Paperclip, CalendarClock, CircleDot, DollarSign, Hash, Heading, Link, ListChecks, Mail, Minus, Phone, Puzzle, SearchCheck, SquareCheck, Table2, Tag, Type, User,
  type LucideIcon,
} from 'lucide-react'
import type { TaskFieldType } from '@/lib/task-field-schema'

export const FIELD_ICONS: Record<TaskFieldType, LucideIcon> = {
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  currency: DollarSign,
  email: Mail,
  phone: Phone,
  url: Link,
  date: Calendar,
  datetime: CalendarClock,
  boolean: SquareCheck,
  choice: CircleDot,
  multi_choice: ListChecks,
  user: User,
  lookup: SearchCheck,
  attachments: Paperclip,
  heading: Heading,
  divider: Minus,
  custom: Puzzle,
  button: MousePointerClick,
  data_table: Table2,
  label: Tag,
  rating: Star,
  nps: Gauge,
  likert: ListOrdered,
  matrix: Grid3x3,
  slider: SlidersHorizontal,
  csat: Smile,
  ranking: ArrowDownUp,
  image_choice: Images,
  yes_no_maybe: ToggleLeft,
}

/** A palette group's label: 11px sentence case. */
export const paletteGroupClass = 'px-2 pb-1 pt-2 text-2xs font-medium text-fg-muted'

/** A palette entry: a flat 28px row (drag it onto the grid, or click / Enter to add). */
export const paletteItemClass = 'flex h-7 w-full cursor-grab items-center gap-2 rounded-md px-2 text-left text-ui text-fg transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle active:cursor-grabbing'

/** Palette groups, in order. */
export const PALETTE_GROUPS: Array<{ label: string; types: TaskFieldType[] }> = [
  { label: 'Text', types: ['text', 'textarea', 'email', 'phone', 'url'] },
  { label: 'Numbers & dates', types: ['number', 'currency', 'date', 'datetime'] },
  { label: 'Choices', types: ['boolean', 'choice', 'multi_choice', 'user', 'lookup'] },
  { label: 'Survey', types: ['rating', 'nps', 'likert', 'matrix', 'slider', 'csat', 'ranking', 'image_choice', 'yes_no_maybe'] },
  { label: 'Data', types: ['data_table'] },
  { label: 'Files', types: ['attachments'] },
  { label: 'Display', types: ['label'] },
  { label: 'Layout', types: ['heading', 'divider', 'button'] },
]

/** Drag payload types (HTML drag and drop). */
export const DRAG_NEW_TYPE = 'application/x-usertasks-form-type'
export const DRAG_FIELD_KEY = 'application/x-usertasks-form-field'
export const DRAG_PAGE_ID = 'application/x-usertasks-form-page'
