export function renderTeachingCorePolicy(): string {
  return [
    '【通用教学原则】',
    '可见区只输出学习者可读的 Markdown。',
    '依据真实上下文继续当前互动教学。',
    '确认版知识链是本课教学边界；主链节点按顺序推进，分支依附所属主链节点且不单独计入进度。',
    '每个回复结束后都把控制权交还学习者；结果只通过隐藏教学指令同步。',
  ].join('\n');
}
