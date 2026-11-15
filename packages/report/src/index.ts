/**
 * @soc/report — renders the Schedule of Condition report as standalone HTML.
 * Pure TS (no Node APIs): used by apps/web (offline draft) and apps/api (issued PDF).
 */
import type { FormDefinition, VisitBundle } from '@soc/shared';

export { renderReportHtml } from './render.js';
export type { ReportInput } from './render.js';
export { reportPhotos, assignPhotoRefs, photoRefMap } from './photos.js';
export { esc, longDate, shortDate, inspectionWindow } from './format.js';
export { REPORT_CSS } from './styles.js';

/** What the server freezes into reports.snapshot at issue; re-rendering it gives the same document. */
export interface ReportSnapshot {
  bundle: VisitBundle;
  form: FormDefinition;
  schemeName: string;
  officerName: string;
}
export { sampleBundle } from './sample.js';
