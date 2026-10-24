import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/app-shell'
import { DashboardPage } from '@/pages/dashboard-page'
import { DonorPage } from '@/pages/donor-page'
import { HomePage } from '@/pages/home-page'
import { RequestPage } from '@/pages/request-page'

export default function App() {
  return <Routes>
    <Route element={<AppShell />}>
      <Route index element={<HomePage />} />
      <Route path="donors" element={<DonorPage />} />
      <Route path="requests/new" element={<RequestPage />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="dashboard/:requestId" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>
}
