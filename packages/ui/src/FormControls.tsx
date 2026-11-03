import { useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { TextInput } from "./Field.js";

export interface CheckControlProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: ReactNode;
  description?: string;
}

export interface CheckboxProps extends CheckControlProps { indeterminate?: boolean }

export function Checkbox({ label, description, indeterminate = false, className = "", ...rest }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const hint = useId();
  useLayoutEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <label className={`omni-ui-check ${className}`}>
    <input {...rest} ref={ref} type="checkbox" aria-describedby={[rest["aria-describedby"], description ? hint : null].filter(Boolean).join(" ") || undefined} />
    <span>{label}{description && <span id={hint} className="omni-ui-hint omni-ui-controlHint">{description}</span>}</span>
  </label>;
}

export function Switch({ label, description, className = "", ...rest }: CheckControlProps) {
  const hint = useId();
  return <label className={`omni-ui-check omni-ui-switch ${className}`}>
    <input {...rest} type="checkbox" role="switch" aria-describedby={[rest["aria-describedby"], description ? hint : null].filter(Boolean).join(" ") || undefined} />
    <span>{label}{description && <span id={hint} className="omni-ui-hint omni-ui-controlHint">{description}</span>}</span>
  </label>;
}

export interface RadioGroupProps {
  label: string;
  name?: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function RadioGroup({ label, name, value, options, onChange, disabled }: RadioGroupProps) {
  const id = useId();
  return <fieldset className="omni-ui-radioGroup" disabled={disabled}><legend className="omni-ui-label">{label}</legend>
    {options.map(option => <label className="omni-ui-check" key={option.value}>
      <input type="radio" name={name ?? id} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} />{option.label}
    </label>)}
  </fieldset>;
}

export type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
/** Native validity and empty drafts are preserved; callers decide when to commit a number. */
export function NumberInput(props: NumberInputProps) {
  return <TextInput {...props} type="number" />;
}

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
export function SearchInput(props: SearchInputProps) {
  return <TextInput {...props} type="search" />;
}

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue"> {
  label: string;
  value: number;
  valueText?: string;
}

export function Slider({ label, value, valueText, id, className = "", ...rest }: SliderProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return <div className={`omni-ui-slider ${className}`}><div className="omni-ui-fieldHead">
    <label className="omni-ui-label" htmlFor={inputId}>{label}</label><output htmlFor={inputId}>{valueText ?? value}</output></div>
    <input {...rest} id={inputId} type="range" value={value} aria-valuetext={valueText} />
  </div>;
}
