import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
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
