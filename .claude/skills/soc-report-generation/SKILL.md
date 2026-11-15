---
name: soc-report-generation
description: Specification for the generated Kingston Schedule of Condition (SOC) report/PDF — section order, page furniture, report numbering, photo appendix, condition key, dilapidation and landlord summary pages, declaration, SHA-256 integrity hash, and the exact boilerplate text (safety disclaimer, declaration, additional-notes rule) from SOC TEMPLATE (PLS).docx. Load when building or reviewing the PDF/HTML report template, the renderer, or any sample report output.
---

# SOC report generation

Sources: `Project_info_files/SOC TEMPLATE (PLS).docx` (the shape landlords know — keep it), `SOC Report Preview.dc.html` (worked example SOC-2026-0417), report §11. Domain rules: see the `soc-domain-model` skill.

> **Confirmed 2026-11-15:** photo column on item tables; condition key includes U and N/A; rooms not present are omitted; appliance serial, FLOORING and KEYS HELD rows; 4 signature roles; cover and declaration use the visit's **scheme name** ("…accuracy cannot be guaranteed by the Private Leasing Scheme."); layout follows `SOC Report Preview.dc.html`. See `soc-template-form` → Confirmed decisions.
>
> **Precedence:** the generated document must reproduce the **Word template** — its sections, order, labels, columns and fixed text (see `soc-template-form`). The preview's extra pages and fields (report number, condition key, summary page, dilapidation summary, photo appendix, serial numbers, flooring/keys rows, 4 signature roles, hash) are **proposed additions**: include them only once confirmed, and never in place of template content.

## Template page furniture to reproduce
- Running header on schedule pages: **PROPERTY:** [address] · **DATE:** [date], plus the abbreviation key: "ABBREVIATION: WP-White Plastic, PWE/PCE painted white/cream emulsion, PWG painted white gloss, DG double glazed, GWG Georgian wired glass. FWD flush wooden door, PWD panelled wood door, WF wood flooring, CRP ceiling rose & pendant, LLWC low level water closet, HLWC high level water closet, O/S outside. G-Good, F-Fair, P-Poor"
- Footer: page number; reference "PLS Agreements/PLS/Schedule of Condition Pro Forma". Cover: www.kingston.gov.uk and council logo.
- Room tables: ITEM · Qty · DESCRIPTION · CONDITION · COMMENT · SCHEDULE OF DILAPIDATION; then MISCELLANEOUS; ADDITIONAL NOTES (DATE · NOTE · ADDED BY · SIGNED); DECLARATION.

## How it is produced
- **HTML/CSS template rendered to PDF server-side — never Word automation.** Template editable by a service designer who knows HTML/CSS but not the backend.
- Draft PDF must be viewable **on the device, offline**, before the officer leaves; authoritative copy regenerated server-side on sync.
- **Deterministic**: same data → same document. SHA-256 of the issued PDF stored with the record and printed on the declaration page. Issued report is immutable.
- Output **tagged accessible PDF** and an **accessible HTML** version.
- A4. Emailed to landlord, agent (tenant where relevant) and team inbox; filed against the property.

## Section order (keep the template's order)
1. **Cover** — council branding (Royal Borough of Kingston upon Thames · Housing · Private Sector Schemes), scheme title ("Private Leasing Scheme — Schedule of Condition and Inventory"), address + postcode, date & time window of inspection, property type, landlord/agent, tenant, Private Sector Schemes Officer, record summary (e.g. "141 items · 38 photographs · 5 below good"). Report number + scheme + visit type top right ("SOC-2026-0417 · PLS · CHECK-IN"). PRSO/tenant finder covers add landlord obligations and certificate expiry dates.
2. **Safety disclaimer** (fixed text, below).
3. **Schedule of condition — general**: description of property, general condition, windows, heating, flooring, keys held.
4. **Meter readings**: service · location · reading in · reading out (electricity, gas, water, stopcock).
5. **Kitchen appliances**: appliance · make · model · serial (hob, oven, extractor).
6. **Condition key**: "G Good · F Fair (serviceable, cosmetic wear) · P Poor (repair needed) · U Unacceptable (not fit for use at let). Every item graded F, P or U carries at least one dated photograph in the appendix."
7. **Room-by-room item tables** — per room header with "N items · N below good · N photographs"; columns Item · Qty · Description · Cond. · Comment · Photo (refs like "P-13, P-14"); Schedule of Dilapidation column for full SOC. Header row repeats across page breaks; never split a row. Footer line: "Recorded on site DD/MM/YYYY by <officer>. Descriptions drawn from the council's standard description library; free-text comments are the officer's own."
8. **Dilapidation summary** (check-out; generated from changed items).
9. **Landlord-friendly summary**: only items not marked Good, with thumbnails — "the page that actually gets read".
10. **Photo appendix** — two per page, each with ref, room · item, note, and the burned-in stamp (address · date time / GPS · ROOM / ITEM). Intro text explains stamping; closing note on retention ("Retained for 7 years from the end of the lease, then deleted automatically…").
11. **Additional notes** — Date · Note · Added by · Agreed (initials of both parties).
12. **Declaration and signatures** — landlord/agent, Private Sector Schemes Officer, tenant at check-in, tenant at check-out; each with method/timestamp/IP meta; SHA-256 block.

## Page furniture
Every page: property address + postcode, report number, page number ("14 ACRE ROAD, KT2 6EU · SOC-2026-0417 · PAGE 11"). Cover footer: "Generated automatically from the inventory app · kingston.gov.uk". Report number format `SOC-YYYY-NNNN`, also stamped on every photo. Typical full report ≈41 pages; test pagination with 350 items and 60 photos.

## Exact boilerplate from the Word template
**Safety Disclaimer**
> This is an inventory report that provides a fair and accurate record solely of the contents and condition of the property and does not form any part of a valuation or structural report. It is the responsibility of the Landlord or the respective agents to agree, the accuracy of this Report, before signing it.
>
> Unless otherwise stated this inventory is compiled on the basis that all items listed are in good order and clean and any defects or soiling are noted where appropriate. We are unable to attribute as to the value of any objects in the property and can only provide a description of all items for identification purposes only in order that each item can be compared to its condition at the commencement of the lease.
>
> We cannot undertake to move any heavy items, access lofts, high-level cupboards, basements, cellars or similar. Any property that has been left in the areas mentioned above, which have not been inventoried, are the sole responsibility of the Landlord.
>
> Boilers, gas fires, water supply and radiators are not tested.

**Additional notes rule**
> When additions are made the landlord/agent and the Council MUST agree and initial.

**Declaration**
> Whilst every care has been taken to ensure the accuracy of this Schedule of Condition and Inventory, accuracy cannot be guaranteed by the {scheme name}.
>
> *(Template original: "…by the Private Leasing Section." Replaced by the scheme name per user decision, e.g. "Private Leasing Scheme".)*
>
> The Landlord(s) are reminded that it is their responsibility to check the accuracy of this Schedule of Condition and are advised to sign it in confirmation.
>
> This is to certify that we the undersigned have carefully checked the foregoing Schedule of Condition and Inventory and subject to the comments (initialled by both landlord and the Council), consider this to be a fair and correct Schedule of Condition.

Signature block: "signed on behalf of the landlord:", "PRINT NAME:", "date:".

Template header fields: "Kingston Council's Private Leasing Scheme · SCHEDULE OF CONDITION and Inventory · At [address] · Date · Landlord/Agent · Tenant · Private Sector Schemes Officer · www.kingston.gov.uk".

## Known template issues to fix in generated output
- The Date field renders as a raw Word field code ("5664835101600") — generate dates as `DD Month YYYY, HH:MM–HH:MM`.
- "UVPC Double Glazed" typo → "UPVC".
- Declaration says "Private Leasing Section"; the preview modernises it to "Private Leasing Scheme" and adds e-signature wording ("Signed electronically under the scheme's e-signature policy. Each signature is bound to the report hash shown opposite; altering any page invalidates it."). **Confirm the wording with the service/legal before changing boilerplate** — don't silently rewrite it.
- Template has no photo column and carries rooms the property lacks — the generated report adds photo refs and only includes rooms that exist.

## Reference example (SOC-2026-0417)
14 Acre Road, Kingston upon Thames KT2 6EU · 15 Sep 2026 09:34–10:12 · 3-bed terraced house, unfurnished · Pemberton Lettings Ltd · officer J. Patel · 141 items, 38 photos, 5 below good. Kitchen: walls F (P-11, P-12), work surface P (P-13, P-14), extractor F (P-16); bathroom shower U (P-21). Use the preview HTML as the visual reference for layout and styling.
