import { cn } from '@/lib/utils'

export function TableWrap({ className, ...props }) {
  return <div className={cn('overflow-x-auto rounded-xl border border-border bg-card shadow-card', className)} {...props} />
}
export function Table({ className, ...props }) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />
}
export function TableHeader({ className, ...props }) {
  return <thead className={cn('bg-muted/70', className)} {...props} />
}
export function TableBody({ className, ...props }) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
export function TableRow({ className, ...props }) {
  return <tr className={cn('border-b border-border transition-colors hover:bg-muted/35', className)} {...props} />
}
export function TableHead({ className, ...props }) {
  return <th className={cn('h-10 px-4 text-left align-middle text-[10px] font-bold uppercase tracking-[.09em] text-muted-foreground whitespace-nowrap', className)} {...props} />
}
export function TableCell({ className, ...props }) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />
}
