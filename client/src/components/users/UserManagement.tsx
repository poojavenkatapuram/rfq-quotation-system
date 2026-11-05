import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users,
  UserPlus,
  Search,
  RefreshCw,
  ShieldCheck,
  Shield,
  UserCheck,
  UserX,
  Pencil,
  X,
  AlertCircle,
  CheckCircle,
} from 'lucide-react'
import api from '../../services/api'
import './UserManagement.css'

type UserRole = 'ADMIN' | 'SALES_HEAD' | 'ESTIMATOR' | 'PLANT_HEAD'

type User = {
  id: string
  name: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

const roles: UserRole[] = ['ADMIN', 'SALES_HEAD', 'ESTIMATOR', 'PLANT_HEAD']

const roleLabel = (role: string) =>
  role.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())

const errorMessage = (error: any, fallback: string) =>
  error.response?.data?.message || fallback

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionUserId, setActionUserId] = useState('')

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'ESTIMATOR' as UserRole,
  })

  const loadUsers = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')

    try {
      const response = await api.get('/users', {
        params: {
          page,
          limit: pagination.limit,
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(roleFilter !== 'ALL' ? { role: roleFilter } : {}),
        },
      })

      const data = response.data.data
      const records: User[] = data.users || []

      setUsers(records)
      setPagination(data.pagination)
    } catch (err: any) {
      setError(errorMessage(err, 'Unable to load users. Please check your connection.'))
    } finally {
      setLoading(false)
    }
  }, [pagination.limit, search, roleFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers(1)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [loadUsers])

  const visibleUsers = useMemo(
    () => users.filter((user) => {
      if (statusFilter === 'ACTIVE') return user.isActive
      if (statusFilter === 'INACTIVE') return !user.isActive
      return true
    }),
    [users, statusFilter],
  )

  const activeCount = users.filter((user) => user.isActive).length
  const inactiveCount = users.length - activeCount

  const resetForm = () => {
    setForm({
      name: '',
      email: '',
      password: '',
      role: 'ESTIMATOR',
    })
    setEditingUser(null)
    setShowForm(false)
  }

  const openCreateForm = () => {
    setError('')
    setNotice('')
    setEditingUser(null)
    setForm({
      name: '',
      email: '',
      password: '',
      role: 'ESTIMATOR',
    })
    setShowForm(true)
  }

  const openEditForm = (user: User) => {
    setError('')
    setNotice('')
    setEditingUser(user)
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
    })
    setShowForm(true)
  }

  const saveUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')

    try {
      if (editingUser) {
        await api.patch(`/users/${editingUser.id}`, {
          name: form.name.trim(),
          role: form.role,
        })
        setNotice('User details updated successfully.')
      } else {
        await api.post('/users', {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
        })
        setNotice('User created successfully.')
      }

      resetForm()
      await loadUsers(pagination.page)
    } catch (err: any) {
      setError(errorMessage(err, 'Unable to save user details.'))
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (user: User) => {
    const nextStatus = !user.isActive
    const action = nextStatus ? 'activate' : 'deactivate'

    if (!window.confirm(`Are you sure you want to ${action} ${user.name}?`)) {
      return
    }

    setActionUserId(user.id)
    setError('')
    setNotice('')

    try {
      await api.patch(`/users/${user.id}/status`, {
        isActive: nextStatus,
      })
      setNotice(`${user.name} has been ${nextStatus ? 'activated' : 'deactivated'}.`)
      await loadUsers(pagination.page)
    } catch (err: any) {
      setError(errorMessage(err, `Unable to ${action} this user.`))
    } finally {
      setActionUserId('')
    }
  }

  const initials = (name: string) =>
    name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')

  return (
    <section className="users-page">
      <div className="users-heading">
        <div>
          <span className="users-eyebrow">ADMINISTRATION</span>
          <h1>Users &amp; Roles</h1>
          <p>Manage employee accounts and access permissions.</p>
        </div>
        <button className="users-primary-button" onClick={openCreateForm}>
          <UserPlus size={17} />
          Add user
        </button>
      </div>

      <div className="users-stats">
        <article className="users-stat-card">
          <div className="users-stat-icon"><Users size={19} /></div>
          <div><span>Total users on this page</span><strong>{pagination.total}</strong></div>
        </article>
        <article className="users-stat-card">
          <div className="users-stat-icon active"><UserCheck size={19} /></div>
          <div><span>Active on this page</span><strong>{activeCount}</strong></div>
        </article>
        <article className="users-stat-card">
          <div className="users-stat-icon inactive"><UserX size={19} /></div>
          <div><span>Inactive on this page</span><strong>{inactiveCount}</strong></div>
        </article>
      </div>

      {error && (
        <div className="users-feedback error">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button>
        </div>
      )}

      {notice && (
        <div className="users-feedback success">
          <CheckCircle size={17} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      <div className="users-toolbar">
        <div className="users-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email..."
          />
        </div>

        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="ALL">All roles</option>
          {roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
        </select>

        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>

        <button className="users-refresh" onClick={() => void loadUsers(pagination.page)} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'users-spinning' : ''} />
          Refresh
        </button>
      </div>

      <div className="users-table-card">
        <div className="users-table-heading">
          <div>
            <h2>Team directory</h2>
            <span>{pagination.total} registered account{pagination.total === 1 ? '' : 's'}</span>
          </div>
          <span className="users-secure-label"><ShieldCheck size={15} /> Admin managed</span>
        </div>

        <div className="users-table-scroll">
          <table className="users-table">
            <thead>
              <tr>
                <th>USER</th>
                <th>ROLE</th>
                <th>STATUS</th>
                <th>CREATED</th>
                <th className="users-actions-heading">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="users-empty">Loading user accounts...</td></tr>
              ) : visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="users-empty">
                    <Users size={26} />
                    <strong>No users found</strong>
                    <span>Try changing your search or filters.</span>
                  </td>
                </tr>
              ) : visibleUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="users-person">
                      <div className="users-avatar">{initials(user.name)}</div>
                      <div><strong>{user.name}</strong><span>{user.email}</span></div>
                    </div>
                  </td>
                  <td>
                    <span className={`users-role role-${user.role.toLowerCase()}`}>
                      {user.role === 'ADMIN' ? <ShieldCheck size={14} /> : <Shield size={14} />}
                      {roleLabel(user.role)}
                    </span>
                  </td>
                  <td>
                    <span className={`users-status ${user.isActive ? 'is-active' : 'is-inactive'}`}>
                      <span />
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString('en-IN')}</td>
                  <td>
                    <div className="users-row-actions">
                      <button title="Edit user" aria-label={`Edit ${user.name}`} onClick={() => openEditForm(user)}>
                        <Pencil size={16} />
                      </button>
                      <button
                        title={user.isActive ? 'Deactivate user' : 'Activate user'}
                        aria-label={`${user.isActive ? 'Deactivate' : 'Activate'} ${user.name}`}
                        disabled={actionUserId === user.id}
                        onClick={() => void toggleStatus(user)}
                      >
                        {user.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="users-pagination">
          <span>Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span>
          <div>
            <button
              disabled={loading || pagination.page <= 1}
              onClick={() => void loadUsers(pagination.page - 1)}
            >Previous</button>
            <button
              disabled={loading || pagination.page >= pagination.totalPages}
              onClick={() => void loadUsers(pagination.page + 1)}
            >Next</button>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="users-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) resetForm()
        }}>
          <section className="users-modal" role="dialog" aria-modal="true" aria-labelledby="users-modal-title">
            <div className="users-modal-heading">
              <div>
                <span className="users-eyebrow">{editingUser ? 'ACCOUNT SETTINGS' : 'NEW ACCOUNT'}</span>
                <h2 id="users-modal-title">{editingUser ? 'Edit user' : 'Create user'}</h2>
              </div>
              <button onClick={resetForm} disabled={saving} aria-label="Close dialog"><X size={19} /></button>
            </div>

            <form onSubmit={saveUser}>
              <label>
                Full name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Enter employee name"
                />
              </label>

              {!editingUser && (
                <>
                  <label>
                    Email address
                    <input
                      required
                      type="email"
                      maxLength={255}
                      value={form.email}
                      onChange={(event) => setForm({ ...form, email: event.target.value })}
                      placeholder="employee@company.com"
                    />
                  </label>
                  <label>
                    Temporary password
                    <input
                      required
                      type="password"
                      minLength={12}
                      maxLength={128}
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      placeholder="At least 12 characters"
                    />
                    <small>Use a temporary password and share it securely with the employee.</small>
                  </label>
                </>
              )}

              <label>
                Role
                <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>
                  {roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </select>
              </label>

              <div className="users-form-actions">
                <button type="button" className="users-cancel-button" onClick={resetForm} disabled={saving}>Cancel</button>
                <button type="submit" className="users-primary-button" disabled={saving}>
                  {saving ? 'Saving...' : editingUser ? 'Save changes' : 'Create account'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}
