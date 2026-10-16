import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '@/pages/login/page'
import { SignupPage } from '@/pages/signup/page'
import { WorkspacesPage } from '@/pages/workspaces/page'
import { ThemeToggle } from '@/components/theme-toggle'
import { RolesPage } from '@/pages/roles/page'
import { WorkspaceLayout } from '@/components/workspace-layout'
import { UsersPage } from '@/pages/users/page'
import { AcceptInvitationPage } from '@/pages/accept-invitation/page'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/signup" replace />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
        <Route path="/workspaces" element={<WorkspacesPage key="list" />} />
        <Route path="/workspaces/new" element={<WorkspacesPage key="create" create />} />
        <Route path="/workspaces/:workspaceId" element={<WorkspaceLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<main aria-label="Dashboard" className="min-h-96" />} />
          <Route path="activity" element={<main aria-label="Activity" className="min-h-96" />} />
          <Route path="settings/roles" element={<RolesPage />} />
          <Route path="settings/users" element={<UsersPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/signup" replace />} />
      </Routes>
      <ThemeToggle />
    </BrowserRouter>
  )
}

export default App
