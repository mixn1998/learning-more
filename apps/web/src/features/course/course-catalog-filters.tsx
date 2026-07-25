import type { CourseMode } from '@learning-more/contracts';

import { COURSE_MODE_REGISTRY } from '../../course-mode-registry.js';
import { toBroadDisciplineLabel } from '../../discipline-label.js';

import './course-catalog-filters.css';

export type FilterableCourse = Readonly<{
  courseMode?: CourseMode | undefined;
  disciplineTag?: string | undefined;
  title?: string | undefined;
  topicTags?: readonly string[] | undefined;
}>;

export type CourseCatalogFilter = Readonly<{
  discipline: string;
  courseMode: CourseMode | '';
}>;

export function courseCatalogFilterOptions(courses: readonly FilterableCourse[]) {
  const disciplines = [
    ...new Set(
      courses.flatMap(
        (course) =>
          toBroadDisciplineLabel(course.disciplineTag, {
            title: course.title,
            topicTags: course.topicTags,
          }) ?? [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const availableModes = new Set(courses.flatMap((course) => course.courseMode ?? []));
  return {
    disciplines,
    modes: COURSE_MODE_REGISTRY.filter((definition) => availableModes.has(definition.id)),
  } as const;
}

export function filterCourseCatalog<T extends FilterableCourse>(
  courses: readonly T[],
  filter: CourseCatalogFilter,
): readonly T[] {
  return courses.filter((course) => {
    const discipline = toBroadDisciplineLabel(course.disciplineTag, {
      title: course.title,
      topicTags: course.topicTags,
    });
    return (
      (filter.discipline === '' || discipline === filter.discipline) &&
      (filter.courseMode === '' || course.courseMode === filter.courseMode)
    );
  });
}

export function CourseCatalogFilters(props: {
  readonly courses: readonly FilterableCourse[];
  readonly discipline: string;
  readonly courseMode: CourseMode | '';
  readonly onDisciplineChange: (value: string) => void;
  readonly onCourseModeChange: (value: CourseMode | '') => void;
}) {
  const options = courseCatalogFilterOptions(props.courses);
  return (
    <div aria-label="课程筛选" className="course-catalog-filters" role="group">
      <label>
        <span>学科/领域</span>
        <select
          aria-label="学科/领域"
          className="lm-control"
          value={props.discipline}
          onChange={(event) => props.onDisciplineChange(event.target.value)}
        >
          <option value="">全部学科/领域</option>
          {options.disciplines.map((discipline) => (
            <option key={discipline} value={discipline}>
              {discipline}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>来源模式</span>
        <select
          aria-label="来源模式"
          className="lm-control"
          value={props.courseMode}
          onChange={(event) => props.onCourseModeChange(event.target.value as CourseMode | '')}
        >
          <option value="">全部来源模式</option>
          {options.modes.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
