---
name: soc-project-brief
description: Background, scope, phases, decisions, business case, risks and governance for the Royal Borough of Kingston Private Sector Schemes "Inventory & Schedule of Condition (SOC) automation" project. Load whenever work in this repo touches scope, roadmap, phase 1 boundaries, requirements (must/should/could), hosting, DPIA/GDPR, accessibility, rollout, or the business case — or before writing any spec, plan, code or document for the SOC app.
---

# Kingston SOC automation — project brief

Source material lives in `Project_info_files/` (bundled `.dc.html` pages — open in a browser — plus the original Word template). This skill is the distilled version; quote the source when exact wording matters.

> **Goal and source of truth (set by the user):** `SOC TEMPLATE (PLS).docx` is the source of truth. The project is to automate **that form** into a full-fledged, online, mobile-friendly web app. The `.dc.html` pages are supporting design proposals — where they differ from the template, the template wins; their additions (grade U, photos, Light SOC, signatures, dashboards…) need confirmation. Load `soc-template-form` first.

| File | What it is | Audience |
|---|---|---|
| `Start Here.dc.html` | Landing page: headline stats, the four deliverables, 7 next steps | Everyone |
| `Inventory Automation Report.dc.html` | 22-section options & delivery report + Appendices A–C (draft, 15 Sep 2026) | Manager / IT board |
| `Inventory App Prototype.dc.html` | Clickable phone prototype: officer flow, manager dashboard, landlord signing page | Officers, manager |
| `SOC Report Preview.dc.html` | Sample generated SOC PDF (SOC-2026-0417, 14 Acre Road) | Landlords / agents |
| `Build Prompt Pack.dc.html` | 18 copy-paste prompts in 5 stages | Builder |
| `SOC TEMPLATE (PLS).docx` | The current paper/Word Schedule of Condition — the shape the output must keep | — |

## The situation
- Housing · Private Sector Schemes team: **6 officers, ~100 property visits/week, 4 schemes** — Private Leasing Scheme (PLS), nightly-paid, tenant finder, PRSO.
- Today: a ~41-page Word template (~350 item rows) is printed, handwritten, photographed separately on a phone camera roll, then **re-typed in the office**.
- Estimated **95 min per SOC** end to end (≈158 h/week ≈ 4.2 FTE), ~40 min of it office work. **All figures are estimates** from template shape — not measured. Always caveat them; Phase 0 measures 20 real visits.

## The solution in one line
A custom, **phone-first, offline-first installable web app** that holds the inventory as **structured data**, forces **stamped photo evidence** on any defect, and **generates the SOC PDF on site**. Target **38 min per SOC, all on site, zero office write-up** → ~95 h/week released ≈ 2.5 FTE.

The four changes that do most of the work:
1. **Property type builds the form** (e.g. "3-bed house" → rooms + items).
2. **Grade by exception** — "Mark all as good", then edit ~8 items instead of 141.
3. **No defect without a photo** — F/P/U grades block issue until a stamped photo exists.
4. **Report finished on site** — PDF generated, signed, emailed before leaving.

## Scope fence — Phase 1 is fixed
Phase 1 = **officer visit flow + automatic PDF**. Nothing else. Explicitly out: e-signatures, check-out comparison, manager dashboard, archive search, **any integration** (standalone was chosen deliberately). Push back on scope creep — "Scope grows into a housing management system" is rated a High risk.

| Phase | When | Content |
|---|---|---|
| 0 Groundwork | Wks 0–3, no code | Time 20 visits; agree taxonomy with all 6 officers; description library + grade definitions; start DPIA; hosting decision; retention schedule |
| 1 Visit flow + PDF | Wks 4–15 | Login, assigned visits, offline cache; property type → rooms/items; mark all good; grades/descriptions/comments; in-app stamped camera; meters & appliances; SOC PDF on site; email + file; pilot 2 officers on PLS check-ins for 3 weeks with paper fallback |
| 2 Sign-off, schemes, archive | Wks 16–26 | 4 signature paths; Light SOC + roll-out to other schemes; property record/archive/search; manager dashboard; retire paper per scheme |
| 3 Check-out & dilapidation | Wks 27–38 | Side-by-side check-in vs check-out; fair-wear suggestions; generated dilapidation schedule with costs; landlord item disputes; voice dictation, room duplication, routing; review HMS integration |

Effort: Phase 1 **55–75 dev days** (2 devs ≈ 10–12 weeks); Phases 2+3 add 60–90 days.

## Requirements by module (M = Phase 1, S = Phase 2, C = Phase 3)
- **A Visits** — M: officer's visits today/week offline; visit carries address, UPRN, scheme, type, landlord contact, time; previous report readable on site. S: manager assigns/reassigns. C: route ordering.
- **B Form generation** — M: property type → rooms (add/rename/duplicate/remove); room → items from taxonomy; one-off items → Miscellaneous; **form definitions are data, admin-editable without a release**. S: scheme selects Full vs Light SOC.
- **C Item capture** — M: item, qty, description, grade, comment, dilapidation note; mark-all-good at property & room level; one-tap description library + free text; below-Good forces comment + ≥1 photo. S: voice dictation; duplicate room.
- **D Photos** — M: in-app only, never camera roll; burned-in + EXIF stamp; mandatory room wide shot + defect shot; delete/retake before sync, admin-only with audit after. S: meter-face photo.
- **E Offline/sync** — M: fully functional offline, local-first writes; background upload with visible queue/retry; no loss if app/phone/browser dies. S: conflict resolution (last-write-wins per field + audit).
- **F Report** — M: SOC PDF in template order with branding/disclaimer/declaration; photo appendix cross-refs; draft viewable on device; report number on every page. S: dilapidation summary; SHA-256 printed on declaration.
- **G Signatures** (all S, dispute = C) · **H Check-out** (S, rate card C) · **I Archive/dashboard** (S, CSV C) · **J Admin** — M: users/roles; S: edit taxonomy/library/grades/variants, retention job; C: PDF template editor.

## Non-functional baseline
- **Offline is the baseline, not a feature.** Cache form defs, previous reports, library. Test in a real basement.
- **Phone-first**: controls ≥44px, one-handed, usable holding a torch; tablet nice-to-have. Design load: 40-min visit with camera; GPS once per room.
- **Installable PWA**, not app-store (no MDM cycle).
- **WCAG 2.2 AA** mandatory; colour never the only grade signal; landlord signing page works on an old phone, no account; tagged PDF + accessible HTML report.
- **Immutability**: an issued report is never edited; corrections are appended, agreed, time-stamped notes. Decide before the first line of code.

## Hosting options (decision pending — gates DPIA, security review, procurement)
- **A · Council Azure tenancy** — *recommended*; hosting ~£100–250/mo; strongest governance.
- **B · Dedicated Azure resources** — ~£250–600/mo; cleaner separation.
- **C · Supplier-hosted, council-owned data** — build £90k–160k + £1.5k–3k/mo; new processor → longer DPIA.
- **D · SaaS inventory product** — £3–8/report; format bends to product. Comparator only.
Indicative build shape: React-or-similar PWA + local storage + sync layer, small API, relational DB (PostgreSQL in the prompts), blob storage for photos, server-side HTML→PDF renderer.

## Tech decisions so far (user, 2026-11-15)
- **No SSO at first.** Build pluggable auth: `AUTH_MODE=local` (email + password, seeded users with officer/manager/admin roles) for local testing; OIDC (Entra ID or other) added later behind the same role model.
- **Council IT context: no Microsoft.** The council uses **Google Workspace** and **Amazon WorkSpaces** (so it has an AWS relationship). The design report's "council Azure tenancy" recommendation and Entra ID references **no longer apply**.
- **Cloud target: AWS, London region (eu-west-2)** — recommended 2026-11-15 (pending confirmation of the council's AWS account/ownership). Mapping: web on S3 + CloudFront; API + PDF service on ECS Fargate; RDS for PostgreSQL; S3 for photos/PDFs (presigned uploads); email via SES or Google Workspace SMTP relay; Secrets Manager; CloudWatch; infrastructure as code with AWS CDK (TypeScript).
- **Later SSO = Google Workspace via OIDC**, restricted to the council domain (`hd` claim), mapped to the same roles. Landlords use expiring signing links, no account.
- Still keep the code cloud-agnostic (storage/mail behind interfaces).
- **Current deployment target: local only** (user, 2026-11-15) — cloud deferred. Dev machine is Windows 11, **no Docker**; uses the **native PostgreSQL 17** service on localhost:5432. Local adapters: photos/PDFs on the filesystem (`./data/storage`), outgoing mail written to `./data/mail` as .eml (no SMTP), PDF via Playwright's bundled Chromium. Node must be ≥ 20.19 (machine had 18.16, which is end-of-life).

## Data protection (DPIA required — start in Phase 0)
Council is controller; lawful basis public task (tenant/property), legitimate interests/contract (landlord/agent contacts) — confirm with DPO. **UK region only.** Retention proposal **7 years from end of lease/tenancy**, auto-deleted, subject to litigation holds. Role-based access (officer: own visits; manager: team; admin: config), no shared logins, SSO when available. Encryption in transit/at rest, no camera roll, remote wipe on offboarding, pen test before go-live. Train officers not to photograph people, documents or possessions; easy delete/retake before sync. Photo storage ≈1.2 GB/week (40 × 100 × 300 KB).

## Decisions still needed (none need a developer)
Hosting (A–D) · who builds it (confirm 2 devs × 10–12 wks) · sign off 4 grade definitions · approve taxonomy (Appendix A) · retention period · legal position on e-signatures (before Phase 2) · name pilot officers + scheme · paper retirement dates per scheme.

## Success measures
Median ≤40 min/SOC all on site · 0 office write-up hours · 100% defects photographed · ≥95% issued same day · ≥95% signed within 14 days · dilapidation write-offs down 50% in year one · officer confidence improves. Strongest business-case lever: faster re-letting of empty properties cuts nightly-paid placement costs.

## Rollout principles
Measure baseline first · build the taxonomy **with** officers · pilot 2 officers / 1 scheme / 3 weeks · expect taxonomy changes (must be editable without release) · train in pairs (20-min session + one shadowed visit) · notify landlords/agents before format change · retire paper on a fixed date per scheme (parallel running ≤1 month).

## Related skills
- `soc-domain-model` — grades, taxonomy, room plans, data model, photo rules.
- `soc-report-generation` — the PDF output spec and exact boilerplate.
- `soc-build-prompts` — the staged prompt pack for producing specs, DPIA, code.
