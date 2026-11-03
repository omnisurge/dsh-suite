import type { ReactNode } from "react";

export type StatusLineTone = "ok" | "warn";

export interface StatusLineProps {
  readonly tone?: StatusLineTone;
  /**
   * 播报级别。结论为「没通过/不可用」时应传 `alert`：失败要被立即播报，
   * 而不是排在 `status` 队列里等用户把光标移开。默认 `status`。
   */
  readonly role?: "status" | "alert";
  readonly children: ReactNode;
  /** Test hook, forwarded like every other control in this library. */
  readonly "data-testid"?: string;
}

/** Dot + one line. For pin / health / channel verdicts — not a Badge pill. */
export function StatusLine(props: StatusLineProps): ReactNode {
  const warn = props.tone === "warn";
  return (
    <p
      className={warn ? "omni-ui-statusLine omni-ui-statusLineWarn" : "omni-ui-statusLine omni-ui-statusLineOk"}
      role={props.role ?? "status"}
      data-testid={props["data-testid"]}
    >
      <span
        className={warn ? "omni-ui-statusDot omni-ui-statusDotWarn" : "omni-ui-statusDot omni-ui-statusDotOk"}
        aria-hidden="true"
      />
      {props.children}
    </p>
  );
}

export interface BannerProps {
  /**
   * 播报级别。默认 `status`；静态说明/须知用 `note`，需要立即播报的错误用 `alert`。
   * 常驻的须知条不该反复打断读屏，所以调用方要能把它降成 `note`。
   */
  readonly role?: "status" | "note" | "alert";
  readonly children: ReactNode;
  /** Test hook, forwarded like every other control in this library. */
  readonly "data-testid"?: string;
}

/** Inline warning strip inside a card. Not a Toast. */
export function Banner(props: BannerProps): ReactNode {
  return (
    <div className="omni-ui-banner" role={props.role ?? "status"} data-testid={props["data-testid"]}>
      {props.children}
    </div>
  );
}
