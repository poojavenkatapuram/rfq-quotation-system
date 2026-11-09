const LOCAL_API_BASE_URL = 'http://localhost:5000/api'

export function resolveApiBaseUrl(
  configuredValue: string | undefined,
  isProduction: boolean,
): string {
  const value = configuredValue?.trim()
  if (!value) {
    if (isProduction) {
      throw new Error('VITE_API_BASE_URL must be set to the deployed HTTPS API URL ending in /api')
    }
    return LOCAL_API_BASE_URL
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('VITE_API_BASE_URL must be a valid absolute URL')
  }

  const apiPath = url.pathname.replace(/\/+$/, '')
  if (
    (url.protocol !== 'https:' && (isProduction || url.protocol !== 'http:')) ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error('VITE_API_BASE_URL must use a safe URL ending in /api')
  }
  if (isProduction && !apiPath.endsWith('/api')) {
    throw new Error('VITE_API_BASE_URL must end in /api in production')
  }

  return value.replace(/\/+$/, '')
}
