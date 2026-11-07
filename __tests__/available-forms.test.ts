/**
 * "Available forms" (lib/forms/available-forms.ts): the sidebar Forms menu's
 * ordering (alphabetical, case-insensitive, locale-aware), the more-than-10
 * search threshold, type-ahead filtering and the highlighted match. The
 * access rules themselves are checked against the database in
 * available-forms-db.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  AVAILABLE_FORMS_SEARCH_THRESHOLD, availableFormsExpandedKey, filterAvailableForms, highlightMatch, showsAvailableFormsSearch, sortAvailableForms,
} from '@/lib/forms/available-forms'

const form = (name: string, id = name, description: string | null = null) => ({ id, name, description })

describe('sortAvailableForms', () => {
  it('sorts alphabetically, ignoring case', () => {
    const names = sortAvailableForms([form('zebra'), form('Apple'), form('banana'), form('apple pie'), form('Cherry')]).map((f) => f.name)
    expect(names).toEqual(['Apple', 'apple pie', 'banana', 'Cherry', 'zebra'])
  })

  it('is locale-aware: accents sort with their letter, numbers in numeric order', () => {
    const names = sortAvailableForms([form('Form 10'), form('Éclair order'), form('Form 2'), form('eagle'), form('Expense claim')]).map((f) => f.name)
    expect(names).toEqual(['eagle', 'Éclair order', 'Expense claim', 'Form 2', 'Form 10'])
  })

  it('is stable for equal names (then by id) and does not mutate its input', () => {
    const input = [form('Leave', 'b'), form('leave', 'a'), form('Leave', 'a')]
    const sorted = sortAvailableForms(input)
    expect(sorted.map((f) => `${f.name}:${f.id}`)).toEqual(['Leave:a', 'Leave:b', 'leave:a'])
    expect(input.map((f) => f.id)).toEqual(['b', 'a', 'a'])
  })
})

describe('search threshold', () => {
  it('shows the search box only with more than 10 forms', () => {
    expect(AVAILABLE_FORMS_SEARCH_THRESHOLD).toBe(10)
    expect(showsAvailableFormsSearch(0)).toBe(false)
    expect(showsAvailableFormsSearch(9)).toBe(false)
    expect(showsAvailableFormsSearch(10)).toBe(false)
    expect(showsAvailableFormsSearch(11)).toBe(true)
    expect(showsAvailableFormsSearch(250)).toBe(true)
  })
})

describe('filterAvailableForms', () => {
  const forms = sortAvailableForms([
    form('Expense claim', '1', 'Claim back what you spent'), form('Leave request', '2'), form('IT access request', '3'),
    form('Équipement', '4'), form('Travel booking', '5', 'Flights and hotels'),
  ])

  it('matches anywhere in the name, case- and accent-insensitively, keeping alphabetical order', () => {
    expect(filterAvailableForms(forms, 'REQ').map((f) => f.name)).toEqual(['IT access request', 'Leave request'])
    expect(filterAvailableForms(forms, 'equip').map((f) => f.name)).toEqual(['Équipement'])
  })

  it('matches the description too', () => {
    expect(filterAvailableForms(forms, 'hotel').map((f) => f.name)).toEqual(['Travel booking'])
  })

  it('returns everything for a blank query and nothing for no match', () => {
    expect(filterAvailableForms(forms, '  ')).toHaveLength(5)
    expect(filterAvailableForms(forms, 'zzz')).toEqual([])
  })
})

describe('highlightMatch', () => {
  it('splits the name around the first case-insensitive match', () => {
    expect(highlightMatch('Leave request', 'REQ')).toEqual([
      { text: 'Leave ', match: false }, { text: 'req', match: true }, { text: 'uest', match: false },
    ])
  })

  it('keeps the original characters of an accent-insensitive match', () => {
    expect(highlightMatch('Équipement', 'equi')).toEqual([{ text: 'Équi', match: true }, { text: 'pement', match: false }])
  })

  it('returns the whole name unmarked without a match or query', () => {
    expect(highlightMatch('Leave request', 'zzz')).toEqual([{ text: 'Leave request', match: false }])
    expect(highlightMatch('Leave request', '')).toEqual([{ text: 'Leave request', match: false }])
  })
})

describe('availableFormsExpandedKey', () => {
  it('is per user', () => {
    expect(availableFormsExpandedKey('u1')).not.toEqual(availableFormsExpandedKey('u2'))
    expect(availableFormsExpandedKey(null)).toContain('anon')
  })
})
