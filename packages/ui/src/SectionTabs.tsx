import { useLayoutEffect, useRef, type KeyboardEvent } from "react";

/** In-section page tabs (Chat assistant 运行/角色, the existing update/about pages). */

export interface SectionTabOption {
  readonly id: string;
  readonly label: string;
}

export interface SectionTabsProps {
  readonly value: string;
  readonly options: readonly SectionTabOption[];
  readonly ariaLabel?: string;
  readonly onChange: (id: string) => void;
  readonly panelIdPrefix?: string;
  readonly "data-testid"?: string;
}

/** Underline tablist. Use for page switches, not for 档位 (those stay CapsuleSwitch). */
export function SectionTabs(props: SectionTabsProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusIdRef = useRef<string | null>(null);
  const hasPrefix = props.panelIdPrefix !== undefined && props.panelIdPrefix !== "";
  const hasSelected = props.options.some((option) => option.id === props.value);

  useLayoutEffect(() => {
    const pendingId = pendingFocusIdRef.current;
    pendingFocusIdRef.current = null;
    if (pendingId !== null && pendingId === props.value) {
      tabRefs.current.get(pendingId)?.focus({ preventScroll: true });
    }
  }, [props.value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = props.options.length;
    if (count === 0) return;
    let targetIndex = -1;
    if (event.key === "ArrowRight") targetIndex = (index + 1) % count;
    else if (event.key === "ArrowLeft") targetIndex = (index - 1 + count) % count;
    else if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = count - 1;
    else return;

    event.preventDefault();
    const target = props.options[targetIndex];
    if (target === undefined) return;
    if (target.id === props.value) {
      pendingFocusIdRef.current = null;
      tabRefs.current.get(target.id)?.focus({ preventScroll: true });
      return;
    }
    pendingFocusIdRef.current = target.id;
    props.onChange(target.id);
  };

  return (
    <div
      className="omni-ui-tabs"
      role="tablist"
      aria-label={props.ariaLabel}
      data-testid={props["data-testid"]}
    >
      {props.options.map((option, index) => {
        const selected = option.id === props.value;
        return (
          <button
            key={option.id}
            ref={(node) => {
              if (node !== null) tabRefs.current.set(option.id, node);
              else tabRefs.current.delete(option.id);
            }}
            id={hasPrefix ? `${props.panelIdPrefix}-tab-${option.id}` : undefined}
            type="button"
            role="tab"
            className="omni-ui-tab"
            aria-selected={selected}
            aria-controls={hasPrefix ? `${props.panelIdPrefix}-panel-${option.id}` : undefined}
            tabIndex={selected || (!hasSelected && index === 0) ? 0 : -1}
            data-active={selected ? "true" : "false"}
            onClick={() => {
              pendingFocusIdRef.current = null;
              props.onChange(option.id);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
