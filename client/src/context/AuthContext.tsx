import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import api from '../services/api'
import { AuthContext } from './auth-context'
import type { AuthUser } from './auth-context'

function clearSession() {
  localStorage.removeItem('rfq_token')
  localStorage.removeItem('rfq_user')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('rfq_token'),
  )
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const logout = useCallback(() => {
    clearSession()
    setToken(null)
    setUser(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password })
    const data = response.data.data

    localStorage.setItem('rfq_token', data.token)
    localStorage.setItem('rfq_user', JSON.stringify(data.user))

    setToken(data.token)
    setUser(data.user)
  }, [])

  useEffect(() => {
    window.addEventListener('rfq:unauthorized', logout)

    return () => {
      window.removeEventListener('rfq:unauthorized', logout)
    }
  }, [logout])

  useEffect(() => {
    let cancelled = false

    const verifySession = async () => {
      const savedToken = localStorage.getItem('rfq_token')

      if (!savedToken) {
        clearSession()
        setToken(null)
        setUser(null)
        setIsLoading(false)
        return
      }

      try {
        const response = await api.get('/auth/me')

        if (!cancelled) {
          const currentUser = response.data.data.user as AuthUser
          localStorage.setItem('rfq_user', JSON.stringify(currentUser))
          setToken(savedToken)
          setUser(currentUser)
        }
      } catch {
        if (!cancelled) {
          clearSession()
          setToken(null)
          setUser(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void verifySession()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
