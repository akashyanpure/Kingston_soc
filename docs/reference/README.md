# UI reference (unpacked from Project_info_files/*.dc.html)

- `prototype.html` — markup, CSS and component logic (bottom `<script>`) of **Inventory App Prototype**: officer phone flow, manager desktop view, landlord signing page. Visual reference for `apps/web`.
- `report-preview.html` — markup and CSS of **SOC Report Preview** (sample report SOC-2026-0417). Visual reference for `packages/report`.
- `report-preview-doc-page.js` — the `<doc-page>` paged-A4 shell the preview uses (page size, margins, header/footer).

These pages use a template engine (`{{ x }}`, `<sc-if>`, `<sc-for>`, `DCLogic` classes). Read them for layout, spacing, typography and colour — do not copy the template engine.
The data in them is demo data. The form itself comes from `@soc/shared` (`buildFormDefinition()`), never from these files.
