import { Children, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const interaction = vi.hoisted(() => ({ openNewQuotation: false, opened: false }))

vi.mock('../src/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof import('react/jsx-runtime')>()
  const withInteraction = (factory: typeof runtime.jsx): typeof runtime.jsx => (type, props, key) => {
    const button = props as { children?: import('react').ReactNode; onClick?: () => void }
    if (type === 'button' && interaction.openNewQuotation &&
        Children.toArray(button.children).some(child => typeof child === 'string' && child.trim() === 'New quotation')) {
      // Invoke the real button handler during render so React's renderer applies
      // the actual state updates and renders the modal, without a DOM dependency.
      interaction.openNewQuotation = false
      interaction.opened = true
      button.onClick?.()
    }
    return factory(type, props, key)
  }
  return { ...runtime, jsx: withInteraction(runtime.jsx), jsxs: withInteraction(runtime.jsxs) }
})

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof import('react/jsx-dev-runtime')>()
  const jsxDEV: typeof runtime.jsxDEV = (type, props, ...rest) => {
    const button = props as { children?: import('react').ReactNode; onClick?: () => void }
    if (type === 'button' && interaction.openNewQuotation &&
        Children.toArray(button.children).some(child => typeof child === 'string' && child.trim() === 'New quotation')) {
      interaction.openNewQuotation = false
      interaction.opened = true
      button.onClick?.()
    }
    return runtime.jsxDEV(type, props, ...rest)
  }
  return { ...runtime, jsxDEV }
})

import Quotation from '../src/components/quotations/Quotation'
import api from '../src/services/api'

beforeEach(() => {
  interaction.openNewQuotation = false
  interaction.opened = false
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ role: 'ESTIMATOR' }) })
})
afterEach(() => vi.unstubAllGlobals())

describe('New quotation modal', () => {
  it('starts with no selected quotation and no open modal', () => {
    const html = renderToStaticMarkup(createElement(Quotation))
    expect(html).toContain('New quotation')
    expect(html).not.toContain('<h2>Create quotation</h2>')
    expect(html).not.toContain('QUOTATION DETAILS')
  })

  it('opens New quotation without a selected quotation and shows the creation form', () => {
    interaction.openNewQuotation = true
    const html = renderToStaticMarkup(createElement(Quotation))
    expect(interaction.opened).toBe(true)
    expect(html).toContain('<h2>Create quotation</h2>')
    expect(html).toContain('Choose an RFQ')
    expect(html).toContain('GST percentage')
    expect(html).toContain('Plant Head approval of each current routing revision')
    expect(html).toContain('disabled="">Create quotation</button>')
    expect(html).not.toContain('QUOTATION DETAILS')
    expect(api.post).not.toHaveBeenCalled()
  })
})
