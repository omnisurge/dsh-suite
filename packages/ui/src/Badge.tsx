import type { ReactNode } from "react";

export type BadgeTone = "ok" | "warn" | "err" | "muted";

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly dot?: boolean;
  readonly loading?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
  /** Test hook, forwarded like every other control in this library. */
  readonly "data-testid"?: string;
}

function toneClass(tone: BadgeTone | undefined): string {
  if (tone === "ok") return "omni-ui-badge omni-ui-badgeOk";
  if (tone === "warn") return "omni-ui-badge omni-ui-badgeWarn";
  if (tone === "err") return "omni-ui-badge omni-ui-badgeErr";
  return "omni-ui-badge omni-ui-badgeMuted";
}

/** Compact status pill for settings card headers. */
export function Badge(props: BadgeProps) {
  const showDot = props.dot ?? (props.tone === "ok" || props.tone === "warn" || props.tone === "err");
  const loading = props.loading === true;
  const extra = props.className !== undefined && props.className !== "" ? ` ${props.className}` : "";
  return (
    <span
      className={toneClass(props.tone) + extra}
      aria-busy={loading ? "true" : undefined}
      data-testid={props["data-testid"]}
    >
      {loading ? (
        <span className="omni-ui-badgeSpin" aria-hidden="true" />
      ) : showDot ? (
        <span className="omni-ui-badgeDot" aria-hidden="true" />
      ) : null}
      <span className="omni-ui-badgeLabel">{props.children}</span>
    </span>
  );
}
