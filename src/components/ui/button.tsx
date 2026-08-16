import Link from 'next/link'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/cn'

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-slate-900 text-white hover:bg-slate-800',
        secondary:
          'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        danger: 'bg-red-600 text-white hover:bg-red-700',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      },
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-9 px-3.5 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonStyleProps = VariantProps<typeof buttonStyles>

export function Button({
  variant,
  size,
  className,
  ...props
}: React.ComponentProps<'button'> & ButtonStyleProps) {
  return (
    <button
      {...props}
      className={cn(buttonStyles({ variant, size }), className)}
    />
  )
}

/** A link styled as a button — for navigation, where a <button> would be wrong. */
export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: React.ComponentProps<typeof Link> & ButtonStyleProps) {
  return (
    <Link
      {...props}
      className={cn(buttonStyles({ variant, size }), className)}
    />
  )
}
