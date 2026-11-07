# Release notes: Redact by type of information

Redact Document now finds sensitive information **by type** — "is this an
SSN, a date of birth, an IRD number?" — from its format and syntax, and can
report what it found without changing anything. Docs:
[Redact Document](/docs/workflows/documents/redact),
[Information types](/docs/workflows/documents/info-types) and the how-to
[Find and redact SSNs and dates of birth in uploaded documents](/docs/workflows/documents/how-to/redact-ssn-dob).

No database migrations. No new dependencies.

## Added

- **Information types** (`info_types`): 50+ types in six categories, each
  with a pattern, a validator and context words, and a confidence (low,
  medium, high):
  - Identity: US SSN and ITIN, US and UK passport numbers, US and NZ
    driver's licences, date of birth, UK National Insurance number, Canada
    SIN (Luhn), Australia TFN (weighted checksum), New Zealand IRD number
    (check digit), German Steuer-ID (ISO 7064), French NIR (key), Spanish
    DNI / NIE (control letter), Italian codice fiscale, Dutch BSN
    (11-proef), India Aadhaar (Verhoeff) and PAN, Singapore NRIC / FIN,
    passport and ID-card MRZ lines (ICAO check digits).
  - Financial: card numbers (Luhn, issuer prefix and length), IBAN
    (mod-97), SWIFT / BIC, US ABA routing numbers, US bank accounts, UK
    sort code and account, Australian BSB and account, New Zealand bank
    accounts (bank / branch ranges and check digit), Bitcoin (Base58Check,
    Bech32) and Ethereum addresses.
  - Contact: email, phone (E.164 and national formats), street addresses
    (heuristic), UK, US, Canadian, Australian and New Zealand postcodes.
  - Health: UK NHS number (mod-11), New Zealand NHI (check character),
    Australian Medicare number, US Medicare Beneficiary Identifier, medical
    record numbers (with context).
  - Technical and credentials: IPv4, IPv6, MAC addresses, URLs, API keys
    (known prefixes and high-entropy values), JSON Web Tokens, private key
    blocks, passwords after `password:`.
- **Date of birth vs date**: any common date format is a date of birth only
  with a word such as DOB, date of birth or born just before it and a
  plausible birth date; other dates stay plain dates.
- **Detect only** (`mode: "detect_only"`): findings without a copy —
  `findings` (type, label, category, confidence, masked value, page / slide
  / sheet and cell / paragraph / line, offsets, a masked context snippet),
  `counts_by_type`; default variable `detected`.
- **Designer**: information types by category with checkboxes, a region
  filter, **All high-confidence types**, minimum confidence, a style per
  type, and OCR. Save & Test shows the first 25 findings, masked.
- **Styles**: mask (█), label (`[SSN]`), partial (keep the last 4) and hash
  (`[SSN:3f9a0c21b7]`, keyed per workspace), per type with `styles`.
- **AI detection** (opt-in, off by default): one of your agents' models
  finds names of people and addresses; marked as probabilistic, values are
  only used when they occur in the text.

## Changed

- The presets (`email`, `phone`, `credit_card`, `iban`, `ssn`,
  `ip_address`, `url`, `date`) keep working as before; the designer shows
  them only on steps that use them.
- Output variables gain `findings`, `counts_by_type` and `mode`, plus
  `<output_var>_findings`. The run history lists counts and masked
  findings, never raw values.

## Limits

- Detection is pattern-based, not a guarantee: try Detect only on sample
  documents first. Context words must be in the same paragraph, cell or
  line. Ethereum addresses and Singapore M-series FINs are checked by
  format only.
