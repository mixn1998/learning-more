import type { TeachingContextPackage } from '../ports/teaching-context-sources.js';
import { normalizeTeachingControlState } from './teaching-directive.js';

export type TeachingCapability = 'math-plot';

const EXPLICIT_VISUAL_REQUEST =
  /(?:画(?:一|个|张|下)?图|图示|作图|绘图|可视化|坐标图|函数图|曲线图|用图|看图)/u;
const MATHEMATICAL_VISUAL_TOPIC =
  /(?:函数|图像|曲线|坐标(?:系|轴|表示)?|向量|几何|微积分|导数|积分|极限|切线|极值|标量场|向量场|相图|相轨迹|曲面|微分方程)/u;
const MATHEMATICAL_COURSE =
  /(?:数学|代数|微积分|几何|概率|统计|数理|方程|拓扑|解析|离散数学)/u;

function currentUserRequest(context: TeachingContextPackage): string {
  return (
    context.recentMessages.findLast(
      (message) => message.role === 'user' && message.completionStatus === 'complete',
    )?.markdown ?? ''
  ).trim();
}

function hasPriorMathPlot(context: TeachingContextPackage): boolean {
  return context.recentMessages.some((message) => /```math-plot\b/u.test(message.markdown));
}

export function capabilitiesForTeachingTurn(
  context: TeachingContextPackage,
): ReadonlySet<TeachingCapability> {
  if (hasPriorMathPlot(context)) return new Set<TeachingCapability>(['math-plot']);

  const state = normalizeTeachingControlState(context.teachingState);
  const activePoint = context.lesson.coreKnowledgePoints.find(
    (point) => point.ref === state.activeKnowledgePointRef,
  );
  const request = currentUserRequest(context);
  const routingText = [request, activePoint?.text ?? '', context.lesson.objective].join('\n');
  const courseText = [context.course.title, ...context.course.goals].join('\n');
  if (
    EXPLICIT_VISUAL_REQUEST.test(request) ||
    MATHEMATICAL_VISUAL_TOPIC.test(routingText) ||
    MATHEMATICAL_COURSE.test(courseText)
  ) {
    return new Set<TeachingCapability>(['math-plot']);
  }
  return new Set<TeachingCapability>();
}
