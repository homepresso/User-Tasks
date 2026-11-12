import type { DocPageDef } from '../types'

export const INFOPATH_IMPORT_PAGE: DocPageDef = {
  slug: 'tasks/import-infopath',
  title: 'Import InfoPath forms',
  description: 'Upload a Microsoft InfoPath form template (.xsn): each view becomes a UserTasks form, with its fields, repeating tables, rules, validation and formulas converted where they translate, and a report of everything else.',
  body: `
Microsoft InfoPath is retired, but many teams still run forms built with it. UserTasks reads an InfoPath form template (**.xsn**) and rebuilds it as UserTasks forms. Each view becomes a form. Rules, validation and formulas are converted where they translate. Everything that doesn't convert is listed in a report and kept as a turned-off rule with its original expression, so nothing is lost silently.

## Import a form

1. Go to **Build › Forms** and select **Import → InfoPath form (.xsn)**.
2. Drag the .xsn onto the box, or click to browse. UserTasks analyses it. The file is only read, never stored.
3. Check the review:
   - **Views**: each ticked view becomes a form called "*Form* — *View*". Untick views you don't need, such as print views.
   - **Make**: *One form per view* (the default), or *Views as steps* / *Views as tabs* to combine the views into one form (InfoPath **Switch view** rules then go to that step or tab).
   - The counts: fields, repeating tables, and how many rules, validations and formulas convert.
   - **Preview**: each form as it will look.
   - **Full report**: every item and what it became, which you can download as Markdown or JSON.
4. Optionally:
   - change the form name, or add a tag (the forms are always tagged with the form name and **infopath**);
   - choose **Create a data table for the submissions**. This also makes a child table for each repeating table, and a draft workflow that saves each submission (review it, then publish).
   - choose **Show in the Forms menu**.
5. Select **Import**, then **Open in the designer**.

You need **forms.edit** to import, plus **data.create** and **workflows.create** (or **workflows.edit**) for the data table option.

### Importing again

When you upload the same file again (matched by its file name), UserTasks offers to **update the forms it made before**. Each form gets a new version, and workflows pinned to an older version keep it. You can also **create new forms** instead.

## What maps

| InfoPath | UserTasks |
|---|---|
| Text box | Text, or Number / Currency / Date / URL / Email from the field's data type and format |
| Rich text box | Rich text (bold, italic, lists, links; sanitised) |
| Date picker, date and time picker | Date, Date & time |
| Time field | Text with an HH:MM pattern |
| Drop-down list, list box, combo box | Single select with the options |
| Option buttons | Single select shown as radio buttons |
| Multiple-selection list box | Multi-select shown as a list box |
| Bulleted, numbered or plain list | Text list (one entry per item, same markers) |
| Hyperlink | URL (opens in a new tab) |
| Picture control | Image (upload or camera; a picture saved in the template becomes its default) |
| Picture placed in the view (a logo) | Display image, stored with the form |
| Signature line, ink picture, digital signature | Signature (an electronic signature: drawn or typed, with the signer and time) |
| Check box | Checkbox (yes/no) |
| File attachment | Attachments |
| Person / group picker | Person picker (several people) |
| Calculated value (expression box) | Label with an expression, keeping its number, currency or percent format |
| Button | Button, with its rules on **Button clicked** |
| Repeating table | List (editable table), a column for each control in the row; a repeating table inside it becomes a nested List (up to 3 levels) |
| Repeating section | Repeating section: a card per item with the same controls and layout; nested sections nest (up to 3 levels) |
| Choice group (choice sections) | Choice group: one of its sections shows, picked with a switch |
| Section, optional section | Section, optional section |
| Layout tables | Rows of up to 4 columns, in the same order |
| "Cannot be blank", non-blank data types | Required |
| Schema patterns, ranges, lengths | Pattern, min / max, min / max length |
| Default values | Defaults (*template.xml*) |
| Default value with a formula (once) | A **Form loads** rule that sets the value |
| Calculated default that updates | A Label with the expression, stored with the submission |
| Row arithmetic in a repeating table | A calculated column, e.g. \`quantity * unit_price\` |
| Conditional formatting: hide | **Always** rule: hide while the condition holds |
| Conditional formatting: read-only / disable | **Always** rule: read only (fields) or disable (buttons) |
| Conditional formatting: font colour, shading, bold, italic, underline, strikethrough | **Always** rule with **Set style** (colours snap to the theme's tones and the report gives the original colour); in a repeating table, a List **row style** on that cell |
| Data validation on a repeating field | A List column validation (per row) or a rule on each Repeating section item |
| User roles, \`get-Role()\` | Conditions on the person's workspace roles (\`user.roles contains "Supervisor"\`) |
| Data validation | **Always** rule with a field error |
| Rules on a field / button / form load / submit | **Field value changes**, **Button clicked**, **Form loads**, **Before submit** |
| Rule: set a field's value | Set values, with \`{{= … }}\` formulas |
| Rule: show a message | Show a message |
| Rule: switch view | Go to step (with *views as steps*) |
| Rule: query a data connection | **Table list**, or **Call an API reference**, when a data table or API reference has the connection's name |

XPath conditions and formulas are translated to UserTasks conditions and [expression functions](/docs/workflows/expressions):

| XPath | UserTasks |
|---|---|
| \`=\`, \`!=\`, \`<\`, \`>\`, \`and\`, \`or\`, \`not()\` | conditions (AND / OR groups) |
| \`. = ""\`, \`string-length(x) > 0\` | is empty, is not empty |
| \`contains\`, \`starts-with\` | contains, starts with |
| \`concat\`, \`sum\`, \`count\`, \`round\`, \`floor\`, \`ceiling\`, \`string-length\`, \`normalize-space\` | \`CONCAT\`, \`SUM\`, \`COUNT\`, \`ROUND\`, \`ROUND_DOWN\`, \`ROUND_UP\`, \`LENGTH\`, \`NORMALIZE_SPACE\` |
| \`substring-before\`, \`substring-after\`, \`substring\`, \`translate\`, \`starts-with\` | \`SUBSTRING_BEFORE\`, \`SUBSTRING_AFTER\`, \`MID\`, \`TRANSLATE\` (or \`UPPER\` / \`LOWER\`), \`STARTS_WITH\` |
| \`sum(rows[col = "x"]/amount)\`, \`count(rows[col = "x"])\` | \`SUMIF\`, \`COUNTIF\` over the List |
| \`xdMath:Eval(rows, "qty * price")\` in a sum / average | A calculated List column, summed |
| \`xdMath:Nz\`, \`Avg\`, \`Max\`, \`Min\`, \`xdUtil:Concat\` | \`COALESCE\`, \`AVG\`, \`MAX\`, \`MIN\`, \`CONCAT\` |
| \`today()\`, \`now()\`, \`addDays()\` | \`TODAY()\`, \`NOW()\`, \`ADD_DAYS()\` |
| \`+\`, \`-\`, \`*\`, \`div\`, \`mod\` | \`+\`, \`-\`, \`*\`, \`/\`, \`MOD()\` |
| \`userName()\`, \`get-DisplayName()\` in a set-value rule | \`{{user.email}}\`, \`{{user.name}}\` |

## What doesn't convert

Each of these is listed in the report. Behaviour is kept as a **turned-off rule** whose **Notes** hold the original XPath, so you can finish it in the Rules tab.

- **Data connections** (SharePoint lists, web services, databases, XML files). Create a data table or an [integration](/docs/integrations) with the same name and import again: query rules then use it, and drop-downs fed by it get their options from the table. Until then those drop-downs are text fields.
- **Form code** (script or managed code). It is never imported or run.
- **Certificates.** Digital signatures become electronic signatures; certificates aren't carried over.
- **Font sizes and families** (the form theme sets them), and formatting that hides or locks one cell of a repeating table (use a Repeating section for per-item behaviour).
- A few XPath forms: \`position()\` / \`last()\` in formulas, predicates other than one \`=\` comparison, \`xdMath:Eval\` outside a sum or average, and reads of secondary data sources (\`GetDOM\`).
- Signatures inside repeating sections (sign the whole form instead), and nesting deeper than 3 levels.
- **Rules that convert in part.** The actions that translate run; the report marks the rule *in part* and its notes say what is left.
- **Person fields on a public form.** Anonymous visitors on a public link don't see Person fields (there is no one to look up), so give a public form a text or email field instead.

## Limits

- **.xsn files up to 4 MB** in the app (the request body limit of hosted serverless platforms is about 4.5 MB). With the [REST API](/docs/api) or the CLI on a self-hosted instance, files up to 20 MB are accepted (\`INFOPATH_MAX_MB\`).
- **Large templates**: images make most .xsn files big. In InfoPath Designer, use **File → Publish → Export Source Files**, zip the folder (you can leave out the images) and upload the **.zip**.
- **Compression**: InfoPath saves with MSZIP, which is supported. A template re-packed with LZX compression is refused with a message: save it again from InfoPath Designer, or upload the zipped source files.
- At most 200 fields and 100 rules per form, and 40 views per file. If a view needs more rules, the report lists those left out.
- Files are checked before they are read: at most 1,000 files and 96 MB unpacked, with no external entities or DTDs in the XML, and a time limit.

## Tips

- Import the **default view** first, and untick print-only and admin views.
- Use **views as steps** when the views are stages of one process, such as a request and an approval.
- Check the report's **Needs attention** items, then open each form's **Rules** tab. Turned-off rules start with the InfoPath rule name, and their notes say what is left to do.
- Turn on **Create a data table** to keep submissions the way an InfoPath form library did. Then publish the draft workflow.

## API, MCP, CLI and the Agent

- **REST**: \`POST /api/v1/forms/import/infopath\` with \`file_base64\` (or multipart \`file\`), \`file_name\`, and options \`mode\`, \`views\`, \`name\`, \`tag\`, \`existing\` (\`new\` / \`update\`), \`create_table\`, \`available_in_menu\`. \`dry_run: true\` returns the report and the forms it would make, and stores nothing.
- **MCP**: \`forms_import_infopath\`, with the same arguments.
- **CLI**: \`usertasks forms import-infopath --set file_base64=@@Expense.xsn --set file_name=Expense.xsn --set dry_run:=true\`. \`@@\` reads a file as base64.
- **Agent**: attach an .xsn in the Agent panel. The Agent reads the analysis and can explain what converts. **Import this InfoPath form** imports it after you confirm.
`,
}
