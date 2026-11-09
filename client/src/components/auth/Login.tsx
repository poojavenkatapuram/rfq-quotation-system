import { useState } from 'react'
import { Factory, LockKeyhole } from 'lucide-react'
import { useAuth } from '../../context/auth-context'
import './Login.css'

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email.trim(), password)
    } catch (requestError) {
      const message =
        typeof requestError === 'object' &&
        requestError !== null &&
        'response' in requestError
          ? (requestError as {
              response?: { data?: { message?: string } }
            }).response?.data?.message
          : undefined

      setError(message || 'Unable to sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <div className="login-brand-icon">
            <Factory size={25} />
          </div>
          <div>
            <h1>ForgeFlow</h1>
            <span>RFQ MANAGEMENT</span>
          </div>
        </div>

        <div className="login-heading">
          <div className="login-lock-icon">
            <LockKeyhole size={22} />
          </div>
          <span className="login-eyebrow">SECURE WORKSPACE</span>
          <h2>Welcome back</h2>
          <p>Sign in to access your RFQ management workspace.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <label htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="login-footer">
          Access is managed by your system administrator.
        </p>
      </section>
    </main>
  )
}
