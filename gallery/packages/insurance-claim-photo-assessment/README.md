# Insurance claim photo assessment

Motor claims with damage photos: an AI damage assessment, decision-table triage and SLA, an adjuster review with letters, and copies of the photos with faces and plates blurred for repairers.

## What's inside

- **Motor claim: report damage** form page (photos with the phone camera) and the **Motor claim photo assessment** workflow
- **Damage triage** decision table (severity, cost, drivable, cover → band, estimate band, SLA, inspection)
- **Motor claims** and **Approved repairers** data tables (the repairer is a lookup on the adjuster's form)
- Five email templates (received, approved, inspection, declined, repair job)
- **Google Gemini (media AI)** integration (your API key)

## How it works

1. **Analyze damage photo**: description, labels and a structured answer (severity, parts, cost range, drivable, consistency, confidence).
2. **Triage**: the decision table sets the band and the SLA; the claim is logged.
3. **Blur faces and plates**: each photo is copied for sharing.
4. **Adjuster review**: the AI assessment is shown as a hint; Approve repair / Request inspection / Decline.
5. Letters are generated as PDFs and emailed; the repairer gets the blurred photos only.

The AI estimate is never a settlement: the adjuster decides every claim.
