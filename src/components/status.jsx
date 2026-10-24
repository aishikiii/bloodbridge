import { Badge } from '@/components/ui/badge'

const requestVariants = { Open: 'warning', Notified: 'info', Accepted: 'success', Fulfilled: 'success' }
const notificationVariants = { Sent: 'info', Accepted: 'success', Declined: 'destructive', Timeout: 'warning', 'Stood down': 'secondary' }

export function RequestStatus({ status }) {
  return <Badge variant={requestVariants[status] || 'outline'}>{status}</Badge>
}

export function NotificationStatus({ status }) {
  return <Badge variant={notificationVariants[status] || 'outline'}>{status === 'Sent' ? 'Notified' : status}</Badge>
}

export function UrgencyBadge({ urgency, labels }) {
  return <Badge variant={urgency === 3 ? 'destructive' : urgency === 2 ? 'warning' : 'outline'}>{labels[urgency]}</Badge>
}

export function BloodGroup({ children, large = false }) {
  return <span className={large ? 'blood-group blood-group-large' : 'blood-group'}>{children}</span>
}
