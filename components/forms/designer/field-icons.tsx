import {
  AlignLeft, Calendar, CalendarClock, CircleDot, DollarSign, Hash, Heading, Link, ListChecks, Mail, Minus, Phone, SearchCheck, SquareCheck, Type, User,
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
  heading: Heading,
  divider: Minus,
}

/** Palette groups, in order. */
export const PALETTE_GROUPS: Array<{ label: string; types: TaskFieldType[] }> = [
  { label: 'Text', types: ['text', 'textarea', 'email', 'phone', 'url'] },
  { label: 'Numbers & dates', types: ['number', 'currency', 'date', 'datetime'] },
  { label: 'Choices', types: ['boolean', 'choice', 'multi_choice', 'user', 'lookup'] },
  { label: 'Layout', types: ['heading', 'divider'] },
]

/** Drag payload types (HTML drag and drop). */
export const DRAG_NEW_TYPE = 'application/x-usertasks-form-type'
export const DRAG_FIELD_KEY = 'application/x-usertasks-form-field'
