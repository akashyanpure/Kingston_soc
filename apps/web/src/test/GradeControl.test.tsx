import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CONDITION_OPTIONS, type Condition } from '@soc/shared';
import { GradeControl } from '../components/GradeControl';

function Harness({ initial = null, onChange }: { initial?: Condition | null; onChange?: (c: Condition) => void }) {
  const [value, setValue] = useState<Condition | null>(initial);
  return (
    <GradeControl itemLabel="Kitchen, walls" value={value} options={CONDITION_OPTIONS}
      onChange={(c) => { setValue(c); onChange?.(c); }} />
  );
}

const radios = () => screen.getAllByRole('radio');
const checked = () => radios().find((r) => r.getAttribute('aria-checked') === 'true')?.getAttribute('aria-label') ?? null;

describe('GradeControl', () => {
  it('is a labelled radiogroup with letter + word options and one tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Condition of Kitchen, walls' })).toBeTruthy();
    expect(radios().map((r) => r.getAttribute('aria-label'))).toEqual([
      'G Good', 'F Fair', 'P Poor', 'U Unacceptable', 'N/A Not present / not inspected',
    ]);
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(checked()).toBeNull();
  });

  it('arrow keys move and select, wrapping; Home/End jump; tab stop follows the selection', () => {
    const onChange = vi.fn();
    render(<Harness initial="G" onChange={onChange} />);
    const group = screen.getByRole('radiogroup');
    radios()[0]!.focus();

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('F');
    expect(checked()).toBe('F Fair');
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1, -1]);

    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(checked()).toBe('P Poor');

    fireEvent.keyDown(group, { key: 'End' });
    expect(checked()).toBe('N/A Not present / not inspected');

    fireEvent.keyDown(group, { key: 'ArrowRight' }); // wraps to the start
    expect(checked()).toBe('G Good');

    fireEvent.keyDown(group, { key: 'ArrowLeft' }); // wraps to the end
    expect(onChange).toHaveBeenLastCalledWith('NA');

    fireEvent.keyDown(group, { key: 'Home' });
    expect(checked()).toBe('G Good');
  });

  it('Space selects the focused option; clicks select; other keys are ignored', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole('radiogroup');
    radios()[0]!.focus();
    fireEvent.keyDown(group, { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith('G');
    fireEvent.keyDown(group, { key: 'a' });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(radios()[3]!);
    expect(checked()).toBe('U Unacceptable');
  });

  it('shows the grade definitions on request', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /what the grades mean/i }));
    expect(screen.getByText(CONDITION_OPTIONS[2]!.definition)).toBeTruthy();
  });
});
