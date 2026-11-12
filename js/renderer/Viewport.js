export function calculateCanvasFit(containerWidth, containerHeight, logicalWidth = 1800, logicalHeight = 1200) {
    for (const [name, value] of Object.entries({ containerWidth, containerHeight, logicalWidth, logicalHeight })) {
        if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative finite number`);
    }
    if (logicalWidth === 0 || logicalHeight === 0) throw new RangeError('Logical canvas dimensions must be positive');
    if (containerWidth === 0 || containerHeight === 0) return { width: 0, height: 0, scale: 0 };
    const scale = Math.min(containerWidth / logicalWidth, containerHeight / logicalHeight);
    return { width: Math.floor(logicalWidth * scale), height: Math.floor(logicalHeight * scale), scale };
}

export function clampPanOffset(offset, mapSize, viewportSize) {
    if (![offset, mapSize, viewportSize].every(Number.isFinite) || mapSize < 0 || viewportSize < 0) {
        throw new TypeError('Pan dimensions and offset must be finite');
    }
    const overflow = Math.max(0, (mapSize - viewportSize) / 2);
    if (overflow === 0) return 0;
    const visibleMargin = Math.min(72, mapSize * 0.12, viewportSize * 0.2);
    const limit = overflow + visibleMargin;
    return Math.max(-limit, Math.min(limit, offset));
}

export function calculateZoomOffset(offset, anchor, currentZoom, nextZoom) {
    if (![offset, anchor, currentZoom, nextZoom].every(Number.isFinite) || currentZoom <= 0 || nextZoom <= 0) {
        throw new TypeError('Zoom transform values must be finite and zoom values positive');
    }
    return anchor - (anchor - offset) * (nextZoom / currentZoom);
}
