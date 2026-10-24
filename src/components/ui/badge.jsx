import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'border-border bg-card text-muted-foreground',
      success: 'border-transparent bg-success-soft text-success',
      warning: 'border-transparent bg-warning-soft text-warning',
      info: 'border-transparent bg-info-soft text-info',
      destructive: 'border-transparent bg-destructive-soft text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
