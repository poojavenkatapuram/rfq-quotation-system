import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings, { CompanySettingsForm } from '../src/components/settings/Settings'
import type { CompanySettingsData } from '../src/components/settings/Settings'
import { AuthContext } from '../src/context/auth-context'
import type { AuthContextValue, AuthUser } from '../src/context/auth-context'
import api from '../src/services/api'

const interaction = vi.hoisted(() => ({ submit: false }))
vi.mock('../src/services/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }))
vi.mock('react/jsx-dev-runtime', async importOriginal => {
  const runtime = await importOriginal<typeof import('react/jsx-dev-runtime')>()
  const jsxDEV: typeof runtime.jsxDEV = (type, props, ...rest) => {
    if (type === 'form' && interaction.submit) {
      interaction.submit = false
      const form = props as { onSubmit?: (event: { preventDefault: () => void }) => void }
      form.onSubmit?.({ preventDefault: () => undefined })
    }
    return runtime.jsxDEV(type, props, ...rest)
  }
  return { ...runtime, jsxDEV }
})
vi.mock('react/jsx-runtime', async importOriginal => {
  const runtime = await importOriginal<typeof import('react/jsx-runtime')>()
  const wrap = (factory: typeof runtime.jsx): typeof runtime.jsx => (type, props, key) => {
    if (type === 'form' && interaction.submit) {
      interaction.submit = false
      const form = props as { onSubmit?: (event: { preventDefault: () => void }) => void }
      form.onSubmit?.({ preventDefault: () => undefined })
    }
    return factory(type, props, key)
  }
  return { ...runtime, jsx: wrap(runtime.jsx), jsxs: wrap(runtime.jsxs) }
})

const settings: CompanySettingsData = { company: { name: 'ForgeFlow Manufacturing', address: 'Registered office, Pune', email: 'quotes@example.com', phone: '+91 9876543210', gstNumber: '27ABCDE1234F1Z5' }, version: 2, source: 'database', updatedAt: '2026-11-09T00:00:00Z' }
const props = () => ({ settings, loading: false, saving: false, needsReload: false, errors: {}, error: '', notice: '', onSave: vi.fn().mockResolvedValue(undefined), onReload: vi.fn() })
beforeEach(() => { vi.clearAllMocks(); interaction.submit = false })

function page(role: AuthUser['role']) {
  const value: AuthContextValue = { user: { id: 'actor', name: 'Actor', email: 'actor@example.com', role }, token: 'test-token', isLoading: false, login: vi.fn(), logout: vi.fn() }
  return renderToStaticMarkup(createElement(AuthContext.Provider, { value }, createElement(Settings)))
}

describe('Admin Company Settings', () => {
  it.each(['ESTIMATOR', 'PLANT_HEAD', 'SALES_HEAD'] as const)('shows no editable fields or settings requests to %s', role => {
    const html = page(role)
    expect(html).toContain('Only administrators can manage company details')
    expect(html).not.toContain('<form')
    expect(api.get).not.toHaveBeenCalled()
    expect(api.put).not.toHaveBeenCalled()
  })
  it('shows a loading state for the Admin page', () => {
    expect(page('ADMIN')).toContain('Loading company details...')
  })
  it('renders the five real profile fields and the historical preservation notice', () => {
    const html = renderToStaticMarkup(createElement(CompanySettingsForm, props()))
    for (const label of ['Company name', 'Registered address', 'Contact email', 'Contact phone', 'GSTIN', 'Version 2', 'Existing approved quotations']) expect(html).toContain(label)
    expect(html).toContain('quotes@example.com')
    expect(html).toContain('27ABCDE1234F1Z5')
  })
  it('submits the loaded optimistic version with the actual form values', () => {
    const value = props(); interaction.submit = true
    renderToStaticMarkup(createElement(CompanySettingsForm, value))
    expect(value.onSave).toHaveBeenCalledWith({ ...settings.company, expectedVersion: 2 })
  })
  it('displays an unconfigured profile without inventing company details', () => {
    const value = props()
    value.settings = { company: { name: null, address: null, email: null, phone: null, gstNumber: null }, version: 0, source: 'unconfigured', updatedAt: null }
    const html = renderToStaticMarkup(createElement(CompanySettingsForm, value))
    expect(html).toContain('Company details have not been configured')
    expect(html).not.toContain('ForgeFlow Manufacturing')
  })
  it('announces a save success', () => {
    const html = renderToStaticMarkup(createElement(CompanySettingsForm, { ...props(), notice: 'Company details saved.' }))
    expect(html).toContain('role="status">Company details saved.')
  })
  it('shows validation errors next to accessible invalid fields', () => {
    const html = renderToStaticMarkup(createElement(CompanySettingsForm, { ...props(), error: 'Invalid company details', errors: { email: ['Invalid email'] } }))
    expect(html).toContain('role="alert">Invalid company details')
    expect(html).toContain('aria-invalid="true" aria-describedby="company-email-error"')
    expect(html).toContain('id="company-email-error">Invalid email')
  })
  it('blocks stale submissions while preserving entered details and explaining explicit reload', () => {
    const value = { ...props(), needsReload: true, error: 'Company details changed in another session.' }
    interaction.submit = true
    const html = renderToStaticMarkup(createElement(CompanySettingsForm, value))
    expect(html).toContain('Your edits remain below')
    expect(html).toContain('value="ForgeFlow Manufacturing"')
    expect(html).toContain('disabled="">Save company details')
    expect(html).toContain('Reload saved details (replace edits)')
    expect(value.onSave).not.toHaveBeenCalled()
  })
  it('disables repeated form submissions while saving', () => {
    const value = { ...props(), saving: true }
    interaction.submit = true
    const html = renderToStaticMarkup(createElement(CompanySettingsForm, value))
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Saving...')
    expect(value.onSave).not.toHaveBeenCalled()
  })
})
