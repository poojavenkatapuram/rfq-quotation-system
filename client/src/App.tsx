import { useState } from 'react'
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  Calculator,
  IndianRupee,
  History,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  Factory,
  Package,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './App.css'

import RFQRegister from './components/rfq/RFQRegister'
import Costing from './components/costing/Costing'
import Quotation from './components/quotations/Quotation'
import Dashboard from './components/dashboard/Dashboard'
import Login from './components/auth/Login'
import { AuthProvider, useAuth } from './context/AuthContext'
import UserManagement from './components/users/UserManagement'
import RateMasters from './components/rates/RateMasters'

const navigation: { label: string; icon: LucideIcon }[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'RFQ Register', icon: ClipboardList },
  { label: 'Costing', icon: Calculator },
  { label: 'Quotations', icon: FileText },
  { label: 'Rate Masters', icon: IndianRupee },
  { label: 'History', icon: History },
]

function formatRole(role: string) {
  return role
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function AppContent() {
  const { user, isLoading, logout } = useAuth()
  const [activePage, setActivePage] = useState('Dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const navigate = (page: string) => {
    setActivePage(page)
    setSidebarOpen(false)
  }

  if (isLoading) {
    return (
      <div className="auth-loading">
        <Factory size={28} />
        <span>Verifying your session...</span>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-icon">
            <Factory size={22} />
          </div>
          <div>
            <h1>ForgeFlow</h1>
            <span>RFQ MANAGEMENT</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={19} />
          </button>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => navigate(label)}
              className={`nav-item ${activePage === label ? 'nav-active' : ''}`}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-divider" />

        <div className="workspace-label">ADMINISTRATION</div>

        <nav className="navigation">
          {user.role === 'ADMIN' && (
            <button
              className={`nav-item ${activePage === 'Users & Roles' ? 'nav-active' : ''}`}
              onClick={() => navigate('Users & Roles')}
            >
              <Users size={19} />
              <span>Users & Roles</span>
            </button>
          )}

          <button
            className={`nav-item ${activePage === 'Settings' ? 'nav-active' : ''}`}
            onClick={() => navigate('Settings')}
          >
            <Settings size={19} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <Package size={18} />
            </div>
            <div>
              <strong>Need assistance?</strong>
              <p>Contact your administrator</p>
            </div>
          </div>

          <div className="profile">
            <div className="avatar">{getInitials(user.name)}</div>
            <div className="profile-info">
              <strong>{user.name}</strong>
              <span>{formatRole(user.role)}</span>
            </div>
            <button
              type="button"
              className="profile-more"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={19} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <div className="breadcrumb">
              <span>Workspace</span>
              <span className="breadcrumb-separator">/</span>
              <strong>{activePage}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <div className="system-status">
              <span className="online-dot" />
              System operational
            </div>
            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
              <span className="notification-dot" />
            </button>
            <div className="topbar-divider" />
            <div className="topbar-date">
              <span>PLANT LOCATION</span>
              <strong>Chakan, Pune</strong>
            </div>
          </div>
        </header>

        <div className="page-content">
          {activePage === 'Dashboard' ? (
            <Dashboard onNavigate={navigate} />
          ) : activePage === 'RFQ Register' ? (
            <RFQRegister />
          ) : activePage === 'Costing' ? (
            <Costing />
          ) : activePage === 'Quotations' ? (
            <Quotation />
          ) : activePage === 'Rate Masters' ? (
            <RateMasters />
          ) : activePage === 'Users & Roles' && user?.role === 'ADMIN' ? (
            <UserManagement />
          ) : (
            <section className="coming-soon">
              <div className="coming-icon">
                <Factory size={28} />
              </div>
              <span className="eyebrow">WORKSPACE MODULE</span>
              <h2>{activePage}</h2>
              <p>
                This module will be connected to the backend APIs as we build
                the application.
              </p>
              <button
                className="primary-button"
                onClick={() => navigate('Dashboard')}
              >
                Return to dashboard
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App