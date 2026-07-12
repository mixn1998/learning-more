import { useEffect, useState } from 'react';

import {
  planningClient,
  type PlanningClient,
  type ScheduleItemView,
} from '../../client/planning-client.js';
import { PlanFlowPanel } from './plan-flow-panel.js';
import { ScheduleBoard } from './schedule-board.js';

export function PlanningPage(props: { readonly client?: PlanningClient }) {
  const api = props.client ?? planningClient;
  const [items, setItems] = useState<readonly ScheduleItemView[]>([]);
  const [version, setVersion] = useState(0);
  const reload = async () => {
    const schedule = await api.getSchedule();
    setItems(schedule.items);
    setVersion(schedule.resourceVersion);
  };
  useEffect(() => {
    void reload();
  }, [api]);
  return (
    <main className="authoring-workspace">
      <h1>课程规划</h1>
      <ScheduleBoard
        items={items}
        onCreate={async (input) => {
          await api.createSchedule(input);
          await reload();
        }}
      />
      <PlanFlowPanel
        onPreview={(courseRefs, lessonRefs) =>
          api.requestPreview({
            constraintsArtifactRef: 'constraints_manual',
            courseRefs,
            lessonRefs,
            timeWindowRefs: ['weekday_evenings'],
            existingScheduleSnapshotRef: `schedule_${version}`,
          })
        }
        onConfirm={async (flow) => {
          await api.confirmPlanFlow(flow.id, flow.resourceVersion);
          await reload();
        }}
      />
    </main>
  );
}
