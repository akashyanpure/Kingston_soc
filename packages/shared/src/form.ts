/**
 * The SOC form definition.
 *
 * Source of truth: Project_info_files/SOC TEMPLATE (PLS).docx, extracted verbatim
 * into ./form/template.json. buildFormDefinition() applies the user's confirmed
 * decisions (2026-11-15) on top of it:
 *   1. Conditions G/F/P + U (Unacceptable) + NA (Not present / not inspected)
 *   2. PHOTO column on every item table
 *   3. Rooms not present are omitted from the report (room_instances.present)
 *   4. Appliance SERIAL; general rows FLOORING + KEYS HELD; four signature roles
 *   5. All schemes share this one form
 *   6. Cover + declaration use the scheme's display name
 *
 * The built definition is stored as JSON in form_versions.definition and is what
 * the app, API and report renderer all read. Never hard-code rooms/items elsewhere.
 */
import template from './form/template.json' with { type: 'json' };
import type { Condition, SignatureRole } from './enums.js';

export interface ConditionOption {
  code: Condition;
  label: string;
  short: string;
  definition: string;
  requiresComment: boolean;
  requiresPhoto: boolean;
  requiresReason: boolean;
}

export interface FormItemDef { code: string; label: string }
export interface FormRoomDef { code: string; label: string; items: FormItemDef[] }
export interface FormFieldDef { code: string; label: string; defaultValue?: string }

export interface FormDefinition {
  schemaVersion: 1;
  source: string;
  coverTitle: string;            // "SCHEDULE OF CONDITION and Inventory"
  coverPrefix: string;           // "Kingston Council's {scheme}"
  conditionOptions: ConditionOption[];
  itemColumns: string[];
  general: FormFieldDef[];
  appliances: FormItemDef[];
  applianceColumns: string[];
  meters: FormItemDef[];
  meterColumns: string[];
  rooms: FormRoomDef[];
  miscellaneous: { label: string; blankRows: number };
  additionalNotes: { columns: string[]; blankRows: number; rule: string };
  signatureRoles: { role: SignatureRole; label: string }[];
  boilerplate: {
    disclaimerTitle: string;
    disclaimer: string[];
    declarationTitle: string;
    /** Paragraphs; "{scheme}" is replaced by the scheme display name. */
    declaration: string[];
    abbreviations: string;
    footerReference: string;
    website: string;
  };
}

/** Exact template text (SOC TEMPLATE (PLS).docx). Do not edit without user approval. */
const DISCLAIMER = [
  'This is an inventory report that provides a fair and accurate record solely of the contents and condition of the property and does not form any part of a valuation or structural report.  It is the responsibility of the Landlord or the respective agents to agree, the accuracy of this Report, before signing it.',
  'Unless otherwise stated this inventory is compiled on the basis that all items listed are in good order and clean and any defects or soiling are noted where appropriate.  We are unable to attribute as to the value of any objects in the property and can only provide a description of all items for identification purposes only in order that each item can be compared to its condition at the commencement of the lease.',
  'We cannot undertake to move any heavy items, access lofts, high-level cupboards, basements, cellars or similar. Any property that has been left in the areas mentioned above, which have not been inventoried, are the sole responsibility of the Landlord.',
  'Boilers, gas fires, water supply and radiators are not tested.',
];

const DECLARATION = [
  // Decision 6: template said "Private Leasing Section"; now the scheme display name.
  'Whilst every care has been taken to ensure the accuracy of this Schedule of Condition and Inventory, accuracy cannot be guaranteed by the {scheme}.',
  'The Landlord(s) are reminded that it is their responsibility to check the accuracy of this Schedule of Condition and are advised to sign it in confirmation.',
  'This is to certify that we the undersigned have carefully checked the foregoing Schedule of Condition and Inventory and subject to the comments (initialled by both landlord and the Council), consider this to be a fair and correct Schedule of Condition.',
];

const ABBREVIATIONS =
  'ABBREVIATION: WP-White Plastic, PWE/PCE painted white/cream emulsion, PWG painted white gloss, DG double glazed, GWG Georgian wired glass. FWD flush wooden door, PWD panelled wood door, WF wood flooring, CRP ceiling rose & pendant, LLWC low level water closet, HLWC high level water closet, O/S outside. G-Good, F-Fair, P-Poor, U-Unacceptable, N/A-Not present';

export const CONDITION_OPTIONS: ConditionOption[] = [
  { code: 'G', label: 'Good', short: 'G', definition: 'Clean, undamaged, working as intended.', requiresComment: false, requiresPhoto: false, requiresReason: false },
  { code: 'F', label: 'Fair', short: 'F', definition: 'Serviceable with cosmetic wear or light soiling. No repair needed now.', requiresComment: true, requiresPhoto: true, requiresReason: false },
  { code: 'P', label: 'Poor', short: 'P', definition: 'Damaged, heavily soiled or not working properly. Repair or replacement needed.', requiresComment: true, requiresPhoto: true, requiresReason: false },
  { code: 'U', label: 'Unacceptable', short: 'U', definition: 'Not fit for use, or a hazard. The property should not be let in this state.', requiresComment: true, requiresPhoto: true, requiresReason: false },
  { code: 'NA', label: 'Not present / not inspected', short: 'N/A', definition: 'The item does not exist here, or could not be accessed. A reason is recorded.', requiresComment: false, requiresPhoto: false, requiresReason: true },
];

interface TemplateJson {
  rooms: { code: string; label: string; items: FormItemDef[] }[];
  miscellaneous_blank_rows: number;
  additional_notes: { columns: string[]; blank_rows: number };
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bWc\b/, 'WC');

export function buildFormDefinition(): FormDefinition {
  const t = template as unknown as TemplateJson;
  return {
    schemaVersion: 1,
    source: 'SOC TEMPLATE (PLS).docx + decisions 2026-11-15',
    coverTitle: 'SCHEDULE OF CONDITION and Inventory',
    coverPrefix: "Kingston Council's {scheme}",
    conditionOptions: CONDITION_OPTIONS,
    itemColumns: ['ITEM', 'Qty', 'DESCRIPTION', 'CONDITION', 'COMMENT', 'SCHEDULE OF DILAPIDATION', 'PHOTO'],
    general: [
      { code: 'DESCRIPTION_OF_PROPERTY', label: 'DESCRIPTION OF PROPERTY' },
      { code: 'GENERAL_CONDITION', label: 'GENERAL CONDITION' },
      { code: 'WINDOWS', label: 'WINDOWS', defaultValue: 'UPVC Double Glazed' }, // template typo "UVPC" corrected
      { code: 'HEATING', label: 'HEATING', defaultValue: 'Central Heating' },
      { code: 'FLOORING', label: 'FLOORING' }, // decision 4
      { code: 'KEYS_HELD', label: 'KEYS HELD' }, // decision 4
    ],
    appliances: [
      { code: 'HOB', label: 'HOB' },
      { code: 'OVEN', label: 'OVEN' },
      { code: 'EXTRACTOR', label: 'EXTRACTOR' },
    ],
    applianceColumns: ['MAKE', 'MODEL', 'SERIAL'],
    meters: [
      { code: 'ELECTRICITY', label: 'ELECTRICITY' },
      { code: 'GAS', label: 'GAS' },
      { code: 'WATER', label: 'WATER' },
      { code: 'STOPCOCK', label: 'STOPCOCK' },
    ],
    meterColumns: ['SERVICE', 'LOCATION', 'READING IN', 'READING OUT'],
    rooms: t.rooms.map((r) => ({ code: r.code, label: r.label, items: r.items.map((i) => ({ code: i.code, label: i.label })) })),
    miscellaneous: { label: 'MISCELLANEOUS', blankRows: t.miscellaneous_blank_rows },
    additionalNotes: {
      columns: t.additional_notes.columns,
      blankRows: t.additional_notes.blank_rows,
      rule: 'When additions are made the landlord/agent and the Council MUST agree and initial.',
    },
    signatureRoles: [
      { role: 'landlord_agent', label: 'Landlord / agent' },
      { role: 'officer', label: 'Private Sector Schemes Officer' },
      { role: 'tenant_check_in', label: 'Tenant (at check-in)' },
      { role: 'tenant_check_out', label: 'Tenant (at check-out)' },
    ],
    boilerplate: {
      disclaimerTitle: 'Safety Disclaimer',
      disclaimer: DISCLAIMER,
      declarationTitle: 'DECLARATION',
      declaration: DECLARATION,
      abbreviations: ABBREVIATIONS,
      footerReference: 'PLS Agreements/PLS/Schedule of Condition Pro Forma',
      website: 'www.kingston.gov.uk',
    },
  };
}

/** Replace {scheme} placeholders with the scheme display name. */
export function withScheme(text: string, schemeName: string): string {
  return text.replaceAll('{scheme}', schemeName);
}

export const roomDisplayName = (label: string) => titleCase(label);
