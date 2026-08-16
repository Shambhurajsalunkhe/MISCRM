import { cn } from '@/lib/cn'

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table
        {...props}
        className={cn('w-full min-w-max border-collapse text-sm', className)}
      />
    </div>
  )
}

export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      {...props}
      className={cn('border-b border-slate-200 bg-slate-50', className)}
    />
  )
}

export function TBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody {...props} className={cn('divide-y divide-slate-100', className)} />
}

export function TR({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr {...props} className={cn('hover:bg-slate-50/70', className)} />
}

export function TH({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      {...props}
      className={cn(
        'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500',
        className,
      )}
    />
  )
}

export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td {...props} className={cn('px-3 py-2 align-middle text-slate-700', className)} />
  )
}
