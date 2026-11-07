import {
  Briefcase, Building, Calendar, CheckCircle, Clock, CreditCard, DollarSign, FileText, Heart, Home, Image, Info, List, Mail,
  MapPin, MessageSquare, Package, Paperclip, Phone, Settings, Shield, ShoppingCart, Star, Truck, User, Users,
  type LucideIcon,
} from 'lucide-react'
import type { FormPageIcon } from '@/lib/forms/layout'

/** The icons a form page (step / tab) can show (lib/forms/layout.ts FORM_PAGE_ICONS). */
export const PAGE_ICONS: Record<FormPageIcon, LucideIcon> = {
  user: User, users: Users, mail: Mail, phone: Phone, 'map-pin': MapPin, home: Home, building: Building, briefcase: Briefcase,
  calendar: Calendar, clock: Clock, 'file-text': FileText, paperclip: Paperclip, 'credit-card': CreditCard, 'dollar-sign': DollarSign,
  'shopping-cart': ShoppingCart, package: Package, truck: Truck, heart: Heart, shield: Shield, settings: Settings, list: List,
  info: Info, star: Star, 'check-circle': CheckCircle, 'message-square': MessageSquare, image: Image,
}

export function PageIcon({ icon, size = 14, className }: { icon?: FormPageIcon; size?: number; className?: string }) {
  const Icon = icon ? PAGE_ICONS[icon] : null
  return Icon ? <Icon size={size} className={className} aria-hidden /> : null
}
