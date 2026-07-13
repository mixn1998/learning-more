export type LessonRecord = Readonly<{
  lessonId: string;
  original: Readonly<{
    sessionId: string;
    label: string;
    messages: readonly string[];
  }>;
  supplementary: readonly Readonly<{
    sessionId: string;
    label: string;
    messages: readonly string[];
  }>[];
  finalReviewMarkdown: string;
}>;

export interface LessonRecordClient {
  getLessonRecord(lessonId: string): Promise<LessonRecord>;
}

export const lessonRecordClient: LessonRecordClient = {
  async getLessonRecord(lessonId) {
    const response = await fetch(`/api/v1/lessons/${encodeURIComponent(lessonId)}/record`);
    const body = (await response.json()) as LessonRecord;
    if (!response.ok) throw body;
    return body;
  },
};
