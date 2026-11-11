import { describe, it, expect } from 'vitest'
import { filterAvailableForms, availableFormTags } from '@/lib/forms/available-forms'

const forms = [
  { id: '1', name: 'Leave request', description: null, tags: ['hr', 'people'] },
  { id: '2', name: 'Purchase request', description: 'Buy things', tags: ['finance'] },
  { id: '3', name: 'Expense claim', description: null, tags: ['finance', 'hr'] },
  { id: '4', name: 'IT access', description: null },
]

describe('forms menu: find a form by its tags', () => {
  it('plain text matches tags as well as names', () => {
    expect(filterAvailableForms(forms, 'financ').map((f) => f.id)).toEqual(['2', '3'])
    expect(filterAvailableForms(forms, 'leave').map((f) => f.id)).toEqual(['1'])
  })
  it('#tag (or tag:) matches that tag exactly', () => {
    expect(filterAvailableForms(forms, '#hr').map((f) => f.id)).toEqual(['1', '3'])
    expect(filterAvailableForms(forms, 'tag: finance').map((f) => f.id)).toEqual(['2', '3'])
    expect(filterAvailableForms(forms, '#h')).toEqual([])
  })
  it('lists the tags in use, most common first', () => {
    expect(availableFormTags(forms)).toEqual(['finance', 'hr', 'people'])
  })
})
