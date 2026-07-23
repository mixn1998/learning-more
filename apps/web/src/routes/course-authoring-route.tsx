import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { AuthoringPage } from '../features/course-authoring/authoring-page.js';
import { readAuthoringStartIntent } from '../state/authoring-start-intent.js';

export function CourseAuthoringRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const outlineSessionId = search.get('outlineSessionId') ?? undefined;
  const initialStartIntent = readAuthoringStartIntent(location.state);
  return (
    <AuthoringPage
      {...(outlineSessionId === undefined ? {} : { initialOutlineSessionId: outlineSessionId })}
      {...(initialStartIntent === undefined ? {} : { initialStartIntent })}
      onSessionChanged={(sessionId) => {
        navigate(`/courses/new?outlineSessionId=${encodeURIComponent(sessionId)}`, {
          replace: true,
          state: null,
        });
      }}
      onNavigate={(path) => navigate(path)}
    />
  );
}
