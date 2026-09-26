import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { formatNum } from "../shared/exercises/format";
import { Icon } from "./icons";

function parseNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function selectAll(el: HTMLInputElement) {
  // iOS needs a tick before selection sticks
  requestAnimationFrame(() => {
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      /* ignore */
    }
  });
}

/** Numeric text field that keeps what you type ("12.") while editing. */
export function NumberField({
  value,
  onChange,
  placeholder,
  decimal = true,
  className = "",
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  decimal?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // value changed from outside (e.g. stepper tapped while focused): drop the draft
  useEffect(() => {
    setDraft((d) => (d != null && parseNum(d) !== value ? (value == null ? "" : formatNum(value)) : d));
  }, [value]);
  const shown = draft ?? (value == null ? "" : formatNum(value));
  return (
    <input
      className={`num ${className}`}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      enterKeyHint="done"
      autoComplete="off"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={shown}
      onFocus={(e) => {
        setDraft(shown);
        selectAll(e.currentTarget);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onChange={(e) => {
        const raw = decimal ? e.target.value.replace(/[^0-9.,]/g, "") : e.target.value.replace(/[^0-9]/g, "");
        setDraft(raw);
        const n = parseNum(raw);
        if (raw.trim() === "" || n != null) onChange(n);
      }}
    />
  );
}

export function Stepper({
  value,
  onChange,
  step,
  decimal,
  placeholder,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step: number;
  decimal?: boolean;
  placeholder?: string;
  label: string;
}) {
  const bump = (dir: 1 | -1) => {
    const base = value ?? 0;
    const next = Math.max(0, Math.round((base + dir * step) * 100) / 100);
    onChange(value == null && dir === -1 ? 0 : next);
  };
  return (
    <div className="stepper">
      <button type="button" className="step-btn" aria-label={`${label} minus ${step}`} onClick={() => bump(-1)}>
        <Icon name="minus" size={16} />
      </button>
      <NumberField value={value} onChange={onChange} decimal={decimal} placeholder={placeholder} ariaLabel={label} />
      <button type="button" className="step-btn" aria-label={`${label} plus ${step}`} onClick={() => bump(1)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

/** Textarea that grows with its content. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; minRows?: number }) {
  const { minRows = 2, className = "", ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} className={`textarea ${className}`} {...rest} />;
}

/** Text input that commits on every keystroke but can be auto-focused once. */
export function TextField({
  value,
  onChange,
  placeholder,
  className = "",
  autoFocus,
  list,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  list?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      className={`text ${className}`}
      type="text"
      value={value}
      list={list}
      aria-label={ariaLabel}
      placeholder={placeholder}
      enterKeyHint="done"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
