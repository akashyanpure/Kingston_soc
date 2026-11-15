import type { PropertyType } from '@soc/shared';

/**
 * Default "rooms present" per property type (template room codes). App behaviour only — the
 * officer can toggle any of the 15 template rooms; this never changes room/item definitions.
 */
const FLAT_CORE = ['FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'BATHROOM'];
const HOUSE_CORE = ['FRONT_GARDEN', 'BACK_GARDEN', 'FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'STAIRS_AND_LANDING', 'BATHROOM'];
const beds = (n: number) => Array.from({ length: n }, (_, i) => `BEDROOM_${i + 1}`);

export const DEFAULT_ROOM_PLANS: Record<PropertyType, string[]> = {
  'Studio flat': ['FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'BATHROOM'],
  '1-bed flat': [...FLAT_CORE, ...beds(1)],
  '2-bed flat': [...FLAT_CORE, ...beds(2)],
  '3-bed flat': [...FLAT_CORE, ...beds(3)],
  '2-bed house': [...HOUSE_CORE, ...beds(2)],
  '3-bed house': [...HOUSE_CORE, ...beds(3), 'SEPARATE_WC'],
  '4-bed house': [...HOUSE_CORE, ...beds(4), 'SEPARATE_WC'],
  Other: ['FRONT_DOOR', 'HALLWAY', 'RECEPTION', 'KITCHEN', 'BATHROOM', ...beds(1)],
};
