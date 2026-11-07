import { describe, expect, it } from 'vitest'
import { FAVORITES_SEARCH_THRESHOLD, favoriteFormsView } from '@/lib/home/favorites'

const form = (id: string, name: string, description: string | null = null) => ({ id, name, description })

describe('Home → Favourite forms tab', () => {
  it('empty: says why (no favourites yet), no search box', () => {
    expect(favoriteFormsView([])).toEqual({ forms: [], searchable: false, empty: 'none' })
  })

  it('lists the forms alphabetically (case-insensitive, numbers in order)', () => {
    const v = favoriteFormsView([form('3', 'travel request'), form('1', 'Expense claim'), form('4', 'Form 10'), form('2', 'Form 9')])
    expect(v.forms.map((f) => f.name)).toEqual(['Expense claim', 'Form 9', 'Form 10', 'travel request'])
    expect(v.empty).toBeNull()
    expect(v.searchable).toBe(false)
  })

  it('a search box only past ten; a hidden box never filters', () => {
    const ten = Array.from({ length: FAVORITES_SEARCH_THRESHOLD }, (_, i) => form(String(i), `Form ${i}`))
    expect(favoriteFormsView(ten, 'zzz')).toMatchObject({ searchable: false, empty: null })
    expect(favoriteFormsView(ten, 'zzz').forms).toHaveLength(10)
    const eleven = [...ten, form('x', 'Leave request', 'Annual or sick leave')]
    expect(favoriteFormsView(eleven).searchable).toBe(true)
  })

  it('searches name and description; says when nothing matches', () => {
    const many = [...Array.from({ length: 11 }, (_, i) => form(String(i), `Form ${i}`)), form('x', 'Leave request', 'Annual or SICK leave')]
    expect(favoriteFormsView(many, '  leave ').forms.map((f) => f.id)).toEqual(['x'])
    expect(favoriteFormsView(many, 'sick').forms.map((f) => f.id)).toEqual(['x'])
    expect(favoriteFormsView(many, 'nothing like it')).toMatchObject({ forms: [], empty: 'no-match' })
  })
})
