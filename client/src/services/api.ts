import axios from 'axios'
import { resolveApiBaseUrl } from './api-base-url'

const api = axios.create({
  baseURL: resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD),
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rfq_token')

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isUnauthorized = error.response?.status === 401
    const isLoginRequest = error.config?.url?.includes('/auth/login')

    if (isUnauthorized && !isLoginRequest) {
      localStorage.removeItem('rfq_token')
      localStorage.removeItem('rfq_user')
      window.dispatchEvent(new Event('rfq:unauthorized'))
    }

    return Promise.reject(error)
  },
)

export default api
