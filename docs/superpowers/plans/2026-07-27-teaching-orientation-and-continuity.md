# Teaching Orientation and Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the teaching agent reliable course/module/lesson positioning for warmup and require logically grounded transitions that never assume future terminology is already known.

**Architecture:** Extend the local teaching-context adapter with a pure knowledge-map projection built from the active outline candidate and stable lesson semantic keys. Render those facts and explicit learned/current/future distinctions into the prompt, while keeping output form free. Strengthen the high-level teaching and outline-generation responsibilities so `relationToNext` is used as a real inference edge rather than a sequence marker.

**Tech Stack:** TypeScript, Zod-backed course entities, Vitest, local-file repositories.

## Global Constraints

- Keep one warmup question and do not expand or advance the first knowledge point in the opening turn.
- Do not require fixed headings, paragraphs, wording, length, or transition format in generated teaching content.
- Treat the active outline as authoritative; map frozen lessons by stable semantic key rather than their historical outline version.
- Treat future lessons as directional context, never as learner-established vocabulary.
- Preserve teaching-ledger, continuation, comprehensive-application, discussion, and closure semantics.

---

### Task 1: Project active-outline knowledge-map facts

**Files:**
- Create: `apps/server/src/bootstrap/local-application/teaching-knowledge-map.ts`
- Create: `apps/server/src/bootstrap/teaching-knowledge-map.test.ts`
- Modify: `apps/server/src/bootstrap/local-application/course-runtime.ts`
- Modify: `apps/server/src/bootstrap/local-application/learning-teaching-context.ts`
- Modify: `apps/server/src/modules/interactive-teaching/ports/teaching-context-sources.ts`

**Interfaces:**
- Consumes: `CourseAggregate`, `LessonDefinition`, `ConfirmedOutlineVersion`, and `CandidateOutlineVersion`.
- Produces: `projectTeachingKnowledgeMap(...) => TeachingKnowledgeMapPosition | undefined` and an optional `course.knowledgeMap` context field.

- [ ] **Step 1: Write the failing semantic-key projection test**

```ts
expect(
  projectTeachingKnowledgeMap({
    course,
    currentLesson: frozenLessonFromOldOutline,
    activeLessons,
    outline,
    candidate,
  }),
).toMatchObject({
  discipline: '数学',
  courseLessonIndex: 1,
  currentModule: {
    title: '模块一：推理基础与向量语言',
    lessonIndex: 1,
    lessonCount: 5,
  },
  isFirstLessonInModule: true,
  isFirstLessonInCourse: true,
});
```

- [ ] **Step 2: Run the focused test and verify the helper is missing**

Run: `pnpm --filter @learning-more/server test -- teaching-knowledge-map.test.ts`

Expected: FAIL because `teaching-knowledge-map.ts` does not exist.

- [ ] **Step 3: Implement the pure projection**

```ts
export function projectTeachingKnowledgeMap(input: TeachingKnowledgeMapInput) {
  const candidateLesson =
    input.candidate.candidate.lessons.find(
      (lesson) => lesson.id === input.currentLesson.semanticKey,
    ) ?? uniqueTitleMatch(input.candidate.candidate.lessons, input.currentLesson.title);
  if (candidateLesson === undefined) return undefined;
  const module = input.candidate.candidate.modules.find((item) =>
    item.lessonIds.includes(candidateLesson.id),
  );
  if (module === undefined) return undefined;
  const actualBySemanticKey = new Map(
    input.activeLessons.map((lesson) => [lesson.semanticKey, lesson] as const),
  );
  const moduleLessons = module.lessonIds.flatMap((semanticKey) => {
    const lesson = actualBySemanticKey.get(semanticKey);
    return lesson === undefined
      ? []
      : [{ lessonId: lesson.id, title: lesson.title, objective: lesson.objective }];
  });
  const courseLessonIndex = input.course.lessonIds.indexOf(input.currentLesson.id);
  const moduleLessonIndex = moduleLessons.findIndex(
    (lesson) => lesson.lessonId === input.currentLesson.id,
  );
  if (courseLessonIndex < 0 || moduleLessonIndex < 0) return undefined;
  return {
    discipline: input.outline.disciplineTag,
    courseLessonIndex: courseLessonIndex + 1,
    courseLessonCount: input.course.lessonIds.length,
    currentModule: {
      id: module.id,
      title: module.title,
      lessonIndex: moduleLessonIndex + 1,
      lessonCount: moduleLessons.length,
      lessons: moduleLessons,
    },
    isFirstLessonInModule: moduleLessonIndex === 0,
    isFirstLessonInCourse: courseLessonIndex === 0,
  };
}
```

- [ ] **Step 4: Expose the active candidate and assemble the context**

```ts
getOutlineCandidate: AuthoringRepositories['candidateVersions']['get'];
```

`createLearningTeachingContext` reads the active outline and source candidate, projects the map, uses candidate `courseGoals` when available, and marks course-map entries as `current`, `prerequisite`, `earlier`, or `future`.

- [ ] **Step 5: Run the focused test and server typecheck**

Run: `pnpm --filter @learning-more/server test -- teaching-knowledge-map.test.ts`

Expected: PASS.

Run: `pnpm --filter @learning-more/server typecheck`

Expected: PASS.

### Task 2: Render free-form warmup positioning and grounded transitions

**Files:**
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-fact-context.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-flow-policy.ts`
- Modify: `apps/server/src/modules/interactive-teaching/implementation/teaching-guiding-policy.ts`
- Modify: `apps/server/src/modules/interactive-teaching/tests/generation-teaching-agent.test.ts`

**Interfaces:**
- Consumes: optional `course.knowledgeMap`, lesson-map relation labels, actual dialogue, and `relationToNext`.
- Produces: prompt facts and high-level responsibilities only; no learner-visible template.

- [ ] **Step 1: Write failing prompt tests**

```ts
expect(prompt).toContain('本课在当前模块和整门课程中的位置及学习意义');
expect(prompt).toContain('最后只提出一个');
expect(prompt).toContain('后续课（尚未学习，仅用于理解方向）');
expect(prompt).toContain('尚未学习的后续内容不能作为当前论证的未解释前提');
expect(prompt).toContain('当前结论如何产生新的问题');
```

Also assert that a legacy `relationToNext: '为下一步理解提供基础'` is not rendered as a meaningful relation.

- [ ] **Step 2: Run the focused tests and verify the new responsibilities are absent**

Run: `pnpm --filter @learning-more/server test -- generation-teaching-agent.test.ts`

Expected: FAIL on the new prompt assertions.

- [ ] **Step 3: Render knowledge-map facts and relation labels**

```ts
case 'future':
  return '后续课（尚未学习，仅用于理解方向）';
case 'earlier':
  return '先前课节（是否已建立以真实对话为准）';
```

Add a `【知识地图位置】` fact section when reliable data exists. Keep the section factual and do not prescribe the assistant’s visible structure.

- [ ] **Step 4: Update warmup and guiding responsibilities**

```ts
'在提出暖场问题前，结合可用的知识地图事实，自然帮助学习者理解本课在当前模块和整门课程中的位置及学习意义；若本课是模块或课程起点，可相应扩大到模块或学科层级。自由组织，不使用固定栏目或机械复述。',
'最后只提出一个能够连接本课目标与学习者已有经验的暖场问题，并等待学习者回应。',
```

Add one guiding-policy paragraph requiring the agent to establish the inferential need between adjacent nodes and to avoid using future concepts as unexplained premises.

- [ ] **Step 5: Run focused prompt and flow tests**

Run: `pnpm --filter @learning-more/server test -- generation-teaching-agent.test.ts interactive-teaching.test.ts context-assembler.test.ts`

Expected: PASS.

### Task 3: Prevent generic knowledge-chain edges in new outlines

**Files:**
- Modify: `apps/server/src/modules/course-authoring/implementation/candidate-output-contract.ts`
- Modify: `apps/server/src/modules/course-authoring/tests/candidate-output-contract.test.ts`

**Interfaces:**
- Consumes: the existing `relationToNext` free-text field.
- Produces: a generation instruction requiring concrete inferential meaning without a relation taxonomy.

- [ ] **Step 1: Write the failing contract test**

```ts
expect(prompt).toContain('state the concrete inferential need');
expect(prompt).toContain('Do not use generic placeholders such as');
expect(prompt).toContain('为下一步理解提供基础');
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @learning-more/server test -- candidate-output-contract.test.ts`

Expected: FAIL on the new assertions.

- [ ] **Step 3: Strengthen the content-freedom instruction**

Add an English instruction that `relationToNext` must express the concrete conclusion, unresolved need, or new explanatory power connecting adjacent nodes; it must not use generic placeholder wording. Keep relationship representation as unrestricted free text.

- [ ] **Step 4: Run authoring and contract tests**

Run: `pnpm --filter @learning-more/server test -- candidate-output-contract.test.ts course-authoring.test.ts`

Expected: PASS.

### Task 4: Integrated verification and activation

**Files:**
- Modify only files required by fixes discovered in the focused verification.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: one pushed commit and an activated runtime build.

- [ ] **Step 1: Run the change-aware server verification**

Run: `pnpm --filter @learning-more/server test -- generation-teaching-agent.test.ts context-assembler.test.ts interactive-teaching.test.ts candidate-output-contract.test.ts teaching-knowledge-map.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck and diff validation**

Run: `pnpm --filter @learning-more/server typecheck`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Commit and push**

```bash
git add apps/server/src packages/contracts/src docs/superpowers/plans
git commit -m "feat: ground teaching transitions in course context"
git push origin agent/teaching-framework-review-reliability
```

- [ ] **Step 4: Activate and inspect runtime readiness**

Use the project activation command, wait for a terminal `activated` phase, and verify that the active build reports the pushed commit.

- [ ] **Step 5: Verify the live prompt path**

Open a fresh lesson and confirm that the opening prompt receives knowledge-map position facts while retaining one warmup question, and that a future-terminology clarification receives the explicit grounded-transition responsibility.
