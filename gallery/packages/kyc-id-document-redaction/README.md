# Identity document capture (KYC) with redaction for storage

An ID photo and a selfie from a form page: the document is read, checked against the form by rules, the document number is blacked out on the stored copy, and a person compares the photos and decides.

> No face recognition or face matching: the media step only reads text and returns face boxes. The reviewer compares the selfie with the ID photo.

## What's inside

- **Verify your identity** form page (phone camera) and the **Identity document check** workflow
- **ID document checks** decision table, **Verified identities** data table and the **Verified identities: 5 years** retention policy
- Three email templates (verified, new documents needed, not verified)
- **Google Gemini (media AI)** integration (your API key)

## How it works

1. **Read the ID**: Analyze Image with a structured answer (name, date of birth, number, expiry, issuing region) plus text and face boxes; **Check the selfie** counts faces.
2. **Number format** (Regex), **name** and **date of birth** conditions, then the decision table gives a result and a flag.
3. **Redact the ID number for storage**: a black box over the number on a PNG copy; the number is kept as `•••••` + its last four characters.
4. **Review the identity**: the reviewer confirms they compared the photos and verifies, asks for new documents or rejects.
5. Verified identities get the masked fields and the redacted copy, with a retention policy.
