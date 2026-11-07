# Support call QA and PII-safe archiving

Every finished support call is transcribed, card numbers and IDs are bleeped from the recording and masked in the transcript, an AI agent scores it against your QA rubric from the masked transcript, and low scores go to a supervisor.

## What's inside

- **Support call QA and redaction** workflow (starts from the API or an inbound webhook)
- **Call QA scorer** AI agent (structured output: score, rubric checks, sentiment, coaching notes, summary)
- **QA thresholds** decision table, **Call QA archive** data table and the **Call QA archive: 2 years** retention policy
- **Google Gemini (media AI)** and **AI model (OpenAI-compatible)** integrations, **Call review outcome** email

## Start it

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"call_id":"CALL-0042","recording_url":"https://telephony.example.com/rec/0042.mp3","agent_name":"Casey Example","queue":"Billing"}}'
```

## How it works

1. **Transcribe the call** with speaker labels (SRT and JSON files).
2. **Bleep card numbers and IDs** in the audio (Redact Video on the recording, reusing the transcript) and **mask the transcript** (Redact Document).
3. **Score against the QA rubric**: the agent only sees the masked transcript.
4. **QA thresholds** decides on a supervisor review; the redacted copies are archived with a 2-year retention policy.
5. **Supervisor call review**: final score and coaching, emailed to the agent.
