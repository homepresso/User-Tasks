import type { DocPageDef } from '../types'

export const SURVEY_CONTROLS_PAGE: DocPageDef = {
  slug: 'tasks/survey-controls',
  title: 'Survey controls and charts',
  description: 'Star ratings, NPS, agreement scales, grids, sliders, satisfaction faces, rankings, picture choices and Yes / No / Maybe in any form, and the charts that summarise them.',
  body: `
Forms have nine survey controls. They are built in, like Text or Single select: they work in the [form designer](/docs/tasks/forms), the [form wizard](/docs/tasks/form-wizard), task forms, public forms and embeds, in rules and validation, and they save to data tables and reports.

In the designer, find them in the **Survey** group of the palette. Their settings are in the field's properties.

## The controls

| Control | Type key | Stored value | Settings |
|---|---|---|---|
| **Star rating** | \`rating\` | a number, 1 to the maximum (0.5 steps with half stars) | Out of 2 to 10, stars / hearts / thumbs, half stars, end labels |
| **NPS (0 to 10)** | \`nps\` | a whole number 0 to 10 | End labels, colour bands (detractor 0–6, passive 7–8, promoter 9–10) |
| **Agreement scale** | \`likert\` | the chosen point (text), e.g. "Agree" | Ready-made scales (5 or 7 points) or your own, lowest first |
| **Matrix / grid** | \`matrix\` | one answer per statement: \`{ "speed": "Good", "price": "Fair" }\` | Statements (rows), the scale (columns) |
| **Slider** | \`slider\` | a number | Lowest, highest, step, unit, show the value, end labels |
| **Satisfaction faces** | \`csat\` | 1 (worst) to 3 or 5 | Three or five faces |
| **Ranking** | \`ranking\` | the options in order, best first: \`["Price", "Speed", …]\` | The options |
| **Picture choice** | \`image_choice\` | the option, or a list when several can be picked | An icon or an https image per option, pick several (with at least / at most), cards per row |
| **Yes / No / Maybe** | \`yes_no_maybe\` | the answer (text) | Two or three answers (rename them, e.g. Agree / Disagree / Not sure) |

**Required** works as for any field. For a grid it means every statement must be answered. A slider stays unanswered until it is moved or clicked; a ranking until something is moved or **Keep this order** is selected. An optional answer can be cleared with **Clear answer**.

**Read-only** greys the control out. A rule's **Make read only** keeps the answer visible and focusable, but it can't be changed. Completed tasks and submissions show the answer drawn (stars, a promoter badge, a small table for a grid, a numbered list for a ranking) with the text beside it.

## Rules and conditions

Rules compare survey answers like other values:

- numbers (rating, NPS, slider, faces): *equals*, *greater than*, *less than* — for example *Show "What could we do better?" when nps is less than 7*;
- text answers (agreement, Yes / No / Maybe, picture choice): *equals*, *is one of*;
- lists (ranking, picture choice with several picks): *contains*;
- a grid's statements, one at a time: pick *Rate us: Speed* in the condition (the path is \`<key>.<statement key>\`).

## Data tables, reports and exports

When a form saves to a data table (the wizard does this for you):

- ratings, NPS, sliders and faces go in **number** columns;
- agreement, Yes / No / Maybe and a single picture choice go in **select** columns with the options;
- a ranking and a multi-pick picture choice go in a **text** column;
- a **grid gets one select column per statement**, named "*Question*: *Statement*" with the key \`<key>_<statement key>\`, so reports can group and count every statement like any other choice. (In a workflow, map it with \`{{form.<key>.<statement key>}}\`.)

The submissions **CSV export** has one column per field; a grid has one per statement (\`<key>.<statement key>\`) and a ranking is written "A > B > C".

## Accessibility

Each control is keyboard and screen-reader friendly:

- single-answer controls are radio groups: Tab moves into the group at the chosen answer, the arrow keys move and choose, Home and End jump to the ends;
- every target is at least 44 pixels (half stars split a 44-pixel star in two);
- the label, help text and error message are announced with the control, and so is "required";
- a grid is one radio group per statement; on phones the statements stack with the answers spelled out;
- a ranking has **Move up** and **Move down** buttons on every item (dragging is optional), and each move is announced;
- colours come from the form theme, so themes and dark mode apply.

The designer's [accessibility check](/docs/tasks/forms) adds a **Survey controls** rule. It flags half stars for review, grids with more than 7 columns or more than 12 statements, a slider that hides its value without end labels, rankings of more than 10 options, and NPS colour bands without an explanation.

## Survey charts

The [wizard's results page](/docs/tasks/form-wizard) picks a chart for each question:

| Question | Chart |
|---|---|
| Star rating | The average with the stars filled to it, and how many chose each point |
| NPS | The score from −100 to +100 on a gauge, the promoter / passive / detractor split, and the 0–10 distribution. NPS = % promoters (9–10) − % detractors (0–6) |
| Agreement scale | One bar centred on the neutral point (disagree to the left, agree to the right), with the agree and disagree shares and the average point |
| Grid | The same centred bar for each statement, with its average |
| Slider | The average, median and range, and a histogram |
| Satisfaction faces | CSAT: the share of satisfied answers (the top two of five faces, the happy face of three), and how many chose each face |
| Ranking | The average position of each option (1 = ranked first) and how often it was first |
| Choices, picture choice, Yes / No / Maybe, checkboxes | Counts and shares (a split bar for yes / no / maybe) |
| Number, money | Average, lowest, highest and total |

It also shows **Responses over time** (the last 30 days) and **Answered per question**.

Every chart has a **Table** button that shows the same numbers as a table, and a one-line summary for screen readers. Colours come from your workspace theme and are checked for contrast and colour-blind separation in light and dark mode; the numbers are always written next to the colours. The numbers are worked out on the server, so only the totals reach the browser, however many responses there are.
`,
}
