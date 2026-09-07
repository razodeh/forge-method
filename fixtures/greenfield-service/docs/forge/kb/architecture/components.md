---
type: Component
schemaVersion: 1
title: Component inventory
status: active
created: 2026-01-05
updated: 2026-01-05
revision: 1
author: architect
changelog: []
components:
  - id: component:api
    label: API
    responsibility: Serves the public HTTP interface and orchestrates requests to the database.
    owner: platform
    dependsOn: [ component:db ]
    failureModes: [ "Database unreachable: 503s on every request" ]
  - id: component:db
    label: Database
    responsibility: Durable transactional store for the service's own state.
    owner: platform
    dependsOn: []
    failureModes: [ "Disk full: writes fail, reads still succeed" ]
---

Component inventory for the greenfield service.
