const BACKWARD_DRIFT_TOLERANCE_MS = 2000;

export function reconcilePlaybackProgress(currentMs: number, reportedMs: number, sameItem: boolean): number {
  const current = Math.max(0, currentMs);
  const reported = Math.max(0, reportedMs);
  if (!sameItem) return reported;

  const backwardDifference = current - reported;
  if (backwardDifference > 0 && backwardDifference <= BACKWARD_DRIFT_TOLERANCE_MS) return current;
  return reported;
}
