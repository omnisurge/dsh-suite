import { useId, type CSSProperties } from "react";

export interface ProgressProps { label: string; value?: number; max?: number }

export function Progress({ label, value, max = 100 }: ProgressProps) {
  const id = useId();
  const bound = Number.isFinite(max) && max > 0 ? max : 100;
  const current = value === undefined || !Number.isFinite(value) ? undefined : Math.min(bound, Math.max(0, value));
  return <div className="omni-ui-progress"><label htmlFor={id} className="omni-ui-label">{label}</label>
    <progress id={id} max={bound} value={current} /></div>;
}

export interface SkeletonProps { lines?: number; }
/** Decorative placeholder. The owning region supplies aria-busy and its accessible name. */
export function Skeleton({ lines = 3 }: SkeletonProps) {
  const count = Number.isFinite(lines) ? Math.max(1, Math.min(10, Math.floor(lines))) : 3;
  return <div className="omni-ui-skeleton" aria-hidden="true">{Array.from({ length: count }, (_, i) =>
    <span key={i} style={{ width: i === count - 1 && count > 1 ? "65%" : "100%" } as CSSProperties} />)}</div>;
}
