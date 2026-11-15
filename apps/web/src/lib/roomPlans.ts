/**
 * Property type → which template rooms are preselected as present (soc-domain-model
 * "Room plans"). Only a preselection: the officer adjusts the checklist, and room/item
 * definitions always come from the FormDefinition.
 */
import type { FormDefinition, PropertyType } from '@soc/shared';

const FLAT = ['FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'BATHROOM'];
const HOUSE = ['FRONT_GARDEN', 'BACK_GARDEN', 'FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'STAIRS_AND_LANDING', 'BATHROOM'];
const beds = (n: number) => Array.from({ length: n }, (_, i) => `BEDROOM_${i + 1}`);

const PLANS: Record<PropertyType, string[]> = {
  'Studio flat': ['FRONT_DOOR', 'RECEPTION', 'KITCHEN', 'BATHROOM'],
  '1-bed flat': [...FLAT, ...beds(1)],
  '2-bed flat': [...FLAT, ...beds(2)],
  '3-bed flat': [...FLAT, ...beds(3)],
  '2-bed house': [...HOUSE, ...beds(2)],
  '3-bed house': [...HOUSE, ...beds(3)],
  '4-bed house': [...HOUSE, ...beds(4)],
  Other: FLAT,
};

export function roomsForPropertyType(form: FormDefinition, type: string): string[] {
  const plan = new Set(PLANS[type as PropertyType] ?? PLANS.Other);
  return form.rooms.filter((r) => plan.has(r.code)).map((r) => r.code);
}
