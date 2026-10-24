import { Laptop, Moon, Sun } from 'lucide-react'
import { useTheme } from './theme-provider'

const modes = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return <div className="theme-switcher" aria-label="Color theme">
    {modes.map(({ value, label, icon: Icon }) => <button
      key={value}
      type="button"
      className="theme-option"
      aria-label={`${label} theme`}
      aria-pressed={theme === value}
      title={`${label} theme`}
      onClick={() => setTheme(value)}
    ><Icon /></button>)}
  </div>
}
