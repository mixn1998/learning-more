import { describe, expect, it } from 'vitest';

import { createReviewNotificationInbox } from '../implementation/review-notification.js';

describe('final Review completion notification', () => {
  it('[EQ-LESSON-13] completes without page ownership, shows active-page Markdown, and consumes an away notification once', () => {
    const inbox = createReviewNotificationInbox();
    const notification = {
      notificationId: 'notification_01',
      lessonId: 'lesson_01',
      reviewId: 'review_01',
      markdown: '# 权威 Review\n完整正文',
    };
    expect(inbox.publish(notification, true)).toEqual(notification);
    expect(inbox.publish(notification, false)).toBeUndefined();
    expect(inbox.consumeNext()).toEqual(notification);
    expect(inbox.consumeNext()).toBeUndefined();
    inbox.dismiss(notification.notificationId);
    expect(inbox.publish(notification, true)).toBeUndefined();
  });
});
