import { describe, it, expect } from 'vitest'
import { withFavoriteForms } from '@/lib/forms/available-forms'

const f = (id: string, name: string) => ({ id, name, description: null })

describe('withFavoriteForms', () => {
  it('lists favourites first (alphabetical), then the other available forms in their order', () => {
    const available = [f('a', 'Alpha'), f('b', 'Bravo'), f('c', 'Charlie')]
    const favs = [f('c', 'Charlie'), f('b', 'Bravo')]
    expect(withFavoriteForms(available, favs).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('includes favourites that are not marked available', () => {
    const out = withFavoriteForms([f('a', 'Alpha')], [f('z', 'Leave request')])
    expect(out.map((x) => x.id)).toEqual(['z', 'a'])
  })

  it('keeps the available row details (e.g. system_name) for a favourite', () => {
    const out = withFavoriteForms([{ ...f('a', 'Alpha'), system_name: 'alpha' }], [f('a', 'Alpha')])
    expect(out).toEqual([{ id: 'a', name: 'Alpha', description: null, system_name: 'alpha' }])
  })

  it('returns the available list unchanged with no favourites', () => {
    const available = [f('b', 'Bravo'), f('a', 'Alpha')]
    expect(withFavoriteForms(available, [])).toEqual(available)
  })
})
