---
name: soc-build-prompts
description: The Kingston SOC project's 18-prompt Build Prompt Pack (P1.1–P5.4) across five stages — discovery/spec, data model & architecture, Phase 1 build (item capture, photo stamping, PDF generator, offline sync), Phase 2/3 features (signatures, check-out/dilapidation, dashboard/archive), and governance (DPIA, test & pilot plan, training & landlord comms, benefits tracking). Load when asked to carry out any of these tasks, "run prompt P3.2", produce the next stage's deliverable, or decide what to build next.
---

# SOC Build Prompt Pack

The verbatim prompts are in `references/prompts.md`. Each is self-contained; the output of one stage feeds the next.

| ID | Tag | Task | Feeds from |
|---|---|---|---|
| **Stage 01 — Discovery & specification** (wks 0–3, service) |||
| P1.1 | service | Analyse the existing template (sections, de-duplicated taxonomy, field list, exact boilerplate, template problems) | `SOC TEMPLATE (PLS).docx` |
| P1.2 | service | As-is / to-be process, time savings, 5 assumptions to measure | P1.1 |
| P1.3 | service | Grade definitions (G/F/P/U + NA), rules, examples, officer card, condition key | — |
| P1.4 | service | Description library (3–6 phrases/item, defect phrases per grade) | P1.1 taxonomy |
| **Stage 02 — Data model & architecture** (wks 3–5, developer) |||
| P2.1 | developer | Relational data model + PostgreSQL DDL + irreversible decisions + "mark all good" modelling | P1.1 |
| P2.2 | developer | Offline-first architecture on council Azure + 6 ADRs + top risks | — |
| **Stage 03 — Phase 1 build** (wks 4–15, developer) |||
| P3.1 | developer | Phase 1 spec: user stories (Given/When/Then), screens, NFRs, 12-week build sequence | P2.1, P2.2 |
| P3.2 | developer | Room item-capture screen (mobile web component) | P3.1, data model |
| P3.3 | developer | In-app photo capture + stamping + SHA-256 | — |
| P3.4 | developer | Server-side HTML→PDF generator + accessible HTML | P1.1 boilerplate, P2.1 |
| P3.5 | developer | Offline sync layer, storage schema, state machine, 3-hour offline test | — |
| **Stage 04 — Phase 2 & 3** (wks 16–38, developer) |||
| P4.1 | developer | Four signature paths + signing link + audit | — |
| P4.2 | developer | Check-out comparison + fair wear + dilapidation schedule | — |
| P4.3 | developer | Manager dashboard + property archive | — |
| **Stage 05 — Governance, testing, rollout** (from wk 0, service + dev) |||
| P5.1 | service | Draft the DPIA | — |
| P5.2 | service | UAT script, edge cases, accessibility tests, 3-week pilot design | P3.1 |
| P5.3 | service | Quick-ref card, training plan, troubleshooting, landlord letter, FAQ | P3.1, P1.3 |
| P5.4 | service | Benefits realisation framework | — |

## How to use this skill
1. When asked to do one of these tasks, open `references/prompts.md`, find the prompt, and **treat its text as the task specification** — follow every numbered deliverable.
2. Fill `[paste …]` placeholders from earlier outputs saved in the repo. If a required predecessor output doesn't exist yet, say so and offer to produce it first (or proceed with stated assumptions).
3. The Word template is the source of truth: where a prompt's wording assumes a design-pack proposal (e.g. Good/Fair/Poor/Unacceptable, Light SOC, photo rules), build the template baseline (G/F/P, PLS form) and treat the proposal as a confirmable addition. Use `soc-template-form` (and its `form-definition.json`) plus the `soc-domain-model`, `soc-report-generation` and `soc-project-brief` skills as the context instead of generic assumptions — that is the difference between "a generic inventory app" and this one. Read the actual `.docx` for P1.1/P3.4.
4. Keep deliverables in a numbered documentation folder (pack convention: "Save every output into one folder with numbered filenames"), e.g. `docs/P1.1-template-analysis.md`.
5. Replace any remaining `[square brackets]` (framework, CSS approach) by checking the repo or asking.
6. Guard rails from the pack: run stage 1 with the officers' input; **don't let phase 1 grow** (visit flow + PDF only); be honest where savings are speculative.

Filters in the source page: "Phase 1 only" = stages 01 + 03; "Governance" = stage 05; "Service only" = no-developer prompts.
