const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_OVERSCAN = 8;
export function computeTimelineWindow(totalCount, scrollTop, viewportHeight, rowHeight = DEFAULT_ROW_HEIGHT, overscan = DEFAULT_OVERSCAN) {
    if (!Number.isInteger(totalCount) || totalCount < 0 || !Number.isFinite(scrollTop) ||
        !Number.isFinite(viewportHeight) || !Number.isFinite(rowHeight) || rowHeight <= 0 ||
        !Number.isInteger(overscan) || overscan < 0) throw new TypeError('回放时间线窗口参数无效');
    if (totalCount === 0) return { start: 0, end: 0, top: 0, bottom: 0 };
    const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight));
    const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight));
    const start = Math.max(0, firstVisible - overscan);
    const end = Math.min(totalCount, firstVisible + visibleCount + overscan);
    return { start, end, top: start * rowHeight, bottom: Math.max(0, (totalCount - end) * rowHeight) };
}
