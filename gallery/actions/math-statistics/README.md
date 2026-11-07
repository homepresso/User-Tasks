# Math & statistics (`ut_math`)

Numeric building blocks for UserTasks workflows: a safe formula evaluator with variables (its own parser, never `eval`), decimal-exact rounding in six modes, descriptive statistics and percentiles over a list of numbers or a field of a list of objects, compound interest with contributions, monthly loan amortisation schedules and unit conversion.

Official UserTasks workflow action, version 1.0.0. Source: `src/action.ts`; built module: `dist/action.js` (one self-contained ES module that runs in the UserTasks QuickJS sandbox).

## Operations

### Evaluate formula (`evaluate`)

Evaluate an arithmetic formula with + - * / % ^ and parentheses, variables from an object and the functions abs, round, floor, ceil, sqrt, min, max, pow, log, ln, exp, sin, cos and tan (constants pi and e). Never runs code.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `expression` | string | yes |  | For example (price * qty) * (1 + tax_rate) - discount. Variable names may be dotted paths into Variables (order.total). ^ is power, % is remainder; log(x) is base 10, log(x, b) base b, ln(x) natural. |
| `variables` | object | no |  | The values the formula uses, as an object: { "price": 19.99, "qty": 3 }. Numeric text is accepted. |
| `decimals` | integer | no |  | Optional: round the result to this many decimal places (half up). Leave empty for the full result. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | number | The value of the formula. |

### Round (`round`)

Round a number to a number of decimal places with an explicit rounding mode. Decimal-exact: 1.005 rounds to 1.01.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | number | yes |  | The number to round. |
| `decimals` | integer | no | `0` | Decimal places (0 for whole numbers; negative rounds to tens, hundreds…). |
| `mode` | choice: `half_up`, `half_even`, `up`, `down`, `floor`, `ceil` | no | `"half_up"` | How to round a value that sits between two results. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | number | The rounded number. |

### Statistics (`stats`)

Descriptive statistics for a list of numbers (or a field of a list of objects): count, sum, mean, min, max, median, mode, variance, standard deviation and range.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `values` | list | yes |  | The numbers: a list of numbers (or numeric text), or a list of objects with Field naming the number. Blank entries are skipped. |
| `field` | string | no |  | When Values is a list of objects: the property holding the number (dotted paths such as amount.total work). |
| `variance_type` | choice: `sample`, `population` | no | `"sample"` | Sample (n - 1, for a sample of a larger population) or population (n, for the whole set). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `count` | integer | How many numbers there are (blank entries are skipped). |
| `sum` | number |  |
| `mean` | number | The average (empty when there are no numbers). |
| `min` | number |  |
| `max` | number |  |
| `median` | number | The middle value (the average of the two middle values for an even count). |
| `mode` | number | The most frequent value (the smallest if several tie); empty when no value repeats. |
| `variance` | number | Sample variance needs at least 2 numbers. |
| `stddev` | number |  |
| `range` | number | Maximum minus minimum. |

### Percentile (`percentile`)

The p-th percentile of a list of numbers, with linear interpolation between the closest ranks (the same as Excel PERCENTILE.INC).

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `values` | list | yes |  | The numbers: a list of numbers (or numeric text), or a list of objects with Field naming the number. Blank entries are skipped. |
| `field` | string | no |  | When Values is a list of objects: the property holding the number (dotted paths such as amount.total work). |
| `p` | number | yes |  | From 0 to 100: 50 is the median, 90 the 90th percentile. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `value` | number | The percentile. |
| `count` | integer | How many numbers were used. |

### Compound interest (`compound_interest`)

Grow a starting amount with compound interest and optional regular contributions; returns the future value and a year-by-year schedule.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `principal` | number | yes |  | The amount invested at the start. |
| `annual_rate` | number | yes |  | Nominal annual interest rate in percent, e.g. 5 for 5%. |
| `years` | integer | yes |  | How many years (1 to 100). |
| `compounds_per_year` | integer | no | `12` | 1 yearly, 4 quarterly, 12 monthly, 52 weekly, 365 daily. |
| `contribution` | number | no | `0` | Optional amount added every compounding period (e.g. monthly when compounding monthly). |
| `contribution_timing` | choice: `end`, `start` | no | `"end"` | Whether contributions are added at the start or the end of each period. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `future_value` | number | The balance at the end, rounded to 2 decimals. |
| `total_contributions` | number | The starting amount plus every contribution. |
| `interest_earned` | number | Future value minus total contributions. |
| `schedule` | list of objects | One row per year. Each item: `year` (integer), `contributions` (number), `interest` (number), `balance` (number). |

### Loan schedule (`loan_schedule`)

Monthly amortisation schedule for a fixed-rate loan: the payment (P·r / (1 − (1 + r)^−n)), each period's interest and principal, the balance, totals and the payoff date. Extra payments shorten the loan.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `principal` | number | yes |  | The amount borrowed. |
| `annual_rate` | number | yes |  | Nominal annual interest rate in percent (0 for an interest-free loan). |
| `term_months` | integer | yes |  | Number of monthly payments (1 to 600), e.g. 360 for 30 years. |
| `start_date` | date | no |  | Optional: the date of the first payment; later payments fall on the same day of each month (the last day in shorter months). |
| `extra_payment` | number | no | `0` | Optional extra principal paid with every payment. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `payment` | number | The regular payment (the last one may be smaller). |
| `total_interest` | number |  |
| `total_paid` | number | Principal plus interest. |
| `number_of_payments` | integer | Fewer than the term when extra payments are made. |
| `payoff_date` | date | The date of the last payment (empty without a first payment date). |
| `schedule` | list of objects | One row per payment. Each item: `period` (integer), `date` (date), `payment` (number), `principal` (number), `interest` (number), `balance` (number). |

### Convert units (`convert_units`)

Convert a value between units of length, mass, volume, temperature, area, speed, data size and time.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | number | yes |  | The amount to convert. |
| `from` | string | yes |  | Symbol or name: mm cm m km in ft yd mi nmi · mg g kg t oz lb st · ml l m3 tsp tbsp floz cup pt qt gal gal_uk · C F K · m2 km2 ha ac ft2 · m/s km/h mph kn · bit B kB MB GB TB KiB MiB GiB Mb Gb · ms s min h d wk mo yr. |
| `to` | string | yes |  | A unit of the same kind as From unit. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `result` | number | The converted value (12 significant digits). |
| `category` | string | length, mass, volume, temperature, area, speed, data or time. |
| `from_unit` | string |  |
| `to_unit` | string |  |

## Capabilities

None: pure computation. The action cannot reach the network, data tables, files or secrets.

## Examples

**Order total with tax and discount** (`evaluate`)

```json
{
  "expression": "(price * qty) * (1 + tax_rate) - discount",
  "variables": {
    "price": 19.99,
    "qty": 3,
    "tax_rate": 0.15,
    "discount": 5
  },
  "decimals": 2
}
```

Variables come from an object; the result is rounded to 2 decimals.

**Five-year car loan** (`loan_schedule`)

```json
{
  "principal": 25000,
  "annual_rate": 7.9,
  "term_months": 60,
  "start_date": "2026-12-01"
}
```

**Summary of response times** (`stats`)

```json
{
  "values": [
    {
      "minutes": 12
    },
    {
      "minutes": 15
    },
    {
      "minutes": 15
    },
    {
      "minutes": 18
    },
    {
      "minutes": 21
    },
    {
      "minutes": 30
    }
  ],
  "field": "minutes"
}
```

**Banker's rounding** (`round`)

```json
{
  "value": 2.345,
  "decimals": 2,
  "mode": "half_even"
}
```

Half even rounds 2.345 to 2.34 and 2.355 to 2.36.

**Marathon in kilometres** (`convert_units`)

```json
{
  "value": 26.2,
  "from": "mi",
  "to": "km"
}
```

A sample workflow ships in `assets/workflows/`: it starts from the API or its start form, runs this action with default inputs and shows the outputs.

## Limits

- Each run has 5 seconds and 32 MB of sandbox memory; inputs and outputs are limited to 5 MB of JSON each.
- Formulas: up to 4,000 characters and 64 levels of nesting; a result that is not a finite number (overflow, 0/0) is an error.
- Loan schedules: up to 600 monthly payments. Interest is computed per period on the balance in cents and rounded half up; the last payment is adjusted so the balance ends at exactly 0.
- Compound interest: 1 to 100 years, up to 365 compounding periods a year.
- Unit conversion results have 12 significant digits. A month is 1/12 of a Gregorian year (30.436875 days) and a year 365.2425 days.

## Build and test

```sh
node gallery/actions/scripts/build.mjs math-statistics
npx vitest run __tests__/gallery-action-math-statistics.test.ts
```

## Licence

Apache-2.0. Copyright UserTasks.
