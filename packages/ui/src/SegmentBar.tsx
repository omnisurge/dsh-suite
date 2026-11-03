import type { ReactNode } from "react";

export interface SegmentOption {
  readonly id: string;
  readonly label: string;
}

export interface SegmentBarProps {
  readonly options: readonly SegmentOption[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly "aria-label"?: string;
}

/**
 * Full-width sidebar track (Work | Chat). Not CapsuleSwitch:
 * pills belong on settings cards; this sits on official chrome.
 */
export function SegmentBar(props: SegmentBarProps): ReactNode {
  return (
    <div className="omni-ui-segments" role="group" aria-label={props["aria-label"]}>
      {props.options.map((option) => {
        const active = option.id === props.value;
        return (
          <button
            key={option.id}
            type="button"
            className="omni-ui-segment"
            data-active={active ? "true" : "false"}
            aria-pressed={active}
            onClick={() => props.onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
