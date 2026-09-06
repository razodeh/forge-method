---
id: RUN-001
type: Runbook
schemaVersion: 1
title: Restart the API service
status: active
created: 2026-01-05
updated: 2026-01-05
revision: 1
author: platform
changelog: []
symptoms: API returns 5xx for every request; health check endpoint times out.
immediate_mitigation: Restart the API process via the platform dashboard.
diagnosis_steps:
  - "Check recent deploys: `forge doctor deploys --last 1h`"
  - "Check database connectivity: `psql $DATABASE_URL -c 'select 1'`"
escalation: Page the on-call platform engineer if the restart does not clear the 5xx rate within 5 minutes.
post_incident_actions:
  - Write an RCA if the outage lasted more than 15 minutes.
---

## Symptoms
API returns 5xx for every request.

## Immediate mitigation
Restart the API process via the platform dashboard.
