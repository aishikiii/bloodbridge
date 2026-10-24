import { Activity, ArrowRight, Building2, Check, Database, HeartHandshake, LockKeyhole, Radar, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, MODE } from '@/lib/bloodbridge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useToast } from '@/components/toast-provider'

const workflow = [
  ['Verified request', 'A registered care centre confirms the shortage.', Building2],
  ['Safe matching', 'Compatibility, consent and availability are checked.', ShieldCheck],
  ['Focused outreach', 'The nearest eligible donors are contacted first.', Radar],
  ['Coordinated response', 'Every acceptance stays mediated and traceable.', HeartHandshake],
]

export function HomePage() {
  const [summary, setSummary] = useState({ donors: 0, requests: [] })
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const load = async () => {
    const [donors, requests] = await Promise.all([api.listDonors(), api.listRequests()])
    setSummary({ donors: donors.length, requests })
  }
  useEffect(() => { load().catch(error => toast(error.message, 'error')) }, [])

  const seed = async () => {
    setBusy(true)
    try { await api.seed(); await load(); toast('Demo donor network is ready') }
    catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }
  const reset = async () => {
    if (!window.confirm('Reset all synthetic donors and requests in this browser?')) return
    setBusy(true)
    try { await api.reset(); await load(); toast('Demo data reset') }
    catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }

  const fulfilled = summary.requests.filter(request => request.status === 'Fulfilled').length
  return <>
    <section className="home-hero">
      <div className="hero-copy">
        <div className="eyebrow"><span />Rapid, responsible donor coordination</div>
        <h1>Every minute matters. <em>Every donor counts.</em></h1>
        <p>BloodBridge helps verified care teams reach compatible, consenting donors quickly—without exposing private contact details.</p>
        <div className="hero-actions">
          <Button size="lg" asChild><Link to="/requests/new">Raise an urgent request <ArrowRight /></Link></Button>
          <Button size="lg" variant="outline" asChild><Link to="/donors">Become a donor</Link></Button>
        </div>
        <div className="trust-list">
          <span><Check />Verified centres</span><span><Check />Privacy first</span><span><Check />Eligibility screened</span>
        </div>
      </div>
      <Card className="workflow-card">
        <CardHeader className="workflow-card-header">
          <div><span className="overline">How it works</span><CardTitle>From request to response</CardTitle></div>
          <span className="live-pulse" />
        </CardHeader>
        <CardContent>
          <ol className="workflow-list">
            {workflow.map(([title, text, Icon], index) => <li key={title}>
              <span className="workflow-icon"><Icon /></span>
              <div><small>0{index + 1}</small><strong>{title}</strong><p>{text}</p></div>
            </li>)}
          </ol>
        </CardContent>
      </Card>
    </section>

    <section className="home-stats" aria-label="Demo summary">
      <Card className="summary-card"><CardContent><span className="overline">Donor network</span><strong>{summary.donors}</strong><h2>Registered donors</h2><p>Synthetic profiles with identities masked.</p></CardContent></Card>
      <Card className="summary-card"><CardContent><span className="overline">Care requests</span><strong>{summary.requests.length}</strong><h2>Requests raised</h2><p>{fulfilled} fulfilled · {summary.requests.length - fulfilled} active</p></CardContent></Card>
      <Card className="summary-card demo-card"><CardContent>
        <div><span className="overline">Explore safely</span><h2>Try the complete flow</h2><p>Load 45 synthetic donors around Vellore.</p></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={seed} disabled={busy}><Database />Load demo data</Button>{MODE === 'demo' && <Button size="sm" variant="outline" onClick={reset} disabled={busy}>Reset</Button>}</div>
      </CardContent></Card>
    </section>

    <section className="demo-guide">
      <div className="section-heading"><div><span className="overline">Interactive prototype</span><h2>See the response flow in action</h2></div><Button variant="ghost" asChild><Link to="/dashboard">Open dashboard <ArrowRight /></Link></Button></div>
      <div className="guide-grid">
        {[
          ['01', 'Prepare', 'Load demo donors or register a synthetic profile.'],
          ['02', 'Request', 'Select a verified centre, blood group and urgency.'],
          ['03', 'Match', 'Run the eligibility gate and inspect the ranking.'],
          ['04', 'Respond', 'Accept, decline or expand the search radius.'],
        ].map(([number, title, text]) => <div className="guide-step" key={number}><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}
      </div>
    </section>

    <section className="architecture-strip">
      <div><Activity /><span><strong>Free-tier demo</strong> S3 → API Gateway → Lambda → DynamoDB</span></div>
      <div><LockKeyhole /><span>Notifications are simulated. No SMS is sent.</span></div>
      <div><Users /><span>Names stay masked in coordinator views.</span></div>
    </section>

    <Alert className="mt-6"><AlertTitle>Designed with a clear safety boundary</AlertTitle><AlertDescription>The score prioritizes outreach only. Blood-centre screening and clinical decisions always come first.</AlertDescription></Alert>
  </>
}
