# Customer satisfaction (CSAT / NPS) survey

A customer survey and its follow-up loop, built only from UserTasks features and official form controls:

- **Customer satisfaction survey** form page in three **steps** with a progress bar and a review step: **Rating** (1-5 stars), **Slider** (0-10, likelihood to recommend), **Likert scale** (speed, knowledge, ease, value, with N/A) and **Rich text** (comment).
- **Survey response** workflow (Form submitted): a **decision table** classifies promoter / passive / detractor and sets the follow-up SLA, the answer is saved in the **Survey responses** data table, low scores become a follow-up task with an **SLA**, reminders and manager escalation, and **email templates** thank the customer or confirm what was agreed.
- **Survey results** form page as a dashboard: **Chart** controls (NPS by month, category split) from the data table, **Saved report** controls (NPS by product area from workflow variables, open follow-ups), and a button that runs the **Monthly NPS summary** workflow.

The form controls install with the package (Extensibility → Form controls). No integrations or API keys.

## After installing

1. Open **Forms → Customer satisfaction survey** and share its page link (`/f/<id>`), or submit it from your app with `POST /api/v1/forms/{id}/submit`.
2. Open **Forms → Survey results** for the dashboard. The charts read the sample answers in **Survey responses** until your own arrive.
3. Follow-up calls go to the person who installed the package. Change the **Call the customer** step's assignee if someone else should call.
4. Optional: apply the **Survey responses: 24 months** retention policy.

## How NPS is worked out

Each answer gets NPS points: +100 for promoters (9-10), 0 for passives (7-8) and -100 for detractors (0-6). The average of the points is the NPS (% promoters minus % detractors), which is what the monthly chart plots. Change the thresholds in the **NPS category and follow-up** decision table.
