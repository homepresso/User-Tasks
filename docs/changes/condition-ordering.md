# Release notes: greater / less than in workflow conditions

Branch by Condition (and the conditions of extension event waits) now
order values the way form rules always have. Before, `gt`, `gte`, `lt` and
`lte` turned both sides into numbers, so dates never matched and an empty
value counted as 0.

## Changed (behaviour change)

- **Dates compare as dates.** `{{start_date}} gt 2027-01-01` is true for
  `2027-05-01`. ISO dates and date-times (`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM…`)
  qualify; a date alone is midnight UTC. Before, every date comparison was
  false.
- **Empty never matches.** A missing, `null`, blank or whitespace value makes
  every greater / less-than rule false. Before, `{{amount}} lt 1000` was true
  for an empty amount (empty read as 0). Use `is_empty` to branch on a
  missing value explicitly.
- **Numbers compare as numbers** (unchanged), including numeric text such
  as `"10"`.
- **Other text** compares trimmed and case-insensitively (`Banana` > `apple`).
  Before, it never matched.
- The `gt_field` … `lte_field` operators (field against field) follow the
  same rules.
- `equals`, `contains`, `in` and the other operators are unchanged.

## Who is affected

A workflow whose greater / less-than rule saw an empty value took the
matching branch before and now takes the next branch (or Else). For
example, the gallery's Contract renewal reminders starts a renewal decision
only when the notice deadline is known; a contract without one now logs
"Nothing due". The gallery packages that use these operators (24 packages)
were re-verified end to end.

Shared code: `compareOrdered` / `orderedMatch` in `lib/conditions.ts`, used
by workflow conditions, event waits and form rules.

No migration.
