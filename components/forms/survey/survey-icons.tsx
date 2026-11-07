import {
  Bike, Book, Briefcase, Building, Bus, Cake, Calendar, Camera, Car, Cat, Check, Clock, Cloud, Coffee, Dog, Dumbbell, Film, Flower, Footprints,
  Frown, Gamepad2, Gift, Globe, GraduationCap, Heart, House, Laptop, Leaf, Lightbulb, Lock, Mail, MapPin, Meh, MessageCircle, Monitor, Moon,
  Music, Palette, Phone, Pizza, Plane, Rocket, Salad, Shield, ShoppingCart, Smartphone, Smile, Star, Sun, ThumbsDown, ThumbsUp, Train, TreePine,
  Trophy, User, Users, Utensils, Video, Wrench, X, Zap,
  type LucideIcon,
} from 'lucide-react'
import type { SurveyOptionIcon } from '@/lib/forms/survey/controls'

/** The icons a Picture choice option can show (lib/forms/survey/controls.ts SURVEY_OPTION_ICONS). */
export const SURVEY_ICON_COMPONENTS: Record<SurveyOptionIcon, LucideIcon> = {
  smile: Smile, frown: Frown, meh: Meh, heart: Heart, star: Star, 'thumbs-up': ThumbsUp, 'thumbs-down': ThumbsDown, coffee: Coffee, pizza: Pizza,
  utensils: Utensils, salad: Salad, cake: Cake, car: Car, bike: Bike, bus: Bus, train: Train, plane: Plane, footprints: Footprints, home: House,
  building: Building, briefcase: Briefcase, laptop: Laptop, smartphone: Smartphone, monitor: Monitor, book: Book, 'graduation-cap': GraduationCap,
  music: Music, camera: Camera, film: Film, gamepad: Gamepad2, dumbbell: Dumbbell, trophy: Trophy, gift: Gift, 'shopping-cart': ShoppingCart,
  mail: Mail, phone: Phone, 'message-circle': MessageCircle, video: Video, users: Users, user: User, globe: Globe, 'map-pin': MapPin,
  calendar: Calendar, clock: Clock, sun: Sun, moon: Moon, cloud: Cloud, leaf: Leaf, tree: TreePine, flower: Flower, dog: Dog, cat: Cat, zap: Zap,
  shield: Shield, lock: Lock, wrench: Wrench, lightbulb: Lightbulb, rocket: Rocket, palette: Palette, check: Check, x: X,
}

/** An option's picture: a known icon (`icon:<name>`) or an image URL; nothing when unset. */
export function OptionPicture({ image, size = 40, className }: { image?: string; size?: number; className?: string }) {
  if (!image) return null
  if (image.startsWith('icon:')) {
    const Icon = SURVEY_ICON_COMPONENTS[image.slice(5) as SurveyOptionIcon]
    return Icon ? <Icon size={size} strokeWidth={1.6} aria-hidden className={className} /> : null
  }
  // The option's text names it, so the picture is decorative (alt="").
  // eslint-disable-next-line @next/next/no-img-element -- author-supplied URLs of any host; next/image needs configured hosts
  return <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={className} style={{ width: '100%', height: size * 2, objectFit: 'cover' }} />
}
