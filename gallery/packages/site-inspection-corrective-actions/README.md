# Site inspection with corrective actions

A safety inspection checklist that turns every failed item into a tracked, evidenced and signed-off corrective action, built only from UserTasks features and official form controls:

- **Site safety inspection** form page in four numbered **steps** with a review step: a **lookup** into **Sites** (fills the site manager, address and risk class), a **Table** control holding the checklist (pre-filled with eight standard items; item, area, Pass / Fail / N/A, severity, notes), a **Rating** for the overall site condition, photo **attachments**, **Rich text** observations, an **Info card** summary and the inspector's **Signature**.
- **Site inspection** workflow (Form submitted): `FILTER_WHERE` / `COUNT` count the failures, a **decision table** sets the outcome band (Compliant, Minor actions, Major actions, Stop work) and the close-out **SLA**, the inspection is saved to **Inspections**, the site manager is emailed the report with the photos and a stop-work alert goes out when needed. A **loop** logs every failed item to **Corrective actions**; each one then becomes a corrective action task (due date from a second decision table, reminder, manager escalation) with an **Info card**, a **Progress** bar, photo evidence and a **Signature** sign-off. The safety manager finishes with a review task (**Info card**, **Progress** ring, **Rating**).
- **Inspection overview** form page as a dashboard: **Chart** controls of open actions by severity and by site (from the Corrective actions table), **Saved report** controls (failures by severity per site from workflow variables; open corrective action tasks), and a button that runs the **Open actions digest** workflow.

The form controls install with the package (Extensibility → Form controls). No integrations or API keys.

## After installing

1. Replace the sample rows in **Sites** with your sites and site managers.
2. Open **Forms → Site safety inspection** and share its page link (`/f/<id>`) with your inspectors; it works on a phone or tablet.
3. Open **Forms → Inspection overview** for the dashboard. The charts read the sample rows in **Corrective actions** until your own arrive.
4. Corrective actions go to the inspector who submitted the form; the review goes to the person who installed the package. Change the assignees in the designer if needed.
5. Optional: apply the **Inspections: 7 years** retention policy.

## How it works

- **Outcome band**: two or more high-severity failures, or a high-severity failure on a site rated 2 stars or less, is *Stop work* (1 day); any high-severity failure is *Major actions* (3 days); four or more failures *Major actions* (7 days); any failure *Minor actions* (14 days); otherwise *Compliant*.
- **Corrective actions** are worked through one after the other in checklist order. *Fixed* records the fix, root cause, closing date, signer and evidence count and emails the site manager the photos; *Cannot fix* marks the action *Escalated* for the safety manager.
- **Saved reports**: *Open corrective actions* (tasks), *Failed checks by severity and site* and *Inspections by outcome band* (workflow variables).
