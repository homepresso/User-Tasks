# Contract and policy review with internal e-sign

Document review and internal sign-off for policies, contracts and procedures, built only from UserTasks features and official form controls:

- **Document review request** form page in three **steps** with a review step: title, **document type** (a lookup on the **Document types** table that fills the review route into an **Info card**), effective date, the PDF (an **Attachments** field limited to PDF, previewed with the **PDF viewer**), owner and reviewers (Person fields) and a **Rich text** summary of changes.
- **Document review and sign-off** workflow (Form submitted): reference number, the **Review route** decision table (reviewers, legal review, days per review), the **Documents register**, reviewer tasks that show the PDF in the **PDF viewer** with **Rich text** redline comments (Approve / Request changes), a revision loop back to the submitter with an **SLA**, optional legal review, the owner's **Signature** e-sign, a SHA-256 checksum of the signed file, a sign-off certificate PDF (text template → PDF, merged with the document) and **email templates**.
- **Audit log** data table: one row per step (who, what, when, version, outcome, file), each with the **Document records: 7 years** retention policy applied by the workflow.
- **Document register** form page as a dashboard: **Chart** controls (documents by status and by type) from the register, **Saved report** controls (review cycle time from workflow variables, open review tasks) and a button that runs the **Reviews due summary** workflow.

The form controls install with the package (Extensibility → Form controls). No integrations or API keys.

## After installing

1. Open **Forms → Document review request** and share its page link (`/f/<id>`).
2. Edit **Review route** (decision table) and **Document types** to match your governance.
3. Legal review goes to the person who installed the package: change the **Legal review** step's assignee to your legal team.
4. Open **Forms → Document register** for the dashboard; it reads the sample rows until your own documents arrive.

## How the PDF reaches the reviewers

The submitted file list is kept in the `current_document` run variable. Each task has a read-only **PDF viewer** field whose default is `{{current_document}}`, so the task opens with the PDF on screen. When the submitter uploads a revision, `current_document` becomes the new file and the next reviewer sees that version.

## E-sign and audit

The owner's sign-off task needs the "I approve this version for publication" box and a **Signature**. The Audit log row for the sign-off records the signer, the time, the file name, its SHA-256 checksum and the signature image name; the same details are on the certificate PDF.
