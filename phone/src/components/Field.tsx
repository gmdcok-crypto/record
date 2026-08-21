import type { ReactNode } from 'react'

type Option<T extends string> = { value: T; label: string }

type ChipGroupProps<T extends string> = {
  options: Option<T>[]
  value: T | ''
  onChange: (value: T) => void
  ariaLabel: string
  columns?: number
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns,
}: ChipGroupProps<T>) {
  return (
    <div
      className="chip-group"
      role="group"
      aria-label={ariaLabel}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="chip-btn"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

type FieldProps = {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}

export function Field({ label, required, hint, children }: FieldProps) {
  return (
    <div className="field">
      <span className="field-label">
        {label}
        {required ? <span className="req">*</span> : null}
      </span>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}
