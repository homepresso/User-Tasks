# Visitor sign-in

A reception form for visitors, built only from UserTasks features: a reusable **form page** with a grid layout, header and mini theme, a **lookup** into the Staff directory table, the **Form submitted** trigger, a data table log, an email template and a task form with outcome buttons.

## After installing

1. Open **Forms → Visitor sign-in** and copy its page link (`/f/<id>`) to the reception tablet.
2. Replace the sample rows in **Staff directory** with your hosts.
3. Optional: apply the **Visitor log: 12 months** retention policy to the **Visitor log** table.

## How it works

- The visitor signs in; the host lookup fills the host's email and team.
- The success screen welcomes the visitor by name.
- The **Visitor arrival** workflow logs the visit, emails the host and, if an NDA is needed, gives reception (the person signed in on the tablet) a task with **NDA signed** / **Visitor refused** buttons.
