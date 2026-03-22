import { supabase } from './supabase.js'

const oauthBox = document.getElementById('oauthBox')
const loginBox = document.getElementById('loginBox')
const registerBox = document.getElementById('registerBox')

let isRegistering = false

// ── Navigation ─────────────────────────────────────────────────────────────
document.getElementById('showEmailLogin').onclick = () => { oauthBox.classList.add('hidden'); loginBox.classList.remove('hidden') }
document.getElementById('backToOauth').onclick = () => { loginBox.classList.add('hidden'); oauthBox.classList.remove('hidden') }
document.getElementById('showRegister').onclick = () => { loginBox.classList.add('hidden'); registerBox.classList.remove('hidden') }
document.getElementById('showLogin').onclick = () => { registerBox.classList.add('hidden'); loginBox.classList.remove('hidden') }

// ── OAuth ──────────────────────────────────────────────────────────────────
document.getElementById('googleBtn').onclick = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/unreal-cord/index.html' }
  })
  if (error) showError('oauthError', error.message)
}

document.getElementById('githubBtn').onclick = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin + '/unreal-cord/index.html' }
  })
  if (error) showError('oauthError', error.message)
}

// ── Email Login ────────────────────────────────────────────────────────────
document.getElementById('loginBtn').onclick = async () => {
  hideError('authError')
  const btn = document.getElementById('loginBtn')
  const email = document.getElementById('loginEmail').value.trim()
  const password = document.getElementById('loginPassword').value
  if (!email || !password) return showError('authError', 'Please fill in all fields.')

  btn.textContent = 'Signing in...'
  btn.disabled = true
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  btn.textContent = 'Log In'
  btn.disabled = false

  if (error) return showError('authError', error.message)
  window.location.href = 'index.html'
}

// ── Register ───────────────────────────────────────────────────────────────
document.getElementById('registerBtn').onclick = async () => {
  hideError('regError')
  const btn = document.getElementById('registerBtn')
  const email = document.getElementById('regEmail').value.trim()
  const username = document.getElementById('regUsername').value.trim()
  const password = document.getElementById('regPassword').value

  if (!email || !username || !password) return showError('regError', 'Please fill in all fields.')
  if (username.length < 2) return showError('regError', 'Username must be at least 2 characters.')
  if (password.length < 6) return showError('regError', 'Password must be at least 6 characters.')

  btn.textContent = 'Creating account...'
  btn.disabled = true
  isRegistering = true

  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } })

  btn.textContent = 'Create Account'
  btn.disabled = false

  if (error) {
    isRegistering = false
    return showError('regError', error.message)
  }

  if (data.user) {
    await ensureProfile(data.user, username)
    isRegistering = false

    // Supabase may require email confirmation — handle both cases
    if (data.session) {
      window.location.href = 'index.html'
    } else {
      showToast('Check your email to confirm your account, then log in.', 'success')
      registerBox.classList.add('hidden')
      loginBox.classList.remove('hidden')
      document.getElementById('loginEmail').value = email
    }
  }
}

// ── Profile helper ─────────────────────────────────────────────────────────
async function ensureProfile(user, username) {
  const colors = ['#5865f2','#eb459e','#ed4245','#57f287','#1abc9c','#e67e22']
  const color = colors[Math.floor(Math.random() * colors.length)]
  const name = username || user.user_metadata?.full_name || user.user_metadata?.user_name || user.email.split('@')[0]
  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    username: name,
    avatar_color: color,
    status: 'online'
  }, { onConflict: 'id' })
  if (error) console.error('Profile upsert error:', error.message)
}

// ── OAuth redirect handler ─────────────────────────────────────────────────
supabase.auth.onAuthStateChange(async (event, session) => {
  if (isRegistering) return // don't interfere with email register flow
  if (event === 'SIGNED_IN' && session) {
    await ensureProfile(session.user, null)
    window.location.href = 'index.html'
  }
})

// ── Already logged in ──────────────────────────────────────────────────────
supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = 'index.html'
})

// ── Helpers ────────────────────────────────────────────────────────────────
function showError(id, msg) {
  const el = document.getElementById(id)
  el.textContent = msg
  el.classList.remove('hidden')
}
function hideError(id) { document.getElementById(id).classList.add('hidden') }

function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className = `toast ${type}`
  t.textContent = msg
  document.getElementById('toastContainer').appendChild(t)
  setTimeout(() => t.remove(), 4000)
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return
  if (!loginBox.classList.contains('hidden')) document.getElementById('loginBtn').click()
  else if (!registerBox.classList.contains('hidden')) document.getElementById('registerBtn').click()
})
