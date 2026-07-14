import { OutlineWorkspaceView } from '../features/course-authoring/outline-workspace-view.js';
import { AppShellView } from '../layouts/app-shell.js';
import type { RuntimeUiState } from '../state/version-guard.js';
import { useCourseModeTheme } from '../use-course-mode-theme.js';
import { AUTHORING_FIXTURE_DATA, type AuthoringFixtureId } from './authoring-fixture-data.js';

const readyRuntime: RuntimeUiState = {
  kind: 'loaded',
  readiness: {
    status: 'ready',
    instanceId: 'visual-instance',
    buildId: 'development',
    protocolVersion: '1',
    storeStatus: 'ready',
    projectionStatus: 'ready',
    providerStatus: 'ready',
  },
  version: { kind: 'compatible', writesAllowed: true },
};

export function AuthoringFixture(props: { readonly fixtureId: AuthoringFixtureId }) {
  const data = AUTHORING_FIXTURE_DATA[props.fixtureId];
  useCourseModeTheme(data.mode);

  return (
    <AppShellView
      headerStatus={{ tone: 'success', text: '● 建档会话已保存' }}
      providerLabel="Codex"
      refresh={() => undefined}
      state={readyRuntime}
    >
      <OutlineWorkspaceView data={data} />
    </AppShellView>
  );
}
