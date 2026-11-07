# Employee pulse survey

A monthly engagement pulse and its follow-up loop, built only from UserTasks features and official form controls:

- **Employee pulse survey** form page in six **steps** with a progress bar and a review step: four **Likert scale** matrices (wellbeing, manager & team, growth, workload, with N/A), a **Slider** (0-10, would you recommend working here: eNPS), a heart **Rating** for mood, the department, an *Answer anonymously* option, a manager Person field shown only for named answers, and **Rich text** for one thing to change.
- **Pulse response** workflow (Form submitted): Set Variable expressions work out the four section averages (N/A ignored), an engagement score out of 100 and eNPS points; the **Engagement risk band** decision table returns Thriving / Okay / At risk and whether to follow up; the answer is saved in the **Pulse responses** data table (no name when anonymous).
- Named at-risk answers become a **manager follow-up** task with an **SLA**, reminder and escalation; the task shows the scores on an **Info card** (key / value) and a **Progress** bar, and records an action plan in a **Table** control (action, owner, due date) and conversation notes, which are emailed to the employee. Anonymous at-risk answers are only logged for the HR aggregate.
- **Pulse results** form page as a dashboard: **Chart** controls (engagement by department, eNPS by round, risk bands) from the data table, **Saved report** controls (section averages by round, open follow-ups), an Info card, and a button that runs the **Pulse round summary** workflow.
- Saved reports from workflow variables: engagement by department, section averages by round, eNPS by month, plus open follow-ups. Email templates for the thank-you, the agreed plan and the round summary. An 18-month retention policy.

The form controls install with the package (Extensibility → Form controls). No integrations or API keys.

## After installing

1. Open **Forms → Employee pulse survey** and share its page link (`/f/<id>`) with employees each month.
2. Open **Forms → Pulse results** for the dashboard. The charts read the 30 sample answers in **Pulse responses** until your own arrive.
3. Follow-ups go to the manager the employee picks, or to the person who installed the package when no manager is given.
4. Optional: apply the **Pulse responses: 18 months** retention policy.

## How the scores work

Each section score is the average of its Likert answers (1 = strongly disagree … 5 = strongly agree; N/A is ignored). The engagement score is the average of all answers on a 0-100 scale (1 → 0, 5 → 100). eNPS points are +100 for 9-10, 0 for 7-8 and -100 for 0-6; their average is the eNPS. Change the bands in the **Engagement risk band** decision table.

## About anonymity

Anonymous answers are stored without a name and never create a personal task, and the results page and reports only group by department and round. The workflow run itself still records who submitted the form (as every run does), so restrict who can see Pulse response runs if you promise strict anonymity.
