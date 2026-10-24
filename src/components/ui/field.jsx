import { cn } from '@/lib/utils'

export function Field({ className, ...props }) {
  return <div className={cn('grid gap-2', className)} {...props} />
}
export function Label({ className, ...props }) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />
}
export function Input({ className, ...props }) {
  return <input className={cn('h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground/70 focus:border-primary focus:ring-3 focus:ring-ring/20', className)} {...props} />
}
export function Select({ className, children, ...props }) {
  return <select className={cn('h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-3 focus:ring-ring/20', className)} {...props}>{children}</select>
}
export function FieldDescription({ className, ...props }) {
  return <p className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />
}
