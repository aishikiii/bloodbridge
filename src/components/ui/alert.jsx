import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Alert({ className, icon: Icon = Info, children, ...props }) {
  return <div role="note" className={cn('grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-primary/15 bg-primary-soft p-4 text-sm', className)} {...props}>
    <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"><Icon className="size-3.5" /></span>
    <div>{children}</div>
  </div>
}
export function AlertTitle({ className, ...props }) {
  return <h3 className={cn('mb-1 text-sm font-semibold', className)} {...props} />
}
export function AlertDescription({ className, ...props }) {
  return <div className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />
}
