export function calculateCanvasFit(containerWidth, containerHeight, logicalWidth = 1800, logicalHeight = 1200) {
    for (const [name, value] of Object.entries({ containerWidth, containerHeight, logicalWidth, logicalHeight })) {
        if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative finite number`);
    }
    if (logicalWidth === 0 || logicalHeight === 0) throw new RangeError('Logical canvas dimensions must be positive');
    if (containerWidth === 0 || containerHeight === 0) return { width: 0, height: 0, scale: 0 };
    const scale = Math.min(containerWidth / logicalWidth, containerHeight / logicalHeight);
    return { width: Math.floor(logicalWidth * scale), height: Math.floor(logicalHeight * scale), scale };
}
