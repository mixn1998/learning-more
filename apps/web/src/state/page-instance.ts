export function getPageInstanceId(
  storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage,
  nextId: () => string = () => crypto.randomUUID(),
): string {
  const key = 'learning-more.page-instance-id';
  const existing = storage.getItem(key);
  if (existing !== null && existing !== '') return existing;
  const created = nextId();
  storage.setItem(key, created);
  return created;
}
