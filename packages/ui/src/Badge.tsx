import type { ReactNode } from "react";

export type BadgeTone = "ok" | "warn" | "err" | "muted";

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
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
  return (
    <span className={toneClass(props.tone)} data-testid={props["data-testid"]}>
      <span className="omni-ui-badgeDot" aria-hidden="true" />
      {props.children}
    </span>
  );
}
