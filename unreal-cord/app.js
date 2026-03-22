import { supabase } from './supabase.js'

const ADMIN_UUID = 'd0de9c14-6ff8-416d-8bdf-8e22adfbadc3'

// ── State ──────────────────────────────────────────────────────────────────
let currentUser = null, currentProfile = null
let currentServer = null, currentChannel = null, currentDM = null
let servers = [], channels = [], members = [], messages = []
let replyingTo = null, muted = false, deafened = false
let msgSub = null, typingSub = null, typingTimer = null
let adminPanelOpen = false

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return (window.location.href = 'auth.html')
  currentUser = session.user

  let { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single()
  if (!profile) {
    const colors = ['#5865f2','#eb459e','#ed4245','#57f287','#1abc9c']
    const username = currentUser.user_metadata?.full_name || currentUser.user_metadata?.user_name || currentUser.email.split('@')[0]
    await supabase.from('profiles').upsert({ id: currentUser.id, username, avatar_color: colors[0], status: 'online' })
    profile = { id: currentUser.id, username, avatar_color: colors[0], status: 'online' }
  } else {
    await supabase.from('profiles').update({ status: 'online' }).eq('id', currentUser.id)
    profile.status = 'online'
  }
  currentProfile = profile

  // Force admin for the designated UUID
  if (currentUser.id === ADMIN_UUID && !profile.is_admin) {
    await supabase.from('profiles').update({ is_admin: true }).eq('id', currentUser.id)
    currentProfile.is_admin = true
  }

  renderUserPanel()
  setupEventListeners()
  await loadServers()
  document.getElementById('app').classList.remove('hidden')

  if (currentUser.id === ADMIN_UUID) {
    document.getElementById('adminToggleBtn').style.display = 'flex'
  }

  window.addEventListener('beforeunload', () => {
    supabase.from('profiles').update({ status: 'offline' }).eq('id', currentUser.id)
  })
}

// ── User Panel ─────────────────────────────────────────────────────────────
function renderUserPanel() {
  document.getElementById('myUsername').textContent = currentProfile.username
  document.getElementById('myTag').textContent = '#' + currentUser.id.slice(0, 4).toUpperCase()
  const av = document.getElementById('myAvatar')
  av.style.background = currentProfile.avatar_color || '#5865f2'
  document.getElementById('myAvatarText').textContent = currentProfile.username[0].toUpperCase()
  const dot = document.getElementById('myStatusDot')
  dot.className = 'status-dot s-' + (currentProfile.status || 'online')
}

// ── Servers ────────────────────────────────────────────────────────────────
async function loadServers() {
  const { data } = await supabase.from('server_members').select('server_id, servers(*)').eq('user_id', currentUser.id)
  servers = data?.map(d => d.servers).filter(Boolean) || []
  renderServerIcons()
  if (servers.length > 0) await selectServer(servers[0])
  else renderDMView()
}

function renderServerIcons() {
  const c = document.getElementById('serverIcons')
  c.innerHTML = ''
  servers.forEach(s => {
    const el = document.createElement('div')
    el.className = 'server-icon' + (currentServer?.id === s.id ? ' active' : '')
    el.innerHTML = s.icon
      ? `<img src="${s.icon}" alt="${s.name}" />`
      : `<span style="font-size:16px;font-weight:800">${s.name[0].toUpperCase()}</span>`
    el.innerHTML += `<span class="server-tooltip">${s.name}</span>`
    el.onclick = () => selectServer(s)
    el.oncontextmenu = e => showServerContextMenu(e, s)
    c.appendChild(el)
  })
}

async function selectServer(server) {
  currentServer = server
  currentDM = null
  document.getElementById('serverName').textContent = server.name
  document.getElementById('dmServerBtn').classList.remove('active')
  document.getElementById('sidebarSearch').innerHTML = `<span>🔍</span><span style="font-size:13px">Search channels</span>`
  renderServerIcons()
  await Promise.all([loadChannels(server.id), loadMembers(server.id)])
}

// ── Channels ───────────────────────────────────────────────────────────────
async function loadChannels(serverId) {
  const { data } = await supabase.from('channels').select('*').eq('server_id', serverId).order('position')
  channels = data || []
  renderChannelList()
  const first = channels.find(c => c.type === 'text')
  if (first) await selectChannel(first)
}

function renderChannelList() {
  const list = document.getElementById('channelList')
  list.innerHTML = ''
  const cats = {}
  channels.forEach(ch => { const c = ch.category || 'CHANNELS'; if (!cats[c]) cats[c] = []; cats[c].push(ch) })

  Object.entries(cats).forEach(([cat, chs]) => {
    const catEl = document.createElement('div')
    catEl.className = 'channel-category'
    catEl.innerHTML = `<span>▸ ${cat}</span><span class="add-ch" onclick="openCreateChannelModal()" title="Create Channel">＋</span>`
    list.appendChild(catEl)
    chs.forEach(ch => {
      const el = document.createElement('div')
      el.className = 'channel-item' + (currentChannel?.id === ch.id ? ' active' : '')
      const icon = ch.type === 'voice' ? '🔊' : ch.type === 'announcement' ? '📢' : '#'
      el.innerHTML = `
        <span class="ch-icon">${icon}</span>
        <span class="ch-name">${ch.name}</span>
        <div class="ch-actions">
          <button class="ch-action-btn" onclick="event.stopPropagation();openEditChannelModal('${ch.id}')" title="Edit">✏️</button>
          <button class="ch-action-btn" onclick="event.stopPropagation();deleteChannel('${ch.id}')" title="Delete">🗑️</button>
        </div>`
      el.onclick = () => ch.type === 'voice' ? joinVoice(ch) : selectChannel(ch)
      el.oncontextmenu = e => showChannelContextMenu(e, ch)
      list.appendChild(el)
    })
  })
}

async function selectChannel(ch) {
  currentChannel = ch
  currentDM = null
  document.getElementById('chatIcon').textContent = ch.type === 'voice' ? '🔊' : ch.type === 'announcement' ? '📢' : '#'
  document.getElementById('chatChannelName').textContent = ch.name
  document.getElementById('chatChannelTopic').textContent = ch.topic || ''
  document.getElementById('messageInput').placeholder = `Message #${ch.name}`
  renderChannelList()
  await loadMessages()
  subscribeMessages()
  subscribeTyping()
}

// ── Members ────────────────────────────────────────────────────────────────
async function loadMembers(serverId) {
  const { data } = await supabase.from('server_members').select('user_id, role, profiles(*)').eq('server_id', serverId)
  members = data || []
  renderMemberList()
}

function renderMemberList() {
  const list = document.getElementById('memberList')
  list.innerHTML = ''
  const online = members.filter(m => ['online','idle','dnd'].includes(m.profiles?.status))
  const offline = members.filter(m => !['online','idle','dnd'].includes(m.profiles?.status))
  if (online.length) { list.innerHTML += `<div class="member-category">Online — ${online.length}</div>`; online.forEach(m => list.appendChild(makeMemberEl(m))) }
  if (offline.length) { list.innerHTML += `<div class="member-category">Offline — ${offline.length}</div>`; offline.forEach(m => list.appendChild(makeMemberEl(m))) }
}

function makeMemberEl(m) {
  const p = m.profiles || {}
  const el = document.createElement('div')
  el.className = 'member-item'
  const statusClass = { online: 's-online', idle: 's-idle', dnd: 's-dnd' }[p.status] || 's-offline'
  el.innerHTML = `
    <div class="member-avatar" style="background:${p.avatar_color||'#5865f2'}">
      <span>${p.username?.[0]?.toUpperCase()||'?'}</span>
      <div class="member-status ${statusClass}"></div>
    </div>
    <div style="flex:1;min-width:0">
      <div class="member-name">${p.username||'Unknown'}${m.role==='admin'?' 👑':''}</div>
    </div>`
  el.onclick = e => showProfilePopup(e, p)
  return el
}

// ── Messages ───────────────────────────────────────────────────────────────
async function loadMessages() {
  document.getElementById('messagesArea').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading...</div>'
  const filter = currentDM
    ? supabase.from('messages').select('*, profiles(*)').eq('dm_id', currentDM)
    : supabase.from('messages').select('*, profiles(*)').eq('channel_id', currentChannel.id)
  const { data } = await filter.order('created_at', { ascending: true }).limit(100)
  messages = data || []
  renderMessages()
}

function renderMessages() {
  const area = document.getElementById('messagesArea')
  area.innerHTML = ''
  if (!messages.length) {
    area.innerHTML = `<div class="welcome-msg">
      <div class="welcome-icon">#</div>
      <h2>Welcome to #${currentChannel?.name || 'this DM'}!</h2>
      <p>This is the start of the conversation.</p>
    </div>`
    return
  }
  let lastDate = null, lastAuthor = null
  messages.forEach((msg, i) => {
    const d = new Date(msg.created_at).toLocaleDateString()
    if (d !== lastDate) {
      const div = document.createElement('div')
      div.className = 'date-divider'
      div.innerHTML = `<span>${d}</span>`
      area.appendChild(div)
      lastDate = d; lastAuthor = null
    }
    const grouped = lastAuthor === msg.user_id && i > 0
    area.appendChild(buildMessageEl(msg, grouped))
    lastAuthor = msg.user_id
  })
  area.scrollTop = area.scrollHeight
}

function buildMessageEl(msg, grouped) {
  const p = msg.profiles || {}
  const el = document.createElement('div')
  el.className = 'message-group'
  el.dataset.id = msg.id
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const isOwn = msg.user_id === currentUser.id
  const isAdmin = p.id === ADMIN_UUID || p.is_admin

  let replyHtml = ''
  if (msg.reply_to) {
    const parent = messages.find(m => m.id === msg.reply_to)
    if (parent) replyHtml = `<div class="msg-reply"><strong>${parent.profiles?.username||'Unknown'}</strong>&nbsp;${parent.content?.slice(0,60)||''}</div>`
  }

  if (grouped) {
    el.innerHTML = `
      <div style="width:40px;flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;padding-right:4px">
        <span class="msg-time" style="opacity:0;font-size:10px">${time}</span>
      </div>
      <div class="msg-content">
        ${replyHtml}
        <div class="msg-text">${fmt(msg.content)}</div>
        ${renderReactions(msg)}
      </div>
      ${buildMsgActions(msg, isOwn)}`
    el.querySelector('.msg-time').parentElement.onmouseenter = function() { this.querySelector('.msg-time').style.opacity = '1' }
    el.querySelector('.msg-time').parentElement.onmouseleave = function() { this.querySelector('.msg-time').style.opacity = '0' }
  } else {
    el.innerHTML = `
      <div class="msg-avatar" style="background:${p.avatar_color||'#5865f2'}" onclick="showProfilePopupById('${msg.user_id}',event)">
        ${p.avatar_url ? `<img src="${p.avatar_url}" />` : p.username?.[0]?.toUpperCase()||'?'}
      </div>
      <div class="msg-content">
        ${replyHtml}
        <div class="msg-header">
          <span class="msg-author" style="color:${p.avatar_color||'var(--text-primary)'}" onclick="showProfilePopupById('${msg.user_id}',event)">${p.username||'Unknown'}</span>
          ${isAdmin ? '<span class="msg-badge admin">ADMIN</span>' : ''}
          <span class="msg-time">${time}</span>
          ${msg.edited ? '<span class="msg-edited">(edited)</span>' : ''}
        </div>
        <div class="msg-text">${fmt(msg.content)}</div>
        ${renderReactions(msg)}
      </div>
      ${buildMsgActions(msg, isOwn)}`
  }
  return el
}

function buildMsgActions(msg, isOwn) {
  return `<div class="msg-actions">
    <button class="msg-action-btn" onclick="openReactionPicker('${msg.id}',event)" title="React">😀</button>
    <button class="msg-action-btn" onclick="setReply('${msg.id}')" title="Reply">↩️</button>
    ${isOwn ? `<button class="msg-action-btn" onclick="editMsg('${msg.id}')" title="Edit">✏️</button>` : ''}
    ${isOwn || currentProfile.is_admin ? `<button class="msg-action-btn danger" onclick="deleteMsg('${msg.id}')" title="Delete">🗑️</button>` : ''}
    ${currentProfile.is_admin ? `<button class="msg-action-btn" onclick="pinMsg('${msg.id}')" title="Pin">📌</button>` : ''}
  </div>`
}

function renderReactions(msg) {
  if (!msg.reactions || !Object.keys(msg.reactions).length) return ''
  return `<div class="msg-reactions">${Object.entries(msg.reactions).map(([e, users]) =>
    `<div class="reaction ${users.includes(currentUser.id)?'reacted':''}" onclick="toggleReaction('${msg.id}','${e}')">
      ${e}<span class="r-count">${users.length}</span>
    </div>`).join('')}</div>`
}

function fmt(text) {
  if (!text) return ''
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```([\s\S]+?)```/g,'<pre><code>$1</code></pre>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/~~(.+?)~~/g,'<s>$1</s>')
    .replace(/__(.*?)__/g,'<u>$1</u>')
    .replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g,'<br>')
}

// ── Send / Edit / Delete / Pin ─────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('messageInput')
  const content = input.value.trim()
  if (!content) return
  input.value = ''; input.style.height = 'auto'

  const payload = { user_id: currentUser.id, content, reactions: {}, created_at: new Date().toISOString() }
  if (replyingTo) { payload.reply_to = replyingTo; cancelReply() }
  if (currentDM) payload.dm_id = currentDM
  else payload.channel_id = currentChannel.id

  const { error } = await supabase.from('messages').insert(payload)
  if (error) showToast(error.message, 'error')
}

window.editMsg = function(id) {
  const msg = messages.find(m => m.id === id)
  if (!msg) return
  showModal('Edit Message', `
    <textarea id="editContent" rows="4" style="min-height:80px">${msg.content}</textarea>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveEdit('${id}')">Save Changes</button>
    </div>`)
}

window.saveEdit = async function(id) {
  const content = document.getElementById('editContent').value.trim()
  if (!content) return
  await supabase.from('messages').update({ content, edited: true }).eq('id', id)
  closeModal()
}

window.deleteMsg = async function(id) {
  if (!confirm('Delete this message?')) return
  await supabase.from('messages').delete().eq('id', id)
}

window.pinMsg = async function(id) {
  await supabase.from('messages').update({ pinned: true }).eq('id', id)
  showToast('Message pinned', 'success')
}

window.setReply = function(id) {
  const msg = messages.find(m => m.id === id)
  if (!msg) return
  replyingTo = id
  document.getElementById('replyName').textContent = msg.profiles?.username || 'Unknown'
  document.getElementById('replyPreview').classList.remove('hidden')
  document.getElementById('chatInputBox').classList.add('has-reply')
  document.getElementById('messageInput').focus()
}

window.cancelReply = function() {
  replyingTo = null
  document.getElementById('replyPreview').classList.add('hidden')
  document.getElementById('chatInputBox').classList.remove('has-reply')
}

// ── Reactions ──────────────────────────────────────────────────────────────
window.toggleReaction = async function(msgId, emoji) {
  const msg = messages.find(m => m.id === msgId)
  if (!msg) return
  const r = { ...(msg.reactions || {}) }
  const users = r[emoji] || []
  r[emoji] = users.includes(currentUser.id) ? users.filter(u => u !== currentUser.id) : [...users, currentUser.id]
  if (!r[emoji].length) delete r[emoji]
  await supabase.from('messages').update({ reactions: r }).eq('id', msgId)
}

window.openReactionPicker = function(msgId, e) {
  e.stopPropagation()
  const emojis = ['👍','👎','❤️','🔥','😂','😮','😢','😡','🎉','✅','💯','🙏','👀','💀','🤔','😎','🥳','💪','🚀','⚡']
  const picker = document.createElement('div')
  picker.className = 'emoji-picker'
  picker.style.cssText = `top:${Math.max(10, e.clientY - 80)}px;left:${Math.min(e.clientX, window.innerWidth - 360)}px`
  picker.innerHTML = `<div class="emoji-grid">${emojis.map(em =>
    `<button class="emoji-btn" onclick="toggleReaction('${msgId}','${em}');this.closest('.emoji-picker').remove()">${em}</button>`
  ).join('')}</div>`
  document.body.appendChild(picker)
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 50)
}

// ── Realtime ───────────────────────────────────────────────────────────────
function subscribeMessages() {
  if (msgSub) supabase.removeChannel(msgSub)
  const key = currentDM || currentChannel?.id
  const filter = currentDM ? `dm_id=eq.${currentDM}` : `channel_id=eq.${currentChannel.id}`
  msgSub = supabase.channel('msgs-' + key)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter }, async payload => {
      if (payload.eventType === 'INSERT') {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', payload.new.user_id).single()
        payload.new.profiles = p
        messages.push(payload.new)
      } else if (payload.eventType === 'UPDATE') {
        const i = messages.findIndex(m => m.id === payload.new.id)
        if (i !== -1) messages[i] = { ...messages[i], ...payload.new }
      } else if (payload.eventType === 'DELETE') {
        messages = messages.filter(m => m.id !== payload.old.id)
      }
      renderMessages()
    }).subscribe()
}

function subscribeTyping() {
  if (typingSub) supabase.removeChannel(typingSub)
  const key = currentDM || currentChannel?.id
  typingSub = supabase.channel('typing-' + key)
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.user_id === currentUser.id) return
      const el = document.getElementById('typingIndicator')
      el.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>${payload.username} is typing...`
      clearTimeout(typingTimer)
      typingTimer = setTimeout(() => { el.innerHTML = '' }, 3000)
    }).subscribe()
}

function broadcastTyping() {
  typingSub?.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.id, username: currentProfile.username } })
}

// ── DM View ────────────────────────────────────────────────────────────────
async function renderDMView() {
  currentServer = null
  document.getElementById('serverName').textContent = 'Direct Messages'
  document.getElementById('dmServerBtn').classList.add('active')
  document.getElementById('memberList').innerHTML = ''
  renderServerIcons()

  const list = document.getElementById('channelList')
  list.innerHTML = `<div style="padding:12px 16px 4px;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.8px">Direct Messages</div>`

  const { data } = await supabase.from('direct_messages').select('*').or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
  for (const dm of (data || [])) {
    const otherId = dm.user1_id === currentUser.id ? dm.user2_id : dm.user1_id
    const { data: other } = await supabase.from('profiles').select('*').eq('id', otherId).single()
    const el = document.createElement('div')
    el.className = 'dm-item' + (currentDM === dm.id ? ' active' : '')
    el.innerHTML = `
      <div class="member-avatar" style="background:${other?.avatar_color||'#5865f2'};width:32px;height:32px;font-size:13px">
        ${other?.username?.[0]?.toUpperCase()||'?'}
        <div class="member-status s-${other?.status||'offline'}"></div>
      </div>
      <span class="dm-name">${other?.username||'Unknown'}</span>`
    el.onclick = () => openDM(dm.id, other)
    list.appendChild(el)
  }

  const newBtn = document.createElement('div')
  newBtn.className = 'channel-item'
  newBtn.style.marginTop = '8px'
  newBtn.innerHTML = '<span>➕</span><span>New Message</span>'
  newBtn.onclick = openNewDMModal
  list.appendChild(newBtn)
}

async function openDM(dmId, other) {
  currentDM = dmId; currentChannel = null
  document.getElementById('chatIcon').textContent = '💬'
  document.getElementById('chatChannelName').textContent = other?.username || 'DM'
  document.getElementById('chatChannelTopic').textContent = ''
  document.getElementById('messageInput').placeholder = `Message ${other?.username || ''}`
  await loadMessages()
  subscribeMessages()
}

function openNewDMModal() {
  showModal('New Message', `
    <p>Start a conversation with someone.</p>
    <label>Username</label>
    <input type="text" id="dmTarget" placeholder="Enter exact username" />
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="startDM()">Open DM</button>
    </div>`)
}

window.startDM = async function() {
  const target = document.getElementById('dmTarget').value.trim()
  if (!target) return
  const { data: profile } = await supabase.from('profiles').select('*').eq('username', target).single()
  if (!profile) return showToast('User not found', 'error')
  const { data: existing } = await supabase.from('direct_messages').select('id')
    .or(`and(user1_id.eq.${currentUser.id},user2_id.eq.${profile.id}),and(user1_id.eq.${profile.id},user2_id.eq.${currentUser.id})`).single()
  let dmId = existing?.id
  if (!dmId) {
    const { data: nd } = await supabase.from('direct_messages').insert({ user1_id: currentUser.id, user2_id: profile.id }).select().single()
    dmId = nd?.id
  }
  closeModal()
  await renderDMView()
  openDM(dmId, profile)
}

// ── Create / Join Server ───────────────────────────────────────────────────
function openCreateServerModal() {
  showModal('Create a Server', `
    <p>Give your server a name and make it yours.</p>
    <label>Server Name</label>
    <input type="text" id="newServerName" placeholder="My Awesome Server" maxlength="100" />
    <label>Description (optional)</label>
    <input type="text" id="newServerDesc" placeholder="What's this server about?" />
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="createServer()">Create Server</button>
    </div>`)
}

window.createServer = async function() {
  const name = document.getElementById('newServerName').value.trim()
  const description = document.getElementById('newServerDesc').value.trim()
  if (!name) return showToast('Server name required', 'error')
  const { data: server, error } = await supabase.from('servers').insert({ name, description, owner_id: currentUser.id }).select().single()
  if (error) return showToast(error.message, 'error')
  await supabase.from('server_members').insert({ server_id: server.id, user_id: currentUser.id, role: 'admin' })
  await supabase.from('channels').insert([
    { server_id: server.id, name: 'general', type: 'text', category: 'TEXT CHANNELS', position: 0 },
    { server_id: server.id, name: 'announcements', type: 'announcement', category: 'TEXT CHANNELS', position: 1 },
    { server_id: server.id, name: 'General', type: 'voice', category: 'VOICE CHANNELS', position: 2 }
  ])
  closeModal()
  await loadServers()
  showToast(`Server "${name}" created!`, 'success')
}

function openJoinServerModal() {
  showModal('Join a Server', `
    <p>Enter an invite code to join a server.</p>
    <label>Invite Code</label>
    <input type="text" id="inviteCode" placeholder="Enter invite code" maxlength="20" />
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="joinServer()">Join Server</button>
    </div>`)
}

window.joinServer = async function() {
  const code = document.getElementById('inviteCode').value.trim()
  if (!code) return
  const { data: server } = await supabase.from('servers').select('*').eq('invite_code', code).single()
  if (!server) return showToast('Invalid invite code', 'error')
  const { data: existing } = await supabase.from('server_members').select('id').eq('server_id', server.id).eq('user_id', currentUser.id).single()
  if (existing) { closeModal(); await selectServer(server); return showToast('Already a member!') }
  await supabase.from('server_members').insert({ server_id: server.id, user_id: currentUser.id, role: 'member' })
  closeModal()
  await loadServers()
  showToast(`Joined "${server.name}"!`, 'success')
}

function openInviteModal() {
  if (!currentServer) return
  showModal(`Invite to ${currentServer.name}`, `
    <p>Share this invite code with friends.</p>
    <div class="invite-code-box">
      <code id="inviteCodeDisplay">${currentServer.invite_code || 'Loading...'}</code>
      <button class="copy-btn" onclick="copyInvite()">Copy</button>
    </div>
    <label>Or share this link</label>
    <input type="text" id="inviteLink" value="${window.location.origin}/unreal-cord/auth.html?invite=${currentServer.invite_code}" readonly onclick="this.select()" />
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>`)
}

window.copyInvite = function() {
  const code = document.getElementById('inviteCodeDisplay').textContent
  navigator.clipboard.writeText(code)
  showToast('Invite code copied!', 'success')
}

// ── Create / Edit Channel ──────────────────────────────────────────────────
window.openCreateChannelModal = function() {
  if (!currentServer) return
  showModal('Create Channel', `
    <label>Channel Type</label>
    <select id="newChType">
      <option value="text"># Text Channel</option>
      <option value="voice">🔊 Voice Channel</option>
      <option value="announcement">📢 Announcement</option>
    </select>
    <label>Channel Name</label>
    <input type="text" id="newChName" placeholder="new-channel" maxlength="50" />
    <label>Topic (optional)</label>
    <input type="text" id="newChTopic" placeholder="What's this channel about?" />
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="createChannel()">Create Channel</button>
    </div>`)
}

window.createChannel = async function() {
  const name = document.getElementById('newChName').value.trim().toLowerCase().replace(/\s+/g, '-')
  const type = document.getElementById('newChType').value
  const topic = document.getElementById('newChTopic').value.trim()
  if (!name) return showToast('Channel name required', 'error')
  const cat = type === 'voice' ? 'VOICE CHANNELS' : 'TEXT CHANNELS'
  await supabase.from('channels').insert({ server_id: currentServer.id, name, type, topic, category: cat, position: channels.length })
  closeModal()
  await loadChannels(currentServer.id)
  showToast(`#${name} created!`, 'success')
}

window.openEditChannelModal = function(id) {
  const ch = channels.find(c => c.id === id)
  if (!ch) return
  showModal('Edit Channel', `
    <label>Channel Name</label>
    <input type="text" id="editChName" value="${ch.name}" />
    <label>Topic</label>
    <input type="text" id="editChTopic" value="${ch.topic||''}" placeholder="Channel topic" />
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveChannel('${id}')">Save</button>
    </div>`)
}

window.saveChannel = async function(id) {
  const name = document.getElementById('editChName').value.trim().toLowerCase().replace(/\s+/g, '-')
  const topic = document.getElementById('editChTopic').value.trim()
  if (!name) return
  await supabase.from('channels').update({ name, topic }).eq('id', id)
  closeModal()
  await loadChannels(currentServer.id)
  showToast('Channel updated!', 'success')
}

window.deleteChannel = async function(id) {
  if (!confirm('Delete this channel? All messages will be lost.')) return
  await supabase.from('channels').delete().eq('id', id)
  await loadChannels(currentServer.id)
  showToast('Channel deleted', 'error')
}

// ── Voice ──────────────────────────────────────────────────────────────────
function joinVoice(ch) {
  document.querySelector('.voice-connected')?.remove()
  const el = document.createElement('div')
  el.className = 'voice-connected'
  el.innerHTML = `🔊 ${ch.name} — Connected <button onclick="this.parentElement.remove();showToast('Left voice')" style="margin-left:auto;background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:0">✕</button>`
  document.getElementById('channelList').prepend(el)
  showToast(`Joined 🔊 ${ch.name}`, 'success')
}

// ── Server Context Menu ────────────────────────────────────────────────────
function showServerContextMenu(e, server) {
  e.preventDefault()
  showContextMenu(e, [
    { label: '📋 Copy Invite Code', action: () => { navigator.clipboard.writeText(server.invite_code); showToast('Copied!', 'success') } },
    { label: '🔗 Invite People', action: () => { currentServer = server; openInviteModal() } },
    { divider: true },
    { label: '⚙️ Server Settings', action: () => openServerSettings(server) },
    { label: '🗑️ Delete Server', danger: true, action: () => deleteServer(server) }
  ])
}

function showChannelContextMenu(e, ch) {
  e.preventDefault()
  showContextMenu(e, [
    { label: '✏️ Edit Channel', action: () => openEditChannelModal(ch.id) },
    { label: '📋 Copy ID', action: () => { navigator.clipboard.writeText(ch.id); showToast('Copied!', 'success') } },
    { divider: true },
    { label: '🗑️ Delete Channel', danger: true, action: () => deleteChannel(ch.id) }
  ])
}

function showContextMenu(e, items) {
  const menu = document.getElementById('contextMenu')
  menu.innerHTML = ''
  items.forEach(item => {
    if (item.divider) { const d = document.createElement('div'); d.className = 'context-divider'; menu.appendChild(d); return }
    const el = document.createElement('div')
    el.className = 'context-item' + (item.danger ? ' danger' : '')
    el.textContent = item.label
    el.onclick = () => { item.action(); closeContextMenu() }
    menu.appendChild(el)
  })
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px'
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px'
  menu.classList.remove('hidden')
}

function closeContextMenu() { document.getElementById('contextMenu').classList.add('hidden') }

// ── Server Settings ────────────────────────────────────────────────────────
function openServerSettings(server) {
  const s = server || currentServer
  if (!s) return
  showModal(`Server Settings`, `
    <label>Server Name</label>
    <input type="text" id="srvName" value="${s.name}" />
    <label>Description</label>
    <input type="text" id="srvDesc" value="${s.description||''}" placeholder="Server description" />
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-secondary);margin-bottom:8px;letter-spacing:.8px">Invite Code</div>
      <div class="invite-code-box">
        <code>${s.invite_code}</code>
        <button class="copy-btn" onclick="navigator.clipboard.writeText('${s.invite_code}');showToast('Copied!','success')">Copy</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-danger" onclick="deleteServer()" style="margin-right:auto">Delete Server</button>
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveServerSettings('${s.id}')">Save</button>
    </div>`)
}

window.saveServerSettings = async function(id) {
  const name = document.getElementById('srvName').value.trim()
  const description = document.getElementById('srvDesc').value.trim()
  if (!name) return
  await supabase.from('servers').update({ name, description }).eq('id', id)
  if (currentServer?.id === id) { currentServer.name = name; document.getElementById('serverName').textContent = name }
  closeModal(); renderServerIcons(); showToast('Server updated!', 'success')
}

window.deleteServer = async function(server) {
  const s = server || currentServer
  if (!s || !confirm(`Delete "${s.name}"? This is permanent.`)) return
  await supabase.from('servers').delete().eq('id', s.id)
  closeModal(); await loadServers(); showToast('Server deleted', 'error')
}

// ── Profile Popup ──────────────────────────────────────────────────────────
window.showProfilePopupById = async function(userId, e) {
  const { data: p } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (p) showProfilePopup(e, p)
}

function showProfilePopup(e, p) {
  e.stopPropagation()
  const popup = document.getElementById('profilePopup')
  const isAdmin = p.id === ADMIN_UUID || p.is_admin
  popup.innerHTML = `
    <div class="profile-banner" style="background:linear-gradient(135deg,${p.avatar_color||'#5865f2'},${p.avatar_color||'#5865f2'}88)"></div>
    <div class="profile-body">
      <div class="profile-avatar-wrap">
        <div class="big-avatar" style="background:${p.avatar_color||'#5865f2'}">
          ${p.avatar_url ? `<img src="${p.avatar_url}" />` : p.username?.[0]?.toUpperCase()||'?'}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="profile-username">${p.username||'Unknown'}</div>
        ${isAdmin ? '<span class="msg-badge admin">ADMIN</span>' : ''}
      </div>
      <div class="profile-tag">#${p.id?.slice(0,4).toUpperCase()||'0000'}</div>
      ${p.bio ? `<div class="profile-divider"></div><div class="profile-section-title">About Me</div><div class="profile-bio">${p.bio}</div>` : ''}
      <div class="profile-divider"></div>
      <div style="display:flex;gap:8px">
        <button class="btn-primary" style="flex:1;padding:9px;font-size:13px" onclick="dmFromProfile('${p.id}')">💬 Message</button>
      </div>
    </div>`
  popup.classList.remove('hidden')
  const x = Math.min(e.clientX + 12, window.innerWidth - 310)
  const y = Math.min(e.clientY, window.innerHeight - 420)
  popup.style.left = x + 'px'; popup.style.top = y + 'px'
}

window.dmFromProfile = async function(userId) {
  document.getElementById('profilePopup').classList.add('hidden')
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (!profile) return
  const { data: existing } = await supabase.from('direct_messages').select('id')
    .or(`and(user1_id.eq.${currentUser.id},user2_id.eq.${userId}),and(user1_id.eq.${userId},user2_id.eq.${currentUser.id})`).single()
  let dmId = existing?.id
  if (!dmId) {
    const { data: nd } = await supabase.from('direct_messages').insert({ user1_id: currentUser.id, user2_id: userId }).select().single()
    dmId = nd?.id
  }
  await renderDMView()
  openDM(dmId, profile)
}

// ── Settings ───────────────────────────────────────────────────────────────
function openSettings() {
  showModal('User Settings', `
    <label>Username</label>
    <input type="text" id="setUsername" value="${currentProfile.username}" maxlength="32" />
    <label>Bio</label>
    <textarea id="setBio" rows="3" placeholder="Tell us about yourself">${currentProfile.bio||''}</textarea>
    <label>Status</label>
    <select id="setStatus">
      <option value="online" ${currentProfile.status==='online'?'selected':''}>🟢 Online</option>
      <option value="idle" ${currentProfile.status==='idle'?'selected':''}>🟡 Idle</option>
      <option value="dnd" ${currentProfile.status==='dnd'?'selected':''}>🔴 Do Not Disturb</option>
      <option value="offline" ${currentProfile.status==='offline'?'selected':''}>⚫ Invisible</option>
    </select>
    <div class="modal-footer">
      <button class="btn-danger" onclick="logout()" style="margin-right:auto">Log Out</button>
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveSettings()">Save</button>
    </div>`)
}

window.saveSettings = async function() {
  const username = document.getElementById('setUsername').value.trim()
  const bio = document.getElementById('setBio').value.trim()
  const status = document.getElementById('setStatus').value
  if (!username) return showToast('Username required', 'error')
  await supabase.from('profiles').update({ username, bio, status }).eq('id', currentUser.id)
  currentProfile = { ...currentProfile, username, bio, status }
  renderUserPanel(); closeModal(); showToast('Settings saved!', 'success')
}

window.logout = async function() {
  await supabase.from('profiles').update({ status: 'offline' }).eq('id', currentUser.id)
  await supabase.auth.signOut()
  window.location.href = 'auth.html'
}

// ── Pinned Messages ────────────────────────────────────────────────────────
async function showPinnedMessages() {
  if (!currentChannel) return
  const { data } = await supabase.from('messages').select('*, profiles(username)').eq('channel_id', currentChannel.id).eq('pinned', true)
  showModal('Pinned Messages', `
    <div style="max-height:400px;overflow-y:auto">
      ${!data?.length ? '<p style="color:var(--text-muted);text-align:center">No pinned messages.</p>' :
        data.map(m => `<div class="pinned-banner" style="margin-bottom:8px">
          <strong>${m.profiles?.username||'?'}</strong>: ${m.content?.slice(0,100)||''}
        </div>`).join('')}
    </div>
    <div class="modal-footer"><button class="btn-secondary" onclick="closeModal()">Close</button></div>`)
}

// ── Search ─────────────────────────────────────────────────────────────────
function openSearch() {
  showModal('Search Messages', `
    <input type="text" id="searchQ" placeholder="Search messages..." />
    <div id="searchRes" style="max-height:320px;overflow-y:auto"></div>
    <div class="modal-footer"><button class="btn-secondary" onclick="closeModal()">Close</button></div>`)
  document.getElementById('searchQ').addEventListener('input', async function() {
    const q = this.value.trim()
    if (q.length < 2) return
    const { data } = await supabase.from('messages').select('*, profiles(username)').ilike('content', `%${q}%`).limit(20)
    document.getElementById('searchRes').innerHTML = !data?.length
      ? '<div style="color:var(--text-muted);text-align:center;padding:16px">No results</div>'
      : data.map(m => `<div style="padding:10px;border-radius:6px;margin-bottom:4px;background:var(--bg-tertiary)">
          <span style="font-weight:600;color:var(--accent)">${m.profiles?.username||'?'}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${new Date(m.created_at).toLocaleString()}</span>
          <div style="margin-top:4px;font-size:14px;color:var(--text-secondary)">${m.content?.slice(0,120)||''}</div>
        </div>`).join('')
  })
}

// ── Emoji Picker ───────────────────────────────────────────────────────────
const ALL_EMOJIS = ['😀','😂','🥹','😍','🤔','😎','🥳','😭','😡','🤯','👍','👎','❤️','🔥','✅','❌','💯','🎉','🚀','💀','👀','🙏','💪','🤝','👋','🎮','🎵','🎨','📸','🌟','⚡','🌈','🍕','🎂','🏆','💎','🔮','🌙','☀️','🌊','🐶','🐱','🦊','🐻','🦁','🐸','🦋','🌸','🍀','🌺']

function toggleEmojiPicker() {
  const picker = document.getElementById('emojiPicker')
  if (!picker.classList.contains('hidden')) { picker.classList.add('hidden'); return }
  picker.innerHTML = `
    <input class="emoji-search" placeholder="Search emoji..." id="emojiSearch" />
    <div class="emoji-grid" id="emojiGrid">${ALL_EMOJIS.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('')}</div>`
  document.getElementById('emojiSearch').oninput = function() {
    const q = this.value.toLowerCase()
    document.getElementById('emojiGrid').innerHTML = ALL_EMOJIS
      .filter(() => true) // could filter by name if we had names
      .map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('')
  }
  const btn = document.getElementById('emojiBtn')
  const rect = btn.getBoundingClientRect()
  picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px'
  picker.style.right = (window.innerWidth - rect.right) + 'px'
  picker.classList.remove('hidden')
}

window.insertEmoji = function(emoji) {
  const input = document.getElementById('messageInput')
  input.value += emoji; input.focus()
  document.getElementById('emojiPicker').classList.add('hidden')
}

// ── Admin Panel ────────────────────────────────────────────────────────────
window.adminTab = async function(tab) {
  if (currentUser.id !== ADMIN_UUID) return // hard block
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.toggle('active', el.textContent.toLowerCase().includes(tab)))
  const content = document.getElementById('adminTabContent')

  if (tab === 'dashboard') {
    const [{ count: uc }, { count: sc }, { count: mc }, { count: cc }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('servers').select('*', { count: 'exact', head: true }),
      supabase.from('messages').select('*', { count: 'exact', head: true }),
      supabase.from('channels').select('*', { count: 'exact', head: true })
    ])
    const { data: recent } = await supabase.from('messages').select('*, profiles(username)').order('created_at', { ascending: false }).limit(8)
    content.innerHTML = `<h1>Dashboard</h1>
      <div class="stats-grid">
        ${[['👥','Users',uc||0],['🖥️','Servers',sc||0],['💬','Messages',mc||0],['📢','Channels',cc||0]].map(([icon,label,val]) =>
          `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${val}</div><div class="stat-label">${label}</div></div>`).join('')}
      </div>
      <h2 style="margin-bottom:12px;font-size:16px">Recent Messages</h2>
      <table class="admin-table"><thead><tr><th>User</th><th>Message</th><th>Time</th></tr></thead>
      <tbody>${(recent||[]).map(m => `<tr><td>${m.profiles?.username||'?'}</td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.content||''}</td><td style="color:var(--text-muted);font-size:12px">${new Date(m.created_at).toLocaleString()}</td></tr>`).join('')}</tbody></table>`
  }

  if (tab === 'users') {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    content.innerHTML = `<h1>Users</h1>
      <table class="admin-table"><thead><tr><th>User</th><th>Status</th><th>Role</th><th>Actions</th></tr></thead>
      <tbody>${(data||[]).map(u => `<tr>
        <td><div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border-radius:50%;background:${u.avatar_color||'#5865f2'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${u.username?.[0]?.toUpperCase()||'?'}</div>
          <span>${u.username||'?'}</span>
        </div></td>
        <td><span class="badge ${u.status==='online'?'badge-green':'badge-red'}">${u.status||'offline'}</span></td>
        <td>${u.is_admin?'<span class="badge badge-gold">Admin</span>':'<span class="badge">Member</span>'}</td>
        <td style="display:flex;gap:6px">
          <button class="action-btn primary" onclick="adminToggleAdmin('${u.id}',${!!u.is_admin})">${u.is_admin?'Remove Admin':'Make Admin'}</button>
          <button class="action-btn danger" onclick="adminBanUser('${u.id}','${u.username}')">Ban</button>
        </td>
      </tr>`).join('')}</tbody></table>`
  }

  if (tab === 'servers') {
    const { data } = await supabase.from('servers').select('*, profiles(username)').order('created_at', { ascending: false })
    content.innerHTML = `<h1>Servers</h1>
      <table class="admin-table"><thead><tr><th>Name</th><th>Owner</th><th>Invite</th><th>Actions</th></tr></thead>
      <tbody>${(data||[]).map(s => `<tr>
        <td><strong>${s.name}</strong></td>
        <td>${s.profiles?.username||'?'}</td>
        <td><code style="font-size:13px;color:var(--accent)">${s.invite_code||'—'}</code></td>
        <td><button class="action-btn danger" onclick="adminDeleteServer('${s.id}','${s.name}')">Delete</button></td>
      </tr>`).join('')}</tbody></table>`
  }

  if (tab === 'messages') {
    const { data } = await supabase.from('messages').select('*, profiles(username), channels(name)').order('created_at', { ascending: false }).limit(100)
    content.innerHTML = `<h1>Messages</h1>
      <table class="admin-table"><thead><tr><th>Author</th><th>Content</th><th>Channel</th><th>Actions</th></tr></thead>
      <tbody>${(data||[]).map(m => `<tr>
        <td>${m.profiles?.username||'?'}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.content||''}</td>
        <td style="color:var(--text-muted)">${m.channels?.name||'DM'}</td>
        <td><button class="action-btn danger" onclick="adminDeleteMsg('${m.id}')">Delete</button></td>
      </tr>`).join('')}</tbody></table>`
  }

  if (tab === 'channels') {
    const { data } = await supabase.from('channels').select('*, servers(name)').order('created_at', { ascending: false })
    content.innerHTML = `<h1>Channels</h1>
      <table class="admin-table"><thead><tr><th>Name</th><th>Type</th><th>Server</th><th>Actions</th></tr></thead>
      <tbody>${(data||[]).map(c => `<tr>
        <td>#${c.name}</td>
        <td><span class="badge badge-blue">${c.type}</span></td>
        <td>${c.servers?.name||'?'}</td>
        <td><button class="action-btn danger" onclick="adminDeleteChannel('${c.id}')">Delete</button></td>
      </tr>`).join('')}</tbody></table>`
  }
}

window.adminToggleAdmin = async function(id, isAdmin) {
  if (currentUser.id !== ADMIN_UUID) return
  await supabase.from('profiles').update({ is_admin: !isAdmin }).eq('id', id)
  adminTab('users'); showToast(!isAdmin ? 'Admin granted' : 'Admin removed', 'success')
}
window.adminBanUser = async function(id, name) {
  if (currentUser.id !== ADMIN_UUID) return
  if (!confirm(`Ban ${name}?`)) return
  await supabase.from('profiles').update({ banned: true, status: 'offline' }).eq('id', id)
  adminTab('users'); showToast(`${name} banned`, 'error')
}
window.adminDeleteServer = async function(id, name) {
  if (currentUser.id !== ADMIN_UUID) return
  if (!confirm(`Delete "${name}"?`)) return
  await supabase.from('servers').delete().eq('id', id)
  adminTab('servers'); showToast('Server deleted', 'error')
}
window.adminDeleteMsg = async function(id) {
  if (currentUser.id !== ADMIN_UUID) return
  await supabase.from('messages').delete().eq('id', id)
  adminTab('messages'); showToast('Message deleted', 'error')
}
window.adminDeleteChannel = async function(id) {
  if (currentUser.id !== ADMIN_UUID) return
  await supabase.from('channels').delete().eq('id', id)
  adminTab('channels'); showToast('Channel deleted', 'error')
}

function toggleAdminPanel() {
  if (currentUser.id !== ADMIN_UUID) return // hard block
  adminPanelOpen = !adminPanelOpen
  const sidebar = document.getElementById('adminSidebar')
  const main = document.getElementById('adminMainPanel')
  const btn = document.getElementById('adminToggleBtn')
  if (adminPanelOpen) {
    sidebar.classList.remove('hidden')
    main.classList.remove('hidden')
    btn.classList.add('active')
    adminTab('dashboard')
  } else {
    sidebar.classList.add('hidden')
    main.classList.add('hidden')
    btn.classList.remove('active')
  }
}

// ── Modal / Toast helpers ──────────────────────────────────────────────────
function showModal(title, body) {
  document.getElementById('modalContent').innerHTML = `<h2>${title}</h2>${body}`
  document.getElementById('modalOverlay').classList.remove('hidden')
}
window.closeModal = function() { document.getElementById('modalOverlay').classList.add('hidden') }

function showToast(msg, type = 'info') {
  const t = document.createElement('div')
  t.className = `toast ${type}`
  t.textContent = msg
  document.getElementById('toastContainer').appendChild(t)
  setTimeout(() => t.remove(), 3500)
}
window.showToast = showToast

// ── Event Listeners ────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('addServerBtn').onclick = openCreateServerModal
  document.getElementById('joinServerBtn').onclick = openJoinServerModal
  document.getElementById('dmServerBtn').onclick = renderDMView
  document.getElementById('settingsBtn').onclick = openSettings
  document.getElementById('emojiBtn').onclick = toggleEmojiPicker
  document.getElementById('sendBtn').onclick = sendMessage
  document.getElementById('pinnedBtn').onclick = showPinnedMessages
  document.getElementById('searchMsgBtn').onclick = openSearch
  document.getElementById('inboxBtn').onclick = () => showToast('No new notifications')
  document.getElementById('myUserInfo').onclick = openSettings
  document.getElementById('adminToggleBtn').onclick = toggleAdminPanel
  document.getElementById('serverHeader').onclick = () => { if (currentServer) openServerSettings() }

  document.getElementById('toggleMembersBtn').onclick = () => {
    const ml = document.getElementById('memberList')
    ml.style.display = ml.style.display === 'none' ? '' : 'none'
  }

  document.getElementById('muteBtn').onclick = function() {
    muted = !muted; this.classList.toggle('active', muted)
    showToast(muted ? '🎤 Muted' : '🎤 Unmuted')
  }
  document.getElementById('deafenBtn').onclick = function() {
    deafened = !deafened; this.classList.toggle('active', deafened)
    showToast(deafened ? '🎧 Deafened' : '🎧 Undeafened')
  }

  const input = document.getElementById('messageInput')
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
    else broadcastTyping()
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 200) + 'px'
  })

  document.getElementById('modalOverlay').onclick = e => { if (e.target === e.currentTarget) closeModal() }
  document.addEventListener('click', () => {
    closeContextMenu()
    document.getElementById('profilePopup').classList.add('hidden')
    document.getElementById('emojiPicker').classList.add('hidden')
  })
  document.addEventListener('contextmenu', e => { if (!e.target.closest('.channel-item,.server-icon')) closeContextMenu() })
}

init()
