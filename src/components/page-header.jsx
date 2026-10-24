import { cn } from '@/lib/utils'

export function PageHeader({ eyebrow, title, description, action, className }) {
  return <div className={cn('page-header', className)}>
    <div>
      {eyebrow && <div className="eyebrow"><span />{eyebrow}</div>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {action}
  </div>
}
