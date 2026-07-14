import type { CourseArchiveView } from '@learning-more/contracts';

export function OutlineVersionHistory(props: {
  readonly versions: NonNullable<CourseArchiveView['outlineVersions']>;
  readonly onSelect: (outlineVersionId: string) => void;
}) {
  return (
    <div className="outline-version-history" role="list">
      {[...props.versions].reverse().map((version, reverseIndex) => (
        <button
          key={version.outlineVersionId}
          className="outline-version-item"
          role="listitem"
          type="button"
          onClick={() => props.onSelect(version.outlineVersionId)}
        >
          <span>
            <b>{`v${props.versions.length - reverseIndex} · ${version.current ? '当前确认版' : '历史版本'}`}</b>
            <small>{new Date(version.createdAt).toLocaleString('zh-CN')}</small>
          </span>
          <em>{version.current ? '当前' : '只读'}</em>
        </button>
      ))}
    </div>
  );
}
