export type ReviewCompletionNotification = Readonly<{
  notificationId: string;
  lessonId: string;
  reviewId: string;
  markdown: string;
}>;

export function createReviewNotificationInbox() {
  const pending = new Map<string, ReviewCompletionNotification>();
  const consumed = new Set<string>();
  return {
    publish(notification: ReviewCompletionNotification, pageActive: boolean) {
      if (consumed.has(notification.notificationId)) return undefined;
      if (pageActive) return notification;
      pending.set(notification.notificationId, Object.freeze({ ...notification }));
      return undefined;
    },
    consumeNext(): ReviewCompletionNotification | undefined {
      const next = [...pending.values()].sort((a, b) =>
        a.notificationId.localeCompare(b.notificationId),
      )[0];
      if (next === undefined) return undefined;
      pending.delete(next.notificationId);
      consumed.add(next.notificationId);
      return next;
    },
    dismiss(notificationId: string) {
      pending.delete(notificationId);
      consumed.add(notificationId);
    },
  };
}
