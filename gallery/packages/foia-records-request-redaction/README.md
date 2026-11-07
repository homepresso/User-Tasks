# FOIA / public records request: evidence redaction and release

A public records request from the request form to the release package, with AI-assisted redaction of video, photos, audio and documents, an exemptions log and a legal reviewer who approves every release.

> Redaction aids the reviewer; it does not decide. Nothing is released until a person approves it. The deadline and exemption rows are configurable examples, not legal advice: adapt them with your counsel.

## What's inside

- **Public records request** form page (requester, law, records sought, date range, delivery) and the **Public records request** workflow (Form submitted trigger)
- **Records request rules (examples)** decision table: statutory days, day type, approximate calendar days for the SLA, extension and default exemption codes for US federal FOIA, an example US state act, the NZ OIA, the UK FOIA and a catch-all
- **Exemption codes** (configurable list), **Records requests** register, **Exemptions log** and **Request activity** (audit trail) data tables
- **Records requests: 7 years** retention policy
- **Google Gemini (media AI)** integration (your API key) and a **Records release portal** REST integration with a **Create release link** reference
- Email templates: acknowledgement, extension, no records, decision to withhold, release

## How it works

1. The form starts the run: reference, statutory deadline, SLA, register row, retention policy, acknowledgement email.
2. **Gather responsive records** (records officer): attach body-worn camera / CCTV video, photos, interview audio and documents; or answer **No records** (letter as PDF) or **Extend deadline** (new SLA and notice).
3. **Automated redaction**: Redact Video (faces, licence plates, on-screen text, speech bleeped from its transcript; runs in the background), Redact Image for each photo, Transcribe + bleep + transcript redaction for the interview, Redact Document in detect-only mode for the statement. Each item is logged with a proposed exemption.
4. **Legal review and release decision**: links to each original (restricted) and its redacted copy, exemption codes from the Exemption codes table, **Approve release**, **Partial release**, **Deny** or **Send back**.
5. **Release**: the document is redacted and converted to PDF, the cover letter and exemption log are generated as PDFs and merged into the release package, a download link is created and the requester is emailed the package or the link. Deny sends a decision letter.

## After installing

1. Complete setup: Gemini API key, the release portal URL and token, the records officer and the legal reviewer.
2. Review the two example tables with your counsel.
3. Share the form page link (`/f/<id>`) on your website.

Background media steps need FFmpeg and the `process-media` scheduler job, as any long video does.
