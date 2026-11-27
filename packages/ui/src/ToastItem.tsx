import { useEffect } from "react";
import { TOAST_ICON_SPECS, toastToneClassName } from "./notify-core.js";
import { injectStyles } from "./styles.js";
import type { ToastTone } from "./toast.js";

export interface ToastItemProps {
  readonly text: string;
  readonly tone?: ToastTone;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly closeLabel?: string;
  readonly showClose?: boolean;
  readonly onClose?: () => void;
  readonly className?: string;
  readonly "data-testid"?: string;
}

function renderToastIcon(tone: ToastTone) {
  if (tone === "neutral") return null;
  if (tone === "loading") {
    return (
      <span className="omni-ui-toastIcon omni-ui-toastIcon--loading" aria-hidden="true">
        <span className="omni-ui-toastSpinner" />
      </span>
    );
  }
  const spec = TOAST_ICON_SPECS[tone];
  return (
    <span className={`omni-ui-toastIcon omni-ui-toastIcon--${tone}`} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        {spec.circles.map((circle, index) => (
          <circle
            key={`c-${index}`}
            cx={circle.cx}
            cy={circle.cy}
            r={circle.r}
            fill={circle.fill}
            stroke={circle.strokeWidth !== undefined ? "currentColor" : undefined}
            strokeWidth={circle.strokeWidth}
          />
        ))}
        {spec.paths.map((path, index) => (
          <path
            key={`p-${index}`}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </span>
  );
}

/** Pure presentational Toast bar primitive matching imperative `showToast` styling and ARIA contract. */
export function ToastItem(props: ToastItemProps) {
  useEffect(() => {
    injectStyles();
  }, []);

  const tone: ToastTone = props.tone ?? "neutral";
  const danger = tone === "danger";
  const loading = tone === "loading";
  const hasAction = props.actionLabel !== undefined && props.actionLabel !== "";

  return (
    <div
      className={toastToneClassName(tone, props.className)}
      role={danger ? "alert" : "status"}
      aria-live={danger ? "assertive" : "polite"}
      aria-busy={loading ? "true" : undefined}
      data-testid={props["data-testid"]}
    >
      {renderToastIcon(tone)}
      <span className="omni-ui-toastText">{props.text}</span>
      {hasAction ? (
        <button type="button" className="omni-ui-toastAction" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
      {props.showClose !== false ? (
        <button
          type="button"
          className="omni-ui-toastClose"
          aria-label={props.closeLabel ?? "Dismiss"}
          onClick={props.onClose}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
