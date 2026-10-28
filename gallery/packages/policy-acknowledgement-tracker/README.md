# Policy acknowledgement tracker

Track who has read and acknowledged each policy, built only from UserTasks features: **Policy register**, **Staff** and **Acknowledgements** data tables, a weekly **schedule**, a **loop** over staff, a **Record acknowledgement** sub-workflow (`call_sub_workflow`, async) with an outcome-button task form, email templates, **reminders** and **escalation to the manager**.

## After installing

1. Fill in **Policy register** (code, title, version, link, status `Current`, *Staff must acknowledge*, *Days to acknowledge*).
2. Replace the sample rows in **Staff** with your people (emails are where the requests and reminders go).
3. The schedule runs every Monday 09:00 Pacific/Auckland; change it on the trigger of **Weekly policy acknowledgements**.

Staff have no app accounts here, so all tasks go to the person who installed (activated) the package: the policy owner. To have people confirm themselves, add a UserTasks user per person and route the tracker task to them.

## How it works

- Policy: the `policy_code` input, or the most recently effective `Current` policy with *Staff must acknowledge* ticked.
- Each active person gets a row keyed `policy|version|email`. **New**: a `Pending` row, the *Please acknowledge a policy* email and a tracker task. **Pending**: the weekly reminder email and `reminders_sent + 1`. Otherwise nothing.
- After the loop, if anyone is still pending, the owner gets **Chase outstanding acknowledgements** listing them (due in 5 days, reminder, escalation to the manager after 5 days).
- A new version of a policy (change *Version*) starts a fresh round for everyone.
