/**
 * Customer quotes for the public site — EMPTY BY DESIGN.
 *
 * Add an entry only for a real, attributable quote the customer has approved
 * for publication (name, role and organisation exactly as they agreed). Never
 * placeholder or illustrative quotes. While the list is empty the section
 * renders nothing, so pages can place <Testimonials /> now.
 */
export type Testimonial = { quote: string; name: string; role: string; organisation: string; href?: string }

export const TESTIMONIALS: Testimonial[] = []

export function Testimonials({ items = TESTIMONIALS }: { items?: Testimonial[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="testimonials-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <h2 id="testimonials-title" className="text-center font-display text-3xl font-bold tracking-tight sm:text-4xl">In their words</h2>
      <ul className="mt-10 columns-1 gap-5 md:columns-2 lg:columns-3">
        {items.map((item) => (
          <li key={`${item.name}-${item.organisation}`} className="mb-5 break-inside-avoid rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6" data-reveal>
            <blockquote className="text-[15px] leading-7 text-(color:--mkt-ink-soft)">“{item.quote}”</blockquote>
            <p className="mt-4 text-sm font-semibold">{item.name}</p>
            <p className="text-xs text-(color:--mkt-muted)">{item.role}, {item.href ? <a href={item.href} className="underline-offset-2 hover:underline">{item.organisation}</a> : item.organisation}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
