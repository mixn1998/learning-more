import { useNavigate, useSearchParams } from 'react-router-dom';

import { AuthoringPage } from '../features/course-authoring/authoring-page.js';

export function CourseAuthoringRoute() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const outlineSessionId = search.get('outlineSessionId') ?? undefined;
  return (
    <AuthoringPage
      {...(outlineSessionId === undefined ? {} : { initialOutlineSessionId: outlineSessionId })}
      onSessionChanged={(sessionId) => {
        setSearch({ outlineSessionId: sessionId }, { replace: true });
      }}
      onNavigate={(path) => navigate(path)}
    />
  );
}
