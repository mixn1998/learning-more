import { useEffect, useState } from 'react';

import {
  profileClient,
  type PortraitEvidenceView,
  type PortraitVersionView,
  type ProfileClient,
} from '../../client/profile-client.js';
import { GlobalProfilePanel } from './global-profile-panel.js';
import { PortraitView } from './portrait-view.js';

export function ProfilePage(props: { readonly client?: ProfileClient }) {
  const api = props.client ?? profileClient;
  const [profile, setProfile] = useState<Record<string, unknown>>();
  const [evidence, setEvidence] = useState<readonly PortraitEvidenceView[]>([]);
  const [portrait, setPortrait] = useState<PortraitVersionView>();
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    void Promise.all([api.getProfile(), api.getEvidence(), api.getPortrait()]).then(
      ([profileView, evidenceView, portraitView]) => {
        setProfile(profileView);
        setEvidence(evidenceView);
        setPortrait(portraitView);
      },
    );
  }, [api]);
  if (profile === undefined)
    return (
      <main>
        <p>正在加载学习画像</p>
      </main>
    );
  return (
    <main className="authoring-workspace">
      <h1>学习画像</h1>
      <GlobalProfilePanel profile={profile} />
      <button
        type="button"
        disabled={refreshing}
        onClick={() => {
          setRefreshing(true);
          void api.refresh().then((version) => {
            setPortrait(version);
            setRefreshing(false);
          });
        }}
      >
        {refreshing ? '正在刷新画像' : '刷新学习画像'}
      </button>
      <PortraitView {...(portrait === undefined ? {} : { portrait })} evidence={evidence} />
    </main>
  );
}
