import { supabase } from './supabase.js'

let adminUser = null
let allUsers = []

// ── Auth ───────────────────────────────────────────────────────────────────
document.getElementById('adminLoginBtn').onclick = async () => {
  const email = document.getElementById('adminEmail').value.trim()
  const password = document.getElementById('adminPassword').value
  const err = document.getElementById('adminError')
  err.classList.add('hidden')

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) { err.textContent = error.message; err.classList.remove('hidden'); return }

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
  if (!profile?.is_admin) {
    await supabase.auth.signOut()
    err.textContent = 'Access denied. Admin only.'
    err.classList.remove('hidden')
    return
  }

  adminUser = data.user
  document.getElementById('adminLogin').style.display = 'none'
  document.getElementById('adminContent').style.display = 'block'
  loadDashboard()
}

window.adminLogout = async () => {
  await supabase.auth.signOut()
  window.location.reload()
}

// Check existing session
supabase.auth.getSession().then(async ({ data }) => {
  if (!data.session) return
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.session.user.id).single()
  if (profile?.is_admin) {
    adminUser = data.session.user
    document.getElementById('adminLogin').style.display = 'none'
    document.getElementById('adminContent').style.display = 'block'
    loadDashboard()
  }
})

// ── Tabs ───────────────────────────────────────────────────────────────────
window.showTab = function(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
  document.getElementById('tab-' + tab).classList.add('active')
  document.querySelectorAll('.admin-nav a').forEach((a, i) => {
    a.classList.toggle('active', a.getAttribute('onclick')?.includes(tab))
  })
  if (tab === 'dashboard') loadDashboard()
  else if (tab === 'users') loadUsers()
  else if (tab === 'servers') loadServers()
  else if (tab === 'messages') loadMessages()
  else if (tab === 'channels') loadChannels()
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  const [{ count: userCount }, { count: serverCount }, { count: msgCount }, { count: chCount }] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('servers').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('channels').select('*', { count: 'exact', head: true })
  ])

  document.getElementById('statsGrid').innerHTML = [
    { label: 'Total Users', value: userCount || 0, icon: '👥' },
    { label: 'Servers', value: serverCount || 0, icon: '🖥️' },
    { label: 'Messages', value: msgCount || 0, icon: '💬' },
    { label: 'Channels', value: chCount || 0, icon: '📢' }
  ].map(s => `<div class="stat-card"><div style="font-size:24px">${s.icon}</div><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`).join('')

  const { data: recent } = await supabase.from('messages').select('*, profiles(username)').order('created_at', { ascending: false }).limit(10)
  document.getElementById('recentActivity').innerHTML = `
    <table class="admin-table">
      <thead><tr><th>User</th><th>Message</th><th>Time</th></tr></thead>
      <tbody>${(recent||[]).map(m => `<tr><td>${m.profiles?.username||'?'}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.content||''}</td><td style="color:var(--text-muted)">${new Date(m.created_at).toLocaleString()}</td></tr>`).join('')}</tbody>
    </table>`
}

// ── Users ──────────────────────────────────────────────────────────────────
async function loadUsers() {
  const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
  allUsers = data || []
  renderUsers(allUsers)
}

function renderUsers(users) {
  document.getElementById('usersBody').innerHTML = users.map(u => `
    <tr>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="width:32px;height:32px;border-radius:50%;background:${u.avatar_color||'#5865f2'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${u.username?.[0]?.toUpperCase()||'?'}</div>
        <div><div style="font-weight:600">${u.username||'Unknown'}</div>${u.is_admin?'<span class="badge badge-blue">Admin</span>':''}</div>
      </div></td>
      <td style="color:var(--text-muted)">${u.id.slice(0,8)}...</td>
      <td><span class="badge ${u.status==='online'?'badge-green':'badge-red'}">${u.status||'offline'}</span></td>
      <td style="color:var(--text-muted)">${u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}</td>
      <td style="display:flex;gap:6px">
        <button class="action-btn primary" onclick="toggleAdmin('${u.id}',${!!u.is_admin})">${u.is_admin?'Remove Admin':'Make Admin'}</button>
        <button class="action-btn danger" onclick="banUser('${u.id}','${u.username}')">Ban</button>
      </td>
    </tr>`).join('')
}

window.filterUsers = function() {
  const q = document.getElementById('userSearch').value.toLowerCase()
  renderUsers(allUsers.filter(u => u.username?.toLowerCase().includes(q)))
}

window.toggleAdmin = async function(userId, isAdmin) {
  await supabase.from('profiles').update({ is_admin: !isAdmin }).eq('id', userId)
  loadUsers()
  showToast(!isAdmin ? 'Admin granted' : 'Admin removed', 'success')
}

window.banUser = async function(userId, username) {
  if (!confirm(`Ban ${username}?`)) return
  await supabase.from('profiles').update({ banned: true, status: 'offline' }).eq('id', userId)
  loadUsers()
  showToast(`${username} banned`, 'error')
}

// ── Servers ────────────────────────────────────────────────────────────────
async function loadServers() {
  const { data } = await supabase.from('servers').select('*, profiles(username)').order('created_at', { ascending: false })
  const { data: memberCounts } = await supabase.from('server_members').select('server_id')
  const counts = {}
  memberCounts?.forEach(m => { counts[m.server_id] = (counts[m.server_id] || 0) + 1 })

  document.getElementById('serversBody').innerHTML = (data||[]).map(s => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.profiles?.username||'Unknown'}</td>
      <td>${counts[s.id]||0}</td>
      <td style="color:var(--text-muted)">${new Date(s.created_at).toLocaleDateString()}</td>
      <td><button class="action-btn danger" onclick="deleteServer('${s.id}','${s.name}')">Delete</button></td>
    </tr>`).join('')
}

window.deleteServer = async function(id, name) {
  if (!confirm(`Delete server "${name}"?`)) return
  await supabase.from('servers').delete().eq('id', id)
  loadServers()
  showToast(`Server deleted`, 'error')
}

// ── Messages ───────────────────────────────────────────────────────────────
async function loadMessages() {
  const { data } = await supabase.from('messages').select('*, profiles(username), channels(name)').order('created_at', { ascending: false }).limit(100)
  document.getElementById('messagesBody').innerHTML = (data||[]).map(m => `
    <tr>
      <td>${m.profiles?.username||'?'}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.content||''}</td>
      <td style="color:var(--text-muted)">${m.channels?.name||'DM'}</td>
      <td style="color:var(--text-muted)">${new Date(m.created_at).toLocaleString()}</td>
      <td><button class="action-btn danger" onclick="deleteMsg('${m.id}')">Delete</button></td>
    </tr>`).join('')
}

window.deleteMsg = async function(id) {
  await supabase.from('messages').delete().eq('id', id)
  loadMessages()
  showToast('Message deleted', 'error')
}

// ── Channels ───────────────────────────────────────────────────────────────
async function loadChannels() {
  const { data } = await supabase.from('channels').select('*, servers(name)').order('created_at', { ascending: false })
  document.getElementById('channelsBody').innerHTML = (data||[]).map(c => `
    <tr>
      <td>#${c.name}</td>
      <td><span class="badge badge-blue">${c.type}</span></td>
      <td>${c.servers?.name||'?'}</td>
      <td style="color:var(--text-muted)">${c.topic||'—'}</td>
      <td><button class="action-btn danger" onclick="deleteChannel('${c.id}')">Delete</button></td>
    </tr>`).join('')
}

window.deleteChannel = async function(id) {
  await supabase.from('channels').delete().eq('id', id)
  loadChannels()
  showToast('Channel deleted', 'error')
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer')
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.textContent = msg
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 3500)
}
