// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COURSE_MODE_REGISTRY } from '../../course-mode-registry.js';
import { CourseModeSelector } from './course-mode-selector.js';

afterEach(cleanup);

describe('course mode selector', () => {
  it('[EQ-PLAY-01] renders eight peer play shells in registry order and allows selection', () => {
    const onChange = vi.fn();
    render(<CourseModeSelector value="standard" onChange={onChange} />);

    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(
      COURSE_MODE_REGISTRY.map((mode) => mode.id),
    );
    expect(radios.slice(1)).toHaveLength(8);
    fireEvent.click(screen.getByRole('radio', { name: /案例研习/ }));
    expect(onChange).toHaveBeenCalledWith('case_study');
  });

  it('[EQ-PLAY-07] shows nine equal entry choices, defaults standard, and reveals upload only for reading', () => {
    const { rerender } = render(<CourseModeSelector value="standard" onChange={() => undefined} />);

    expect(screen.getAllByRole('radio')).toHaveLength(9);
    expect(screen.getByRole('radio', { name: /标准模式/ })).toBeChecked();
    expect(screen.queryByLabelText('学习材料')).not.toBeInTheDocument();
    rerender(<CourseModeSelector value="reading_seminar" onChange={() => undefined} />);
    expect(screen.getByLabelText('学习材料')).toHaveAttribute(
      'accept',
      '.pdf,.txt,.md,application/pdf,text/plain,text/markdown',
    );
  });
});
