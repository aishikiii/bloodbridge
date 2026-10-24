import { CheckCircle2, XCircle, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const dismiss = useCallback(id => setItems(current => current.filter(item => item.id !== id)), [])
  const toast = useCallback((message, variant = 'success') => {
    const id = crypto.randomUUID()
    setItems(current => [...current, { id, message, variant }])
    window.setTimeout(() => dismiss(id), 3500)
  }, [dismiss])
  const value = useMemo(() => ({ toast }), [toast])

  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-region" aria-live="polite">
      {items.map(item => <div className="toast-card" data-variant={item.variant} key={item.id}>
        {item.variant === 'error' ? <XCircle /> : <CheckCircle2 />}
        <span>{item.message}</span>
        <button onClick={() => dismiss(item.id)} aria-label="Dismiss notification"><X /></button>
      </div>)}
    </div>
  </ToastContext.Provider>
}

export function useToast() {
  return useContext(ToastContext)
}
