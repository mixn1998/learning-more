import { projectDisciplineLabel, type DisciplineProjectionInput } from '@learning-more/contracts';

export function toBroadDisciplineLabel(
  value: string | undefined,
  context: Omit<DisciplineProjectionInput, 'disciplineTag'> = {},
): string | undefined {
  return projectDisciplineLabel({ ...context, disciplineTag: value });
}
