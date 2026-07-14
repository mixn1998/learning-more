// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { WeeklyReportResponse } from '@learning-more/contracts';

import { WeeklyReportView } from './weekly-report-view.js';

afterEach(cleanup);

describe('WeeklyReportView', () => {
  it('renders finalized AI prose through the shared Markdown boundary', () => {
    const report = {
      state: 'finalized',
      markdown:
        '## Weekly evidence\n\n**Observed:**\n\n- completed a lesson\n- revised a decision\n\n> The report is bounded by the frozen snapshot.',
    } as WeeklyReportResponse;

    render(<WeeklyReportView report={report} />);

    expect(screen.getByRole('heading', { name: 'Weekly evidence' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Observed:').tagName).toBe('STRONG');
    expect(document.querySelector('.weekly-report-panel blockquote')).toHaveTextContent(
      'The report is bounded by the frozen snapshot.',
    );
  });
});
