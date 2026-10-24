import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:-translate-y-px',
        outline: 'border border-border bg-card text-foreground hover:border-primary/30 hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        success: 'bg-success text-white hover:bg-success/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 px-5',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({ className, variant, size, asChild = false, children, ...props }) {
  if (asChild && children?.type) {
    const Child = children.type
    return <Child {...children.props} {...props} className={cn(buttonVariants({ variant, size }), className, children.props.className)} />
  }
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</button>
}

export { buttonVariants }
