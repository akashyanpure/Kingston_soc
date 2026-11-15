# Build Prompt Pack — all 18 prompts, verbatim

Source: `Project_info_files/Build Prompt Pack.dc.html`. Run in order; each output feeds the next. Replace [square brackets] before sending. Attach `SOC TEMPLATE (PLS).docx` to the first prompt of a stage that mentions it.

## Stage 01 — Discovery and specification
*Weeks 0–3 · Service, no developer needed*

### P1.1 — Analyse the existing template  `[service]`

_Why:_ Turns the Word document into a structured inventory of fields. Attach the .docx.

```text
You are a service designer working for a UK local authority housing team.

Attached is the Word template our Private Sector Schemes officers currently complete by hand on every property visit: the Private Leasing Scheme "Schedule of Condition and Inventory".

Analyse it and produce:
1. A complete list of every section in document order, with what each one captures.
2. A de-duplicated item taxonomy: every distinct inventory item, and which room types it appears in. Flag items that are near-duplicates and should be merged (e.g. "SINGLE LIGHT SWITCH" / "DOUBLE LIGHT SWITCH").
3. A field list for each item row with data type and whether it is required.
4. Every piece of fixed boilerplate text (disclaimers, declaration) quoted exactly, so it can be reproduced in a generated report.
5. Problems with the template as a data-capture instrument — ambiguity, missing fields, rooms most properties do not have, anything that encourages officers to skip.

Output as markdown tables. Do not redesign anything yet.
```

### P1.2 — Write the as-is / to-be process  `[service]`

_Why:_ The document that gets a manager or board to say yes.

```text
Context: [paste the output of P1.1].

Our team: 6 Private Sector Schemes officers, roughly 100 property visits a week across four schemes — Private Leasing Scheme, nightly paid, tenant finder, PRSO. Today every visit is recorded on the paper template, photographed separately on a phone, and re-typed into Word back at the office.

Produce:
1. An as-is process map, step by step, with an estimated time for each step and a note of where the waste is.
2. A to-be process map for a phone-first app that captures the inventory as structured data, forces a photograph on any defect, and generates the PDF on site before the officer leaves.
3. A table of the differences, with the estimated time saved per visit and per week.
4. The five assumptions in your estimates that we must verify with real measurements, and exactly how to measure each one in two weeks.

Be honest where a saving is speculative. Do not inflate benefits.
```

### P1.3 — Agree the grading scale and evidence rules  `[service]`

_Why:_ The most common cause of inconsistent reports is an undefined middle grade.

```text
Our current condition scale is Good / Fair / Poor. We are adding a fourth grade so that dilapidation disputes are easier to argue.

Write, for a UK council housing inventory:
1. Four grade definitions — Good, Fair, Poor, Unacceptable — in plain English, each under 25 words, each testable by a non-expert standing in a room. Plus a "not present / not inspected" option.
2. For each grade: whether a comment is required, whether a photograph is required, and what the system should do (flag to a manager, enter the dilapidation schedule, block check-in).
3. Six worked examples per grade drawn from real inventory items (walls, carpet, work surface, shower, oven, window).
4. A one-page "how to grade" card for officers, and a shorter condition key to print in the report so landlords read the same rule.
5. Guidance on separating the grade (what the officer sees) from the fair-wear decision (who pays), and why they must be separate fields.
```

### P1.4 — Build the description library  `[service]`

_Why:_ Ends inconsistent wording between officers. Run this with all six of them.

```text
Context: [paste the item taxonomy from P1.1].

For each item in the taxonomy, write 3–6 standard description phrases an officer could pick with one tap instead of typing — the wording a UK lettings inventory would actually use. Keep each under 8 words. Cover the common variants of the item, not exotic ones.

Then:
1. Output as a two-column table: item, then the phrases separated by " · ".
2. Note which items genuinely need free text instead (make, model and serial number fields, for example).
3. Suggest 10 standard defect comment phrases per grade that officers could pick from as a starting point before adding detail.
4. Flag any wording that could prejudice a dilapidation dispute and say why.
```

## Stage 02 — Data model and architecture
*Weeks 3–5 · Developer or technical lead*

### P2.1 — Design the data model  `[developer]`

_Why:_ Everything else in the system depends on getting this right.

```text
Context: [paste P1.1's item taxonomy and field list].

Design a relational data model for a council housing inventory / Schedule of Condition system.

Requirements:
- Properties are permanent; tenancies and visits attach to them. A visit is check-in, check-out or interim.
- Form definitions (which rooms, which items per room type) are DATA, versioned and editable by an administrator without a code release. A visit records which form version it used.
- Item records hold quantity, description, condition grade, comment, dilapidation note and linked photographs.
- Photographs belong to an item or a room, carry a capture timestamp, GPS, burned-in stamp text, a hash, and a retention date.
- A published report is IMMUTABLE. Corrections are appended, agreed, time-stamped notes — never edits.
- Signatures record role, method, timestamp, IP, device and the hash of the report signed.
- Check-out must be able to compare item-by-item against the same property's check-in.
- Four schemes: PLS, nightly paid, tenant finder, PRSO. Two form variants: full and light.

Deliver:
1. Entity list with every field, type, nullability and a one-line purpose.
2. An ER description in words (no diagram needed).
3. DDL for PostgreSQL with indexes and constraints.
4. The five design decisions you made that would be expensive to reverse later, with your reasoning.
5. How you would model "mark all as good" efficiently without writing 350 rows per visit if that is avoidable — and whether it is, given we need a full audit trail.
```

### P2.2 — Choose the architecture and write the ADRs  `[developer]`

_Why:_ Make the offline and hosting decisions explicitly, once, and in writing.

```text
Design the architecture for an offline-first, phone-first web application for 6 field officers doing 100 property inspections a week, hosted in a UK council's existing Azure tenancy, with no integrations in phase 1.

Constraints:
- Must be fully usable with no mobile signal: form definitions, previous reports and description library cached; all writes local first; upload queued and automatic.
- Photographs: about 40 per visit, captured in-app, stamped, never in the device camera roll.
- Must generate a 40-page branded PDF with a photo appendix — a draft viewable on the device offline, the authoritative copy rendered server-side on sync.
- WCAG 2.2 AA. Installable web app, not an app-store app.
- Two developers, ten to twelve weeks for phase 1.

Deliver:
1. A recommended stack with justification, and the two alternatives you rejected and why.
2. The offline storage and sync design in detail: what is cached, what triggers sync, how conflicts and partial uploads are handled, what happens if the app is killed mid-visit.
3. Azure service list with an indicative monthly cost at this volume.
4. Six architecture decision records in the standard format (context, decision, consequences).
5. The three highest technical risks and how you would de-risk each in week one.
```

## Stage 03 — Phase 1 — the officer visit flow
*Weeks 4–15 · Developer*

### P3.1 — Write the phase 1 specification  `[developer]`

_Why:_ The scope fence. Phase 1 is the visit flow and the PDF — nothing else.

```text
Context: [paste P2.1 data model and P2.2 architecture].

Write a build-ready specification for PHASE 1 ONLY of a council housing inventory app. Phase 1 scope is fixed: the officer visit flow plus automatic PDF generation. Explicitly out of scope: electronic signatures, check-out comparison, manager dashboard, archive search, any integration.

In scope:
- Officer login; assigned visits for today and the week; works offline.
- New visit: scheme, visit type, property, property type. Property type generates the room list; rooms can be added, renamed, duplicated or removed.
- Room screen: mandatory wide photo; item rows with quantity, description (library chips plus free text), grade (Good/Fair/Poor/Unacceptable/Not present), comment.
- "Mark all as good" at property and room level.
- Any grade below Good requires a comment and at least one photograph. The report cannot be issued until every one is evidenced.
- In-app camera with automatic stamp: address, date, time, GPS, room, item, report number, officer — burned into the image and written to EXIF.
- Meter readings and kitchen appliance make / model / serial.
- Review screen listing anything ungraded or unevidenced.
- Generate the Schedule of Condition PDF in the existing template order with a photo appendix; viewable on the device before leaving; emailed and filed on sync.

Deliver:
1. User stories with acceptance criteria in Given/When/Then form.
2. A screen-by-screen specification: purpose, fields, validation, states (empty, loading, offline, error), and what each button does.
3. Non-functional requirements: performance targets, offline behaviour, accessibility, security.
4. An ordered build sequence for two developers over twelve weeks, with what is demoable at the end of each two-week block.
5. Everything you think we have forgotten.
```

### P3.2 — Build the item capture screen  `[developer]`

_Why:_ The screen officers spend 30 minutes in. Get it right before anything else.

```text
Context: [paste P3.1 spec and the data model].

Build the room item-capture screen as a mobile-first web component in [React / your framework], styled with [your CSS approach].

Behaviour:
- A list of item rows for the current room. Each row: item name, quantity stepper, description field with one-tap library chips, and a grade control showing Good / Fair / Poor / Unacceptable.
- Selecting any grade below Good expands a comment box and a photo requirement that must be satisfied.
- "All good in here" grades every item in the room Good in one tap.
- Show room progress (items graded / total) and which items still block completion.
- Everything writes to local storage immediately; no save button; nothing lost if the app is killed.
- Touch targets at least 44px. Usable one-handed. Readable in poor light. Colour is never the only signal of a grade.
- Full keyboard and screen-reader support; grade controls announced properly as a group.

Deliver working code, the local-storage schema it writes, and a list of the edge cases you handled (zero quantity, item not present, removing a photo, adding a one-off item, 30+ items in a room).
```

### P3.3 — Photo capture and stamping  `[developer]`

_Why:_ The feature that ends "which room was this photo from?" and wins disputes.

```text
Build the in-app photo capture and stamping module for a council property inspection app.

Requirements:
- Capture via the device camera inside the app. Images must never land in the device camera roll or gallery.
- On capture, burn a stamp into the bottom of the image: address and postcode, date and time, GPS coordinates, scheme, report number, room and item, officer name. Legible but not obstructive — no more than 15% of image height.
- Write the same data to EXIF/XMP metadata.
- Resize to a long edge of about 1600px, JPEG quality around 80, target under 400KB.
- Store locally with the item reference; queue for upload; retry with backoff; show queue state to the officer.
- Compute a SHA-256 of the final image and store it for evidential integrity.
- Allow delete and retake before sync. After sync, deletion is an administrator action with an audit entry.
- Capture GPS once per room, not per photo, to preserve battery.

Deliver the implementation, how you handle a denied camera or location permission, and how you prove at a later date that an image has not been altered since capture.
```

### P3.4 — The PDF generator  `[developer]`

_Why:_ The output landlords already recognise, produced in seconds instead of an hour.

```text
Context: [paste the section list and exact boilerplate text from P1.1, and the data model from P2.1].

Build a server-side PDF generator that produces our Schedule of Condition report from the structured visit data, rendering an HTML/CSS template to PDF (not Word automation).

Requirements:
- A4. Report order: cover; safety disclaimer; general schedule of condition; meter readings; kitchen appliances; room-by-room item tables; dilapidation summary; photo appendix; additional notes; declaration and signature blocks.
- Every page carries the report number, property address and page number. Council branding.
- Item tables repeat their header row across page breaks and never split a row.
- Photo appendix: two per page with reference numbers cross-referenced from the item rows ("see P-13").
- A landlord-friendly summary page listing only items not marked Good, with thumbnails.
- Tagged, accessible PDF output.
- Deterministic: the same data always produces the same document. Hash the output and store it.
- Also produce an accessible HTML version of the same report.
- The template must be editable by a service designer who knows HTML and CSS but not our backend.

Deliver the template, the rendering service, and how you test pagination against a property with 350 items and 60 photographs.
```

### P3.5 — Offline sync layer  `[developer]`

_Why:_ Basements and mid-terrace kitchens have no signal. This is the baseline, not a feature.

```text
Build the offline-first data layer for a field inspection app used by 6 officers on phones with unreliable signal.

Requirements:
- Cache on the device: assigned visits, form definitions, the description library, and the previous report for each property in the round.
- All writes go to local storage first and are immediately durable; there is no save button.
- Background sync when a connection returns: visits, item records, then photographs (largest last), with per-item retry and backoff.
- Show the officer a clear queue state: what is waiting, what failed, what has landed.
- Handle the app being killed, the phone dying, and the browser evicting storage. Never silently lose a visit.
- Handle two officers editing the same visit: last-write-wins per field, with an audit entry recording both.
- Server remains the source of truth once synced; the device must reconcile without duplicating records.

Deliver the implementation, the storage schema, the sync state machine, and a test plan including a genuinely offline three-hour round with 4 visits and 160 photographs.
```

## Stage 04 — Phase 2 and 3 features
*Weeks 16–38 · Developer*

### P4.1 — Signatures and the signing link  `[developer]`

_Why:_ Finishes the visit on site, and makes chasing visible instead of manual.

```text
Build electronic sign-off for a council Schedule of Condition report, supporting four paths:
1. Finger signature on the officer's phone at the visit, when the landlord or agent is present.
2. A secure expiring link emailed to the landlord or agent, chased automatically at 3, 7 and 12 days and flagged to a manager at 14.
3. A PDF emailed for wet signature, with the scan accepted back and filed against the report.
4. Officer-only issue for empty properties, clearly marked as unagreed and queued for agreement.

Requirements:
- The signing page needs no account, works on an old phone in a browser, and meets WCAG 2.2 AA.
- It shows the full report, plus a summary of every item not marked Good with its photographs.
- The signer may dispute an individual item, which notifies the officer instead of signing.
- Record for every signature: role, name, method, timestamp, IP, user agent, and the SHA-256 of the report signed.
- Links expire, are single-purpose, and cannot be guessed.

Deliver the implementation, the audit schema, and a note on what a UK council should confirm with its legal team about electronic signatures before go-live.
```

### P4.2 — Check-out comparison and dilapidation  `[developer]`

_Why:_ Where dilapidation disputes are actually won or lost.

```text
Build check-out mode for a council inventory app.

Requirements:
- Load the same property's check-in record and present, item by item, only the items whose grade has changed: check-in grade and photograph beside today's grade and photograph.
- For each changed item, suggest "fair wear" or "chargeable" using tenancy length and an administrator-maintained expected-life table. The officer always decides; record both the suggestion and the decision.
- Where chargeable, suggest a pro-rated cost from a rate card based on remaining expected life — never full replacement cost — and show the calculation.
- Generate a schedule of dilapidation as a report section: item, room, check-in condition, check-out condition, evidence references, proposed action, proposed cost, fair-wear reasoning.
- Handle items that did not exist at check-in, and rooms that have been reconfigured.

Deliver the implementation, the expected-life and rate-card data structures, and the wording of the dilapidation section so it reads defensibly to a landlord challenging a deduction.
```

### P4.3 — Manager dashboard and archive  `[developer]`

_Why:_ Makes the invisible problems — unsigned reports, lost reports — visible.

```text
Build a manager dashboard and property archive for a team of 6 officers doing 100 inspections a week.

Dashboard:
- Visits booked, completed and outstanding this week; reports issued; reports awaiting signature with age; overdue signatures.
- Median minutes per Schedule of Condition, by officer and team, from visit start and end timestamps.
- Any item graded Unacceptable in the last 7 days, as an action list.
- Assign and reassign visits to officers.

Archive:
- Search by address, UPRN, postcode, scheme, officer, date range or report number, returning results in under a second.
- Property timeline: every visit, report, signature and photograph in one place.
- CSV export.

Requirements: desktop-first but responsive; WCAG 2.2 AA; role-based access so an officer sees only their own visits. Make every number on the dashboard click through to the records behind it — a metric nobody can drill into gets ignored.

Deliver the implementation and the queries, with the indexes needed at this volume.
```

## Stage 05 — Governance, testing and rollout
*In parallel, from week 0 · Service and developer*

### P5.1 — Draft the DPIA  `[service]`

_Why:_ Required, and it has a longer lead time than the build. Start it now.

```text
Draft a Data Protection Impact Assessment for a UK local authority housing service introducing a mobile app that records property inventories and Schedules of Condition.

The processing: officers photograph the interiors of leased properties; records include landlord and agent contact details, tenant references, officer identity, GPS location at capture, electronic signatures with IP addresses, and about 40 photographs per visit. The council is the controller. Hosting options under consideration are the council's own Azure tenancy or a supplier-hosted service.

Cover:
1. Description of the processing, purposes and necessity.
2. Lawful basis for each category of data, with reasoning.
3. Data flows, including the offline cache on officers' devices.
4. Risks to data subjects with likelihood, severity and mitigation — include accidental capture of people or documents in photographs, device loss, and the officer's own device holding cached data.
5. Retention and deletion, including automatic deletion of photographs, and how litigation holds are handled.
6. Data subject rights: how access, rectification and erasure requests are answered when the record is deliberately immutable.
7. Controller/processor position for each hosting option, and what a data-processing agreement must say.
8. The questions the DPO will ask that this draft cannot answer.

Write it as a document a council DPO would accept, and flag every assumption.
```

### P5.2 — Test plan and pilot design  `[service]`

_Why:_ A three-week pilot with real visits is the only honest test.

```text
Context: [paste the phase 1 specification].

Write a test and pilot plan for a phase 1 release of a field inspection app.

Include:
1. A user acceptance test script an officer can run on a real property, step by step, with expected results — including a full visit with no signal from start to finish.
2. Edge cases that must be tested: dead battery mid-visit, denied camera permission, 350-item property, room the template does not cover, two officers on one visit, app killed during photo upload, storage full.
3. Accessibility test steps against WCAG 2.2 AA on a phone, using real assistive technology.
4. A three-week pilot design: two officers, one scheme, paper carried as a fallback. What to measure daily, how to collect feedback without adding work, and the go / no-go criteria for wider rollout.
5. The three signals during the pilot that should stop the rollout, and what to do about each.
```

### P5.3 — Training and landlord communications  `[service]`

_Why:_ The app is easy. Changing a habit and a landlord-facing format is not.

```text
Context: [paste the phase 1 specification and the grading definitions].

Produce the rollout materials for a team of 6 council housing officers moving from a paper Schedule of Condition to a phone app:

1. A one-page quick reference card: the visit flow in eight steps, the four grades with definitions, and the photo rules.
2. A 20-minute training session plan, including the one thing to demonstrate first — "mark all as good, then edit the exceptions" — because it reframes the whole job.
3. A troubleshooting sheet for the field: no signal, camera won't open, photo won't upload, wrong property type chosen, room missing, phone died.
4. A one-page letter to landlords and agents explaining the new report format and the signing link, reassuring them that nothing about their obligations changes.
5. A short FAQ for officers, written for the sceptical one — including an honest answer to "this is slower than paper".

Plain English, no jargon, no more than one page each.
```

### P5.4 — Benefits tracking after go-live  `[service]`

_Why:_ Prove it worked, or find out early that it didn’t.

```text
Design a benefits realisation framework for a council housing inventory automation project.

Baseline (estimated, to be verified): 95 minutes per Schedule of Condition end to end, of which about 40 minutes is office write-up; 100 visits a week; 6 officers. Target: 38 minutes per report, all on site, zero write-up.

Produce:
1. Up to 8 measures with a baseline, a target, a source of data and a collection frequency — measures the system can produce automatically wherever possible.
2. How to measure the harder benefits: fewer disputed dilapidation charges, faster re-letting of empty properties, fewer reports that cannot be found.
3. A monthly one-page report template for the service manager.
4. The leading indicators in month one that predict whether the benefit will be realised — before the outcome measures can show it.
5. How to tell apart a real saving from a saving that just moved work somewhere else.
```
