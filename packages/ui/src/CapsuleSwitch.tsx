import type { ReactNode } from "react";
import { Field, TextInput } from "./Field.js";

export interface CapsuleOption {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface CapsuleSwitchProps {
  readonly options: readonly CapsuleOption[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
  /** When set, selecting this option reveals a free-form field. */
  readonly customOptionId?: string;
  readonly customValue?: string;
  readonly onCustomChange?: (value: string) => void;
  readonly customPlaceholder?: string;
  readonly customLabel?: string;
  readonly customHint?: string;
}

/** Horizontal capsule switcher (segmented control). */
export function CapsuleSwitch(props: CapsuleSwitchProps): ReactNode {
  const customId = props.customOptionId;
  const showCustom = customId !== undefined && props.value === customId;

  return (
    <div className="omni-ui-capsuleBlock">
      <div
        className="omni-ui-capsule"
        role="radiogroup"
        aria-label={props["aria-label"]}
        aria-disabled={props.disabled === true}
      >
        {props.options.map((option) => {
          const active = option.id === props.value;
          const optionDisabled = props.disabled === true || option.disabled === true;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? "omni-ui-capsuleItem omni-ui-capsuleItemActive" : "omni-ui-capsuleItem"}
              disabled={optionDisabled}
              onClick={() => {
                if (!active && !optionDisabled) props.onChange(option.id);
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {showCustom ? (
        <Field label={props.customLabel ?? ""} hint={props.customHint}>
          <TextInput
            value={props.customValue ?? ""}
            placeholder={props.customPlaceholder}
            disabled={props.disabled === true}
            inputMode="numeric"
            onChange={(event) => props.onCustomChange?.(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}
