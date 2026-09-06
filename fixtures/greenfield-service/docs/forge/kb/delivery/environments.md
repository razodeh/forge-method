---
type: Environment
schemaVersion: 1
title: Environment matrix
status: active
created: 2026-01-05
updated: 2026-01-05
revision: 1
author: platform
changelog: []
environments:
  - id: ENV-001
    purpose: staging
    url: "https://staging.example.com"
    deploy_trigger: merge to main
    data_policy: synthetic data only
    secrets_source: "vault:staging"
    owner: platform
    access: request via #platform-access
  - id: ENV-002
    purpose: production
    url: "https://example.com"
    deploy_trigger: manual promotion from staging
    data_policy: real customer data, PII redacted in logs
    secrets_source: "vault:production"
    owner: platform
    access: request via #platform-access, requires on-call approval
---

Environment matrix for the greenfield service.
