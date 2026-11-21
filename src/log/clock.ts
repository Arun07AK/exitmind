export function stopwatch(): () => number {
  const t0 = performance.now();
  return () => Math.round(performance.now() - t0);
}
