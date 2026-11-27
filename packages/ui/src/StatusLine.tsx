import type { ReactNode } from "react";

export type StatusLineTone = "ok" | "warn" | "err" | "neutral" | "loading" | "error";

type NormalizedStatusTone = "ok" | "warn" | "err" | "neutral" | "loading";

export interface StatusLineProps {
  readonly tone?: StatusLineTone;
  /**
   * 播报级别。结论为「没通过/不可用」时默认 `alert`：失败要被立即播报，
   * 而不是排在 `status` 队列里等用户把光标移开。其余默认 `status`，可传 `none` 关闭。
   */
  readonly role?: "status" | "alert" | "none";
  readonly emphasis?: "default" | "strong";
  readonly children: ReactNode;
  readonly className?: string;
  /** Test hook, forwarded like every other control in this library. */
  readonly "data-testid"?: string;
}

function normalizeStatusTone(tone: StatusLineTone | undefined): NormalizedStatusTone {
  if (tone === undefined || tone === "ok") return "ok";
  if (tone === "warn") return "warn";
  if (tone === "err" || tone === "error") return "err";
  if (tone === "loading") return "loading";
  return "neutral";
}

function statusLineToneClasses(tone: NormalizedStatusTone): string {
  if (tone === "warn") return "omni-ui-statusLineWarn omni-ui-statusLine--warn";
  if (tone === "err") return "omni-ui-statusLineErr omni-ui-statusLine--err";
  if (tone === "neutral") return "omni-ui-statusLineNeutral omni-ui-statusLine--neutral";
  if (tone === "loading") return "omni-ui-statusLineLoading omni-ui-statusLine--loading";
  return "omni-ui-statusLineOk omni-ui-statusLine--ok";
}

function statusDotClass(tone: NormalizedStatusTone): string {
  if (tone === "warn") return "omni-ui-statusDot omni-ui-statusDotWarn";
  if (tone === "err") return "omni-ui-statusDot omni-ui-statusDotErr";
  if (tone === "neutral") return "omni-ui-statusDot omni-ui-statusDotNeutral";
  return "omni-ui-statusDot omni-ui-statusDotOk";
}

/** Dot + one line. For pin / health / channel verdicts — not a Badge pill. */
export function StatusLine(props: StatusLineProps): ReactNode {
  const tone = normalizeStatusTone(props.tone);
  const role = props.role ?? (tone === "err" ? "alert" : "status");
  const classes = ["omni-ui-statusLine", statusLineToneClasses(tone)];
  if (props.emphasis === "strong") classes.push("omni-ui-statusLine--strong");
  if (props.className !== undefined && props.className !== "") classes.push(props.className);
  return (
    <p
      className={classes.join(" ")}
      role={role}
      aria-busy={tone === "loading" ? "true" : undefined}
      data-testid={props["data-testid"]}
    >
      <span className="omni-ui-statusDotWrap" aria-hidden="true">
        {tone === "loading" ? (
          <svg className="omni-ui-statusArc" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="3.75" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
            <path d="M5 1.25A3.75 3.75 0 1 1 1.75 6.875" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          <span className={statusDotClass(tone)} />
        )}
      </span>
      <span className="omni-ui-statusText">{props.children}</span>
    </p>
  );
}

export type BannerTone = "neutral" | "ok" | "warn" | "err";

export interface BannerProps {
  readonly tone?: BannerTone;
  /**
   * 播报级别。默认 `status`；静态说明/须知用 `note`，需要立即播报的错误用 `alert`。
   * 常驻的须知条不该反复打断读屏，所以调用方要能把它降成 `note`。
   */
  readonly role?: "status" | "note" | "alert";
  readonly children: ReactNode;
  readonly className?: string;
  /** Test hook, forwarded like every other control in this library. */
  readonly "data-testid"?: string;
}

/** Inline alert/notice strip inside a card. Not a Toast. */
export function Banner(props: BannerProps): ReactNode {
  const tone = props.tone ?? "err";
  const classes = ["omni-ui-banner", `omni-ui-banner--${tone}`];
  if (props.className !== undefined && props.className !== "") classes.push(props.className);
  return (
    <div className={classes.join(" ")} role={props.role ?? "status"} data-testid={props["data-testid"]}>
      {props.children}
    </div>
  );
}
