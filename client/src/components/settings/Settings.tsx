import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import axios from 'axios'
import api from '../../services/api'
import { useAuth } from '../../context/auth-context'
import './Settings.css'

type CompanyFields = { name: string; address: string; email: string; phone: string; gstNumber: string }
export type CompanySettingsData = {
  company: { [Field in keyof CompanyFields]: string | null }
  version: number
  source: 'database' | 'environment' | 'unconfigured'
  updatedAt: string | null
}
type FieldErrors = Partial<Record<keyof CompanyFields | 'expectedVersion', string[]>>
type SavePayload = CompanyFields & { expectedVersion: number }

type FormProps = {
  settings: CompanySettingsData
  saving: boolean
  loading: boolean
  error: string
  notice: string
  errors: FieldErrors
  needsReload: boolean
  onSave: (payload: SavePayload) => Promise<void>
  onReload: () => void
}

export function CompanySettingsForm({ settings, saving, loading, error, notice, errors, needsReload, onSave, onReload }: FormProps) {
  const [draft, setDraft] = useState<CompanyFields>(() => ({
    name: settings.company.name ?? '', address: settings.company.address ?? '',
    email: settings.company.email ?? '', phone: settings.company.phone ?? '', gstNumber: settings.company.gstNumber ?? '',
  }))
  const busy = saving || loading
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || needsReload) return
    void onSave({ ...draft, expectedVersion: settings.version })
  }
  const field = (name: keyof CompanyFields, label: string, maxLength: number, type = 'text', required = false) => {
    const id = `company-${name}`
    return <label className="settings-field" key={name} htmlFor={id}>
      <span>{label}{required ? ' *' : ''}</span>
      <input id={id} name={name} type={type} value={draft[name]} required={required} minLength={required ? 2 : undefined} maxLength={maxLength}
        autoComplete={name === 'name' ? 'organization' : name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'off'}
        aria-invalid={Boolean(errors[name]?.length)} aria-describedby={errors[name]?.length ? `${id}-error` : undefined}
        onChange={event => setDraft(current => ({ ...current, [name]: name === 'gstNumber' ? event.target.value.toUpperCase() : event.target.value }))} />
      {errors[name]?.length ? <span className="settings-field-error" id={`${id}-error`}>{errors[name]!.join(' ')}</span> : null}
    </label>
  }

  return <form className="settings-card" onSubmit={submit} aria-label="Company details" aria-busy={busy}>
    <h2>Company details</h2>
    <p>Changes apply to future quotation approvals. Existing approved quotations and their PDF content remain unchanged.</p>
    <p className="settings-source">{settings.source === 'database' ? `Saved company profile · Version ${settings.version}` : settings.source === 'environment' ? 'Using environment defaults. Save to manage company details here.' : 'Company details have not been configured.'}
      {settings.updatedAt && ` · Updated ${new Date(settings.updatedAt).toLocaleString('en-IN')}`}</p>
    {loading && <p role="status">Loading saved company details...</p>}
    {error && <div className="settings-error" role="alert">{error}</div>}
    {notice && <div className="settings-success" role="status">{notice}</div>}
    {needsReload && <p>Your edits remain below. Reloading saved details will replace them with the current profile.</p>}
    <fieldset disabled={busy}>
      <legend className="settings-sr-only">Company profile fields</legend>
      {field('name', 'Company name', 200, 'text', true)}
      <label className="settings-field" htmlFor="company-address"><span>Registered address *</span>
        <textarea id="company-address" name="address" value={draft.address} required minLength={5} maxLength={2000} rows={4} autoComplete="street-address"
          aria-invalid={Boolean(errors.address?.length)} aria-describedby={errors.address?.length ? 'company-address-error' : undefined}
          onChange={event => setDraft(current => ({ ...current, address: event.target.value }))} />
        {errors.address?.length ? <span className="settings-field-error" id="company-address-error">{errors.address.join(' ')}</span> : null}
      </label>
      <div className="settings-grid">{field('email', 'Contact email', 254, 'email')}{field('phone', 'Contact phone', 32, 'tel')}</div>
      {field('gstNumber', 'GSTIN', 15)}
      <p className="settings-help">Contact fields and GSTIN are optional. Phone: 7–15 digits, without an extension. GSTIN is checked for format only.</p>
    </fieldset>
    <div className="settings-actions">
      <button type="submit" disabled={busy || needsReload}>{saving ? 'Saving...' : 'Save company details'}</button>
      <button type="button" className="settings-secondary" disabled={busy} onClick={onReload}>Reload saved details (replace edits)</button>
    </div>
  </form>
}

function CompanySettingsPanel() {
  const [settings, setSettings] = useState<CompanySettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [needsReload, setNeedsReload] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    let current = true
    api.get('/settings/company').then(response => {
      if (current) setSettings(response.data.data)
    }).catch(() => { if (current) setError('Unable to load company details. Please retry.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  const reload = async () => {
    setLoading(true); setError(''); setNotice('')
    try {
      const response = await api.get('/settings/company')
      setSettings(response.data.data); setErrors({}); setNeedsReload(false); setLoadKey(key => key + 1)
    } catch { setError('Unable to load company details. Your edits have been preserved; please retry.') }
    finally { setLoading(false) }
  }
  const save = async (payload: SavePayload) => {
    setSaving(true); setError(''); setNotice(''); setErrors({})
    try {
      const response = await api.put('/settings/company', payload)
      setSettings(response.data.data); setNeedsReload(false)
      setNotice('Company details saved. Existing approved quotations remain unchanged.')
    } catch (failure) {
      if (axios.isAxiosError<{ message?: string; errors?: { fieldErrors?: FieldErrors } }>(failure)) {
        setError(failure.response?.data?.message || 'Unable to confirm the save. Reload saved details to verify before retrying.')
        setErrors(failure.response?.data?.errors?.fieldErrors ?? {})
        if (failure.response?.status === 409) setNeedsReload(true)
      } else { setError('Unable to confirm the save. Reload saved details to verify before retrying.') }
    } finally { setSaving(false) }
  }

  return <section className="settings-page"><h1>Settings</h1>
    {!settings ? <div className="settings-card">
      {loading ? <p role="status">Loading company details...</p> : <><p className="settings-error" role="alert">{error}</p><button type="button" onClick={() => void reload()}>Retry</button></>}
    </div> : <CompanySettingsForm key={`${settings.version}:${loadKey}`} settings={settings} saving={saving} loading={loading} error={error} notice={notice} errors={errors} needsReload={needsReload} onSave={save} onReload={() => void reload()} />}
  </section>
}

export default function Settings() {
  const { user } = useAuth()
  if (user?.role !== 'ADMIN') return <section className="settings-page"><h1>Settings</h1><p role="alert">Only administrators can manage company details.</p></section>
  return <CompanySettingsPanel key={user.id} />
}
