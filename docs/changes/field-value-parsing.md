# Release notes: stricter number, choice and date-time values

Values submitted through the API, imports, agents and forms are checked
more strictly so they are not silently changed.

## Changed

- **Numbers and currency:** plain decimals only (`1000`, `-2.5`, `1e3`,
  `.5`). Commas are accepted only as thousands separators in groups of three
  (`1,000`, `1,234,567.50`). Ambiguous or non-decimal text is refused with
  "must be a number" instead of being guessed: `1,5` (decimal comma or
  fifteen?) was stored as 15 and `0x10` as 16 before. There is no
  locale-based parsing; send a dot decimal.
- **Choice and multi-select:** values match options after Unicode NFC
  normalisation, so a decomposed `Zürich` (as some keyboards and APIs
  send it) matches the option `Zürich`, and is stored exactly as the option
  is written.
- **Date-time without a timezone** (`2027-01-01T10:00`): read as UTC.
  Workspaces have no timezone setting; before, it depended on the server's
  own timezone. Include an offset (`+13:00`) or `Z` to be explicit. The
  browser already sends a full ISO value with the offset.
- **Dates must exist:** `2027-02-30`, `2027-04-31` and the like are refused
  for date and date-time fields and for a task's estimated completion
  (before, they rolled over into the next month).

No migration.
