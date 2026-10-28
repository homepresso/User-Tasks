# Joiner, mover, leaver sync

Nightly HR-to-directory sync: create joiners, update movers, disable leavers, log everything.

## What's inside

- **Joiner mover leaver sync** workflow (scheduled daily at 02:00)
- **Role mappings** data table: department and job family → groups and licence (seven sample roles)
- **JML sync log** data table: one row per processed change
- **HR system** REST integration with *List HR changes*
- **Directory** REST integration with *Create user*, *Update user* and *Disable user*

## After installing

1. Complete setup: base URLs and tokens for the HR system and the directory.
2. Edit the role mappings to your groups and licences.
3. Publish the workflow; it runs every night. To replay a period, start it by hand:

```bash
curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \
  -d '{"workflow_id":"<workflow id>","variables":{"since":"2026-10-01"}}'
```
