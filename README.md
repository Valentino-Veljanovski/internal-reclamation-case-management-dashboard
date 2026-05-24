# Internal Reclamation Case Management Snippets

A public, employer-safe overview of an internal reclamation case
management dashboard inside Slack: App Home overview, structured
modals for create / search / update, region-partitioned spreadsheet
state via Microsoft Graph, periodic Slack DMs for reports, and an
LLM email-drafting assistant that reads thread context.

This repository documents the architecture decisions, code patterns, and
design trade-offs from a Slack-based internal case-management system I
built for an operational team.

> Customer data, secrets, Slack workspace identifiers, user IDs, internal
> workbook references, and raw workflow exports are not part of this
> repository. The JavaScript helpers below are public-safe examples:
> field names are neutral, project-specific identifiers are removed,
> and comments are translated to English.

---

## What this pattern solves

A team handles operational reclamation cases across multiple regional
offices. Each case has a structured set of fields:
project company, customer name, address, phone, priority, responsible
person, status, value, payment date, notes, and lives in a spreadsheet
the operations team already maintains.

The team works in Slack all day. Asking them to also keep one spreadsheet
open per region, scroll for cases, and edit cells for status updates is
friction that produces silent data loss: cases not updated because nobody
had time to re-open the sheet.

The pattern brings the spreadsheet into Slack:

- **App Home tab** displays a region-by-region dashboard with case counts per
  status. Buttons for `New`, `Search`, `Update`, `Report`, `Email`.
- **Modals** open on button click. Structured fields, validated inputs,
  no free text where a dropdown will do.
- **Excel via Microsoft Graph** is still the source of truth, the Slack
  interface reads from and writes to the same workbook the team has used
  for years.
- **Confirmation DMs** echo back the saved case so the user knows the
  write succeeded.
- **Optional LLM email drafting** for outbound customer email, triggered
  by `@mention` in a case thread, with the customer record passed as
  system-prompt context.

---

## Architecture at a glance

```
┌────────────── Layer 1: Slack UI ──────────────────────────────┐
│  App Home tab                                                  │
│    └── per-region dashboard (status counts)                      │
│    └── action buttons: New / Search / Update / Report / Email  │
│  Slack Modals (opened via trigger_id)                          │
│  Slack DMs (confirmations and reports)                         │
└────────────────────────────────────────────────────────────────┘
                          │
              Slack interactions webhook
                          │
                          ▼
┌────────────── Layer 2: n8n Router ────────────────────────────┐
│  Single Webhook node receives every interaction               │
│  Parse payload -> Whitelist check -> Detect action + region       │
│  Switch dispatches to the matching branch:                    │
│    new / search / update / search-view / email / summarize    │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────── Layer 3: Spreadsheet State ─────────────────────┐
│  Microsoft Graph → Excel workbook                             │
│    one worksheet per region: Region A, Region B, Region C, ...  │
│  Each row is one case; columns map to modal fields            │
└────────────────────────────────────────────────────────────────┘
```

See [`docs/architecture.md`](docs/architecture.md) for the full breakdown.

---

## Repository structure

```
.
├── README.md                              ← you are here
├── docs/
│   ├── architecture.md                    ← system overview
│   ├── slack-app-home-pattern.md          ← App Home dashboard
│   ├── interaction-router-pattern.md      ← single-webhook dispatch
│   └── ai-agent-pattern.md                ← LLM with thread context
└── snippets/
    ├── README.md                          ← snippet index
    ├── slack-payload-parser.js            ← parse interactions + user whitelist
    ├── slack-modal-builder.js             ← Block Kit modal (search example)
    ├── slack-thread-context-extractor.js  ← read structured data from thread history
    ├── llm-agent-prompt-builder.js        ← assemble system prompt with case context
    └── date-range-summary-aggregator.js   ← compute per-region report from sheet rows
```

The snippets are adapted from n8n Code-node work and prepared for
public review: field names are neutral, project-specific identifiers
are removed, and comments are translated to English.

---

## Tech stack

- **Orchestration:** n8n (cloud)
- **UI:** Slack (App Home tab + modals + DMs)
- **State:** Microsoft Excel via Microsoft Graph (one sheet per region)
- **Optional LLM:** Azure OpenAI for email drafting (single agent,
  triggered by `@mention` inside a case thread)
- **Code:** in-node JavaScript patterns for parsing, routing, modal
  building, thread context extraction, and report aggregation

---

## What this pattern does and does not do

This is an internal tool for a small team (single-digit users), not a
multi-tenant SaaS. Some explicit trade-offs:

- **No real-time sync.** App Home refreshes when the user opens it;
  there's no push notification when another user updates a case.
- **User access is a hard-coded whitelist** of Slack user IDs in the
  parser. Adequate for a closed team; replace with a real role check for
  any external use.
- **Excel is the bottleneck.** Microsoft Graph rate limits and Excel's
  workbook lock are the failure modes you'll hit first under load.
- **One large workflow.** The interaction router is intentionally kept
  as one workflow while the shared parser and dispatch logic remain
  easier to maintain in one place. The trade-off is documented in
  `docs/architecture.md`.

---

## About

Built and maintained by [Valentino Veljanovski](https://valentinoveljanovski.de),
automation developer based in Germany. The full case study for the
internal workflow this pattern came from is at
[valentinoveljanovski.de/projects/internal-reclamation-case-management-dashboard](https://valentinoveljanovski.de/projects/internal-reclamation-case-management-dashboard).

---

## Viewing Notice

This repository is published for public review during hiring and collaboration conversations.

All code, documentation, diagrams, and content in this repository remain
the intellectual property of the author. **All rights reserved.**

No license is granted, expressed or implied, for reuse, redistribution,
modification, or commercial use of any material in this repository
without prior written permission from the author.

For licensing or collaboration inquiries, contact: <valentinoveljanovski@outlook.com>
