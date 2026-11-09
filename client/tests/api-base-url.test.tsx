import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl } from '../src/services/api-base-url'

describe('API base URL configuration', () => {
  it('keeps the local development default', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('http://localhost:5000/api')
  })

  it('requires a hosted HTTPS API URL in production', () => {
    expect(() => resolveApiBaseUrl(undefined, true)).toThrow('VITE_API_BASE_URL')
    expect(() => resolveApiBaseUrl('http://api.example.com/api', true)).toThrow('safe URL')
    expect(() => resolveApiBaseUrl('https://api.example.com', true)).toThrow('end in /api')
  })

  it('accepts an HTTPS API URL ending in /api without URL credentials or query values', () => {
    expect(resolveApiBaseUrl('https://api.example.com/api/', true)).toBe('https://api.example.com/api')
    expect(() => resolveApiBaseUrl('https://user:secret@api.example.com/api', true)).toThrow('safe URL')
    expect(() => resolveApiBaseUrl('https://api.example.com/api?token=secret', true)).toThrow('safe URL')
  })
})
