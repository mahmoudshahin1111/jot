import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '@/pages/login'
import { SignupPage } from '@/pages/signup'
import { WorkspacesPage } from '@/pages/workspaces'
import { ThemeToggle } from '@/components/theme-toggle'
import { RolesPage } from '@/pages/roles'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/signup" replace />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/workspaces" element={<WorkspacesPage key="list" />} />
        <Route path="/workspaces/new" element={<WorkspacesPage key="create" create />} />
        <Route path="/workspaces/:workspaceId/settings/roles" element={<RolesPage />} />
        <Route path="*" element={<Navigate to="/signup" replace />} />
      </Routes>
      <ThemeToggle />
    </BrowserRouter>
  )
}

export default App
