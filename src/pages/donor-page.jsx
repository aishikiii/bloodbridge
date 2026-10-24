import { ShieldCheck, UserRoundPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, GROUPS, LOCALITIES, MIN_INTERVAL_DAYS } from '@/lib/bloodbridge'
import { todayString } from '@/lib/utils'
import { PageHeader } from '@/components/page-header'
import { ChoiceGroup } from '@/components/choice-group'
import { useToast } from '@/components/toast-provider'
import { BloodGroup } from '@/components/status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, Input, Label, Select } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table'

export function DonorPage() {
  const [donors, setDonors] = useState([])
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const load = () => api.listDonors().then(items => setDonors(items.slice().reverse())).catch(error => toast(error.message, 'error'))
  useEffect(() => { load() }, [])

  const submit = async event => {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form).entries())
    if (!data.name?.trim()) return toast('Please enter a donor name.', 'error')
    if (!form.elements.consent.checked) return toast('Consent is required to register.', 'error')
    setBusy(true)
    try {
      const donor = await api.registerDonor({ ...data, consent: true })
      toast(`Registered ${donor.id} (${donor.bloodGroup})`)
      form.reset()
      await load()
    } catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }

  return <>
    <PageHeader eyebrow="Donor network" title="Register a donor" description="Join a consent-first network. Contact details remain private and are never shown directly to hospitals." />
    <div className="form-layout">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserRoundPlus /> Donor details</CardTitle></CardHeader>
        <CardContent><form className="form-stack" onSubmit={submit}>
          <Field><Label htmlFor="name">Full name</Label><Input id="name" name="name" required maxLength="60" autoComplete="off" placeholder="e.g. Priya Sharma" /></Field>
          <ChoiceGroup label="Blood group" name="bloodGroup" values={GROUPS} defaultValue="O+" />
          <Field><Label htmlFor="locality">Locality</Label><Select id="locality" name="locality">{LOCALITIES.map(locality => <option value={locality.id} key={locality.id}>{locality.name}</option>)}</Select></Field>
          <Field><Label htmlFor="last">Last donation date <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="last" name="lastDonationDate" type="date" max={todayString()} /><FieldDescription>Donors are held back until {MIN_INTERVAL_DAYS} days after their last donation.</FieldDescription></Field>
          <ChoiceGroup label="Availability" name="availability" values={[['now', 'Available now'], ['today', 'Later today']]} defaultValue="now" />
          <label className="consent-box"><input type="checkbox" name="consent" /><span><strong>I consent to emergency contact.</strong> My details stay mediated through BloodBridge and are never shared directly with hospitals.</span></label>
          <Button type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register donor'}</Button>
        </form></CardContent>
      </Card>
      <section>
        <div className="list-heading"><div><span className="overline">Donor directory</span><h2>Recently registered</h2></div><span className="count-badge">{donors.length}</span></div>
        {donors.length ? <TableWrap><Table><TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Donor</TableHead><TableHead>Group</TableHead><TableHead>Area</TableHead></TableRow></TableHeader><TableBody>
          {donors.slice(0, 12).map(donor => <TableRow key={donor.id}><TableCell className="font-mono text-xs">{donor.id}</TableCell><TableCell className="font-semibold">{donor.label}</TableCell><TableCell><BloodGroup>{donor.bloodGroup}</BloodGroup></TableCell><TableCell className="text-muted-foreground">{donor.locality}</TableCell></TableRow>)}
        </TableBody></Table></TableWrap> : <Card className="empty-state"><ShieldCheck /><h3>No donors yet</h3><p>Register a synthetic donor or load demo data from the home page.</p></Card>}
      </section>
    </div>
  </>
}
