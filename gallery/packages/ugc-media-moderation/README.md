# User-generated media moderation

Uploads arrive from your platform by API: AI safety analysis of images and videos, thresholds that auto-approve or reject clear cases, a moderator queue for the rest, publish or hide through your platform's API, and the uploader is told.

## What's inside

- **Upload moderation** workflow (starts from the API or an inbound webhook)
- **Moderation thresholds** decision table, **Moderation log** data table and the **Moderation log: 1 year** retention policy
- **Content platform** REST integration (placeholder host) with **Publish upload** and **Reject upload** references
- **Google Gemini (media AI)** integration (your API key), two email templates

## Start it

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"upload_id":"UP-0042","media_url":"https://cdn.example.com/u/0042.jpg","media_type":"image","uploader_email":"river@example.com"}}'
```

## How it works

1. **Analyze Image / Analyze Video** with a moderation prompt and a structured answer (risk score, category, child safety concern, people visible, reason).
2. **Moderation thresholds**: approve under 0.3, reject at 0.85 and over, people review the rest, self-harm and any child safety concern.
3. **Moderate the upload** (moderator): Approve or Reject with the guideline.
4. **Publish upload** / **Reject upload** on your platform, email the uploader, log the decision.

The AI verdict is a triage aid: borderline and sensitive cases always go to a person.
