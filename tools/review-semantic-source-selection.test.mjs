import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderComprehensiveApplicationSegment,
  selectClassroomSummaryAssistant,
  selectComprehensiveApplicationAssistantReplies,
} from './review-semantic-source-selection.mjs';

test('keeps the first delivered classroom summary when a later reply repeats ready-to-close', () => {
  const firstSummary = {
    message: { id: 'message_summary_1' },
    task: {
      raw: '{"lessonPhase":"ready_to_close","summaryStatus":"delivered"}',
      reply: 'the original classroom summary',
    },
  };
  const repeatedSummary = {
    message: { id: 'message_summary_2' },
    task: {
      raw: '{"lessonPhase":"ready_to_close","summaryStatus":"delivered"}',
      reply: 'a later rewritten summary',
    },
  };

  assert.equal(selectClassroomSummaryAssistant([firstSummary, repeatedSummary]), firstSummary);
});

test('keeps the complete comprehensive application segment instead of only its terminal reply', () => {
  const candidates = [
    {
      task: {
        raw: '{"lessonPhase":"knowledge_point","comprehensiveApplication":"pending"}',
        reply: 'knowledge point',
      },
    },
    {
      task: {
        raw: '{"lessonPhase":"comprehensive_application","comprehensiveApplication":"learning"}',
        reply: 'specific transferable relationship',
      },
    },
    {
      task: {
        raw: '{"lessonPhase":"discussion","comprehensiveApplication":"completed"}',
        reply: 'generic transition',
      },
    },
  ];

  const replies = selectComprehensiveApplicationAssistantReplies(candidates);

  assert.deepEqual(replies, ['specific transferable relationship', 'generic transition']);
  assert.match(
    renderComprehensiveApplicationSegment(replies),
    /specific transferable relationship/u,
  );
});

test('keeps a skipped comprehensive application terminal reply when no start was recorded', () => {
  const replies = selectComprehensiveApplicationAssistantReplies([
    {
      task: {
        raw: '{"lessonPhase":"discussion","comprehensiveApplication":"skipped"}',
        reply: 'AI relationship synthesis without a learner answer',
      },
    },
  ]);

  assert.deepEqual(replies, ['AI relationship synthesis without a learner answer']);
});
