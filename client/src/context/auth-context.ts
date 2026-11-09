import { createContext, useContext } from 'react'

export type AuthUser = {
  id: string
  name: string
  email: string
  role: 'ESTIMATOR' | 'SALES_HEAD' | 'PLANT_HEAD' | 'ADMIN'
}

export type AuthContextValue = {
  user: AuthUser | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return context
}
