import type { ReactNode } from 'react'

type FieldProps = {
  label: string
  required?: boolean
  children: ReactNode
}

export function Field({ label, required, children }: FieldProps) {
  return (
    <div className="field">
      <span className="field-label">
        {label}
        {required ? <span className="req">*</span> : null}
      </span>
      {children}
    </div>
  )
}
