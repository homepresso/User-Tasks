# People & Culture: engagement, performance and growth

A complete people app for an organisation of any size: engagement surveys and pulses with anonymity-safe results, goals and OKRs, performance reviews with peer feedback and calibration, a recognition wall, development plans and one-to-ones. Fictional company (Fernhill Labs) and people; amounts in USD.

## What's inside

| Asset | What it does |
|---|---|
| **People & Culture** (app) | Top tabs: Home, Engagement, My team, Goals, Performance, Recognition, Growth; hidden pages Admin and Goal (opened in a side panel). |
| **Engagement survey**, **Pulse check** (forms) | A multi-page survey of agreement matrices by driver, eNPS and a comment; a two-minute pulse. Both take the cycle from the link (`?cycle=ENG-2026-Q4`). |
| **Give recognition**, **Set a goal**, **Goal check-in**, **Request feedback**, **Log a one-to-one**, **Create a development plan**, **Create action plan**, **Launch a survey**, **Start a performance review** (forms) | Every action of the app, each opened in a slide-in panel. Set a goal and development plans use repeating sections. |
| **Survey cycle** (workflow) | Adds the cycle, invites the audience, reminds non-responders, waits for the close date, calls **Publish survey results**, then asks the People partner to agree action plans. |
| **Survey response**, **Pulse response** (workflows) | Mark the person as responded (date only), update participation, compute % favourable per driver and eNPS points, wait sealed until close, write an anonymous ballot. |
| **Publish survey results** (workflow) | Ballots → Engagement results per segment with suppression under the minimum group size, comment themes (decision table), cycle headline numbers; deletes the ballots. |
| **Performance review**, **Peer feedback**, **Feedback request** (workflows) | Self review → peer nominations → peer feedback → manager review → calibration → share → acknowledge, with SLA, due dates, reminders and escalation. |
| **Goal set**, **Goal check-in**, **Goal check-in reminders** (weekly), **Action plan follow-up**, **One-to-one logged**, **Development plan created**, **Recognition given** (workflows) | The rest of the app's processes. |
| **Comment theme keywords**, **Performance and potential band** (decision tables) | Themes for comments; the nine-box band used in calibration. |
| 5 email templates | Invitation, reminder, kudos, goal check-in reminder, results published. |
| 20 data tables | People directory, Survey cycles, Survey question bank, Survey participation, Sealed survey ballots, Engagement results, Question results, Comment themes, Survey action plans, Goals and OKRs → Key results (child records), Performance reviews, Feedback, Recognition, Skills framework, Learning catalogue, Skill assessments, Development plans → Development actions (child records), One-to-ones. |
| **Open performance review steps** (report) | For the download button on the Performance page. |

## Roles

| Who | App role | What they get |
|---|---|---|
| Every employee | Viewer | Home, Engagement results (company and segments of five or more), Goals, Recognition, Growth. They answer surveys, give kudos, set goals and plans from the forms (submitting forms needs the Submit forms permission, which every role has). |
| Managers | Contributor | Also My team (their reports' reviews, goals, one-to-ones, a calendar), Performance and Admin, and the review and one-to-one tasks. |
| People team | Contributor (with Manage rows) | Also edits calibration ratings, the question bank, cycles, action plans and the directory in place. |

Add them under **Apps → People & Culture → Settings → Audience**. The audience never travels with a package.

## How anonymity works

- **No raw answers in any table people can read.** A survey answer only marks the person as *Responded* (the date, never the answers) in Survey participation. The Survey response workflow keeps the scores in its run and **pauses until the survey closes**.
- **Sealed ballots.** At close each response writes one ballot with no name, no submitter and no time of answering (every ballot is written at the same moment). A department, location or tenure group with fewer respondents than the cycle's **minimum group size** (default five) is written as "Other".
- **Aggregated results only.** Publish survey results reads the ballots, writes % favourable, eNPS and participation per segment — **scores only where at least the minimum group size answered** (a dash and "Fewer than 5 responses" otherwise) — and **deletes the ballots**. The dashboards read only these aggregated tables; comments are shown only as themes.
- **What the platform still keeps.** The form submission itself (answers with the submitter) is visible to the respondent and to people who can edit forms; the response workflow's run is visible to people who can view workflow runs. Give those permissions to the People team only, and consider a retention policy for the survey's submissions. Data tables have no per-table read permission, which is why the package never writes identifiable answers to one.
- **Known limit.** Comparing the company total with every published segment can narrow down a hidden "Other" group; keep the minimum group size at five or more and avoid very small segments.

## Customising

- **Questions:** each driver is a matrix on the Engagement survey form (rows = questions, values 1-5). Add rows and update the matching `score_*` step of Survey response.
- **Benchmark and colours:** the Engagement KPI target (72) and the app's warm palette (App settings → Style).
- **Ratings and nine-box:** the rating choices on the review tasks and the Performance and potential band decision table.
- **Company values:** the Give recognition form's value choices and the Recognition table's Value column.
- **AI themes:** comments are grouped by keyword rules. If your workspace has an AI agent, add a Run agent step after "Read the sealed ballots" in Publish survey results to summarise the comments per theme.

## Sample data

Generated deterministically: 150 employees in 8 departments, 5 locations (one small studio, so you can see a hidden segment) and 4 tenure bands; three published quarterly surveys (Q1-Q3 2026) with results for every segment and question; an open November pulse with live participation; the H2 2026 review cycle at every stage; 51 goals with 109 key results; 120 pieces of feedback; 200 kudos; 37 development plans; 80 one-to-ones; 16 action plans. Every survey number is an aggregate of at least five people.
