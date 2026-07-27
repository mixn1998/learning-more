import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const dataRoot = path.resolve(projectRoot, '.learning-more-data');
const runtimeRoot = path.resolve(projectRoot, '.learning-more-runtime');
const stateFile = path.join(runtimeRoot, 'course-knowledge-chain-naming-migration-v2.json');
const baseUrl = process.env.LEARNING_MORE_BASE_URL ?? 'http://127.0.0.1:43120';
const apply = process.argv.includes('--apply');
const verifyOnly = process.argv.includes('--verify');
const courseArgument = process.argv.find((argument) => argument.startsWith('--course='));
const selectedCourseId = courseArgument?.slice('--course='.length);
const maxAttempts = 3;
const pollIntervalMs = 2_000;
const generationTimeoutMs = 15 * 60_000;

if (apply && verifyOnly) throw new Error('course_knowledge_chain_mode_conflict');

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(target)));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(target);
  }
  return result;
}

async function readEntityFiles(entityType) {
  const records = [];
  for (const file of await filesUnder(path.join(dataRoot, 'entities', entityType))) {
    const wrapper = JSON.parse(await readFile(file, 'utf8'));
    records.push({ file, wrapper, data: wrapper.data });
  }
  return records;
}

async function readState() {
  return JSON.parse(
    await readFile(stateFile, 'utf8').catch(() =>
      JSON.stringify({
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        courses: {},
        inFlight: {},
      }),
    ),
  );
}

async function saveState(state) {
  await mkdir(runtimeRoot, { recursive: true });
  const temporary = `${stateFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, stateFile);
}

async function api(pathname, options = {}) {
  const unsafe = options.method !== undefined && options.method !== 'GET';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(unsafe
        ? {
            'x-csrf-token': 'development-csrf',
            'idempotency-key': options.idempotencyKey ?? randomUUID(),
            'x-page-instance-id': options.pageInstanceId ?? `migration_${randomUUID()}`,
          }
        : {}),
      ...(options.resourceVersion === undefined
        ? {}
        : { 'if-match': `"${options.resourceVersion}"` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = new Error(
      `course_knowledge_chain_http_${response.status}:${value?.code ?? 'unknown'}`,
    );
    error.status = response.status;
    error.problem = value;
    throw error;
  }
  return value;
}

function lessonProgress(progressByLessonId, lessonId) {
  return progressByLessonId.get(lessonId)?.learning?.progress ?? 'not_started';
}

function assertKnowledgeStructure(structure, lessonId) {
  if (
    structure === null ||
    !Array.isArray(structure?.mainChain) ||
    structure.mainChain.length === 0 ||
    !Array.isArray(structure.branches)
  ) {
    throw new Error(`knowledge_structure_missing:${lessonId}`);
  }
  const nodeIds = structure.mainChain.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new Error(`knowledge_structure_node_duplicate:${lessonId}`);
  }
  for (const [index, node] of structure.mainChain.entries()) {
    if (typeof node.content !== 'string' || node.content.trim() === '') {
      throw new Error(`knowledge_structure_node_empty:${lessonId}`);
    }
    const terminal = index === structure.mainChain.length - 1;
    if (
      !terminal &&
      (typeof node.relationToNext !== 'string' || node.relationToNext.trim() === '')
    ) {
      throw new Error(`knowledge_structure_relation_missing:${lessonId}`);
    }
    if (terminal && node.relationToNext !== undefined) {
      throw new Error(`knowledge_structure_terminal_relation:${lessonId}`);
    }
  }
  for (const branch of structure.branches) {
    if (!nodeIds.includes(branch.attachedTo)) {
      throw new Error(`knowledge_structure_branch_anchor:${lessonId}`);
    }
  }
}

function migrationInstruction(baseline) {
  return [
    '这是一次既有课程的新版知识链迁移。',
    '保持当前课程目标、学科与主题标签、模块数量与顺序、模块标题、课节数量与顺序，以及每一课的稳定语义键、标题、学习目标、前置关系、预计时长和来源引用不变。',
    '所有已经开始、放弃或完成的课节都是冻结锚点，完整保持其定义与知识结构。',
    '只为尚未开始的课节重新设计 knowledgeStructure：每课形成一条因果或推理关系清楚的 mainChain，必要的边界、反例和补充概念作为 branches 依附于相应主节点。',
    '每个 mainChain 节点的 content 都是面向学习者展示的教学知识点名称。名称应以最短的完整语义标明需要建立的核心认知，脱离知识链仍能看懂学习指向。',
    '知识点名称可自由表达概念、关系、判据、洞察、分歧或误区修正，但不能只是知识图谱标签、过渡步骤，也不能把解释、论证过程或案例写进名称。调性示例仅供参考而非固定模板：双侧极限的单侧判据、函数值与极限值的区别、无界不等于趋于无穷、基本定理连接变化与累积。',
    '节点之间的推理推进写入 relationToNext，不通过扩写知识点名称来表达；关系使用自然语义，不使用类型枚举。',
    '这是结构迁移，不扩写课程范围，不新增、删除、合并、拆分、改名或重排课节。',
    `当前需保持的课节顺序：${baseline.lessons.map((lesson) => lesson.id).join(' → ')}`,
  ].join('\n');
}

function assertCandidateIsMigrationOnly(baseline, candidate, frozenSemanticKeys) {
  const baselineLessonOrder = baseline.modules.flatMap((module) => module.lessonIds);
  const candidateLessonOrder = candidate.modules.flatMap((module) => module.lessonIds);
  if (JSON.stringify(candidateLessonOrder) !== JSON.stringify(baselineLessonOrder)) {
    throw new Error('candidate_migration_lesson_order_changed');
  }
  if (candidate.lessons.length !== baseline.lessons.length) {
    throw new Error('candidate_migration_lesson_count_changed');
  }
  const baselineByKey = new Map(baseline.lessons.map((lesson) => [lesson.id, lesson]));
  for (const lesson of candidate.lessons) {
    const previous = baselineByKey.get(lesson.id);
    if (previous === undefined) throw new Error(`candidate_migration_lesson_unknown:${lesson.id}`);
    assertKnowledgeStructure(lesson.knowledgeStructure, lesson.id);
  }
  for (const semanticKey of frozenSemanticKeys) {
    if (!candidate.lessons.some((lesson) => lesson.id === semanticKey)) {
      throw new Error(`candidate_migration_frozen_lesson_missing:${semanticKey}`);
    }
  }
}

function recoverPublishedMigration(course, archive, currentInventory, expectedCandidateVersionId) {
  const currentVersion = archive.outlineVersions?.find((version) => version.current);
  const previousVersion = archive.outlineVersions
    ?.filter((version) => !version.current)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .at(0);
  if (currentVersion === undefined || previousVersion === undefined) return undefined;
  if (currentVersion.sourceCandidateVersionId !== expectedCandidateVersionId) return undefined;
  const baseline = currentInventory.candidatesById.get(previousVersion.sourceCandidateVersionId);
  const candidate = currentInventory.candidatesById.get(currentVersion.sourceCandidateVersionId);
  if (baseline === undefined || candidate === undefined) return undefined;
  const previousLessons = [...currentInventory.lessonsById.values()]
    .filter(
      (lesson) =>
        lesson.courseId === course.id &&
        lesson.outlineVersionId === previousVersion.outlineVersionId,
    )
    .sort(
      (left, right) =>
        baseline.lessons.findIndex((lesson) => lesson.id === left.semanticKey) -
        baseline.lessons.findIndex((lesson) => lesson.id === right.semanticKey),
    );
  if (previousLessons.length !== archive.lessonIds.length) return undefined;
  const startedLessonIds = previousLessons
    .filter((lesson) => archive.lessonIds.includes(lesson.id))
    .map((lesson) => lesson.id);
  const unstartedLessonIds = previousLessons
    .filter((lesson) => !archive.lessonIds.includes(lesson.id))
    .map((lesson) => lesson.id);
  if (unstartedLessonIds.length === 0) return undefined;
  const frozenSemanticKeys = new Set(
    previousLessons
      .filter((lesson) => startedLessonIds.includes(lesson.id))
      .map((lesson) => lesson.semanticKey),
  );
  try {
    assertCandidateIsMigrationOnly(baseline, candidate, frozenSemanticKeys);
    for (const lesson of archive.lessons ?? []) {
      assertKnowledgeStructure(lesson.knowledgeStructure, lesson.lessonId);
    }
  } catch {
    return undefined;
  }
  return {
    courseId: course.id,
    sourceOutlineVersionId: previousVersion.outlineVersionId,
    targetOutlineVersionId: currentVersion.outlineVersionId,
    lessonCount: previousLessons.length,
    startedLessonIds,
    unstartedLessonIds,
    migratedAt: new Date().toISOString(),
    recoveredAfterResponseLoss: true,
  };
}

async function waitForCandidate(outlineSessionId, baselineCandidateId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < generationTimeoutMs) {
    const session = await api(`/api/v1/outline-sessions/${encodeURIComponent(outlineSessionId)}`);
    if (
      session.state === 'candidate-ready' &&
      session.candidateVersionId !== undefined &&
      session.candidateVersionId !== baselineCandidateId
    ) {
      return session;
    }
    if (session.state === 'candidate-ready') {
      throw new Error('candidate_generation_failed');
    }
    if (session.state !== 'generating-candidates' && session.state !== 'candidate-ready') {
      throw new Error(`candidate_generation_terminal_state:${session.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error('candidate_generation_poll_timeout');
}

async function inventory() {
  const [courseRecords, lessonRecords, progressRecords, candidateRecords] = await Promise.all([
    readEntityFiles('courses'),
    readEntityFiles('lesson-definitions'),
    readEntityFiles('lesson-progress'),
    readEntityFiles('outline-candidates'),
  ]);
  const lessonsById = new Map(lessonRecords.map((record) => [record.data.id, record.data]));
  const progressByLessonId = new Map(
    progressRecords.map((record) => [record.data.lessonId, record.data]),
  );
  const candidatesById = new Map(
    candidateRecords.map((record) => [record.data.id, record.data.candidate]),
  );
  const courses = courseRecords
    .map((record) => record.data)
    .filter(
      (course) =>
        course.status === 'active' &&
        (selectedCourseId === undefined || course.id === selectedCourseId),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return { courses, lessonsById, progressByLessonId, candidatesById };
}

function baselineFor(course, lessonsById, progressByLessonId, candidatesById, archive) {
  const lessons = course.lessonIds.map((lessonId) => {
    const lesson = lessonsById.get(lessonId);
    if (lesson === undefined) throw new Error(`lesson_definition_missing:${lessonId}`);
    return lesson;
  });
  const startedLessonIds = lessons
    .filter((lesson) => lessonProgress(progressByLessonId, lesson.id) !== 'not_started')
    .map((lesson) => lesson.id);
  const unstartedLessonIds = lessons
    .filter((lesson) => lessonProgress(progressByLessonId, lesson.id) === 'not_started')
    .map((lesson) => lesson.id);
  const sourceCandidateVersionId = archive.outlineVersions?.find(
    (version) => version.current,
  )?.sourceCandidateVersionId;
  const baselineOutline =
    sourceCandidateVersionId === undefined
      ? undefined
      : candidatesById.get(sourceCandidateVersionId);
  if (baselineOutline === undefined) {
    throw new Error(`baseline_candidate_missing:${course.id}`);
  }
  const frozenSemanticKeys = new Set(
    lessons
      .filter((lesson) => startedLessonIds.includes(lesson.id))
      .map((lesson) => lesson.semanticKey),
  );
  return {
    sourceOutlineVersionId: course.outlineVersionId,
    lessons,
    startedLessonIds,
    unstartedLessonIds,
    baselineOutline,
    frozenSemanticKeys,
  };
}

async function verifyCourse(entry) {
  const [archive, currentInventory] = await Promise.all([
    api(`/api/v1/courses/${encodeURIComponent(entry.courseId)}`),
    inventory(),
  ]);
  const course = currentInventory.courses.find((candidate) => candidate.id === entry.courseId);
  if (course === undefined) throw new Error(`course_not_active:${entry.courseId}`);
  if (archive.outlineVersionId !== entry.targetOutlineVersionId) {
    throw new Error(`course_outline_version_mismatch:${entry.courseId}`);
  }
  if (archive.lessonIds.length !== entry.lessonCount) {
    throw new Error(`course_lesson_count_changed:${entry.courseId}`);
  }
  for (const lessonId of entry.startedLessonIds) {
    if (!archive.lessonIds.includes(lessonId)) {
      throw new Error(`frozen_lesson_replaced:${lessonId}`);
    }
    const progress = lessonProgress(currentInventory.progressByLessonId, lessonId);
    if (progress === 'not_started') throw new Error(`frozen_lesson_progress_lost:${lessonId}`);
  }
  for (const lessonId of entry.unstartedLessonIds) {
    if (archive.lessonIds.includes(lessonId)) {
      throw new Error(`unstarted_lesson_not_reprojected:${lessonId}`);
    }
  }
  for (const lesson of archive.lessons ?? []) {
    assertKnowledgeStructure(lesson.knowledgeStructure, lesson.lessonId);
    if (
      !entry.startedLessonIds.includes(lesson.lessonId) &&
      lesson.outlineVersionId !== archive.outlineVersionId
    ) {
      throw new Error(`reprojected_lesson_version_mismatch:${lesson.lessonId}`);
    }
  }
  return archive;
}

async function migrateCourse(course, localInventory, state) {
  const pageInstanceId = `knowledge_chain_migration_${randomUUID()}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentInventory = attempt === 1 ? localInventory : await inventory();
    const currentCourse =
      currentInventory.courses.find((candidate) => candidate.id === course.id) ?? course;
    const archive = await api(`/api/v1/courses/${encodeURIComponent(course.id)}`);
    const baseline = baselineFor(
      currentCourse,
      currentInventory.lessonsById,
      currentInventory.progressByLessonId,
      currentInventory.candidatesById,
      archive,
    );
    if (baseline.unstartedLessonIds.length === 0) {
      return { status: 'skipped', reason: 'no_unstarted_lessons' };
    }
    const adjustment = await api(
      `/api/v1/courses/${encodeURIComponent(course.id)}/outline-adjustment-sessions`,
      {
        method: 'POST',
        body: {},
        resourceVersion: archive.resourceVersion,
        pageInstanceId,
      },
    );
    let candidateSession;
    let candidate;
    const sourceCandidateVersionId = archive.outlineVersions?.find(
      (version) => version.current,
    )?.sourceCandidateVersionId;
    if (adjustment.state === 'generating-candidates') {
      try {
        candidateSession = await waitForCandidate(
          adjustment.outlineSessionId,
          adjustment.candidateVersionId,
        );
        const candidateInventory = await inventory();
        candidate = candidateInventory.candidatesById.get(candidateSession.candidateVersionId);
        if (candidate === undefined) throw new Error('candidate_entity_missing');
        assertCandidateIsMigrationOnly(
          baseline.baselineOutline,
          candidate,
          baseline.frozenSemanticKeys,
        );
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        continue;
      }
    }
    if (
      candidateSession === undefined &&
      adjustment.candidateVersionId !== undefined &&
      adjustment.candidateVersionId !== sourceCandidateVersionId
    ) {
      const candidateInventory = await inventory();
      const reusableCandidate = candidateInventory.candidatesById.get(
        adjustment.candidateVersionId,
      );
      if (reusableCandidate !== undefined) {
        try {
          assertCandidateIsMigrationOnly(
            baseline.baselineOutline,
            reusableCandidate,
            baseline.frozenSemanticKeys,
          );
          candidateSession = adjustment;
          candidate = reusableCandidate;
        } catch {
          // A prior candidate from this session may target a different adjustment.
        }
      }
    }
    if (candidateSession === undefined || candidate === undefined) {
      const appended = await api(
        `/api/v1/outline-sessions/${encodeURIComponent(adjustment.outlineSessionId)}/messages`,
        {
          method: 'POST',
          body: { content: migrationInstruction(baseline.baselineOutline) },
          resourceVersion: adjustment.resourceVersion,
          pageInstanceId,
        },
      );
      const baselineCandidateId = adjustment.candidateVersionId;
      const accepted = await api(
        `/api/v1/outline-sessions/${encodeURIComponent(adjustment.outlineSessionId)}/candidate-generations`,
        {
          method: 'POST',
          body: {},
          resourceVersion: appended.resourceVersion,
          pageInstanceId,
        },
      );
      if (accepted.failureCode !== undefined) {
        if (attempt === maxAttempts) {
          throw new Error(`candidate_generation_failed:${accepted.failureCode}`);
        }
        continue;
      }
      try {
        candidateSession = await waitForCandidate(adjustment.outlineSessionId, baselineCandidateId);
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        continue;
      }
      const candidateInventory = await inventory();
      candidate = candidateInventory.candidatesById.get(candidateSession.candidateVersionId);
      if (candidate === undefined) {
        if (attempt === maxAttempts) {
          throw new Error(`candidate_entity_missing:${candidateSession.candidateVersionId}`);
        }
        continue;
      }
      try {
        assertCandidateIsMigrationOnly(
          baseline.baselineOutline,
          candidate,
          baseline.frozenSemanticKeys,
        );
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        continue;
      }
    }
    try {
      const latestCourse = await api(`/api/v1/courses/${encodeURIComponent(course.id)}`);
      state.inFlight ??= {};
      state.inFlight[course.id] = {
        courseId: course.id,
        sourceOutlineVersionId: baseline.sourceOutlineVersionId,
        sourceCandidateVersionId: candidateSession.candidateVersionId,
        lessonCount: baseline.lessons.length,
        startedLessonIds: baseline.startedLessonIds,
        unstartedLessonIds: baseline.unstartedLessonIds,
        publishingAt: new Date().toISOString(),
      };
      state.updatedAt = new Date().toISOString();
      await saveState(state);
      const revised = await api(
        `/api/v1/courses/${encodeURIComponent(course.id)}/outline-revisions`,
        {
          method: 'POST',
          body: { sourceCandidateVersionId: candidateSession.candidateVersionId },
          resourceVersion: latestCourse.resourceVersion,
          pageInstanceId,
        },
      );
      const entry = {
        courseId: course.id,
        sourceOutlineVersionId: baseline.sourceOutlineVersionId,
        targetOutlineVersionId: revised.outlineVersionId,
        lessonCount: baseline.lessons.length,
        startedLessonIds: baseline.startedLessonIds,
        unstartedLessonIds: baseline.unstartedLessonIds,
        migratedAt: new Date().toISOString(),
      };
      state.courses[course.id] = entry;
      delete state.inFlight[course.id];
      state.updatedAt = new Date().toISOString();
      await saveState(state);
      await verifyCourse(entry);
      return {
        status: 'migrated',
        outlineVersionId: revised.outlineVersionId,
        migratedLessons: baseline.unstartedLessonIds.length,
        frozenLessons: baseline.startedLessonIds.length,
      };
    } catch (error) {
      if (
        (error.problem?.code !== 'source_snapshot_changed' &&
          error.problem?.code !== 'version_conflict') ||
        attempt === maxAttempts
      ) {
        throw error;
      }
    }
  }
  throw new Error(`course_migration_attempts_exhausted:${course.id}`);
}

async function main() {
  await api('/api/v1/runtime/ready');
  const localInventory = await inventory();
  const state = await readState();
  const summary = [];
  for (const course of localInventory.courses) {
    const existing = state.courses[course.id];
    let archiveAfterVerificationFailure;
    if (existing !== undefined) {
      try {
        await verifyCourse(existing);
        summary.push({ courseId: course.id, status: 'verified_existing' });
        continue;
      } catch {
        if (!apply) {
          summary.push({ courseId: course.id, status: 'verification_failed' });
          continue;
        }
        archiveAfterVerificationFailure = await api(
          `/api/v1/courses/${encodeURIComponent(course.id)}`,
        );
        const retargeted = {
          ...existing,
          targetOutlineVersionId: archiveAfterVerificationFailure.outlineVersionId,
          migratedAt: new Date().toISOString(),
          recoveredAfterForwardRepair: true,
        };
        try {
          await verifyCourse(retargeted);
          state.courses[course.id] = retargeted;
          state.updatedAt = new Date().toISOString();
          await saveState(state);
          summary.push({ courseId: course.id, status: 'repaired_and_verified' });
          continue;
        } catch {
          // The current outline is not a valid forward repair; resume normal migration recovery.
        }
      }
    }
    const archive =
      archiveAfterVerificationFailure ??
      (await api(`/api/v1/courses/${encodeURIComponent(course.id)}`));
    const pendingPublication = state.inFlight?.[course.id];
    const recovered =
      pendingPublication === undefined
        ? undefined
        : recoverPublishedMigration(
            course,
            archive,
            localInventory,
            pendingPublication.sourceCandidateVersionId,
          );
    if (recovered !== undefined) {
      state.courses[course.id] = recovered;
      if (state.inFlight !== undefined) delete state.inFlight[course.id];
      state.updatedAt = new Date().toISOString();
      await saveState(state);
      await verifyCourse(recovered);
      summary.push({ courseId: course.id, status: 'recovered_and_verified' });
      continue;
    }
    if (verifyOnly) {
      summary.push({ courseId: course.id, status: 'not_migrated' });
      continue;
    }
    if (!apply) {
      const baseline = baselineFor(
        course,
        localInventory.lessonsById,
        localInventory.progressByLessonId,
        localInventory.candidatesById,
        archive,
      );
      summary.push({
        courseId: course.id,
        status: 'pending',
        lessons: baseline.lessons.length,
        frozenLessons: baseline.startedLessonIds.length,
        unstartedLessons: baseline.unstartedLessonIds.length,
      });
      continue;
    }
    const result = await migrateCourse(course, localInventory, state);
    summary.push({ courseId: course.id, ...result });
    process.stdout.write(`${JSON.stringify(summary.at(-1))}\n`);
  }
  process.stdout.write(
    `${JSON.stringify({ mode: apply ? 'apply' : verifyOnly ? 'verify' : 'dry-run', summary }, null, 2)}\n`,
  );
  if (verifyOnly && summary.some((item) => item.status !== 'verified_existing')) {
    process.exitCode = 1;
  }
}

await main();
