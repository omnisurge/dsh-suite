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
}

/** Underline tablist. Use for page switches, not for 档位 (those stay CapsuleSwitch). */
export function SectionTabs(props: SectionTabsProps) {
  return (
    <div className="omni-ui-tabs" role="tablist" aria-label={props.ariaLabel}>
      {props.options.map((option) => {
        const selected = option.id === props.value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            className="omni-ui-tab"
            aria-selected={selected}
            data-active={selected ? "true" : "false"}
            onClick={() => props.onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
