---
name: soc-template-form
description: SOURCE OF TRUTH for the Kingston Schedule of Condition web app. Defines the form exactly as in Project_info_files/SOC TEMPLATE (PLS).docx — every section, field, room, item row, condition option, column, fixed text, header/footer and abbreviation — with a machine-readable form-definition.json. Load FIRST for any work on the form, data model, capture screens, seed data, validation or report output, and whenever another project document disagrees with the template.
---

# SOC Template — the form we are automating (source of truth)

**Rule of precedence:** `Project_info_files/SOC TEMPLATE (PLS).docx` is the authoritative definition of the form. The goal is a full-fledged, online, mobile-friendly web app that captures **this form** and produces **this document**. The other project files (design report, prototype, report preview, prompt pack) are *supporting design proposals*:
- Where they **agree** with the template → use them.
- Where they **add** something the template lacks → treat it as an *enhancement*: allowed only if it does not change or remove anything in the template, and label it as an addition. See "Proposed enhancements" below.
- Where they **contradict** the template → the template wins. Flag the conflict to the user; do not silently adopt the proposal.

Machine-readable definition (generated from the docx's 35 tables — verbatim labels, normalised codes): `references/form-definition.json`. Use it to seed form definitions instead of retyping lists. To regenerate, parse `word/document.xml` tables from the docx.

## Document structure (in order)

### 1. Cover
"Kingston Council's Private Leasing Scheme" · **SCHEDULE OF CONDITION and Inventory** · fields:
| Field | Type |
|---|---|
| At (property address) | text, required |
| Date | date of inspection, required (template's Word field is broken — renders "5664835101600"; the app must generate a real date) |
| Landlord/Agent | text |
| Tenant | text |
| Private Sector Schemes Officer | text (the logged-in officer) |
Footer: www.kingston.gov.uk, council logo (image1.png).

### 2. Safety Disclaimer — fixed text (4 paragraphs; exact wording in the `soc-report-generation` skill). Not editable by officers.

### 3. Schedule of Condition (general) — table
| Row | Default in template | Captured |
|---|---|---|
| DESCRIPTION OF PROPERTY | — | free text |
| GENERAL CONDITION | — | free text |
| WINDOWS | "UVPC Double Glazed" (typo for UPVC) | text, pre-filled default |
| HEATING | "Central Heating" | text, pre-filled default |
| KITCHEN APPLIANCES: HOB, OVEN, EXTRACTOR | — | **MAKE** and **MODEL** for each |

### 4. Meter readings — table
Columns: **SERVICE · LOCATION · READING IN · READING OUT** (readings marked "(Council/landlord to complete)").
Rows: ELECTRICITY, GAS, WATER, STOPCOCK.

### 5. Room schedules — 15 room tables, fixed order
Every room table has the same 6 columns: **ITEM · Qty · DESCRIPTION · CONDITION · COMMENT · SCHEDULE OF DILAPIDATION**.
Condition is a choice of exactly **G / F / P** per row.

| # | Room | Items |
|---|---|---|
| 1 | FRONT GARDEN | 6 |
| 2 | BACK GARDEN | 5 |
| 3 | FRONT DOOR | 10 |
| 4 | HALLWAY | 20 |
| 5 | RECEPTION | 22 |
| 6 | CONSERVATORY | 20 |
| 7 | KITCHEN | 32 |
| 8 | UTILITY | 23 |
| 9 | STAIRS AND LANDING | 21 |
| 10–13 | BEDROOM 1, 2, 3, 4 | 18 each |
| 14 | BATHROOM | 20 |
| 15 | SEPARATE WC | 13 |
| | **Total** | **264 item rows**, 64 distinct item types |

Exact item lists per room: `references/form-definition.json` (and human-readable in the `soc-domain-model` skill's `references/taxonomy.md` §1).

### 6. MISCELLANEOUS — same 6 columns, **13 blank rows** (officer enters the item name).

### 7. ADDITIONAL NOTES — columns **DATE · NOTE · ADDED BY · SIGNED**, 21 blank rows. Rule (fixed text): "When additions are made the landlord/agent and the Council MUST agree and initial."

### 8. DECLARATION — 3 fixed paragraphs + "signed on behalf of the landlord:", "PRINT NAME:", "date:".

### Running page furniture (room-schedule pages)
- Header: **PROPERTY:** [address] · **DATE:** [date]
- Header abbreviation key (fixed text): *"ABBREVIATION: WP-White Plastic, PWE/PCE painted white/cream emulsion, PWG painted white gloss, DG double glazed, GWG Georgian wired glass. FWD flush wooden door, PWD panelled wood door, WF wood flooring, CRP ceiling rose & pendant, LLWC low level water closet, HLWC high level water closet, O/S outside. G-Good, F-Fair, P-Poor"*
- Footer: page number; document reference "PLS Agreements/PLS/Schedule of Condition Pro Forma".

The abbreviation key is the officers' existing description shorthand — the app should offer these as description quick-picks/expansions and print the key in the report.

## What "automating the template" means for the app
- Every template field above must exist in the app and appear in the output **in the same order with the same labels**.
- **No template field may be dropped**; the report must remain recognisable to landlords.
- Rooms: all 15 template room types are available. The officer selects the rooms present at the property (instead of striking through pages); rooms not present are left out of the generated report.
- Items: exactly the template rows per room; officers add extra items via MISCELLANEOUS (as on paper).
- Data captured once on a phone, saved as structured data, and output as the SOC document (PDF) — no re-typing.
- Mobile-friendly: large touch targets, one-handed, works with poor signal; responsive so it also works on desktop for office/manager use.

## Confirmed decisions (user, 2026-11-15) — these extend the template and are now part of the form
1. **Condition options: G / F / P / U / N/A.** U = Unacceptable; N/A = not present / not inspected (needs a reason). Report and header key read "G-Good, F-Fair, P-Poor, U-Unacceptable, N/A-Not present".
2. **Photo column added** to every room and Miscellaneous table: ITEM · Qty · DESCRIPTION · CONDITION · COMMENT · SCHEDULE OF DILAPIDATION · **PHOTO** (photo refs, e.g. P-13). Stamped in-app photos per the photo standard in `soc-domain-model`.
3. **Rooms not in the property are left out** of the generated report. In the app the officer chooses which of the 15 template rooms are present (property type can preselect).
4. **Extra fields added:** appliance **SERIAL** (HOB/OVEN/EXTRACTOR: MAKE · MODEL · SERIAL); general schedule rows **FLOORING** and **KEYS HELD**; signatures for **landlord/agent, officer, tenant at check-in, tenant at check-out** (each name, method, date/time).
5. **All schemes use this same form.** No Light SOC. Scheme is a field on the visit. Official display names (confirmed by the user): **PLS = Private Leasing Scheme, NP = Nightly Paid, TF = Tenant Finder, PRSO = Private Rented Sector Offer** (seeded from `SCHEMES` in `packages/shared/src/enums.ts`).
6. **Scheme name drives the wording.** Cover reads "Kingston Council's {scheme name}" and the declaration reads "…accuracy cannot be guaranteed by the {scheme name}." — e.g. "Private Leasing Scheme" (replaces the template's "Private Leasing Section").
8. **Signatures (user, 2026-11-15): e-signatures only** (no wet signatures). Parties sign with a finger **on the phone at the review step, before issue**; signatures are **printed in the issued PDF**. Each signature binds to `visitContentHash()` of the draft shown; editing afterwards makes it stale (must re-sign). Officer signature required; landlord/agent and tenant optional ("Not signed"; an absent party may later sign by link — not in the issued PDF). The SHA-256 printed on the declaration is the content hash; the PDF's own hash is stored/emailed — **wording accepted by the user**.
7. **UI reference:** the generated HTML in `Project_info_files/` — `Inventory App Prototype.dc.html` for the app screens, `SOC Report Preview.dc.html` for the report layout. Tokens: fonts Barlow Condensed (headings, controls) + Barlow (body), mono for stamps/hashes; brand teal `#17708c` (hover `#14657f`), deep `#0f5568`/`#0b3d4c`/`#072932`, light tint `#cfe8ef`/`#eaf5f8`, text `#1d1f20`, muted `#5d5d60`, rule `#e0e1e3`, page `#f8f8f9`, on-dark `#f2f2f3`; grade pills G `#cfe8ef`/`#0b3d4c`, F `#6fb4c9`/`#072932`, P `#0f5568`/`#f2f2f3`, U `#072932`/`#f2f2f3`, N/A `#e0e1e3`/`#5d5d60`; square corners, condensed uppercase labels.

`references/form-definition.json` holds the pure template; apply decisions 1–6 on top of it when seeding.

## Design-pack proposals — status after the decisions above
| Proposal (source) | Template says | Status |
|---|---|---|
| 4th grade **U – Unacceptable** + **NA – not present/not inspected** (report §8, prototype) | G / F / P only | **Adopted** (decision 1) |
| **Photo** column / mandatory stamped photos per defect (report §9) | No photos in the form | **Adopted** (decision 2) |
| Property type auto-builds the room list (report, prototype) | Fixed 15 rooms | App behaviour only; must not change room/item definitions |
| Simplified item sets, e.g. one "LIGHT SWITCH" (prototype) | Single & double switches/sockets separate | **Conflict — template wins** |
| **Light SOC** variant for nightly-paid / tenant finder / PRSO | Only the PLS template exists | **Rejected** — all schemes use the same form (decision 5) |
| Appliance **serial** number (report preview) | MAKE, MODEL only | **Adopted** (decision 4) |
| General schedule **FLOORING**, **KEYS HELD** rows (report preview) | Not present | **Adopted** (decision 4) |
| Additional notes "Agreed" column (preview) | Column is "SIGNED" | Conflict — keep "SIGNED" |
| 4 signature roles (landlord, officer, tenant in/out) (preview) | Landlord signature, print name, date | **Adopted** (decision 4); e-signature method + hash still to confirm with legal |
| Declaration "Private Leasing **Scheme**" (preview) | "Private Leasing **Section**" | **Adopted as {scheme name}** (decision 6) |
| "~350 item rows" (report) | 264 rows + 13 misc | Report figure is wrong; use 264 |
| Report number SOC-YYYY-NNNN, summary/dilapidation/photo appendix pages | Not present | Additive output pages — confirm |

When building, implement the template baseline first; put each enhancement behind a clear decision and never let it alter template fields.

## Related skills
`soc-domain-model` (data model, rules — read with this precedence in mind) · `soc-report-generation` (output + exact boilerplate) · `soc-project-brief` (scope, phases, governance) · `soc-build-prompts` (staged task prompts).
