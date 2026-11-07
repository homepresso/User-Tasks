# Validation & formatting (`ut_validate`)

Validation of identifiers (IBAN, BIC, payment cards, email, phone, postcodes, national IDs and tax numbers) with normalised values and plain-language reasons, and locale-aware formatting and parsing of numbers, currencies and phone numbers.

Official UserTasks workflow action, version 1.0.0. Source: `src/action.ts`; built module: `dist/action.js` (one self-contained ES module that runs in the UserTasks QuickJS sandbox).

## Operations

### Validate (`validate`)

Check one value: iban, bic, card, email, phone, postcode or national_id. Returns valid, the normalised value, the reason it is invalid and type-specific details (card issuer, IBAN country, phone country code, formatted ID, …).

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `type` | choice: `iban`, `bic`, `card`, `email`, `phone`, `postcode`, `national_id` | yes | `"email"` | What the value is. |
| `value` | string | yes |  | The value to check (spaces and dashes are allowed where usual). |
| `country` | string | no |  | Postcode: the ISO country (US, GB, CA, AU, NZ, DE, FR, NL, IE, ES, IT, …). Phone: the default country (ISO code or calling code such as 64) for numbers without +. |
| `id_type` | choice: `us_ssn`, `uk_nino`, `ca_sin`, `au_tfn`, `nz_ird`, `nz_nhi`, `de_tax_id`, `fr_nir`, `es_dni`, `it_fiscal_code`, `nl_bsn`, `in_aadhaar`, `sg_nric` | no |  | For national_id: which scheme. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `valid` | boolean |  |
| `normalized` | string | The value in its standard form (IBAN without spaces, E.164 phone, upper-case postcode with standard spacing, digits-only card number, …). |
| `reason` | string | Why the value is invalid (empty when valid). |
| `details` | object | Type-specific facts: iban country, bban and formatted; bic bank_code, country, branch; card issuer, last4, masked; email local, domain; phone country_code, national_number, international; national_id formatted. |

### Validate many (`validate_many`)

Check a list of { type, value } entries at once (e.g. every field of an onboarding form) and get one result per entry plus whether all are valid.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | List of { "type": "email", "value": "…", "name"?: "label", "country"?: "NZ", "id_type"?: "nz_ird" }. |
| `country` | string | no |  | Used for phone and postcode entries without their own country. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `results` | list of objects | One per item, in order. Each item: `name` (string), `type` (string), `value` (string), `valid` (boolean), `normalized` (string), `reason` (string). |
| `all_valid` | boolean |  |
| `valid_count` | integer |  |
| `invalid_count` | integer |  |

### Format number (`format_number`)

Format a number for a locale: grouping and decimal separators, percent (0.25 → 25%), currency, or compact (1.2K) notation.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | number | yes |  | The number. For percent, 0.25 is 25%. |
| `locale` | string | no | `"en-US"` | BCP 47 locale, e.g. en-US, en-NZ, de-DE, fr-FR, ja-JP. |
| `style` | choice: `decimal`, `percent`, `currency` | no | `"decimal"` | Plain number, percent or currency. |
| `currency` | string | no |  | For the currency style: ISO 4217 code (USD, EUR, NZD, JPY, …). |
| `minimum_fraction_digits` | integer | no |  | Optional: at least this many decimal places. |
| `maximum_fraction_digits` | integer | no |  | Optional: at most this many decimal places (rounded). |
| `use_grouping` | boolean | no | `true` | Group digits (1,234,567). |
| `notation` | choice: `standard`, `compact`, `scientific`, `engineering` | no | `"standard"` | Standard, compact (1.2M), scientific or engineering. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `formatted` | string |  |

### Format currency (`format_currency`)

Format an amount of money for a locale and currency, with the currency's usual decimals (JPY has none) and symbol, code or name.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | number | yes |  | The amount. |
| `currency` | string | yes |  | ISO 4217 code (USD, EUR, GBP, NZD, AUD, JPY, …). |
| `locale` | string | no | `"en-US"` | BCP 47 locale, e.g. en-US, en-NZ, de-DE, fr-FR, ja-JP. |
| `display` | choice: `symbol`, `narrowSymbol`, `code`, `name` | no | `"symbol"` | Symbol ($), narrow symbol, ISO code (NZD) or name (New Zealand dollars). |
| `accounting` | boolean | no | `false` | Show negative amounts in brackets, e.g. ($1,234.50). |
| `minimum_fraction_digits` | integer | no |  | Optional: at least this many decimal places. |
| `maximum_fraction_digits` | integer | no |  | Optional: at most this many decimal places (rounded). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `formatted` | string |  |
| `currency` | string |  |

### Parse number (`parse_number`)

Read a number typed the way a locale writes it: "1.234,56" in de-DE and "1,234.56" in en-US are both 1234.56. Handles currency symbols and codes, percent (12% → 0.12), brackets and minus signs, and local digits.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | string | yes |  | The number as text. |
| `locale` | string | no | `"en-US"` | BCP 47 locale, e.g. en-US, en-NZ, de-DE, fr-FR, ja-JP. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `value` | number | The number (empty when the text is not a number). |
| `valid` | boolean | Whether the text could be read as a number. |
| `decimal_separator` | string | The locale's decimal separator. |
| `group_separator` | string | The locale's thousands separator. |

### Format phone (`format_phone`)

Normalise a phone number to E.164 (+64211234567), or format it in international (+64 21 123 4567) or national (021 123 4567) style with simple grouping. North American numbers use (415) 555-0132.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | string | yes |  | As typed: with + and country code, or national with Country set. |
| `country` | string | no |  | ISO country (NZ, US, GB, …) or calling code (64) for numbers without +. |
| `format` | choice: `e164`, `international`, `national` | no | `"international"` | Output style. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `formatted` | string | Empty when the number is not valid. |
| `e164` | string |  |
| `valid` | boolean |  |
| `reason` | string | Why the number is invalid (empty when valid). |

## Capabilities

None: pure computation. Locale data comes from the host's ctx.intl helpers (Unicode CLDR); the action cannot reach the network, data tables, files or secrets.

## Examples

**UK IBAN** (`validate`)

```json
{
  "type": "iban",
  "value": "GB82 WEST 1234 5698 7654 32"
}
```

**Card number with issuer** (`validate`)

```json
{
  "type": "card",
  "value": "4111 1111 1111 1111"
}
```

**Onboarding form fields** (`validate_many`)

```json
{
  "items": [
    {
      "name": "Email",
      "type": "email",
      "value": "ap@example.co.nz"
    },
    {
      "name": "Bank",
      "type": "iban",
      "value": "DE89 3704 0044 0532 0130 00"
    },
    {
      "name": "Phone",
      "type": "phone",
      "value": "021 123 4567",
      "country": "NZ"
    },
    {
      "name": "Postcode",
      "type": "postcode",
      "value": "sw1a1aa",
      "country": "GB"
    }
  ]
}
```

**German amount to a number** (`parse_number`)

```json
{
  "text": "1.234,56 €",
  "locale": "de-DE"
}
```

**Yen without decimals** (`format_currency`)

```json
{
  "value": 1234567.8,
  "currency": "JPY",
  "locale": "ja-JP"
}
```

A sample workflow ships in `assets/workflows/`: it starts from the API or its start form, runs this action with default inputs and shows the outputs.

## Limits

- Each run has 5 seconds and 32 MB of sandbox memory; inputs and outputs are limited to 5 MB of JSON each.
- Checks prove a value is well-formed (format and check digits), not that an account, card, mailbox or person exists.
- Postcodes: US, GB, CA, AU, NZ, DE, FR, NL, BE, AT, CH, IE, ES, IT, PT, SE, NO, DK, FI, PL, JP, IN, SG, BR, MX, ZA.
- National IDs: us_ssn, uk_nino, ca_sin, au_tfn, nz_ird, nz_nhi, de_tax_id, fr_nir, es_dni, it_fiscal_code, nl_bsn, in_aadhaar, sg_nric (check digits as published by each issuer; the shared validators in lib/documents/pii/validators.ts).
- Phone numbers: E.164 allows 8–15 digits including the country code; national and international formats use simple grouping, not every country's own numbering plan.
- Validate many takes up to 10,000 entries.

## Build and test

```sh
node gallery/actions/scripts/build.mjs validation-formatting
npx vitest run __tests__/gallery-action-validation-formatting.test.ts
```

## Licence

Apache-2.0. Copyright UserTasks.
