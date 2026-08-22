/** 将模型旋转角规范化为 [0, 360) 的度数。 */
export function normalizeRotationDegrees(rotation: number): number {
  if (!Number.isFinite(rotation)) throw new Error("rotation-not-finite");
  const normalized = ((rotation % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}
