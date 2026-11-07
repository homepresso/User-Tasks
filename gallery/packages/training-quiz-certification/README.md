# Training feedback, quiz and certificate

End-of-course feedback, a scored quiz and a PDF certificate, built only from UserTasks features and official form controls:

- **Training feedback and quiz** form page in four numbered **steps** with a review step: a course lookup from the **Courses** data table (title, trainer, pass mark and validity fill in), **Rating** controls for the trainer and the content, a **Likert scale** on course quality, six multiple-choice questions on information security basics, and an attestation with the **Signature** control.
- **Quiz submitted** workflow (Form submitted): Set Variable expressions score the quiz and list the topics to revise; the **Quiz result band** decision table compares the score with the course pass mark (pass / retake / session); the result is saved in the **Quiz results** data table.
- **Pass**: a certificate number and expiry (course validity in months), an HTML certificate from a Text template converted to **PDF** on the server, recorded in Quiz results and emailed as an attachment.
- **Retake**: a task for the learner with their score on a **Progress** bar (warn below 60 %, good from 80 %) and the topics to revise on an **Info card**.
- **Fail**: a task for the training coordinator (the person who installed the package) to book a session, with an **SLA**, reminder and escalation; the booking is emailed to the learner.
- **Training results** form page as a dashboard: **Chart** controls (average score by course, pass / retake / fail) from Quiz results, **Saved report** controls (pass rate by course, average scores and ratings, open retakes and sessions), and a button that runs **Training summary and expiry reminders**.
- Email templates for the certificate, the session booking, expiry reminders and the summary; a seven-year retention policy.

The form controls install with the package (Extensibility → Form controls). No integrations or API keys: the PDF is made by the built-in converter.

## After installing

1. Replace the sample **Courses** with your catalogue (code, title, pass mark, validity in months, trainer).
2. Share **Forms → Training feedback and quiz** (`/f/<id>`) with learners at the end of the course.
3. Open **Forms → Training results** for the dashboard; press the button to email yourself a summary and remind learners whose certificates expire soon.
4. Optional: apply the **Quiz results: 7 years** retention policy.

## Changing the quiz

The six questions are choice fields on the quiz form. Their correct answers are in the **Correct answers** and **Topics to revise** steps of the Quiz submitted workflow (`IF(form.q1 == "…", 1, 0)`): when you change a question, change its answer there too. The score is the share of correct answers; the pass mark comes from the course.
