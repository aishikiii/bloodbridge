import { Activity, Droplet, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { MODE } from '@/lib/bloodbridge'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from './theme-toggle'

const nav = [
  ['/', 'Home'],
  ['/donors', 'Register donor'],
  ['/requests/new', 'Raise request'],
  ['/dashboard', 'Dashboard'],
]

export function Logo() {
  return <NavLink to="/" className="brand" aria-label="BloodBridge home">
    <span className="brand-mark"><Droplet /></span>
    <span>BloodBridge</span>
  </NavLink>
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  return <div className="min-h-screen bg-background text-foreground">
    <header className="site-header">
      <div className="site-header-inner">
        <Logo />
        <nav className={cn('main-nav', open && 'is-open')} aria-label="Main navigation">
          {nav.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => cn('nav-link', isActive && 'active')}>{label}</NavLink>)}
        </nav>
        <div className="header-tools">
          <Badge variant="outline" className="mode-badge"><span className="status-dot" />{MODE === 'aws' ? 'AWS API connected' : 'Demo data · this browser'}</Badge>
          <ThemeToggle />
          <button className="mobile-menu" onClick={() => setOpen(value => !value)} aria-label="Toggle navigation" aria-expanded={open}>{open ? <X /> : <Menu />}</button>
        </div>
      </div>
    </header>
    <main className="page-shell"><Outlet /></main>
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Logo />
        <p><strong>Clinical safety notice.</strong> Matching prioritizes outreach only. Final screening and transfusion decisions remain with qualified blood-centre staff.</p>
        <span className="prototype-label"><Activity /> Student prototype · synthetic data</span>
      </div>
    </footer>
  </div>
}
