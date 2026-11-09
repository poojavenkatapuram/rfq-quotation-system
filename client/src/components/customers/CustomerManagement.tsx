import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import axios from 'axios'
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/auth-context'
import './CustomerManagement.css'

type Customer = {
  id: string
  name: string
  code: string
  email: string | null
  phone: string | null
  address: string | null
  gstNumber: string | null
  createdAt: string
  updatedAt: string
}

type CustomerForm = {
  name: string
  code: string
  email: string
  phone: string
  address: string
  gstNumber: string
}

const emptyForm = (): CustomerForm => ({
  name: '',
  code: '',
  email: '',
  phone: '',
  address: '',
  gstNumber: '',
})

const getErrorMessage = (error: unknown, fallback: string) =>
  axios.isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message || fallback
    : fallback

const fetchCustomers = async (search = ''): Promise<Customer[]> => {
  const response = await api.get('/customers', {
    params: search.trim() ? { search: search.trim() } : undefined,
  })
  return response.data.data ?? []
}

const customerToForm = (customer: Customer): CustomerForm => ({
  name: customer.name,
  code: customer.code,
  email: customer.email ?? '',
  phone: customer.phone ?? '',
  address: customer.address ?? '',
  gstNumber: customer.gstNumber ?? '',
})

export default function CustomerManagement() {
  const { user } = useAuth()
  const canManage = user?.role === 'ADMIN'
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerForm>(emptyForm())

  const loadCustomers = async (query = search) => {
    setLoading(true)
    setError('')

    try {
      setCustomers(await fetchCustomers(query))
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to load customers. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true

    const loadInitialCustomers = async () => {
      try {
        const records = await fetchCustomers()
        if (isCurrent) setCustomers(records)
      } catch (requestError) {
        if (isCurrent) {
          setError(getErrorMessage(requestError, 'Unable to load customers. Please try again.'))
        }
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void loadInitialCustomers()

    return () => {
      isCurrent = false
    }
  }, [])

  const openCreate = () => {
    setEditingCustomer(null)
    setForm(emptyForm())
    setError('')
    setNotice('')
    setShowForm(true)
  }

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer)
    setForm(customerToForm(customer))
    setError('')
    setNotice('')
    setShowForm(true)
  }

  const closeForm = () => {
    if (saving) return
    setShowForm(false)
    setEditingCustomer(null)
  }

  const updateForm = (field: keyof CustomerForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const saveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')

    if (form.name.trim().length < 2 || form.code.trim().length < 2) {
      setError('Customer name and customer code must each contain at least two characters.')
      return
    }

    setSaving(true)
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      gstNumber: form.gstNumber.trim(),
    }

    try {
      if (editingCustomer) {
        await api.patch(`/customers/${editingCustomer.id}`, payload)
        setNotice('Customer updated. RFQ and quotation relationships were preserved.')
      } else {
        await api.post('/customers', payload)
        setNotice('Customer created successfully.')
      }

      setShowForm(false)
      setEditingCustomer(null)
      await loadCustomers()
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Unable to save customer details.'))
    } finally {
      setSaving(false)
    }
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void loadCustomers()
  }

  return (
    <section className="customers-page">
      <header className="customers-heading">
        <div>
          <span className="customers-eyebrow">MASTER DATA</span>
          <h1>Customers</h1>
          <p>Maintain the approved customer directory used for RFQs and quotations.</p>
        </div>
        {canManage && (
          <button type="button" className="customers-primary-button" onClick={openCreate}>
            <Plus size={16} /> Add customer
          </button>
        )}
      </header>

      {!canManage && (
        <div className="customers-read-only">
          <Building2 size={17} /> Customer records are managed by an administrator. You can search and select records for RFQs.
        </div>
      )}

      {error && !showForm && (
        <div className="customers-feedback error">
          <AlertCircle size={16} /><span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button>
        </div>
      )}
      {notice && (
        <div className="customers-feedback success">
          <CheckCircle2 size={16} /><span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <section className="customers-panel">
        <form className="customers-toolbar" onSubmit={handleSearch}>
          <div className="customers-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer name or code..."
              aria-label="Search customers"
            />
          </div>
          <button type="submit" className="customers-secondary-button" disabled={loading}>Search</button>
          <button type="button" className="customers-secondary-button" onClick={() => void loadCustomers()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'customers-spinning' : ''} /> Refresh
          </button>
        </form>

        {loading ? (
          <div className="customers-empty"><LoaderCircle className="customers-spinning" size={20} /> Loading customers...</div>
        ) : customers.length === 0 ? (
          <div className="customers-empty">
            <Building2 size={26} />
            <strong>No customers found</strong>
            <span>{search.trim() ? 'Try a different name or customer code.' : 'Add the first customer record to begin.'}</span>
          </div>
        ) : (
          <div className="customers-table-wrap">
            <table className="customers-table">
              <thead>
                <tr>
                  <th>Customer</th><th>Code</th><th>Contact</th><th>Address</th><th>GSTIN</th>
                  {canManage && <th className="customers-actions-heading">Action</th>}
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td><strong>{customer.name}</strong></td>
                    <td><span className="customers-code">{customer.code}</span></td>
                    <td><span>{customer.email || '—'}</span><small>{customer.phone || ''}</small></td>
                    <td className="customers-address">{customer.address || '—'}</td>
                    <td>{customer.gstNumber || '—'}</td>
                    {canManage && (
                      <td><button type="button" className="customers-edit-button" onClick={() => openEdit(customer)}><Pencil size={14} /> Edit</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showForm && (
        <div className="customers-modal-backdrop">
          <form className="customers-modal" onSubmit={saveCustomer}>
            <div className="customers-modal-heading">
              <div>
                <span className="customers-eyebrow">{editingCustomer ? 'EDIT CUSTOMER' : 'NEW CUSTOMER'}</span>
                <h2>{editingCustomer ? 'Update customer' : 'Create customer'}</h2>
              </div>
              <button type="button" className="customers-icon-button" onClick={closeForm} aria-label="Close form"><X size={19} /></button>
            </div>
            <p className="customers-form-note">Fields marked with an asterisk are required. Customer codes must be unique.</p>
            <div className="customers-form-grid">
              <label>Customer name *<input value={form.name} onChange={(event) => updateForm('name', event.target.value)} maxLength={150} required /></label>
              <label>Customer code *<input value={form.code} onChange={(event) => updateForm('code', event.target.value)} maxLength={30} pattern="[A-Za-z0-9_-]+" required /></label>
              <label>Email<input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} maxLength={150} /></label>
              <label>Phone<input value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} maxLength={20} /></label>
              <label>GSTIN<input value={form.gstNumber} onChange={(event) => updateForm('gstNumber', event.target.value)} maxLength={20} /></label>
              <label className="customers-address-field">Address<textarea rows={3} value={form.address} onChange={(event) => updateForm('address', event.target.value)} maxLength={500} /></label>
            </div>
            {error && <div className="customers-feedback error"><AlertCircle size={16} /><span>{error}</span></div>}
            <div className="customers-modal-actions">
              <button type="button" className="customers-secondary-button" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="submit" className="customers-primary-button" disabled={saving}>
                {saving ? <LoaderCircle className="customers-spinning" size={16} /> : <CheckCircle2 size={16} />}
                {saving ? 'Saving...' : editingCustomer ? 'Save changes' : 'Create customer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
