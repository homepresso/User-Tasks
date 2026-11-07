# Text toolkit (`ut_text`)

Text operations for UserTasks workflows: slugs, case conversion, `{{placeholder}}` templates, truncation, extraction between markers, fuzzy matching (Levenshtein and Jaro-Winkler), word counts and masking of sensitive values.

Official UserTasks workflow action, version 1.0.0. Source: `src/action.ts`; built module: `dist/action.js` (one self-contained ES module that runs in the UserTasks QuickJS sandbox).

## Operations

### Slugify (`slugify`)

Turn text into a URL- and file-name-safe slug: accents removed (é → e, ß → ss), & becomes "and", everything else that is not a letter or digit becomes the separator.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | string | yes |  | The text to turn into a slug. |
| `separator` | string | no | `"-"` | Placed between words (up to 3 punctuation characters). |
| `lowercase` | boolean | no | `true` | Lowercase the slug. |
| `max_length` | integer | no | `0` | Optional: cut the slug to this many characters, at a word boundary when possible (0 = no limit). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `slug` | string | For example creme-brulee-and-cafe-menu-2026. |

### Change case (`change_case`)

Convert between camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title Case, Sentence case, UPPER and lower. Words are split on spaces, punctuation and case changes (parseHTTPResponse → parse HTTP response).

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | string | yes |  | The text or identifier to convert. |
| `case` | choice: `camel`, `pascal`, `snake`, `kebab`, `constant`, `title`, `sentence`, `upper`, `lower` | no | `"snake"` | The case to convert to. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | string |  |

### Fill template (`template`)

Replace {{name}} placeholders with values from an object. Paths reach nested values ({{customer.name}}, {{items[0].sku}}) and {{name | fallback}} gives a default. Objects and lists are inserted as JSON.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `template` | text | yes |  | Text with {{placeholders}}. |
| `data` | object | no |  | The values, as an object. |
| `missing` | choice: `keep`, `blank`, `error` | no | `"keep"` | Keep the {{placeholder}}, leave it blank, or fail the step. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | text | The filled-in text. |
| `missing` | list of strings | Placeholder paths that had no value (and no fallback). |
| `replaced` | integer | How many placeholders were filled. |

### Truncate (`truncate`)

Shorten text to a number of characters or words and add an ellipsis. In character mode the result, ellipsis included, fits the length and does not cut a word in half when it can avoid it.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | text | yes |  | The text to shorten. |
| `length` | integer | yes |  | Maximum characters (or words). |
| `by` | choice: `chars`, `words` | no | `"chars"` | Count characters or words. |
| `ellipsis` | string | no | `"…"` | Added when the text is cut; enter none for no ellipsis. |
| `preserve_words` | boolean | no | `true` | In character mode, cut at the last space instead of mid-word. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | text |  |
| `truncated` | boolean | Whether the text was shortened. |

### Extract between (`extract_between`)

Find the text between a start and an end marker (the first match or all of them). Leave the start empty to read from the beginning, or the end empty to read to the end.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | text | yes |  | The text to search. |
| `start` | string | no |  | Text just before the value. |
| `end` | string | no |  | Text just after the value. |
| `all` | boolean | no | `false` | Return every match instead of the first. |
| `include_markers` | boolean | no | `false` | Keep the start and end markers in the result. |
| `case_sensitive` | boolean | no | `true` | Match the markers exactly (off: ignore case). |
| `trim` | boolean | no | `true` | Trim spaces around each match. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `value` | string | The first match (empty when none). |
| `matches` | list of strings | Every match (one when All matches is off). |
| `count` | integer |  |
| `found` | boolean |  |

### Similarity / fuzzy match (`similarity`)

Compare a value with another (Levenshtein distance, normalised similarity 0–1 and Jaro-Winkler) and/or find its best fuzzy match in a list of candidates, with a threshold.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | string | yes |  | The text to compare or look up. |
| `compare_to` | string | no |  | Optional: a second text to compare with. |
| `candidates` | list | no |  | Optional: a list of texts to find the best match in. |
| `threshold` | number | no | `0.8` | Score (0–1) at or above which it counts as a match. |
| `method` | choice: `jaro_winkler`, `levenshtein` | no | `"jaro_winkler"` | Score used for the candidate list and the threshold. |
| `case_sensitive` | boolean | no | `false` | Off: compare ignoring case (spaces are always normalised). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `distance` | integer | Levenshtein distance between Value and Compare to (empty without Compare to). |
| `similarity` | number | 1 − distance / longer length (0–1). |
| `jaro_winkler` | number | Jaro-Winkler score (0–1). |
| `best_match` | string | The candidate with the highest score (empty without candidates). |
| `best_score` | number |  |
| `best_index` | integer | Position of the best match in the list (from 0; −1 when none). |
| `matched` | boolean | Whether the score reaches the threshold. |

### Word count (`word_count`)

Count words, characters (with and without spaces), sentences and paragraphs, and estimate the reading time.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `text` | text | no |  | The text to count (empty text counts as 0). |
| `words_per_minute` | integer | no | `200` | Words per minute for the reading time. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `words` | integer |  |
| `characters` | integer |  |
| `characters_no_spaces` | integer |  |
| `sentences` | integer |  |
| `paragraphs` | integer |  |
| `reading_minutes` | integer | Rounded up; 0 for empty text. |

### Mask (`mask`)

Hide part of a sensitive value: keep the last or first N characters, mask everything, or mask an email address (a***@example.com). Spaces and dashes can stay visible so the shape remains readable.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | string | yes |  | The value to mask. |
| `mode` | choice: `keep_last`, `keep_first`, `email`, `all` | no | `"keep_last"` | What to keep visible. |
| `keep` | integer | no | `4` | N for Keep the last / first N (never more than half of the value is shown). |
| `mask_char` | string | no | `"*"` | The character that replaces hidden ones. |
| `preserve_separators` | boolean | no | `true` | Leave spaces, dashes, dots, slashes, + and brackets unmasked. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `masked` | string |  |

## Capabilities

None: pure computation. The action cannot reach the network, data tables, files or secrets.

## Examples

**A slug from a title** (`slugify`)

```json
{
  "text": "Crème brûlée & Café Menu 2026!"
}
```

**Best match for a misspelt name** (`similarity`)

```json
{
  "value": "Jon Smyth",
  "candidates": [
    "John Smith",
    "Joan Smythe",
    "Jonas Schmidt"
  ],
  "threshold": 0.85
}
```

**Fill a message template** (`template`)

```json
{
  "template": "Hi {{customer.first_name}}, your order {{order.id}} ships {{order.ship_date | soon}}.",
  "data": {
    "customer": {
      "first_name": "Aroha"
    },
    "order": {
      "id": "SO-1042"
    }
  }
}
```

order.ship_date is missing, so its fallback "soon" is used.

**Mask a card number** (`mask`)

```json
{
  "value": "4111 1111 1111 1111",
  "mode": "keep_last",
  "keep": 4
}
```

**Identifier to camelCase** (`change_case`)

```json
{
  "text": "customer order ID",
  "case": "camel"
}
```

A sample workflow ships in `assets/workflows/`: it starts from the API or its start form, runs this action with default inputs and shows the outputs.

## Limits

- Each run has 5 seconds and 32 MB of sandbox memory; inputs and outputs are limited to 5 MB of JSON each.
- Text inputs: up to 1,000,000 characters (similarity: 10,000 characters per value and 10,000 candidates).
- Lengths and positions count Unicode code points, so accented letters and emoji count as one character.
- Slugs contain ASCII letters and digits only: letters from scripts without an ASCII form (Cyrillic, CJK, …) are dropped.

## Build and test

```sh
node gallery/actions/scripts/build.mjs text-toolkit
npx vitest run __tests__/gallery-action-text-toolkit.test.ts
```

## Licence

Apache-2.0. Copyright UserTasks.
