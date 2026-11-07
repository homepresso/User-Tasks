# Meeting recording to minutes and action items

Upload a meeting recording and get a transcript with speakers, AI-drafted minutes that the organiser checks, a task for each action owner, and the minutes emailed with an SRT subtitle file.

## What's inside

- **Meeting recording** form page and the **Meeting minutes from a recording** workflow (Form submitted trigger)
- **Meeting action item** sub-workflow: one task per action owner, with the due date
- **Minutes writer** AI agent (structured output: summary, decisions, three action items with owner and due date, minutes text)
- **Meeting minutes** and **Action items** data tables, **Meeting minutes** email template
- **Google Gemini (media AI)** integration (transcription) and an **AI model (OpenAI-compatible)** integration for the agent

## How it works

1. **Transcribe with speakers**: timed segments, speaker labels, SRT / VTT / text files.
2. **Draft minutes and actions**: the agent reads the transcript; it suggests owners by the names said in the meeting and never assigns anyone itself.
3. **Check the minutes and assign actions** (the organiser who uploaded): edit, pick each owner from the workspace people (Person fields), send or discard.
4. Each action with an owner starts **Meeting action item** (a task for the owner) and is logged in **Action items**.
5. The minutes are converted to PDF and emailed with the SRT.

Get consent before recording people: the form asks the organiser to confirm it.
