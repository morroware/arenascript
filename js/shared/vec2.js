// ============================================================================
// Vec2 utility functions (pure, deterministic)
// ============================================================================
export function vec2(x, y) {
    return { x, y };
}
export function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}
export function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}
export function scale(v, s) {
    return { x: v.x * s, y: v.y * s };
}
export function length(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y);
}
export function distance(a, b) {
    return length(sub(a, b));
}
export function normalize(v) {
    const len = length(v);
    if (len === 0 || !isFinite(len))
        return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
}
export function clamp(v, minX, minY, maxX, maxY) {
    return {
        x: Math.max(minX, Math.min(maxX, v.x)),
        y: Math.max(minY, Math.min(maxY, v.y)),
    };
}
export function dot(a, b) {
    return a.x * b.x + a.y * b.y;
}
export function lerp(a, b, t) {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    };
}
export function equals(a, b, epsilon = 0.001) {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}
