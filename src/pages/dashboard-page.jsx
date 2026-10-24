import { Activity, BellRing, CheckCircle2, ChevronDown, Clock3, MapPin, Radar, Radio, RefreshCw, ShieldCheck, TimerReset, UsersRound } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, BATCH_SIZE, MIN_INTERVAL_DAYS, MODE, RADIUS_MAX, RADIUS_STEP, URGENCY, W } from '@/lib/bloodbridge'
import { formatTime } from '@/lib/utils'
import { PageHeader } from '@/components/page-header'
import { useToast } from '@/components/toast-provider'
import { BloodGroup, NotificationStatus, RequestStatus, UrgencyBadge } from '@/components/status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table'

export function DashboardPage() {
  const { requestId } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [requests, setRequests] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())

  const loadRequests = useCallback(async () => {
    const list = await api.listRequests()
    setRequests(list)
    return list
  }, [])

  const refresh = useCallback(async preferredId => {
    setLoading(true)
    try {
      const list = await loadRequests()
      const selected = preferredId && list.some(item => item.id === preferredId) ? preferredId : list[0]?.id
      if (!selected) { setData(null); return }
      if (selected !== requestId) navigate(`/dashboard/${selected}`, { replace: true })
      setData(await api.getRequest(selected))
    } catch (error) { toast(error.message, 'error') }
    finally { setLoading(false) }
  }, [loadRequests, navigate, requestId, toast])

  useEffect(() => { refresh(requestId) }, [requestId])

  const runAction = async (action, success) => {
    if (!data) return
    setBusy(true)
    try { await action(data.request.id); toast(success); await refresh(data.request.id) }
    catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }

  const respond = async (donorId, response) => {
    setBusy(true)
    try { await api.respond(data.request.id, donorId, response); toast(response === 'accept' ? 'Donor accepted' : 'Donor declined'); await refresh(data.request.id) }
    catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }

  const toggle = donorId => setExpanded(current => {
    const next = new Set(current)
    next.has(donorId) ? next.delete(donorId) : next.add(donorId)
    return next
  })

  if (loading && !data) return <DashboardSkeleton />
  if (!requests.length) return <>
    <PageHeader eyebrow="Response workspace" title="Coordinator dashboard" description="Monitor verified requests, matching decisions and donor responses." />
    <Card className="empty-state"><Activity /><h2>No requests yet</h2><p>Raise a verified request to begin matching eligible donors.</p><Button asChild><Link to="/requests/new">Raise a request</Link></Button></Card>
  </>

  const request = data.request
  return <>
    <PageHeader eyebrow="Response workspace" title="Coordinator dashboard" action={<Badge variant="success" className="live-badge"><span className="status-dot" />Live coordination</Badge>} />
    <div className="dashboard-layout">
      <aside className="request-sidebar" aria-label="Blood requests">
        <div className="sidebar-label">Request queue <span>{requests.length}</span></div>
        {requests.map(item => <Link key={item.id} to={`/dashboard/${item.id}`} className="request-card" aria-current={item.id === request.id ? 'true' : undefined}>
          <div><strong>{item.id}</strong><RequestStatus status={item.status} /></div>
          <div className="flex gap-2"><BloodGroup>{item.bloodGroup}</BloodGroup><UrgencyBadge urgency={item.urgency} labels={URGENCY} /></div>
          <p>{item.hospitalName}</p>
        </Link>)}
      </aside>
      <section className="dashboard-main">
        <div className="request-heading">
          <BloodGroup large>{request.bloodGroup}</BloodGroup>
          <div><h2>{request.hospitalName}</h2><div className="request-meta"><span className="font-mono">{request.id}</span><UrgencyBadge urgency={request.urgency} labels={URGENCY} /><Badge variant="outline">{request.units} unit{request.units > 1 ? 's' : ''}</Badge><Badge variant="success"><ShieldCheck />Verified centre</Badge><Badge variant="outline">Shortage verified</Badge></div></div>
        </div>

        <StatusStepper status={request.status} />
        <ActionPanel data={data} busy={busy} onMatch={() => runAction(api.match, 'Matching complete')} onEscalate={() => runAction(api.escalate, 'Search escalated')} onFulfil={() => runAction(api.fulfil, 'Request fulfilled')} />
        <Alert className="notification-note" icon={BellRing}><AlertTitle>Notification delivery is simulated</AlertTitle><AlertDescription>No SMS is sent and no SNS charges are incurred. Every attempt is stored as a demo notification record.</AlertDescription></Alert>
        <Metrics data={data} />

        <div className="content-heading"><div><span className="overline">Eligibility results</span><h2>Ranked donors</h2></div><Badge variant="outline"><UsersRound />{data.notifications.length + data.queue.length} candidates</Badge></div>
        <DonorTable data={data} expanded={expanded} toggle={toggle} respond={respond} busy={busy} />
        <Excluded data={data} />
        <ActivityLog log={request.log} />
      </section>
    </div>
  </>
}

function StatusStepper({ status }) {
  const steps = ['Open', 'Notified', 'Accepted', 'Fulfilled']
  const active = steps.indexOf(status)
  return <ol className="status-stepper" aria-label="Request status">
    {steps.map((step, index) => <li key={step} className={index < active ? 'done' : index === active ? 'active' : ''} aria-current={index === active ? 'step' : undefined}><span>{index < active ? <CheckCircle2 /> : index + 1}</span><strong>{step}</strong></li>)}
  </ol>
}

function ActionPanel({ data, busy, onMatch, onEscalate, onFulfil }) {
  const request = data.request
  const pending = data.notifications.filter(item => item.status === 'Sent').length
  const nextRadius = Math.min(RADIUS_MAX, request.radiusKm + RADIUS_STEP)
  if (request.status === 'Open' && request.batch === 0) return <div className="action-panel"><div><strong>Ready to find eligible donors</strong><p>Run the hard gate first, then rank survivors and notify the top {BATCH_SIZE}.</p></div><Button onClick={onMatch} disabled={busy}>{busy ? <RefreshCw className="animate-spin" /> : <Radio />}Run matching</Button></div>
  if (request.status === 'Open') return <div className="action-panel"><div><strong>No eligible donors within {request.radiusKm} km</strong><p>Widen the search area to include the next group.</p></div><Button onClick={onEscalate} disabled={busy}>Widen to {nextRadius} km</Button></div>
  if (request.status === 'Notified') return <div className="action-panel"><div><strong>{pending ? `Waiting on ${pending} donor${pending > 1 ? 's' : ''}` : 'The current batch is exhausted'}</strong><p>{pending ? 'Accept or decline from the donor table, or simulate a timeout.' : 'Escalate to the next ranked batch.'}</p></div><Button variant={pending ? 'outline' : 'default'} onClick={onEscalate} disabled={busy}><TimerReset />{pending ? 'Simulate timeout' : 'Escalate'}{request.radiusKm < RADIUS_MAX ? ` · ${nextRadius} km` : ''}</Button></div>
  if (request.status === 'Accepted') {
    const accepted = data.notifications.find(item => item.donorId === request.acceptedDonorId)
    return <div className="action-panel success"><div><strong>{accepted?.donor.label || request.acceptedDonorId} accepted</strong><p>The coordinator mediates contact while the blood centre performs final screening.</p></div><Button variant="success" onClick={onFulfil} disabled={busy}><CheckCircle2 />Mark fulfilled</Button></div>
  }
  return <div className="action-panel success"><div><strong>Request fulfilled</strong><p>The request is closed and the donor enters the {MIN_INTERVAL_DAYS}-day interval.</p></div><Badge variant="success"><CheckCircle2 />Completed</Badge></div>
}

function Metrics({ data }) {
  const request = data.request
  const metrics = request.metrics || {}
  const count = status => data.notifications.filter(item => item.status === status).length
  const acceptanceSeconds = request.acceptedAt ? Math.max(0, Math.round((request.acceptedAt - request.createdAt) / 1000)) : null
  const items = [
    [request.radiusKm + ' km', 'Search radius', MapPin],
    [request.batch, 'Batches sent', BellRing],
    [metrics.evaluated ?? '–', 'Donors evaluated', UsersRound],
    [metrics.passedGate ?? '–', 'Passed hard gate', ShieldCheck],
    [metrics.latencyMs != null ? metrics.latencyMs + ' ms' : '–', `Matching latency${MODE === 'demo' ? ' · browser' : ''}`, Activity],
    [`${count('Accepted')} / ${count('Declined')} / ${count('Timeout')}`, 'Accept / decline / timeout', Radio],
    ...(acceptanceSeconds != null ? [[acceptanceSeconds + ' s', 'Request to acceptance', Clock3]] : []),
  ]
  return <div className="metric-grid">{items.map(([value, label, Icon]) => <Card className="metric-card" key={label}><CardContent><Icon /><strong>{value}</strong><span>{label}</span></CardContent></Card>)}</div>
}

function DonorTable({ data, expanded, toggle, respond, busy }) {
  const request = data.request
  const live = request.status === 'Notified'
  const rows = useMemo(() => [
    ...data.notifications.map((item, index) => ({ ...item, rank: index + 1, queued: false })),
    ...data.queue.map((item, index) => ({ ...item, rank: data.notifications.length + index + 1, status: 'Queued', queued: true })),
  ], [data])
  if (!rows.length) return <Card className="empty-state compact"><Radar /><h3>No ranked donors yet</h3><p>Run matching to see eligible candidates.</p></Card>
  return <TableWrap><Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Donor</TableHead><TableHead>Group</TableHead><TableHead>Distance</TableHead><TableHead>EDPS</TableHead><TableHead>Batch</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>
    {rows.map(item => <Fragment key={item.donorId}>
      <TableRow>
        <TableCell className="font-mono text-xs">{item.rank}</TableCell>
        <TableCell><strong>{item.donor.label}</strong><span className="cell-note">{item.donor.id} · {item.donor.locality || ''}</span></TableCell>
        <TableCell><BloodGroup>{item.donor.bloodGroup}</BloodGroup></TableCell>
        <TableCell>{item.distanceKm} km<span className="cell-note">~{item.etaMin} min</span></TableCell>
        <TableCell><Score value={item.score} /></TableCell>
        <TableCell className="text-center">{item.queued ? '–' : item.batch}</TableCell>
        <TableCell>{item.queued ? <Badge variant="secondary">Queued</Badge> : <NotificationStatus status={item.status} />}</TableCell>
        <TableCell><div className="flex flex-wrap gap-1.5">{item.status === 'Sent' && live && <><Button size="sm" variant="success" disabled={busy} onClick={() => respond(item.donorId, 'accept')}>Accept</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => respond(item.donorId, 'decline')}>Decline</Button></>}<Button size="sm" variant="ghost" onClick={() => toggle(item.donorId)}>Why <ChevronDown className={expanded.has(item.donorId) ? 'rotate-180' : ''} /></Button></div></TableCell>
      </TableRow>
      {expanded.has(item.donorId) && <TableRow className="score-row"><TableCell /><TableCell colSpan="7"><ScoreBreakdown item={item} /></TableCell></TableRow>}
    </Fragment>)}
  </TableBody></Table></TableWrap>
}

function Score({ value }) {
  return <div className="score"><span><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span><strong>{value.toFixed(1)}</strong></div>
}

function ScoreBreakdown({ item }) {
  const rows = [['Urgency fit', 'urgency'], ['Proximity', 'proximity'], ['Availability', 'availability'], [`Response signal${item.validated ? '' : ' · neutral'}`, 'response'], ['Fairness', 'fairness'], ['Fatigue penalty', 'fatigue']]
  return <div className="score-breakdown"><div><span className="overline">EDPS breakdown</span><p>Contribution to the 100-point priority score.</p></div><div className="score-components">{rows.map(([label, key]) => <div key={key}><span>{label} <small>×{W[key]}</small></span><strong>{item.contrib[key] >= 0 ? '+' : '−'}{Math.abs(item.contrib[key] * 100).toFixed(1)}</strong></div>)}</div></div>
}

function Excluded({ data }) {
  if (!data.request.metrics) return null
  const grouped = data.excluded.reduce((result, item) => {
    const key = item.reason.replace(/\(.*\)/, '').replace(/\d+ km/, 'N km').trim()
    result[key] = (result[key] || 0) + 1
    return result
  }, {})
  return <details className="detail-panel"><summary>Why were other donors excluded? <Badge variant="secondary">{data.excluded.length}</Badge></summary><div className="detail-content">{Object.entries(grouped).sort((a, b) => b[1] - a[1]).map(([reason, count]) => <div className="reason-row" key={reason}><span>{reason}</span><strong>{count}</strong></div>)}{!data.excluded.length && <p className="text-sm text-muted-foreground">No donors were excluded.</p>}<p className="detail-note">The hard gate runs before scoring, so ineligible donors are never ranked.</p></div></details>
}

function ActivityLog({ log }) {
  return <details className="detail-panel" open><summary>Activity log <Badge variant="secondary">{log.length}</Badge></summary><ol className="activity-log">{log.map((item, index) => <li key={`${item.t}-${index}`}><span /><time>{formatTime(item.t)}</time><p>{item.msg}</p></li>)}</ol></details>
}

function DashboardSkeleton() {
  return <><PageHeader eyebrow="Response workspace" title="Coordinator dashboard" /><div className="skeleton-grid"><div className="skeleton h-80" /><div className="space-y-3"><div className="skeleton h-20" /><div className="skeleton h-32" /><div className="skeleton h-72" /></div></div></>
}
