---
name: soc-domain-model
description: Domain rules and data model for the Kingston Schedule of Condition (SOC) inventory app — condition grades G/F/P/U/NA and the photo-evidence rule, schemes and Full vs Light form variants, property-type room plans, item taxonomy per room, description library, expected-life (fair wear) table, entity/field model, immutability and signature audit rules, photo stamping standard. Load before designing schemas, writing seed data, building capture/photo/check-out logic, or validating any SOC data.
---

# SOC domain model

Distilled from `Project_info_files/Inventory Automation Report.dc.html` (§7–10, §12, Appendices A–C), the prototype, and `SOC TEMPLATE (PLS).docx`. Full lists are in `references/` — read them when you need exact items.

> **Precedence:** `SOC TEMPLATE (PLS).docx` is the source of truth (see the `soc-template-form` skill and its `form-definition.json`). Rooms, items, columns and condition options come from the template. Everything below that goes beyond the template — grade U/NA, photos, Light SOC, Appendix A merges, prototype item sets, extra entities — is a **design proposal**: use it only where it adds to the template without changing it, and confirm with the user before treating it as decided.

## Condition grades (template G / F / P **+ U and N/A, confirmed by the user 2026-11-15**)
| Code | Name | Means | System consequence |
|---|---|---|---|
| G | Good | Clean, undamaged, working as intended | No comment/photo needed. **Default** after "mark all as good" |
| F | Fair | Serviceable, cosmetic wear or light soiling; no repair now | Comment + photo required. Usually fair wear at check-out |
| P | Poor | Damaged, heavily soiled or not working; repair/replace needed | Comment + photo required. Enters dilapidation schedule |
| U | Unacceptable | Not fit for use or a hazard; should not be let in this state | Comment + photo required. **Flags manager on sync, blocks a clean check-in** |
| — / NA | Not present / not inspected | Item doesn't exist or couldn't be accessed | Recorded explicitly **with a reason** — silence never reads as approval |

Rules:
- **Evidence rule**: any F/P/U item needs a comment and ≥1 stamped photo. The report **cannot be issued** while any defect lacks one (sign-off shows the count; button disabled).
- **Grade ≠ fair-wear decision.** Grade = what the officer sees. Chargeable vs fair wear is a separate field, suggested from tenancy length + expected-life table; officer decides; store suggestion *and* decision.
- Colour must never be the only signal — always show letter + word. Long-press shows the definition; definitions also print in the report's condition key.
- Prototype palette: G `#cfe8ef`/`#0b3d4c`, F `#6fb4c9`/`#072932`, P `#0f5568`/`#f2f2f3`, U `#072932`/`#f2f2f3`, NA `#e0e1e3`/`#5d5d60`; brand teal `#17708c`; font Barlow Condensed.

## Schemes and form variants
**Decided 2026-11-15: all four schemes use the same single form** (the template + confirmed decisions). Scheme is a field on the visit and supplies the name used on the cover and in the declaration. The Light SOC proposal below was **rejected** — kept for context only.

~~One form engine, **two published definitions**~~ (rejected); scheme is a tag on the record; scheme-specific bits are optional sections, not separate forms.
| Scheme | Form | Differences |
|---|---|---|
| Private Leasing Scheme (PLS) | Full SOC | Every room/item, dilapidation column, full photo appendix (~350 rows max) |
| Nightly paid | Light SOC | Core room items, mandatory photos, meters, **furnishings / bed-linen / crockery count**; ~30–50 rows |
| Tenant finder | Light SOC | Condition-focused; optional furnishings; landlord obligations noted on cover |
| PRSO | Light SOC | **Landlord-obligations block + certificate expiry dates** on cover |

Visit types: check-in, check-out, interim.

## Room plans (property type → rooms)
The available room types are exactly the template's 15 (Front garden, Back garden, Front door, Hallway, Reception, Conservatory, Kitchen, Utility, Stairs and landing, Bedroom 1–4, Bathroom, Separate WC). A property-type plan only **preselects which of them are present**; it never changes a room's items. Prototype plans (simplified demo, not authoritative):
- **Studio flat**: Front door, Reception/Bedsit, Kitchen, Bathroom
- **1-bed flat**: Front door, Hallway, Reception, Kitchen, Bedroom 1, Bathroom
- **2-bed flat**: + Bedroom 2
- **3-bed house**: Front garden, Front door, Hallway, Reception, Kitchen, Stairs & landing, Bedrooms 1–3, Bathroom (+ back garden per template)
Officers can add, rename, duplicate or remove rooms. Optional template rooms (Conservatory, Utility, Separate WC, Bedroom 4, gardens) are added only when present — the paper template forces them on every property, which is a known problem.

## Item taxonomy
**Authoritative list = the template's 264 rows / 64 item types** (`soc-template-form/references/form-definition.json`; human-readable in `references/taxonomy.md` §1). Appendix A and the prototype sets (§2–3) are proposals; do not merge single/double variants unless the user agrees. Recurring core per habitable room: Walls, Ceiling, Door, Handle, Door frame, Woodwork, Window, Window handle, Radiator, sockets (single/double), light switches (single/double), Smoke alarm, Light fitting. Room-specific additions and the exact template lists per room are in `references/taxonomy.md`. Known near-duplicates to merge: single/double socket, single/double light switch, base/wall units single/double. Template typos to normalise: "DOUBLESOCKET", "WINDOWHANDLE", "WATERCLOSET", "BATHROOMFITTINGS", "LIGHTFITTING", "UVPC" (→ UPVC), "Locks" (lowercase).

Item row fields (template columns): **Item · Qty · Description · Condition · Comment · Schedule of Dilapidation**. Comment = what is seen; Dilapidation = what should be done and who pays — keep separate. The template has **no photo column** — the app adds photo refs. Plus **Miscellaneous** (13 free rows; repeated free-text entries are candidates for the taxonomy).

Other captured blocks (template): general schedule (description of property, general condition, windows [default "UPVC Double Glazed"], heating [default "Central Heating"]), kitchen appliances (make + model for hob, oven, extractor), meters (electricity, gas, water, stopcock — location, reading in, reading out), additional notes (date, note, added by, signed). Proposed additions: flooring, keys held, appliance serial, meter-face photo.

## Data model (entities)
| Entity | Note | Key fields |
|---|---|---|
| Property | one per address, forever | uprn, address_lines, postcode, property_type, bedrooms, tenure, landlord_id, created_at |
| Landlord/agent | signing party | name, company, email, phone, preferred_signing_method, notes |
| Tenancy | links check-in to check-out | property_id, scheme, tenant_ref, start_date, end_date, status |
| Visit | one appointment | property_id, tenancy_id, scheme, visit_type (in/out/interim), officer_id, scheduled_at, started_at, completed_at, status, report_number |
| Form definition | **versioned data, not code** | variant (full/light), version, rooms[], items_by_room_type[], grade_set, published_at — a visit records which version it used |
| Room instance | per visit | visit_id, room_type, label ("Bedroom 2"), sort_order, wide_photo_id |
| Item record | the atom | room_instance_id, item_code, label, qty, description, condition (G/F/P/U/NA), comment, dilapidation_note, chargeable_suggestion, photo_ids[], updated_at, updated_by |
| Photograph | immutable once synced | visit_id, room_instance_id, item_record_id, blob_url, captured_at, gps, stamp_text, sha256, retention_until |
| Meter reading | per visit | visit_id, service, location, reading, photo_id |
| Report | issued artefact | visit_id, report_number, pdf_url, sha256, issued_at, issued_by, immutable=true |
| Signature | audit-bearing | report_id, role (landlord/agent/officer/tenant), name, method, signed_at, ip, device, report_sha256 |
| Note addition | post-issue corrections | report_id, note, added_by, added_at, agreed_by_landlord, agreed_at |

Invariants: issued Report is immutable (corrections only via Note addition, agreed by both parties); Photograph immutable after sync (post-sync deletion = admin action + audit); conflicts = last-write-wins **per field** with audit entry; report number format `SOC-YYYY-NNNN`, one per visit.

## Photo standard
- Mandatory **wide room shot from the doorway** on entering each room, before grading.
- Mandatory **item shot** for F/P/U; second close-up with a **scale card** encouraged for chargeable items.
- **Stamp** burned in (≤15% of image height, bottom) **and** in EXIF/XMP: address + postcode, UPRN, date, time, GPS, scheme, report number, room, item, officer.
- ~1600 px long edge, JPEG q≈80, target <400 KB; SHA-256 stored; original kept on device until upload confirmed.
- Captured in-app only, never in the camera roll. GPS captured once per room. Upload order on sync: visits → item records → photos (largest last), retry with backoff.
- Photo refs `P-nn`, cross-referenced from item rows ("see P-13").

## Signatures (Phase 2)
Four paths, one model: on-phone finger signature at visit · secure expiring link (chase at **3, 7, 12 days**, manager flag at **14**) · wet-signature PDF with scan-back · officer-only issue (marked **unagreed**, chased). Every signature stores who, role, method, when, IP, device/user agent, report SHA-256. Signer may dispute an individual item (notifies officer).

## Check-out & dilapidation (Phase 3)
Show only items whose grade changed, check-in grade+photo beside today's. Suggest fair wear vs chargeable from tenancy length + expected-life table (`references/expected-life.md`); cost **pro-rated against remaining life, never full replacement**; show the calculation. Handle items absent at check-in and reconfigured rooms. Prototype examples: work surface G→P chargeable £180 est.; shower G→U landlord repair; reception walls G→F after 31 months = fair wear; bedroom carpet F→P burn = chargeable £95 est.

## References
- `../soc-template-form/references/form-definition.json` — authoritative, machine-readable form (rooms, items, codes, columns).
- `references/taxonomy.md` — exact item lists per room from the Word template (§1, authoritative), Appendix A proposal (§2), prototype demo sets (§3).
- `references/description-library.md` — Appendix B one-tap description chips.
- `references/expected-life.md` — Appendix C fair-wear table.
