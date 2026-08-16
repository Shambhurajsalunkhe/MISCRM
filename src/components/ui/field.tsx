import { cn } from '@/lib/cn'

const controlStyles =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 ' +
  'shadow-xs transition placeholder:text-slate-400 ' +
  'focus:border-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-slate-900/20 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ' +
  'aria-[invalid=true]:border-red-400'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input {...props} className={cn(controlStyles, className)} />
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea {...props} className={cn(controlStyles, 'min-h-20', className)} />
  )
}

export function Select({
  className,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <select {...props} className={cn(controlStyles, 'pr-8', className)} />
  )
}

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn(
        'size-4 rounded border-slate-300 text-slate-900 accent-slate-900 ' +
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
        className,
      )}
    />
  )
}

/**
 * Label + control + error, wired together.
 *
 * `error` is the per-field message from a server action's Zod flatten, so a
 * failed submit shows the message next to the offending input rather than only
 * in a banner at the top of the form.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A checkbox with its label on the right — for module switches and flags. */
export function CheckboxField({
  label,
  name,
  hint,
  defaultChecked,
  disabled,
}: {
  label: string
  name: string
  hint?: string
  defaultChecked?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={name}
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <label htmlFor={name} className="text-sm text-slate-700">
          {label}
        </label>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
    </div>
  )
}
