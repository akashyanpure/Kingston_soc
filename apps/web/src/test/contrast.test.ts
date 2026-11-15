/**
 * WCAG 2.2 AA contrast for every text/background pair in the design tokens (src/styles/tokens.css).
 * Normal text needs ≥ 4.5:1; large/bold UI text and non-text indicators ≥ 3:1.
 */
import { describe, expect, it } from 'vitest';

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const PAPER = '#FAF6EE', RAISED = '#FFFDF8', SUNKEN = '#F3EDE1', TINT = '#E3EFEE';
const INK = '#1F2523', MUTED = '#5E625C', TEAL = '#0F5E6E', TEAL_HOVER = '#0B4C5A', BRASS_INK = '#7A5A17';

/** [label, foreground, background, minimum] */
export const PAIRS: [string, string, string, number][] = [
  // text on surfaces
  ['ink on paper', INK, PAPER, 4.5],
  ['ink on raised', INK, RAISED, 4.5],
  ['ink on sunken', INK, SUNKEN, 4.5],
  ['ink on teal tint', INK, TINT, 4.5],
  ['muted on paper', MUTED, PAPER, 4.5],
  ['muted on raised', MUTED, RAISED, 4.5],
  ['muted on sunken', MUTED, SUNKEN, 4.5],
  ['muted on teal tint', MUTED, TINT, 4.5],
  ['teal on paper (links)', TEAL, PAPER, 4.5],
  ['teal on raised', TEAL, RAISED, 4.5],
  ['teal on sunken', TEAL, SUNKEN, 4.5],
  ['teal on tint', TEAL, TINT, 4.5],
  ['raised on teal (primary button)', RAISED, TEAL, 4.5],
  ['raised on teal hover', RAISED, TEAL_HOVER, 4.5],
  ['brass ink on paper (issued label)', BRASS_INK, PAPER, 4.5],
  ['brass ink on brass tint', BRASS_INK, '#F6EBD3', 4.5],
  // grade badges: tint background + grade ink
  ['G badge', '#276B4F', '#E6F1EA', 4.5],
  ['F badge', '#8A5A0B', '#FBF0D9', 4.5],
  ['P badge', '#9A4521', '#F8E4DA', 4.5],
  ['U badge', '#8E1F2F', '#F6DCDF', 4.5],
  ['N/A badge', '#5C5C55', '#ECEAE3', 4.5],
  // selected grade pill: solid grade colour + ivory text
  ['G selected', RAISED, '#2F7A5B', 4.5],
  ['F selected', RAISED, '#8A5A0B', 4.5],
  ['P selected', RAISED, '#9A4521', 4.5],
  ['U selected', RAISED, '#8E1F2F', 4.5],
  ['N/A selected', RAISED, '#6B6B63', 4.5],
  // non-text indicators (dots, rings, focus) need 3:1 against the surface
  ['G hue indicator', '#2F7A5B', RAISED, 3],
  ['F hue indicator', '#A86F12', RAISED, 3],
  ['P hue indicator', '#B4532A', RAISED, 3],
  ['U hue indicator', '#8E1F2F', RAISED, 3],
  ['teal ring / focus on paper', TEAL, PAPER, 3],
  ['teal ring on sunken track', TEAL, SUNKEN, 3],
];

describe('design token contrast (WCAG 2.2 AA)', () => {
  for (const [label, fg, bg, min] of PAIRS) {
    it(`${label}: ${fg} on ${bg} ≥ ${min}`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
    });
  }
});
