import { ArrowRight, Building2, Database, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, GROUPS, HOSPITALS, URGENCY } from '@/lib/bloodbridge'
import { PageHeader } from '@/components/page-header'
import { ChoiceGroup } from '@/components/choice-group'
import { useToast } from '@/components/toast-provider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, Input, Label, Select } from '@/components/ui/field'

export function RequestPage() {
  const [donorCount, setDonorCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { toast } = useToast()
  const loadCount = () => api.listDonors().then(donors => setDonorCount(donors.length)).catch(error => toast(error.message, 'error'))
  useEffect(() => { loadCount() }, [])

  const seed = async () => {
    setBusy(true)
    try { await api.seed(); await loadCount(); toast('Demo donor network is ready') }
    catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }
  const submit = async event => {
    event.preventDefault()
    setBusy(true)
    try {
      const request = await api.createRequest(Object.fromEntries(new FormData(event.currentTarget).entries()))
      toast(`Request ${request.id} created`)
      navigate(`/dashboard/${request.id}`)
    } catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }

  return <>
    <PageHeader eyebrow="Care centre access" title="Raise a blood request" description="Create a verified request with the details coordinators need to begin safe, focused matching." />
    <div className="request-layout">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 /> Request details</CardTitle></CardHeader>
        <CardContent><form className="form-stack" onSubmit={submit}>
          <Field><Label htmlFor="hospital">Verified institution</Label><Select id="hospital" name="hospitalId">{HOSPITALS.map(hospital => <option value={hospital.id} key={hospital.id}>{hospital.name} ({hospital.area})</option>)}</Select><FieldDescription><ShieldCheck className="inline size-3.5" /> Only pre-verified demo institutions can create a request.</FieldDescription></Field>
          <ChoiceGroup label="Blood group needed" name="bloodGroup" values={GROUPS} defaultValue="B+" />
          <Field><Label htmlFor="units">Units required</Label><Input id="units" name="units" type="number" min="1" max="10" defaultValue="2" /></Field>
          <ChoiceGroup label="Urgency" name="urgency" values={[1, 2, 3].map(value => [value, URGENCY[value]])} defaultValue="3" description="Critical expects a donor within about 60 minutes, Urgent within 3 hours, and Routine within 12 hours." />
          <label className="consent-box"><input type="checkbox" name="shortageVerified" defaultChecked /><span><strong>Inventory shortage verified.</strong> Local stock has been checked and donor outreach is required.</span></label>
          <Button type="submit" size="lg" disabled={busy}>{busy ? 'Creating request…' : <>Create verified request <ArrowRight /></>}</Button>
        </form></CardContent>
      </Card>
      <aside className="request-aside">
        {donorCount < 5 ? <Alert icon={Database}><AlertTitle>Donor network needs demo data</AlertTitle><AlertDescription>Load 45 synthetic donors before matching this request.</AlertDescription><Button className="mt-3" size="sm" onClick={seed} disabled={busy}>Load demo donors</Button></Alert> : <Alert icon={ShieldCheck}><AlertTitle>{donorCount} donors available for evaluation</AlertTitle><AlertDescription>The eligibility gate will run only when a coordinator starts matching.</AlertDescription></Alert>}
        <Card><CardHeader><CardTitle>What happens next</CardTitle></CardHeader><CardContent><ol className="compact-steps"><li><span>1</span>Request appears in the coordinator queue.</li><li><span>2</span>Eligibility rules filter the donor network.</li><li><span>3</span>EDPS ranks the eligible candidates.</li><li><span>4</span>A small notification batch is simulated.</li></ol></CardContent></Card>
      </aside>
    </div>
  </>
}
