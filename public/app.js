(() => {
  const landing = document.querySelector('#landing');
  const app = document.querySelector('#app');
  const loginForm = document.querySelector('#loginForm');
  const loginBtn = document.querySelector('#loginBtn');
  const nameInput = document.querySelector('#nameInput');
  const toast = document.querySelector('#toast');
  const messages = document.querySelector('#messages');
  const messageForm = document.querySelector('#messageForm');
  const messageInput = document.querySelector('#messageInput');
  const membersList = document.querySelector('#membersList');
  const membersCount = document.querySelector('#membersCount');
  const onlineCount = document.querySelector('#onlineCount');
  const membersPanel = document.querySelector('#membersPanel');
  const membersToggle = document.querySelector('#membersToggle');
  const channelsPanel = document.querySelector('#channelsPanel');
  const mobileChannelsToggle = document.querySelector('#mobileChannelsToggle');
  const mobileChannelsClose = document.querySelector('#mobileChannelsClose');
  const mobileDrawerBackdrop = document.querySelector('#mobileDrawerBackdrop');
  const logoutBtn = document.querySelector('#logoutBtn');
  const selfName = document.querySelector('#selfName');
  const selfAvatar = document.querySelector('#selfAvatar');
  const voiceDock = document.querySelector('#voiceDock');
  const voiceRoomLabel = document.querySelector('#voiceRoomLabel');
  const voiceConnectionText = document.querySelector('.voice-connected-copy strong');
  const leaveVoiceBtn = document.querySelector('#leaveVoiceBtn');
  const micBtn = document.querySelector('#micBtn');
  const audioBtn = document.querySelector('#audioBtn');
  const micStatusText = document.querySelector('#micStatusText');
  const soundStatusText = document.querySelector('#soundStatusText');
  const cameraBtn = document.querySelector('#cameraBtn');
  const screenBtn = document.querySelector('#screenBtn');
  const noiseBtn = document.querySelector('#noiseBtn');
  const noiseStatusText = document.querySelector('#noiseStatusText');
  const callStage = document.querySelector('#callStage');
  const callStageTitle = document.querySelector('#callStageTitle');
  const collapseCallBtn = document.querySelector('#collapseCallBtn');
  const fullscreenCallBtn = document.querySelector('#fullscreenCallBtn');
  const videoGrid = document.querySelector('#videoGrid');
  const emptyVideo = document.querySelector('#emptyVideo');
  const audioBin = document.querySelector('#audioBin');
  const channelScroll = document.querySelector('.channel-scroll');
  const textChannelsList = document.querySelector('#textChannelsList');
  const voiceChannelsList = document.querySelector('#voiceChannelsList');
  const createTextChannelBtn = document.querySelector('#createTextChannelBtn');
  const createVoiceChannelBtn = document.querySelector('#createVoiceChannelBtn');
  const adminSettingsBtn = document.querySelector('#adminSettingsBtn');
  const editProfileBtn = document.querySelector('#editProfileBtn');

  const channelNames = {
    geral: ['geral', 'O papo principal da turma'],
    jogos: ['jogos', 'Partidas, convites e aquele GG'],
    'links-e-assuntos': ['links-e-assuntos', 'Links, vídeos e assuntos aleatórios'],
  };
  const voiceNames = {
    'sala-da-turma': 'Sala da turma',
    'jogando-juntos': 'Jogando juntos',
    'cinema-live': 'Cinema & live',
  };

  const SAVED_NAME_KEY = 'conecta.savedName';
  const SAVED_USER_KEY = 'conecta.userKey';
  const LEGACY_NOISE_SUPPRESSION_KEY = 'conecta.noiseSuppression';
  const KRISP_ENABLED_KEY = 'conecta.krispEnabled';
  const KRISP_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@livekit/krisp-noise-filter@0.4.4/+esm';

  let sessionId = sessionStorage.getItem('conecta.sessionId') || '';
  let profileName = sessionStorage.getItem('conecta.name') || '';
  let userKey = localStorage.getItem(SAVED_USER_KEY) || '';
  let socket = null;
  let reauthenticating = false;
  let socketEverConnected = false;
  let socketRecovering = false;
  let currentChannel = 'geral';
  let currentVoiceRoom = null;
  let lkRoom = null;
  let micEnabled = false;
  let roomSoundEnabled = true;
  let cameraEnabled = false;
  let screenEnabled = false;
  const savedKrispPreference = localStorage.getItem(KRISP_ENABLED_KEY);
  const legacyNoisePreference = localStorage.getItem(LEGACY_NOISE_SUPPRESSION_KEY);
  let noiseSuppressionEnabled = savedKrispPreference !== null
    ? savedKrispPreference !== 'false'
    : legacyNoisePreference !== 'false';
  let krispState = noiseSuppressionEnabled ? 'idle' : 'off';
  let krispProcessor = null;
  let krispTrack = null;
  let krispModulePromise = null;
  let krispOperationToken = 0;
  let callCollapsed = false;
  let cueAudioContext = null;
  const voiceTokenCache = new Map();
  const voiceTokenRequests = new Map();
  const participantVolumes = new Map();
  const participantMuted = new Map();
  const screenAudioVolumes = new Map();
  const screenAudioMuted = new Map();
  let stoppingScreenShare = false;
  let volumePopover = null;
  let volumePopoverIdentity = '';
  let historyLoadToken = 0;
  let channelCatalog = [];
  let lastPresence = { users: [], total: 0, max: 20 };
  let channelMenuPopover = null;
  let channelMenuTarget = null;
  let currentUser = {
    name: profileName,
    userKey,
    isMaster: false,
    isAdmin: false,
    roles: [],
    avatarId: null,
    avatarUrl: null,
    permissions: {
      send_messages: false, join_voice: false, speak: false, camera: false, screen_share: false,
      manage_channels: false, manage_roles: false, manage_members: false,
    },
  };
  let adminRoles = [];
  let adminMembers = [];
  let adminChannels = [];
  let adminModal = null;
  let adminActiveTab = 'roles';
  let adminSelectedRoleId = '';
  let adminSelectedMemberKey = '';
  let userRoleMenu = null;
  let userRoleMenuUser = null;
  let userLongPressTimer = null;
  let suppressNextUserClick = false;
  let profileModal = null;
  let pendingAvatarDataUrl = '';
  let avatarUploadBusy = false;


  function notify(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function isMobileLayout() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  function syncMobileBackdrop() {
    if (!mobileDrawerBackdrop) return;
    const visible = isMobileLayout() && (channelsPanel?.classList.contains('mobile-open') || membersPanel?.classList.contains('open'));
    mobileDrawerBackdrop.classList.toggle('open', Boolean(visible));
  }

  function openMobileChannels() {
    if (!isMobileLayout()) return;
    membersPanel?.classList.remove('open');
    channelsPanel?.classList.add('mobile-open');
    document.body.classList.add('mobile-panel-open');
    syncMobileBackdrop();
  }

  function closeMobileChannels() {
    channelsPanel?.classList.remove('mobile-open');
    if (!membersPanel?.classList.contains('open')) document.body.classList.remove('mobile-panel-open');
    syncMobileBackdrop();
  }

  function closeMobilePanels() {
    channelsPanel?.classList.remove('mobile-open');
    membersPanel?.classList.remove('open');
    document.body.classList.remove('mobile-panel-open');
    syncMobileBackdrop();
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function voiceControlIcon(type, off = false, extraClass = '') {
    const classes = `discord-voice-icon${off ? ' is-off' : ''}${extraClass ? ` ${extraClass}` : ''}`;
    const slash = off ? '<path class="discord-icon-slash" d="M3 3l18 18" />' : '';
    if (type === 'headphones') {
      return `<svg class="${classes}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5Z" />
        <path d="M20 14h-3v6h2a1 1 0 0 0 1-1v-5Z" />
        ${slash}
      </svg>`;
    }
    return `<svg class="${classes}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 11v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
      ${slash}
    </svg>`;
  }

  function avatarMarkup(name, avatarUrl = null, avatarId = null, extraClass = '') {
    const safeName = escapeHtml(name || '?');
    const safeId = avatarId ? ` data-avatar-id="${escapeHtml(avatarId)}"` : '';
    const safeAvatarName = ` data-avatar-name="${safeName}"`;
    const classes = `avatar${avatarUrl ? ' has-photo' : ''}${extraClass ? ` ${extraClass}` : ''}`;
    return `<div class="${classes}"${safeId}${safeAvatarName}>${avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" draggable="false" />`
      : escapeHtml(initials(name))}</div>`;
  }

  function setAvatarNode(node, name, avatarUrl = null, avatarId = null) {
    if (!node) return;
    node.dataset.avatarName = String(name || '?');
    if (avatarId) node.dataset.avatarId = avatarId;
    else delete node.dataset.avatarId;
    node.classList.toggle('has-photo', Boolean(avatarUrl));
    node.innerHTML = '';
    if (avatarUrl) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.draggable = false;
      node.appendChild(img);
    } else {
      node.textContent = initials(name);
    }
  }

  function updateAvatarNodes(avatarId, avatarUrl) {
    if (!avatarId) return;
    document.querySelectorAll(`.avatar[data-avatar-id="${CSS.escape(avatarId)}"]`).forEach(node => {
      setAvatarNode(node, node.dataset.avatarName || '?', avatarUrl, avatarId);
    });
  }

  function ensureUserKey() {
    if (userKey) return userKey;
    if (window.crypto?.randomUUID) {
      userKey = window.crypto.randomUUID();
    } else {
      const bytes = new Uint8Array(16);
      window.crypto?.getRandomValues?.(bytes);
      userKey = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') || `${Date.now()}${Math.random().toString(36).slice(2)}`;
    }
    localStorage.setItem(SAVED_USER_KEY, userKey);
    return userKey;
  }

  const PERMISSION_LABELS = {
    send_messages: 'Enviar mensagens',
    join_voice: 'Entrar em salas de voz',
    speak: 'Falar no microfone',
    camera: 'Usar câmera',
    screen_share: 'Compartilhar tela',
    manage_channels: 'Gerenciar canais',
    manage_roles: 'Gerenciar cargos',
    manage_members: 'Gerenciar membros',
  };

  function hasPermission(permission) {
    return Boolean(currentUser?.isMaster || currentUser?.isAdmin || currentUser?.permissions?.[permission]);
  }

  function canOpenAdmin() {
    return Boolean(currentUser?.isMaster || currentUser?.isAdmin || hasPermission('manage_roles') || hasPermission('manage_members') || hasPermission('manage_channels'));
  }

  function currentChannelObject() {
    return channelCatalog.find(item => item.slug === currentChannel) || null;
  }

  function applyMe(me) {
    if (!me) return;
    currentUser = {
      ...currentUser,
      ...me,
      permissions: { ...currentUser.permissions, ...(me.permissions || {}) },
      roles: Array.isArray(me.roles) ? me.roles : [],
    };
    if (me.name) {
      profileName = me.name;
      selfName.textContent = profileName;
    }
    setAvatarNode(selfAvatar, profileName, currentUser.avatarUrl, currentUser.avatarId);
    updatePermissionUi();
    renderChannels();
    renderPresence(lastPresence);
  }

  function roleChip(role, extraClass = '') {
    if (!role?.name) return '';
    return `<span class="role-chip ${extraClass}" style="--role-color:${escapeHtml(role.color || '#5865F2')}">${escapeHtml(role.name)}</span>`;
  }

  function updatePermissionUi() {
    const canChannels = hasPermission('manage_channels');
    createTextChannelBtn?.classList.toggle('hidden', !canChannels);
    createVoiceChannelBtn?.classList.toggle('hidden', !canChannels);
    adminSettingsBtn?.classList.toggle('hidden', !canOpenAdmin());

    const channel = currentChannelObject();
    const canSend = Boolean(channel?.isLobby || hasPermission('send_messages'));
    if (messageInput) {
      messageInput.disabled = !canSend;
      if (!canSend) messageInput.placeholder = 'Seu cargo não permite enviar mensagens neste canal';
      else if (channel) messageInput.placeholder = `Conversar em #${channel.name}`;
    }

    if (micBtn) micBtn.disabled = !canUseVoicePermission('speak');
    if (cameraBtn) cameraBtn.disabled = !canUseVoicePermission('camera');
    if (screenBtn) screenBtn.disabled = !canUseVoicePermission('screen_share');

  }

  async function refreshMe() {
    try {
      const data = await api('/api/me');
      applyMe(data.me);
      return data.me;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  function channelInfo(slug) {
    return channelNames[slug] || [slug || 'canal', ''];
  }

  function voiceRoomName(slug) {
    return voiceNames[slug] || slug || 'Sala de voz';
  }

  function voiceChannelObject(slug) {
    return channelCatalog.find(item => item.type === 'voice' && item.slug === slug) || null;
  }

  function canUseVoicePermission(permission, roomName = currentVoiceRoom) {
    const room = voiceChannelObject(roomName);
    if (room?.isLobby && ['join_voice', 'speak', 'camera', 'screen_share'].includes(permission)) return true;
    return hasPermission(permission);
  }

  function applyChannelCatalog(channels, { loadIfChanged = true } = {}) {
    channelCatalog = Array.isArray(channels) ? channels : [];

    for (const key of Object.keys(channelNames)) delete channelNames[key];
    for (const key of Object.keys(voiceNames)) delete voiceNames[key];

    const text = channelCatalog.filter(item => item.type === 'text');
    const voice = channelCatalog.filter(item => item.type === 'voice');

    for (const item of text) {
      channelNames[item.slug] = [item.name, item.subtitle || `Conversa em #${item.name}`];
    }
    for (const item of voice) {
      voiceNames[item.slug] = item.name;
    }

    const previousChannel = currentChannel;
    if (!channelNames[currentChannel]) currentChannel = text[0]?.slug || '';

    renderChannels();
    renderPresence(lastPresence);

    if (currentVoiceRoom && voiceNames[currentVoiceRoom]) {
      voiceRoomLabel.textContent = voiceRoomName(currentVoiceRoom);
      callStageTitle.textContent = voiceRoomName(currentVoiceRoom);
    }

    if (currentChannel) {
      const [name, subtitle] = channelInfo(currentChannel);
      document.querySelector('#channelTitle').textContent = name;
      document.querySelector('#channelSubtitle').textContent = subtitle;
      messageInput.placeholder = `Conversar em #${name}`;
    }

    if (loadIfChanged && previousChannel !== currentChannel && currentChannel) {
      socket?.emit('join-text-channel', currentChannel);
      loadChannelHistory(currentChannel);
    }

    updatePermissionUi();

    setTimeout(() => {
      document.querySelectorAll('.voice-channel').forEach(button => {
        prefetchVoiceToken(button.dataset.room);
      });
    }, 30);
  }

  function renderChannels() {
    const text = channelCatalog.filter(item => item.type === 'text');
    const voice = channelCatalog.filter(item => item.type === 'voice');
    const canChannels = hasPermission('manage_channels');

    textChannelsList.innerHTML = text.map(item => `
      <button class="channel text-channel${item.slug === currentChannel ? ' active' : ''}" data-channel="${escapeHtml(item.slug)}" data-channel-id="${escapeHtml(item.id)}" type="button">
        <span class="channel-icon">#</span>
        <span>${escapeHtml(item.name)}</span>
        <span class="channel-tail">${canChannels ? `<span class="channel-more" data-channel-menu="${escapeHtml(item.id)}" title="Opções" role="button" tabindex="0">⋮</span>` : ''}</span>
      </button>
    `).join('');

    voiceChannelsList.innerHTML = voice.map(item => {
      const canJoinThisRoom = item.isLobby || hasPermission('join_voice');
      return `
      <button class="channel voice-channel${item.slug === currentVoiceRoom ? ' connected' : ''}" data-room="${escapeHtml(item.slug)}" data-channel-id="${escapeHtml(item.id)}" type="button"${canJoinThisRoom ? '' : ' disabled'}>
        <span class="channel-icon">🔊</span>
        <span>${escapeHtml(item.name)}</span>
        <span class="channel-tail">
          <b class="voice-count" data-count="${escapeHtml(item.slug)}">0</b>
          ${canChannels ? `<span class="channel-more" data-channel-menu="${escapeHtml(item.id)}" title="Opções" role="button" tabindex="0">⋮</span>` : ''}
        </span>
      </button>
      <div class="voice-members hidden"></div>
    `;
    }).join('');
  }

  function renderPresence(payload = lastPresence) {
    const users = payload?.users || [];
    const total = Number(payload?.total || 0);
    const max = Number(payload?.max || 20);
    const onlineUsers = users.filter(user => user.online !== false);
    const offlineUsers = users.filter(user => user.online === false);
    lastPresence = { ...payload, users, total, max };

    onlineCount.textContent = `${total} online`;
    membersCount.textContent = `${total} / ${max}`;

    const memberMarkup = (user, offline = false) => `
      <div class="member${offline ? ' offline-member' : ''}${user.userKey ? ' manageable-user' : ''}"${user.livekitIdentity ? ` data-participant="${escapeHtml(user.livekitIdentity)}"` : ''}${user.userKey ? ` data-user-key="${escapeHtml(user.userKey)}" data-user-name="${escapeHtml(user.name)}"` : ''}>
        <div class="member-avatar-wrap">${avatarMarkup(user.name, user.avatarUrl, user.avatarId)}<span class="status-dot"></span></div>
        <div class="member-info">
          <div class="member-name-row"><strong>${escapeHtml(user.name)}${user.sessionId === sessionId ? ' (você)' : ''}</strong>${user.primaryRole ? roleChip(user.primaryRole, 'compact') : ''}</div>
          <span>${offline ? 'offline' : (user.voiceRoom ? `em ${escapeHtml(voiceRoomName(user.voiceRoom))}` : 'online')}</span>
        </div>
      </div>
    `;

    membersList.innerHTML = `
      ${onlineUsers.map(user => memberMarkup(user, false)).join('')}
      <div class="members-offline-title">OFFLINE — ${offlineUsers.length}</div>
      <div class="offline-members-list">${offlineUsers.map(user => memberMarkup(user, true)).join('')}</div>
    `;

    document.querySelectorAll('.voice-channel').forEach(button => {
      const room = button.dataset.room;
      const people = onlineUsers.filter(user => user.voiceRoom === room);
      const count = button.querySelector('[data-count]');
      if (count) count.textContent = people.length;

      let list = button.nextElementSibling;
      if (!list || !list.classList.contains('voice-members')) {
        list = document.createElement('div');
        list.className = 'voice-members';
        button.insertAdjacentElement('afterend', list);
      }

      list.innerHTML = people.map(user => `
        <div class="voice-member${user.sessionId !== sessionId && user.livekitIdentity ? ' volume-user' : ''}${user.userKey ? ' manageable-user' : ''}" title="${escapeHtml(user.name)}${user.sessionId !== sessionId && user.livekitIdentity ? ' • clique para ajustar volume' : ''}"${user.livekitIdentity ? ` data-participant="${escapeHtml(user.livekitIdentity)}" data-name="${escapeHtml(user.name)}"` : ''}${user.userKey ? ` data-user-key="${escapeHtml(user.userKey)}" data-user-name="${escapeHtml(user.name)}"` : ''}>
          <span class="voice-member-avatar-wrap">${avatarMarkup(user.name, user.avatarUrl, user.avatarId, 'voice-avatar')}<span class="voice-member-dot"></span></span>
          <span class="voice-member-name">${escapeHtml(user.name)}${user.sessionId === sessionId ? ' (você)' : ''}${user.primaryRole ? roleChip(user.primaryRole, 'micro') : ''}</span>
          <span class="voice-member-states">
            <span class="voice-state-icon${user.micEnabled ? '' : ' off'}" title="${user.micEnabled ? 'Microfone ligado' : 'Microfone mutado'}">${voiceControlIcon('mic', !user.micEnabled, 'member-control-icon')}</span>
            <span class="voice-state-icon${user.soundEnabled ? '' : ' off'}" title="${user.soundEnabled ? 'Áudio ligado' : 'Áudio desativado'}">${voiceControlIcon('headphones', !user.soundEnabled, 'member-control-icon')}</span>
          </span>
        </div>
      `).join('');
      list.classList.toggle('hidden', people.length === 0);
    });
  }

  async function loadChannels({ loadHistory = false } = {}) {
    try {
      const data = await api('/api/channels');
      if (data.me) applyMe(data.me);
      applyChannelCatalog(data.channels, { loadIfChanged: !loadHistory });
      if (loadHistory && currentChannel) loadChannelHistory(currentChannel);
      return true;
    } catch (error) {
      notify(error.message || 'Não foi possível carregar os canais.', true);
      return false;
    }
  }

  async function createChannel(type) {
    const label = type === 'text' ? 'canal de texto' : 'sala de voz';
    const name = window.prompt(`Nome do novo ${label}:`);
    if (!name?.trim()) return;

    try {
      const data = await api('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ type, name }),
      });
      applyChannelCatalog(data.channels);
      notify(type === 'text' ? 'Canal de texto criado.' : 'Sala de voz criada.');
    } catch (error) {
      notify(error.message || 'Não foi possível criar o canal.', true);
    }
  }

  async function renameChannel(channel) {
    if (!channel) return;
    const name = window.prompt('Novo nome:', channel.name);
    if (!name?.trim() || name.trim() === channel.name) return;

    try {
      const data = await api(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      applyChannelCatalog(data.channels, { loadIfChanged: false });
      notify('Canal renomeado.');
    } catch (error) {
      notify(error.message || 'Não foi possível renomear o canal.', true);
    }
  }

  async function deleteChannel(channel) {
    if (!channel) return;
    const kind = channel.type === 'text' ? 'canal de texto' : 'sala de voz';
    const extra = channel.type === 'text'
      ? '\nAs mensagens salvas deste canal também serão excluídas.'
      : '\nQuem estiver nesta sala será desconectado.';
    if (!window.confirm(`Excluir ${kind} "${channel.name}"?${extra}`)) return;

    try {
      const data = await api(`/api/channels/${encodeURIComponent(channel.id)}`, {
        method: 'DELETE',
      });
      applyChannelCatalog(data.channels);
      closeChannelMenu();
      notify('Canal excluído.');
    } catch (error) {
      notify(error.message || 'Não foi possível excluir o canal.', true);
    }
  }

  async function moveChannel(channel, direction) {
    if (!channel || !['up', 'down'].includes(direction)) return;
    try {
      const data = await api(`/api/channels/${encodeURIComponent(channel.id)}/order`, {
        method: 'PATCH',
        body: JSON.stringify({ direction }),
      });
      if (Array.isArray(data.channels)) applyChannelCatalog(data.channels, { loadIfChanged: false });
      closeChannelMenu();
      if (data.moved === false) notify(direction === 'up' ? 'Este canal já está no topo.' : 'Este canal já está no final.');
      else notify(direction === 'up' ? 'Canal movido para cima.' : 'Canal movido para baixo.');
    } catch (error) {
      notify(error.message || 'Não foi possível mover o canal.', true);
    }
  }

  function ensureChannelMenu() {
    if (channelMenuPopover) return channelMenuPopover;
    channelMenuPopover = document.createElement('div');
    channelMenuPopover.className = 'channel-menu-popover hidden';
    document.body.appendChild(channelMenuPopover);

    channelMenuPopover.addEventListener('click', (event) => {
      if (event.target.closest('[data-channel-up]')) moveChannel(channelMenuTarget, 'up');
      if (event.target.closest('[data-channel-down]')) moveChannel(channelMenuTarget, 'down');
      if (event.target.closest('[data-channel-rename]')) renameChannel(channelMenuTarget);
      if (event.target.closest('[data-channel-delete]')) deleteChannel(channelMenuTarget);
    });
    return channelMenuPopover;
  }

  function openChannelMenu(channelId, anchor) {
    const channel = channelCatalog.find(item => item.id === channelId);
    if (!channel || !anchor) return;
    channelMenuTarget = channel;
    const menu = ensureChannelMenu();
    const sameType = channelCatalog.filter(item => item.type === channel.type);
    const index = sameType.findIndex(item => item.id === channel.id);
    const canMoveUp = index > 0;
    const canMoveDown = index >= 0 && index < sameType.length - 1;
    menu.innerHTML = `
      <button type="button" data-channel-up${canMoveUp ? '' : ' disabled'}>↑ Mover para cima</button>
      <button type="button" data-channel-down${canMoveDown ? '' : ' disabled'}>↓ Mover para baixo</button>
      ${channel.isLobby ? '' : '<div class="channel-menu-separator"></div><button type="button" data-channel-rename>✎ Renomear</button><button type="button" class="danger" data-channel-delete>🗑 Excluir</button>'}
    `;
    menu.classList.remove('hidden');

    const rect = anchor.getBoundingClientRect();
    const width = 190;
    const gap = 6;
    let left = rect.right - width;
    if (left < gap) left = gap;
    let top = rect.bottom + gap;
    const estimatedHeight = channel.isLobby ? 86 : 170;
    if (top + estimatedHeight > window.innerHeight) top = Math.max(gap, rect.top - estimatedHeight);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function closeChannelMenu() {
    channelMenuTarget = null;
    channelMenuPopover?.classList.add('hidden');
  }

  function switchTextChannel(channel) {
    if (!channel) return;
    if (channel === currentChannel) {
      closeMobileChannels();
      return;
    }
    currentChannel = channel;
    document.querySelectorAll('.text-channel').forEach(el => {
      el.classList.toggle('active', el.dataset.channel === channel);
    });
    socket?.emit('join-text-channel', channel);
    const [name, subtitle] = channelInfo(channel);
    document.querySelector('#channelTitle').textContent = name;
    document.querySelector('#channelSubtitle').textContent = subtitle;
    messageInput.placeholder = `Conversar em #${name}`;
    updatePermissionUi();
    loadChannelHistory(channel);
    closeMobileChannels();
  }

  function getParticipantVolume(identity) {
    return participantVolumes.has(identity) ? participantVolumes.get(identity) : 1;
  }

  function isParticipantMuted(identity) {
    return participantMuted.get(identity) === true;
  }

  function getScreenAudioVolume(identity) {
    return screenAudioVolumes.has(identity) ? screenAudioVolumes.get(identity) : 1;
  }

  function isScreenAudioMuted(identity) {
    return screenAudioMuted.get(identity) === true;
  }

  function isScreenAudioSource(source) {
    const known = LivekitClient?.Track?.Source?.ScreenShareAudio;
    return source === known || source === 'screen_share_audio';
  }

  function applyAudioElementState(el) {
    if (!el) return;
    const identity = el.dataset.participant || '';
    const screenAudio = el.dataset.audioSource === 'screen';
    const individuallyMuted = screenAudio ? isScreenAudioMuted(identity) : isParticipantMuted(identity);
    el.muted = !roomSoundEnabled || individuallyMuted;
    el.volume = screenAudio
      ? getScreenAudioVolume(identity)
      : (identity ? getParticipantVolume(identity) : 1);
  }

  function applyParticipantAudioState(identity) {
    if (!identity) return;
    audioBin.querySelectorAll('audio').forEach(el => {
      if (el.dataset.participant !== identity || el.dataset.audioSource === 'screen') return;
      applyAudioElementState(el);
    });
  }

  function applyScreenAudioState(identity) {
    if (!identity) return;
    audioBin.querySelectorAll('audio').forEach(el => {
      if (el.dataset.participant !== identity || el.dataset.audioSource !== 'screen') return;
      applyAudioElementState(el);
    });
    updateScreenAudioControls(identity);
  }

  function applyRoomSoundState() {
    audioBin.querySelectorAll('audio').forEach(applyAudioElementState);
    document.querySelectorAll('.video-tile.screen[data-participant]').forEach(tile => {
      updateScreenAudioControls(tile.dataset.participant || '');
    });
  }

  function ensureVolumePopover() {
    if (volumePopover) return volumePopover;
    volumePopover = document.createElement('div');
    volumePopover.className = 'volume-popover hidden';
    volumePopover.innerHTML = `
      <div class="volume-popover-head">
        <strong data-volume-name>Volume</strong>
        <button type="button" data-volume-close aria-label="Fechar">×</button>
      </div>
      <div class="volume-popover-row"><span>Volume</span><b data-volume-value>100%</b></div>
      <input data-volume-range class="volume-range" type="range" min="0" max="100" step="1" value="100" />
      <button type="button" class="volume-mute-btn" data-volume-mute>🔇 Silenciar só esta pessoa</button>
      <small>Esse ajuste vale somente no seu computador.</small>
    `;
    document.body.appendChild(volumePopover);

    const range = volumePopover.querySelector('[data-volume-range]');
    const muteBtn = volumePopover.querySelector('[data-volume-mute]');
    volumePopover.querySelector('[data-volume-close]').addEventListener('click', closeVolumePopover);

    range.addEventListener('input', () => {
      if (!volumePopoverIdentity) return;
      const value = Number(range.value) / 100;
      participantVolumes.set(volumePopoverIdentity, value);
      volumePopover.querySelector('[data-volume-value]').textContent = `${Math.round(value * 100)}%`;
      applyParticipantAudioState(volumePopoverIdentity);
    });

    muteBtn.addEventListener('click', () => {
      if (!volumePopoverIdentity) return;
      participantMuted.set(volumePopoverIdentity, !isParticipantMuted(volumePopoverIdentity));
      updateVolumePopoverState();
      applyParticipantAudioState(volumePopoverIdentity);
    });

    return volumePopover;
  }

  function updateVolumePopoverState() {
    if (!volumePopover || !volumePopoverIdentity) return;
    const muted = isParticipantMuted(volumePopoverIdentity);
    const volume = getParticipantVolume(volumePopoverIdentity);
    volumePopover.querySelector('[data-volume-range]').value = String(Math.round(volume * 100));
    volumePopover.querySelector('[data-volume-value]').textContent = `${Math.round(volume * 100)}%`;
    const muteBtn = volumePopover.querySelector('[data-volume-mute]');
    muteBtn.textContent = muted ? '🔊 Ouvir novamente' : '🔇 Silenciar só esta pessoa';
    muteBtn.classList.toggle('muted', muted);
  }

  function openVolumePopover(identity, name, anchor) {
    if (!identity || !anchor) return;
    if (lkRoom?.localParticipant?.identity === identity) return;
    const popover = ensureVolumePopover();
    volumePopoverIdentity = identity;
    popover.querySelector('[data-volume-name]').textContent = name || 'Volume';
    updateVolumePopoverState();
    popover.classList.remove('hidden');

    const rect = anchor.getBoundingClientRect();
    const width = 240;
    const gap = 8;
    let left = rect.right + gap;
    if (left + width > window.innerWidth - gap) left = Math.max(gap, rect.left - width - gap);
    const top = Math.max(gap, Math.min(rect.top, window.innerHeight - 170));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function closeVolumePopover() {
    volumePopoverIdentity = '';
    volumePopover?.classList.add('hidden');
  }

  function microphoneCaptureOptions() {
    // Mantemos o tratamento básico do navegador mesmo com Krisp.
    // A documentação do LiveKit permite deixar echo cancellation/noise suppression ativos.
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
  }

  function getMicrophoneTrack() {
    if (!lkRoom) return null;
    const publication = [...lkRoom.localParticipant.audioTrackPublications.values()]
      .find(item => item.source === LivekitClient.Track.Source.Microphone);
    return publication?.track || null;
  }

  async function loadKrispModule() {
    if (!krispModulePromise) {
      krispModulePromise = import(KRISP_MODULE_URL).catch(error => {
        krispModulePromise = null;
        throw error;
      });
    }
    return krispModulePromise;
  }

  async function disableKrispProcessor({ dispose = false } = {}) {
    const processor = krispProcessor;
    const track = krispTrack;

    if (processor) {
      try { await processor.setEnabled(false); } catch {}
    }

    if (dispose) {
      if (track?.stopProcessor) {
        try { await track.stopProcessor(); } catch {}
      }
      krispProcessor = null;
      krispTrack = null;
    }
  }

  async function enableKrispOnMicrophone() {
    if (!lkRoom || !micEnabled || !noiseSuppressionEnabled) return false;

    const operationToken = krispOperationToken;
    krispState = 'loading';
    updateControlButtons();

    try {
      const krisp = await loadKrispModule();
      if (operationToken !== krispOperationToken || !noiseSuppressionEnabled || !lkRoom) return false;

      if (typeof krisp.isKrispNoiseFilterSupported === 'function' && !krisp.isKrispNoiseFilterSupported()) {
        krispState = 'fallback';
        updateControlButtons();
        return false;
      }

      let track = getMicrophoneTrack();
      for (let attempt = 0; !track && attempt < 6; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (operationToken !== krispOperationToken || !noiseSuppressionEnabled || !lkRoom) return false;
        track = getMicrophoneTrack();
      }
      if (!track?.setProcessor) {
        krispState = 'fallback';
        updateControlButtons();
        return false;
      }

      if (krispTrack !== track || !krispProcessor) {
        if (krispTrack && krispTrack !== track) await disableKrispProcessor({ dispose: true });
        krispProcessor = krisp.KrispNoiseFilter({ quality: 'medium' });
        await track.setProcessor(krispProcessor);
        krispTrack = track;
      }

      if (operationToken !== krispOperationToken || !noiseSuppressionEnabled) {
        await disableKrispProcessor();
        krispState = 'off';
        updateControlButtons();
        return false;
      }

      await krispProcessor.setEnabled(true);
      krispState = 'active';
      updateControlButtons();
      return true;
    } catch (error) {
      console.error('Krisp não pôde ser iniciado:', error);
      krispState = 'fallback';
      updateControlButtons();
      return false;
    }
  }

  function startKrispInBackground({ notifyOnFallback = false } = {}) {
    if (!noiseSuppressionEnabled || !lkRoom || !micEnabled) return;
    enableKrispOnMicrophone().then(active => {
      if (!active && notifyOnFallback && noiseSuppressionEnabled && currentVoiceRoom) {
        notify('Krisp não ficou disponível neste navegador. A redução básica de ruído continua ativa.', true);
      }
    });
  }

  function setVoiceConnectionStatus(status = 'connected') {
    if (!voiceConnectionText) return;
    if (status === 'reconnecting') {
      voiceConnectionText.innerHTML = '<span class="signal-bars">▂▄▆</span> Reconectando…';
      voiceConnectionText.title = 'A conexão oscilou. O Conecta está tentando voltar automaticamente.';
      return;
    }
    voiceConnectionText.innerHTML = '<span class="signal-bars">▂▄▆</span> Voz conectada';
    voiceConnectionText.title = '';
  }

  function playVoiceCue(type) {
    if (!roomSoundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      cueAudioContext ||= new AudioCtx();
      const ctx = cueAudioContext;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const now = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const joining = type === 'join';
      osc.frequency.setValueAtTime(joining ? 470 : 680, now);
      osc.frequency.exponentialRampToValueAtTime(joining ? 740 : 410, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.11, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.20);
    } catch {}
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (sessionId) headers.Authorization = `Bearer ${sessionId}`;
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Algo deu errado.');
    return data;
  }

  async function login(name, { remember = true, silent = false } = {}) {
    loginBtn.disabled = true;
    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ name, userKey: ensureUserKey() }),
      });
      sessionId = data.sessionId;
      profileName = data.name;
      userKey = data.userKey || ensureUserKey();
      localStorage.setItem(SAVED_USER_KEY, userKey);
      voiceTokenCache.clear();
      voiceTokenRequests.clear();
      sessionStorage.setItem('conecta.sessionId', sessionId);
      sessionStorage.setItem('conecta.name', profileName);
      if (remember) {
        localStorage.setItem(SAVED_NAME_KEY, profileName);
      }
      if (data.me) applyMe(data.me);
      enterApp();
      return true;
    } catch (error) {
      if (!silent) notify(error.message, true);
      return false;
    } finally {
      loginBtn.disabled = false;
    }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await login(nameInput.value);
  });

  function enterApp() {
    landing.classList.add('hidden');
    app.classList.remove('hidden');
    selfName.textContent = profileName;
    setAvatarNode(selfAvatar, profileName, currentUser.avatarUrl, currentUser.avatarId);
    connectSocket();
    refreshMe();
    loadChannels({ loadHistory: true });
  }

  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io({
      auth: { sessionId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      const recovered = socketRecovering;
      socketEverConnected = true;
      socketRecovering = false;

      // Ao reconectar, o servidor cria o socket de novo. Restauramos o canal e a presença de voz.
      if (currentChannel) socket.emit('join-text-channel', currentChannel);
      if (currentVoiceRoom) emitVoiceState();
      if (recovered) {
        loadChannelHistory(currentChannel);
        notify('Conexão restabelecida.');
      }

      // Deixa os tokens das salas prontos em segundo plano para o clique responder mais rápido.
      setTimeout(() => {
        document.querySelectorAll('.voice-channel').forEach(button => {
          prefetchVoiceToken(button.dataset.room);
        });
      }, 120);
    });

    socket.on('disconnect', (reason) => {
      if (!socketEverConnected || reason === 'io client disconnect') return;
      socketRecovering = true;
      notify('Conexão instável. Tentando reconectar automaticamente…');

      // Se o servidor encerrou o socket, o Socket.IO exige um connect() manual.
      if (reason === 'io server disconnect') {
        setTimeout(() => socket?.connect(), 1000);
      }
    });

    socket.io.on('reconnect_attempt', () => {
      socketRecovering = true;
    });

    socket.on('connect_error', async (error) => {
      const message = error.message || 'Não foi possível entrar na turma.';
      if (/sessão/i.test(message)) {
        const savedName = localStorage.getItem(SAVED_NAME_KEY) || '';
        if (!reauthenticating && savedName) {
          reauthenticating = true;
          socket?.disconnect();
          sessionStorage.removeItem('conecta.sessionId');
          sessionStorage.removeItem('conecta.name');
          sessionId = '';
          profileName = '';
          const ok = await login(savedName, { remember: true, silent: true });
          reauthenticating = false;
          if (!ok) {
            landing.classList.remove('hidden');
            app.classList.add('hidden');
            nameInput.value = savedName;
            notify('Seu login salvo não pôde ser validado. Entre novamente.', true);
          }
          return;
        }
      }
      // Durante uma oscilação comum, o Socket.IO seguirá tentando sozinho.
      if (socketRecovering) return;
      notify(message, true);
    });

    socket.on('presence', (payload) => {
      renderPresence(payload);
    });

    socket.on('channels-updated', ({ channels } = {}) => {
      if (Array.isArray(channels)) applyChannelCatalog(channels);
    });

    socket.on('permissions-updated', ({ me, channels } = {}) => {
      if (me) applyMe(me);
      if (Array.isArray(channels)) applyChannelCatalog(channels);
      renderPresence(lastPresence);
    });

    socket.on('avatar-updated', ({ avatarId, avatarUrl } = {}) => {
      if (!avatarId) return;
      if (currentUser.avatarId === avatarId) {
        currentUser.avatarUrl = avatarUrl || null;
        setAvatarNode(selfAvatar, profileName, currentUser.avatarUrl, currentUser.avatarId);
      }
      if (Array.isArray(lastPresence?.users)) {
        lastPresence.users = lastPresence.users.map(user => user.avatarId === avatarId ? { ...user, avatarUrl: avatarUrl || null } : user);
        renderPresence(lastPresence);
      }
      adminMembers = adminMembers.map(member => member.avatarId === avatarId ? { ...member, avatarUrl: avatarUrl || null } : member);
      updateAvatarNodes(avatarId, avatarUrl || null);
    });

    socket.on('voice-access-revoked', ({ room } = {}) => {
      if (currentVoiceRoom !== room) return;
      leaveVoice(false);
      notify('Seu acesso a esta sala de voz foi removido.', true);
    });

    socket.on('voice-room-deleted', ({ room, name } = {}) => {
      if (currentVoiceRoom !== room) return;
      leaveVoice(false);
      notify(`A sala "${name || 'de voz'}" foi excluída.`);
    });

    socket.on('chat-message', (msg) => {
      if (msg.channel !== currentChannel) return;
      appendMessage(msg);
    });

    socket.on('message-edited', (msg) => {
      if (msg.channel !== currentChannel) return;
      updateMessageElement(msg);
    });

    socket.on('message-deleted', (msg) => {
      if (msg.channel !== currentChannel) return;
      const element = messages.querySelector(`[data-message-id="${CSS.escape(msg.id)}"]`);
      element?.remove();
    });

    socket.on('chat-error', (payload = {}) => {
      notify(payload.message || 'Não foi possível concluir a ação no chat.', true);
    });
  }

  function clearMessagesForChannel() {
    messages.innerHTML = `
      <div class="welcome-message">
        <div class="hash-bubble">#</div>
        <h2>Bem-vindo ao <span>#${escapeHtml(channelInfo(currentChannel)[0])}</span></h2>
        <p>As mensagens deste canal ficam salvas e podem ser editadas ou excluídas por quem enviou.</p>
      </div>`;
  }

  async function loadChannelHistory(channel) {
    const requestToken = ++historyLoadToken;
    clearMessagesForChannel();

    try {
      const data = await api(`/api/messages/${encodeURIComponent(channel)}`);
      if (requestToken !== historyLoadToken || channel !== currentChannel) return;

      for (const msg of data.messages || []) {
        appendMessage(msg, { scroll: false });
      }
      sortMessagesByTime();
      messages.scrollTop = messages.scrollHeight;
    } catch (error) {
      if (requestToken !== historyLoadToken || channel !== currentChannel) return;
      notify(error.message || 'Não foi possível carregar as mensagens.', true);
    }
  }

  createTextChannelBtn?.addEventListener('click', () => createChannel('text'));
  createVoiceChannelBtn?.addEventListener('click', () => createChannel('voice'));

  channelScroll?.addEventListener('click', (event) => {
    const menuTarget = event.target.closest('[data-channel-menu]');
    if (menuTarget) {
      event.preventDefault();
      event.stopPropagation();
      openChannelMenu(menuTarget.dataset.channelMenu, menuTarget);
      return;
    }

    const textButton = event.target.closest('.text-channel[data-channel]');
    if (textButton) {
      switchTextChannel(textButton.dataset.channel);
      return;
    }

    const voiceButton = event.target.closest('.voice-channel[data-room]');
    if (voiceButton) {
      joinVoice(voiceButton.dataset.room);
      closeMobileChannels();
    }
  });

  channelScroll?.addEventListener('pointerover', (event) => {
    const voiceButton = event.target.closest('.voice-channel[data-room]');
    if (voiceButton) prefetchVoiceToken(voiceButton.dataset.room);
  }, { passive: true });

  channelScroll?.addEventListener('pointerdown', (event) => {
    const voiceButton = event.target.closest('.voice-channel[data-room]');
    if (voiceButton) prefetchVoiceToken(voiceButton.dataset.room);
  }, { passive: true });

  channelScroll?.addEventListener('focusin', (event) => {
    const voiceButton = event.target.closest('.voice-channel[data-room]');
    if (voiceButton) prefetchVoiceToken(voiceButton.dataset.room);
  });

  messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    const channel = currentChannelObject();
    if (!channel?.isLobby && !hasPermission('send_messages')) return notify('Seu cargo não permite enviar mensagens aqui.', true);
    if (!text || !socket?.connected) return;
    socket.emit('chat-message', { channel: currentChannel, text });
    messageInput.value = '';
  });

  function appendMessage(msg, { scroll = true } = {}) {
    if (!msg?.id) return;
    if (messages.querySelector(`[data-message-id="${CSS.escape(msg.id)}"]`)) return;

    const div = document.createElement('div');
    div.className = `message${msg.mine ? ' own-message' : ''}`;
    div.dataset.messageId = msg.id;
    div.dataset.ts = String(Number(msg.ts) || Date.now());

    const time = new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      ${avatarMarkup(msg.name, msg.avatarUrl, msg.avatarId)}
      <div class="message-content">
        <div class="message-head">
          <strong>${escapeHtml(msg.name)}</strong>
          <time>${time}</time>
          <span class="message-edited${msg.editedAt ? '' : ' hidden'}">(editada)</span>
        </div>
        <p class="message-text">${escapeHtml(msg.text)}</p>
      </div>
      ${msg.mine ? `
        <div class="message-actions" aria-label="Ações da mensagem">
          <button type="button" data-message-edit title="Editar mensagem" aria-label="Editar mensagem">✎</button>
          <button type="button" data-message-delete title="Excluir mensagem" aria-label="Excluir mensagem">🗑</button>
        </div>
      ` : ''}
    `;

    messages.appendChild(div);
    if (scroll) messages.scrollTop = messages.scrollHeight;
  }

  function sortMessagesByTime() {
    const items = [...messages.querySelectorAll('.message')];
    items.sort((a, b) => Number(a.dataset.ts || 0) - Number(b.dataset.ts || 0));
    items.forEach(item => messages.appendChild(item));
  }

  function updateMessageElement(msg) {
    const element = messages.querySelector(`[data-message-id="${CSS.escape(msg.id)}"]`);
    if (!element) return;

    const editor = element.querySelector('.message-editor');
    if (editor) {
      const p = document.createElement('p');
      p.className = 'message-text';
      p.textContent = msg.text;
      editor.replaceWith(p);
    } else {
      const text = element.querySelector('.message-text');
      if (text) text.textContent = msg.text;
    }

    const edited = element.querySelector('.message-edited');
    if (edited) edited.classList.remove('hidden');
  }

  function startMessageEdit(messageElement) {
    const textElement = messageElement?.querySelector('.message-text');
    if (!textElement || messageElement.querySelector('.message-editor')) return;

    const originalText = textElement.textContent;
    const editor = document.createElement('div');
    editor.className = 'message-editor';

    const textarea = document.createElement('textarea');
    textarea.value = originalText;
    textarea.maxLength = 1500;
    textarea.rows = 2;

    const actions = document.createElement('div');
    actions.className = 'message-editor-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Salvar';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';

    actions.append(save, cancel);
    editor.append(textarea, actions);
    textElement.replaceWith(editor);

    const restore = () => {
      const p = document.createElement('p');
      p.className = 'message-text';
      p.textContent = originalText;
      editor.replaceWith(p);
    };

    const submit = () => {
      const text = textarea.value.trim();
      if (!text) return;
      socket?.emit('edit-message', { id: messageElement.dataset.messageId, text });
      save.disabled = true;
      textarea.disabled = true;
    };

    save.addEventListener('click', submit);
    cancel.addEventListener('click', restore);
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        restore();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  messages.addEventListener('click', (event) => {
    const messageElement = event.target.closest('.message[data-message-id]');
    if (!messageElement) return;

    if (event.target.closest('[data-message-edit]')) {
      startMessageEdit(messageElement);
      return;
    }

    if (event.target.closest('[data-message-delete]')) {
      if (window.confirm('Excluir esta mensagem?')) {
        socket?.emit('delete-message', { id: messageElement.dataset.messageId });
      }
    }
  });


  async function requestVoiceToken(roomName) {
    const data = await api('/api/livekit-token', {
      method: 'POST',
      body: JSON.stringify({ room: roomName }),
    });
    // O token do servidor vale 15 minutos. Renovamos antes disso.
    voiceTokenCache.set(roomName, { data, expiresAt: Date.now() + 10 * 60 * 1000 });
    return data;
  }

  function prefetchVoiceToken(roomName) {
    if (!roomName || !sessionId || !canUseVoicePermission('join_voice', roomName)) return;
    const cached = voiceTokenCache.get(roomName);
    if (cached && cached.expiresAt > Date.now()) return;
    if (voiceTokenRequests.has(roomName)) return;

    const pending = requestVoiceToken(roomName)
      .catch(() => null)
      .finally(() => voiceTokenRequests.delete(roomName));
    voiceTokenRequests.set(roomName, pending);
  }

  async function getVoiceToken(roomName) {
    const cached = voiceTokenCache.get(roomName);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const pending = voiceTokenRequests.get(roomName);
    if (pending) {
      const data = await pending;
      if (data) return data;
    }

    return requestVoiceToken(roomName);
  }

  function showVoiceRoomImmediately(roomName) {
    currentVoiceRoom = roomName;
    micEnabled = false;
    cameraEnabled = false;
    screenEnabled = false;
    voiceDock.classList.remove('hidden');
    mobileChannelsToggle?.classList.add('voice-active');
    setVoiceConnectionStatus('connected');
    voiceRoomLabel.textContent = voiceRoomName(roomName);
    callStageTitle.textContent = voiceRoomName(roomName);
    callStage.classList.add('hidden');
    callCollapsed = false;
    document.querySelectorAll('.voice-channel').forEach(el => {
      el.classList.toggle('connected', el.dataset.room === roomName);
    });
    updateControlButtons();
    emitVoiceState();
  }

  function emitVoiceState() {
    if (!currentVoiceRoom) return;
    socket?.emit('voice-state', {
      room: currentVoiceRoom,
      micEnabled,
      soundEnabled: roomSoundEnabled,
    });
  }

  function updateSpeakingIndicators(activeSpeakers = []) {
    const activeIds = new Set(activeSpeakers.map(participant => participant.identity));

    document.querySelectorAll('[data-participant]').forEach(element => {
      element.classList.toggle('speaking', activeIds.has(element.dataset.participant));
    });

    if (lkRoom?.localParticipant?.identity) {
      const localSpeaking = activeIds.has(lkRoom.localParticipant.identity);
      document.querySelector('.self-card')?.classList.toggle('speaking', localSpeaking);
    }
  }

  async function joinVoice(roomName) {
    if (!canUseVoicePermission('join_voice', roomName)) {
      notify('Seu cargo não permite entrar nesta sala de voz.', true);
      return;
    }
    if (currentVoiceRoom === roomName && lkRoom) {
      callCollapsed = false;
      syncCallStageVisibility();
      return;
    }
    try {
      await leaveVoice(false);

      // Resposta visual imediata: o usuário já aparece na sala assim que clica.
      showVoiceRoomImmediately(roomName);
      playVoiceCue('join');

      // Na maioria dos cliques este token já foi preparado em segundo plano.
      const data = await getVoiceToken(roomName);

      const { Room, RoomEvent, Track } = LivekitClient;
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
          degradationPreference: 'maintain-framerate',
        },
      });
      lkRoom = room;

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const source = publication?.source ?? track.source;
          const screenAudio = isScreenAudioSource(source);
          const el = track.attach();
          el.autoplay = true;
          el.dataset.participant = participant.identity;
          el.dataset.audioSource = screenAudio ? 'screen' : 'microphone';
          audioBin.appendChild(el);
          applyAudioElementState(el);
          if (screenAudio) updateScreenAudioControls(participant.identity);
        } else if (track.kind === Track.Kind.Video) {
          addVideoTrack(
            track,
            participant.name || participant.identity,
            (publication?.source ?? track.source) === Track.Source.ScreenShare,
            false,
            participant.identity,
          );
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        const wasScreenAudio = track.kind === Track.Kind.Audio && isScreenAudioSource(publication?.source ?? track.source);
        removeTrack(track);
        if (wasScreenAudio && participant?.identity) {
          setTimeout(() => updateScreenAudioControls(participant.identity), 0);
        }
      });
      if (RoomEvent.LocalTrackUnpublished) {
        room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
          if (room !== lkRoom) return;
          if (publication?.source === Track.Source.ScreenShare) screenEnabled = false;
          if (publication?.source === Track.Source.Camera) cameraEnabled = false;
          updateControlButtons();
          setTimeout(refreshLocalVideo, 0);
        });
      }
      room.on(RoomEvent.ParticipantConnected, () => {
        playVoiceCue('join');
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        updateSpeakingIndicators(speakers);
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        playVoiceCue('leave');
        document.querySelectorAll(`[data-participant="${CSS.escape(participant.identity)}"]`).forEach(el => el.remove());
        participantVolumes.delete(participant.identity);
        participantMuted.delete(participant.identity);
        screenAudioVolumes.delete(participant.identity);
        screenAudioMuted.delete(participant.identity);
        if (volumePopoverIdentity === participant.identity) closeVolumePopover();
        updateEmptyVideo();
      });
      room.on(RoomEvent.Reconnecting, () => {
        if (room !== lkRoom || !currentVoiceRoom) return;
        setVoiceConnectionStatus('reconnecting');
        notify('A conexão da voz oscilou. Reconectando automaticamente…');
      });

      room.on(RoomEvent.Reconnected, () => {
        if (room !== lkRoom || !currentVoiceRoom) return;
        setVoiceConnectionStatus('connected');
        applyRoomSoundState();
        emitVoiceState();
        refreshLocalVideo();
        notify('Voz reconectada.');
      });

      room.on(RoomEvent.Disconnected, () => {
        if (room !== lkRoom) return;
        lkRoom = null;
        if (currentVoiceRoom) {
          setVoiceConnectionStatus('reconnecting');
          notify('A voz perdeu a conexão depois de várias tentativas. Clique na sala para entrar novamente.', true);
          finishVoiceUi();
        }
      });

      await room.connect(data.url, data.token);
      setVoiceConnectionStatus('connected');
      updateSpeakingIndicators(room.activeSpeakers || []);

      if (canUseVoicePermission('speak', roomName)) {
        try {
          await lkRoom.localParticipant.setMicrophoneEnabled(true, microphoneCaptureOptions());
          micEnabled = true;
          startKrispInBackground({ notifyOnFallback: true });
        } catch {
          micEnabled = false;
          notify('Entre na sala de voz. Se quiser falar, permita o microfone no navegador.', true);
        }
      } else {
        micEnabled = false;
      }
      updateControlButtons();
      emitVoiceState();
      refreshLocalVideo();
    } catch (error) {
      console.error(error);
      notify(error.message || 'Não foi possível entrar na sala de voz.', true);
      await leaveVoice(false);
    }
  }

  function syncCallStageVisibility() {
    const hasVideo = Boolean(videoGrid.querySelector('.video-tile'));
    const shouldShow = Boolean(currentVoiceRoom && hasVideo && !callCollapsed);
    callStage.classList.toggle('hidden', !shouldShow);

    if (!hasVideo && document.fullscreenElement === callStage) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function updateVideoLayout() {
    const tiles = [...videoGrid.querySelectorAll('.video-tile')];
    const hasScreen = tiles.some(tile => tile.classList.contains('screen'));

    videoGrid.classList.toggle('single-video', tiles.length === 1);
    videoGrid.classList.toggle('two-videos', tiles.length === 2);
    videoGrid.classList.toggle('has-screen', hasScreen);
    callStage.classList.toggle('screen-active', hasScreen);

    // Quando uma live começa, ela vira automaticamente o destaque principal.
    if (hasScreen && !tiles.some(tile => tile.classList.contains('focused'))) {
      tiles.find(tile => tile.classList.contains('screen'))?.classList.add('focused');
    }

    if (!hasScreen && tiles.length <= 1) {
      tiles.forEach(tile => tile.classList.remove('focused'));
    }

    videoGrid.classList.toggle('has-focus', tiles.some(tile => tile.classList.contains('focused')));
    syncCallStageVisibility();
  }

  function focusVideoTile(tile) {
    if (!tile || !videoGrid.contains(tile)) return;
    const tiles = [...videoGrid.querySelectorAll('.video-tile')];
    if (tiles.length <= 1) return;

    const hasScreen = tiles.some(item => item.classList.contains('screen'));
    const wasFocused = tile.classList.contains('focused');
    tiles.forEach(item => item.classList.remove('focused'));

    // Sem compartilhamento de tela, clicar novamente no destaque volta para a grade normal.
    if (!(wasFocused && !hasScreen)) tile.classList.add('focused');
    updateVideoLayout();
  }

  async function toggleVideoTileFullscreen(tile) {
    if (!tile) return;
    try {
      if (document.fullscreenElement === tile) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await tile.requestFullscreen();
      }
    } catch (error) {
      console.error(error);
      notify('Não foi possível abrir este vídeo em tela cheia.', true);
    }
  }

  function syncVideoAspect(tile, video, track) {
    if (!tile || !video) return;
    const apply = () => {
      const settings = track?.mediaStreamTrack?.getSettings?.() || {};
      const width = Number(video.videoWidth || settings.width || 0);
      const height = Number(video.videoHeight || settings.height || 0);
      if (width > 0 && height > 0) {
        tile.style.setProperty('--media-aspect', `${width} / ${height}`);
      }
    };
    apply();
    video.addEventListener('loadedmetadata', apply, { once: true });
    video.addEventListener('resize', apply);
  }

  function hasRemoteScreenAudio(identity) {
    if (!identity) return false;
    return Boolean(audioBin.querySelector(`audio[data-participant="${CSS.escape(identity)}"][data-audio-source="screen"]`));
  }

  function updateScreenAudioControls(identity) {
    if (!identity) return;
    document.querySelectorAll('.video-tile.screen[data-participant]').forEach(tile => {
      if (tile.dataset.participant !== identity) return;
      const control = tile.querySelector('.screen-audio-control');
      if (!control) return;
      const hasAudio = hasRemoteScreenAudio(identity);
      const muted = !roomSoundEnabled || isScreenAudioMuted(identity);
      const volume = getScreenAudioVolume(identity);
      const button = control.querySelector('[data-screen-audio-mute]');
      const range = control.querySelector('[data-screen-audio-range]');
      const value = control.querySelector('[data-screen-audio-value]');
      control.classList.toggle('no-audio', !hasAudio);
      if (button) {
        button.disabled = !hasAudio;
        button.textContent = hasAudio ? (muted ? '🔇' : '🔊') : '🔇';
        button.title = hasAudio ? (muted ? 'Ativar som da live' : 'Silenciar som da live') : 'Esta live não está transmitindo áudio';
      }
      if (range) {
        range.disabled = !hasAudio;
        range.value = String(Math.round(volume * 100));
      }
      if (value) value.textContent = hasAudio ? `${Math.round(volume * 100)}%` : 'Sem áudio';
    });
  }

  function addScreenAudioControls(tile, identity, local) {
    if (!tile || !identity || local || tile.querySelector('.screen-audio-control')) return;
    const control = document.createElement('div');
    control.className = 'screen-audio-control no-audio';
    control.innerHTML = `
      <button type="button" data-screen-audio-mute title="Som da live" aria-label="Som da live">🔇</button>
      <input type="range" min="0" max="100" step="1" value="100" data-screen-audio-range aria-label="Volume da live" />
      <span data-screen-audio-value>Sem áudio</span>
    `;
    control.addEventListener('click', event => event.stopPropagation());
    control.addEventListener('dblclick', event => event.stopPropagation());
    control.addEventListener('pointerdown', event => event.stopPropagation());

    const mute = control.querySelector('[data-screen-audio-mute]');
    const range = control.querySelector('[data-screen-audio-range]');
    mute.addEventListener('click', event => {
      event.stopPropagation();
      if (!hasRemoteScreenAudio(identity)) return;
      screenAudioMuted.set(identity, !isScreenAudioMuted(identity));
      applyScreenAudioState(identity);
    });
    range.addEventListener('input', event => {
      event.stopPropagation();
      const value = Number(range.value) / 100;
      screenAudioVolumes.set(identity, Math.max(0, Math.min(1, value)));
      if (value > 0 && isScreenAudioMuted(identity)) screenAudioMuted.set(identity, false);
      applyScreenAudioState(identity);
    });
    tile.appendChild(control);
    updateScreenAudioControls(identity);
  }

  function prepareVideoTile(tile) {
    if (!tile || tile.dataset.interactive === 'true') return;
    tile.dataset.interactive = 'true';
    tile.tabIndex = 0;
    tile.title = 'Clique para destacar • duplo clique para tela cheia';

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.type = 'button';
    fullscreenBtn.className = 'video-tile-fullscreen';
    fullscreenBtn.textContent = '⛶';
    fullscreenBtn.title = 'Tela cheia';
    fullscreenBtn.setAttribute('aria-label', 'Abrir vídeo em tela cheia');
    fullscreenBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleVideoTileFullscreen(tile);
    });
    tile.appendChild(fullscreenBtn);

    tile.addEventListener('click', () => focusVideoTile(tile));
    tile.addEventListener('dblclick', (event) => {
      event.preventDefault();
      toggleVideoTileFullscreen(tile);
    });
    tile.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') focusVideoTile(tile);
    });
  }

  async function toggleCallFullscreen() {
    try {
      if (document.fullscreenElement === callStage) {
        await document.exitFullscreen();
      } else {
        await callStage.requestFullscreen();
      }
    } catch (error) {
      console.error(error);
      notify('Não foi possível abrir a tela cheia.', true);
    }
  }

  function addVideoTrack(track, label, isScreen, local, participantIdentity = '') {
    const sid = track.sid || track.mediaStreamTrack?.id || Math.random().toString(36).slice(2);
    const id = `track-${sid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    document.getElementById(id)?.remove();
    const tile = document.createElement('div');
    tile.id = id;
    tile.className = `video-tile${isScreen ? ' screen' : ''}`;
    if (participantIdentity) tile.dataset.participant = participantIdentity;
    const video = track.attach();
    video.autoplay = true;
    video.playsInline = true;
    if (local && !isScreen) video.muted = true;
    tile.appendChild(video);
    syncVideoAspect(tile, video, track);
    const badge = document.createElement('div');
    badge.className = 'video-label';
    badge.textContent = `${label}${local ? ' (você)' : ''}${isScreen ? ' • tela' : ''}`;
    tile.appendChild(badge);
    prepareVideoTile(tile);
    if (isScreen) addScreenAudioControls(tile, participantIdentity, local);
    videoGrid.appendChild(tile);
    if (isScreen && participantIdentity) setTimeout(() => updateScreenAudioControls(participantIdentity), 0);
    updateEmptyVideo();
    updateVideoLayout();
  }

  function removeTrack(track) {
    if (!track) return;
    track.detach().forEach(el => el.remove());
    const sid = track.sid || track.mediaStreamTrack?.id || '';
    if (sid) document.getElementById(`track-${sid.replace(/[^a-zA-Z0-9_-]/g, '')}`)?.remove();
    updateEmptyVideo();
    updateVideoLayout();
  }

  function clearLocalTiles() {
    document.querySelectorAll('[data-local="true"]').forEach(el => el.remove());
  }

  function refreshLocalVideo() {
    clearLocalTiles();
    if (!lkRoom) return updateEmptyVideo();
    for (const publication of lkRoom.localParticipant.videoTrackPublications.values()) {
      const track = publication.track;
      if (!track) continue;
      if (track.mediaStreamTrack?.readyState === 'ended') continue;
      const isScreen = publication.source === LivekitClient.Track.Source.ScreenShare;
      const sid = track.sid || track.mediaStreamTrack?.id || Math.random().toString(36).slice(2);
      const tile = document.createElement('div');
      tile.id = `track-${String(sid).replace(/[^a-zA-Z0-9_-]/g, '')}`;
      tile.dataset.local = 'true';
      if (lkRoom.localParticipant.identity) tile.dataset.participant = lkRoom.localParticipant.identity;
      tile.className = `video-tile${isScreen ? ' screen' : ''}`;
      const video = track.attach();
      video.autoplay = true; video.playsInline = true; video.muted = true;
      tile.appendChild(video);
      syncVideoAspect(tile, video, track);
      const badge = document.createElement('div'); badge.className = 'video-label'; badge.textContent = `${profileName} (você)${isScreen ? ' • tela' : ''}`; tile.appendChild(badge);
      prepareVideoTile(tile);
      videoGrid.appendChild(tile);

      if (isScreen && track.mediaStreamTrack) {
        const mediaTrack = track.mediaStreamTrack;
        mediaTrack.addEventListener('ended', () => {
          if (!stoppingScreenShare) stopScreenShareTracks().catch(() => {});
          screenEnabled = false;
          updateControlButtons();
          tile.remove();
          updateEmptyVideo();
          updateVideoLayout();
          setTimeout(refreshLocalVideo, 0);
        }, { once: true });
      }
    }
    updateEmptyVideo();
    updateVideoLayout();
    updateSpeakingIndicators(lkRoom.activeSpeakers || []);
  }

  function updateEmptyVideo() {
    const hasTiles = videoGrid.querySelector('.video-tile');
    emptyVideo.classList.toggle('hidden', Boolean(hasTiles));
    syncCallStageVisibility();
  }

  micBtn.addEventListener('click', async () => {
    if (!lkRoom) return;
    if (!canUseVoicePermission('speak')) return notify('Seu cargo não permite usar o microfone nesta sala.', true);
    try {
      micEnabled = !micEnabled;
      await lkRoom.localParticipant.setMicrophoneEnabled(
        micEnabled,
        micEnabled ? microphoneCaptureOptions() : undefined,
      );
      if (micEnabled) {
        startKrispInBackground();
      } else if (krispProcessor) {
        await disableKrispProcessor();
        krispState = noiseSuppressionEnabled ? 'idle' : 'off';
      }
      updateControlButtons();
      emitVoiceState();
      notify(micEnabled ? 'Microfone desmutado.' : 'Microfone mutado.');
    } catch (error) {
      micEnabled = false;
      updateControlButtons();
      emitVoiceState();
      notify('Não consegui acessar o microfone.', true);
    }
  });

  noiseBtn?.addEventListener('click', async () => {
    noiseSuppressionEnabled = !noiseSuppressionEnabled;
    localStorage.setItem(KRISP_ENABLED_KEY, String(noiseSuppressionEnabled));
    krispOperationToken += 1;

    if (!noiseSuppressionEnabled) {
      await disableKrispProcessor();
      krispState = 'off';
      updateControlButtons();
      notify('Krisp desativado. A redução básica do navegador continua ativa.');
      return;
    }

    krispState = lkRoom && micEnabled ? 'loading' : 'idle';
    updateControlButtons();

    if (!lkRoom || !micEnabled) {
      notify('Krisp será ativado automaticamente quando o microfone estiver conectado.');
      return;
    }

    const active = await enableKrispOnMicrophone();
    notify(
      active ? 'Krisp ativado.' : 'Krisp não ficou disponível. A redução básica de ruído continua ativa.',
      !active,
    );
  });

  audioBtn.addEventListener('click', () => {
    roomSoundEnabled = !roomSoundEnabled;
    applyRoomSoundState();
    updateControlButtons();
    emitVoiceState();
    notify(roomSoundEnabled ? 'Som da sala ativado.' : 'Som da sala silenciado.');
  });

  cameraBtn.addEventListener('click', async () => {
    if (!lkRoom) return;
    if (!canUseVoicePermission('camera')) return notify('Seu cargo não permite usar câmera nesta sala.', true);
    try {
      cameraEnabled = !cameraEnabled;

      if (cameraEnabled) {
        callCollapsed = false;
        await lkRoom.localParticipant.setCameraEnabled(
          true,
          {
            resolution: { width: 1920, height: 1080, frameRate: 30 },
          },
          {
            videoEncoding: { maxBitrate: 5_000_000, maxFramerate: 30 },
            degradationPreference: 'maintain-resolution',
          },
        );
      } else {
        await lkRoom.localParticipant.setCameraEnabled(false);
      }

      setTimeout(refreshLocalVideo, 100);
      updateControlButtons();
    } catch (error) {
      cameraEnabled = false;
      updateControlButtons();
      notify('Não consegui acessar a câmera em Full HD.', true);
    }
  });

  async function publishScreenShareWithAudio() {
    if (!lkRoom) return { hasAudio: false, fallback: false };
    const participant = lkRoom.localParticipant;
    const { Track } = LivekitClient;

    if (typeof participant.createScreenTracks !== 'function') {
      await participant.setScreenShareEnabled(
        true,
        {
          resolution: { width: 1920, height: 1080, frameRate: 60 },
          contentHint: 'motion',
        },
        {
          videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
          degradationPreference: 'maintain-framerate',
        },
      );
      return { hasAudio: false, fallback: true };
    }

    const tracks = await participant.createScreenTracks({
      audio: true,
      resolution: { width: 1920, height: 1080, frameRate: 60 },
      contentHint: 'motion',
    });
    const videoTrack = tracks.find(track => track.kind === Track.Kind.Video || track.kind === 'video');
    const audioTrack = tracks.find(track => track.kind === Track.Kind.Audio || track.kind === 'audio');
    if (!videoTrack) {
      tracks.forEach(track => { try { track.stop?.(); } catch {} });
      throw new Error('O navegador não retornou a imagem da tela.');
    }

    await participant.publishTrack(videoTrack, {
      source: Track.Source.ScreenShare,
      videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
      degradationPreference: 'maintain-framerate',
    });

    let hasAudio = false;
    if (audioTrack) {
      try {
        await participant.publishTrack(audioTrack, {
          source: Track.Source.ScreenShareAudio || 'screen_share_audio',
        });
        hasAudio = true;
      } catch (error) {
        console.warn('Não foi possível publicar o áudio da live.', error);
        try { audioTrack.stop?.(); } catch {}
      }
    }
    return { hasAudio, fallback: false };
  }

  async function stopScreenShareTracks() {
    if (!lkRoom || stoppingScreenShare) return;
    stoppingScreenShare = true;
    const participant = lkRoom.localParticipant;
    const { Track } = LivekitClient;
    try {
      try { await participant.setScreenShareEnabled(false); } catch {}
      const publications = [
        ...participant.videoTrackPublications.values(),
        ...participant.audioTrackPublications.values(),
      ];
      for (const publication of publications) {
        if (publication.source !== Track.Source.ScreenShare && !isScreenAudioSource(publication.source)) continue;
        const track = publication.track;
        if (!track) continue;
        try { await participant.unpublishTrack(track); } catch {}
        try { track.stop?.(); } catch {}
      }
    } finally {
      screenEnabled = false;
      stoppingScreenShare = false;
      updateControlButtons();
      setTimeout(refreshLocalVideo, 0);
    }
  }

  screenBtn.addEventListener('click', async () => {
    if (!lkRoom) return;
    if (!canUseVoicePermission('screen_share')) return notify('Seu cargo não permite compartilhar a tela nesta sala.', true);
    try {
      if (!screenEnabled) {
        callCollapsed = false;
        const result = await publishScreenShareWithAudio();
        screenEnabled = true;
        setTimeout(refreshLocalVideo, 100);
        updateControlButtons();
        if (result.hasAudio) {
          notify('Live iniciada com som.');
        } else {
          notify('Live iniciada sem som. Para transmitir áudio, marque “Compartilhar áudio” no seletor do navegador.', true);
        }
      } else {
        await stopScreenShareTracks();
        notify('Compartilhamento de tela encerrado.');
      }
    } catch (error) {
      console.error(error);
      screenEnabled = false;
      updateControlButtons();
      notify(error.message || 'O compartilhamento de tela foi cancelado ou bloqueado.', true);
    }
  });

  function updateControlButtons() {
    micBtn.classList.toggle('active', micEnabled);
    micBtn.classList.toggle('off', !micEnabled);
    micBtn.innerHTML = voiceControlIcon('mic', !micEnabled, 'dock-voice-icon');
    micBtn.title = micEnabled ? 'Mutar microfone' : 'Desmutar microfone';
    micBtn.setAttribute('aria-label', micBtn.title);

    audioBtn.classList.toggle('active', roomSoundEnabled);
    audioBtn.classList.toggle('off', !roomSoundEnabled);
    audioBtn.innerHTML = voiceControlIcon('headphones', !roomSoundEnabled, 'dock-voice-icon');
    audioBtn.title = roomSoundEnabled ? 'Desativar áudio da sala' : 'Ativar áudio da sala';
    audioBtn.setAttribute('aria-label', audioBtn.title);

    if (micStatusText) {
      micStatusText.innerHTML = `${voiceControlIcon('mic', !micEnabled, 'status-control-icon')}<span>${micEnabled ? 'Microfone ligado' : 'Microfone mutado'}</span>`;
      micStatusText.classList.toggle('off', !micEnabled);
    }
    if (soundStatusText) {
      soundStatusText.innerHTML = `${voiceControlIcon('headphones', !roomSoundEnabled, 'status-control-icon')}<span>${roomSoundEnabled ? 'Áudio ligado' : 'Áudio desativado'}</span>`;
      soundStatusText.classList.toggle('off', !roomSoundEnabled);
    }
    if (noiseStatusText) {
      let noiseLabel = '✦ Krisp automático';
      if (!noiseSuppressionEnabled || krispState === 'off') noiseLabel = '○ Krisp desligado';
      else if (krispState === 'loading') noiseLabel = '… Krisp iniciando';
      else if (krispState === 'active') noiseLabel = '✦ Krisp ativo';
      else if (krispState === 'fallback') noiseLabel = '○ Redução básica';
      noiseStatusText.textContent = noiseLabel;
      noiseStatusText.classList.toggle('off', !noiseSuppressionEnabled || krispState === 'fallback');
      noiseStatusText.classList.toggle('loading', krispState === 'loading');
    }
    if (noiseBtn) {
      noiseBtn.classList.toggle('active', noiseSuppressionEnabled && krispState !== 'fallback');
      noiseBtn.classList.toggle('off', !noiseSuppressionEnabled || krispState === 'fallback');
      noiseBtn.classList.toggle('loading', krispState === 'loading');
      noiseBtn.textContent = krispState === 'loading' ? '…' : '✦';
      noiseBtn.title = noiseSuppressionEnabled ? 'Desativar Krisp' : 'Ativar Krisp';
      noiseBtn.setAttribute('aria-label', noiseBtn.title);
    }

    micBtn.disabled = !canUseVoicePermission('speak');
    cameraBtn.disabled = !canUseVoicePermission('camera');
    screenBtn.disabled = !canUseVoicePermission('screen_share');
    cameraBtn.classList.toggle('active', cameraEnabled); cameraBtn.textContent = cameraEnabled ? '◉' : '◎';
    screenBtn.classList.toggle('active', screenEnabled);
  }

  leaveVoiceBtn.addEventListener('click', () => leaveVoice(true));
  async function leaveVoice(showToast = true) {
    if (showToast && currentVoiceRoom) playVoiceCue('leave');
    krispOperationToken += 1;
    if (krispTrack || krispProcessor) await disableKrispProcessor({ dispose: true });
    krispState = noiseSuppressionEnabled ? 'idle' : 'off';
    if (lkRoom) {
      const room = lkRoom;
      lkRoom = null;
      try { await room.disconnect(); } catch {}
    }
    if (currentVoiceRoom) socket?.emit('voice-state', null);
    finishVoiceUi();
    if (showToast) notify('Você saiu da sala de voz.');
  }

  function finishVoiceUi() {
    currentVoiceRoom = null;
    micEnabled = cameraEnabled = screenEnabled = false;
    voiceDock.classList.add('hidden');
    mobileChannelsToggle?.classList.remove('voice-active');
    setVoiceConnectionStatus('connected');
    callStage.classList.add('hidden');
    document.querySelectorAll('.voice-channel').forEach(el => el.classList.remove('connected'));
    document.querySelectorAll('.video-tile').forEach(el => el.remove());
    document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
    participantVolumes.clear();
    participantMuted.clear();
    screenAudioVolumes.clear();
    screenAudioMuted.clear();
    closeVolumePopover();
    audioBin.innerHTML = '';
    updateControlButtons();
    updateEmptyVideo();
    updateVideoLayout();
    if (document.fullscreenElement === callStage) document.exitFullscreen().catch(() => {});
  }


  function closeUserRoleMenu() {
    userRoleMenuUser = null;
    userRoleMenu?.classList.add('hidden');
  }

  async function ensureAdminRolesLoaded(force = false) {
    if (adminRoles.length && !force) return adminRoles;
    const data = await api('/api/admin/roles');
    adminRoles = Array.isArray(data.roles) ? data.roles : [];
    return adminRoles;
  }

  function findPresenceUserByKey(userKey) {
    return (lastPresence?.users || []).find(user => user.userKey === userKey) || null;
  }

  async function setMemberRoles(userKey, roleIds) {
    await api(`/api/admin/members/${encodeURIComponent(userKey)}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds }),
    });
  }

  async function openUserRoleMenu(user, clientX, clientY) {
    if (!user?.userKey || !hasPermission('manage_members')) return;
    try {
      await ensureAdminRolesLoaded();
      if (!userRoleMenu) {
        userRoleMenu = document.createElement('div');
        userRoleMenu.className = 'user-role-menu hidden';
        document.body.appendChild(userRoleMenu);
      }
      userRoleMenuUser = user;
      const selected = new Set(user.roleIds || []);
      userRoleMenu.innerHTML = `
        <div class="user-role-menu-head">
          <strong>${escapeHtml(user.name)}</strong>
          <small>${user.isMaster ? 'ADM Master • protegido' : 'Marque ou desmarque cargos'}</small>
        </div>
        <div class="user-role-menu-list">
          ${adminRoles.map(role => `
            <label class="role-menu-option">
              <input type="checkbox" value="${escapeHtml(role.id)}" ${selected.has(role.id) ? 'checked' : ''} />
              <span class="role-color-dot" style="--role-color:${escapeHtml(role.color)}"></span>
              <span>${escapeHtml(role.name)}</span>
              ${role.systemKey === 'admin' ? '<small>controle total</small>' : ''}
            </label>
          `).join('') || '<div class="admin-empty">Nenhum cargo criado.</div>'}
        </div>
        <button type="button" class="role-menu-manage">⚙ Abrir gerenciamento</button>
      `;

      userRoleMenu.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', async () => {
          const roleIds = [...userRoleMenu.querySelectorAll('input[type="checkbox"]:checked')].map(el => el.value);
          input.disabled = true;
          try {
            await setMemberRoles(user.userKey, roleIds);
            user.roleIds = roleIds;
            notify('Cargos atualizados.');
          } catch (error) {
            input.checked = !input.checked;
            notify(error.message || 'Não foi possível alterar os cargos.', true);
          } finally {
            input.disabled = false;
          }
        });
      });
      userRoleMenu.querySelector('.role-menu-manage')?.addEventListener('click', () => {
        closeUserRoleMenu();
        openAdminPanel('members', user.userKey);
      });

      userRoleMenu.classList.remove('hidden');
      const rect = userRoleMenu.getBoundingClientRect();
      const gap = 8;
      let left = Number(clientX || gap);
      let top = Number(clientY || gap);
      if (left + rect.width > window.innerWidth - gap) left = window.innerWidth - rect.width - gap;
      if (top + rect.height > window.innerHeight - gap) top = window.innerHeight - rect.height - gap;
      userRoleMenu.style.left = `${Math.max(gap, left)}px`;
      userRoleMenu.style.top = `${Math.max(gap, top)}px`;
    } catch (error) {
      notify(error.message || 'Não foi possível abrir os cargos.', true);
    }
  }

  function ensureAdminModal() {
    if (adminModal) return adminModal;
    const wrap = document.createElement('div');
    wrap.className = 'admin-modal-backdrop hidden';
    wrap.innerHTML = `
      <section class="admin-modal" role="dialog" aria-modal="true" aria-label="Administração do Conecta">
        <header class="admin-modal-head">
          <div><span class="brand-mark mini">C</span><div><strong>Administração do Conecta</strong><small>Cargos, membros e acesso aos canais</small></div></div>
          <button type="button" data-admin-close aria-label="Fechar">×</button>
        </header>
        <nav class="admin-tabs">
          <button type="button" data-admin-tab="roles">Cargos</button>
          <button type="button" data-admin-tab="members">Membros</button>
          <button type="button" data-admin-tab="channels">Canais</button>
        </nav>
        <div class="admin-body" data-admin-body></div>
      </section>
    `;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', event => {
      if (event.target === wrap || event.target.closest('[data-admin-close]')) closeAdminPanel();
      const tab = event.target.closest('[data-admin-tab]')?.dataset.adminTab;
      if (tab) loadAdminTab(tab);
    });
    adminModal = wrap;
    return wrap;
  }

  function closeAdminPanel() {
    adminModal?.classList.add('hidden');
  }

  async function openAdminPanel(tab = 'roles', memberKey = '') {
    if (!canOpenAdmin()) return;
    closeUserRoleMenu();
    closeMobilePanels();
    ensureAdminModal().classList.remove('hidden');
    if (memberKey) adminSelectedMemberKey = memberKey;
    await loadAdminTab(tab);
  }

  function adminBody() {
    return adminModal?.querySelector('[data-admin-body]');
  }

  function syncAdminTabs() {
    adminModal?.querySelectorAll('[data-admin-tab]').forEach(btn => {
      const permission = btn.dataset.adminTab === 'roles' ? 'manage_roles' : btn.dataset.adminTab === 'members' ? 'manage_members' : 'manage_channels';
      const allowed = btn.dataset.adminTab === 'channels'
        ? (hasPermission('manage_channels') || hasPermission('manage_roles'))
        : hasPermission(permission);
      btn.classList.toggle('hidden', !allowed);
      btn.classList.toggle('active', btn.dataset.adminTab === adminActiveTab);
    });
  }

  async function loadAdminTab(tab) {
    if (!adminModal) return;
    const allowed = tab === 'roles' ? hasPermission('manage_roles')
      : tab === 'members' ? hasPermission('manage_members')
      : (hasPermission('manage_channels') || hasPermission('manage_roles'));
    if (!allowed) {
      tab = hasPermission('manage_roles') ? 'roles' : hasPermission('manage_members') ? 'members' : 'channels';
    }
    adminActiveTab = tab;
    syncAdminTabs();
    const body = adminBody();
    if (!body) return;
    body.innerHTML = '<div class="admin-loading">Carregando…</div>';
    try {
      if (tab === 'roles') await renderAdminRoles();
      else if (tab === 'members') await renderAdminMembers();
      else await renderAdminChannels();
    } catch (error) {
      body.innerHTML = `<div class="admin-empty">${escapeHtml(error.message || 'Não foi possível carregar esta área.')}</div>`;
    }
  }

  async function renderAdminRoles() {
    await ensureAdminRolesLoaded(true);
    if (!adminSelectedRoleId || !adminRoles.some(role => role.id === adminSelectedRoleId)) adminSelectedRoleId = adminRoles[0]?.id || '';
    const selected = adminRoles.find(role => role.id === adminSelectedRoleId) || null;
    const body = adminBody();
    body.innerHTML = `
      <div class="admin-split">
        <aside class="admin-list-pane">
          <button type="button" class="admin-primary-small" data-new-role>＋ Novo cargo</button>
          <div class="admin-role-list">
            ${adminRoles.map(role => `
              <button type="button" class="admin-role-item${role.id === adminSelectedRoleId ? ' active' : ''}" data-role-id="${escapeHtml(role.id)}">
                <span class="role-color-dot" style="--role-color:${escapeHtml(role.color)}"></span>
                <span><strong>${escapeHtml(role.name)}</strong><small>${role.memberCount} membro${role.memberCount === 1 ? '' : 's'}</small></span>
                ${role.systemKey === 'admin' ? '<b>ADMIN</b>' : ''}
              </button>
            `).join('')}
          </div>
        </aside>
        <section class="admin-editor-pane">
          ${selected ? `
            <div class="admin-editor-title"><div><h3>${escapeHtml(selected.name)}</h3><p>Edite nome, cor e o que este cargo pode fazer.</p></div>${selected.protected ? '<span class="protected-pill">Protegido</span>' : ''}</div>
            <label class="admin-field">Nome do cargo<input data-role-name maxlength="32" value="${escapeHtml(selected.name)}" /></label>
            <label class="admin-field admin-color-field">Cor<input data-role-color type="color" value="${escapeHtml(selected.color)}" /><span>${escapeHtml(selected.color)}</span></label>
            <div class="admin-permissions">
              <h4>Permissões</h4>
              ${Object.entries(PERMISSION_LABELS).map(([key, label]) => `
                <label class="admin-check">
                  <input type="checkbox" data-role-permission="${key}" ${selected.permissions?.[key] ? 'checked' : ''} ${selected.protected ? 'disabled' : ''}/>
                  <span><strong>${label}</strong><small>${key.startsWith('manage_') ? 'Permissão administrativa' : 'Permissão de uso'}</small></span>
                </label>
              `).join('')}
            </div>
            <div class="admin-editor-actions">
              <button type="button" class="admin-save" data-save-role>Salvar alterações</button>
              ${selected.protected ? '' : '<button type="button" class="admin-danger" data-delete-role>Excluir cargo</button>'}
            </div>
          ` : '<div class="admin-empty">Crie um cargo para começar.</div>'}
        </section>
      </div>
    `;

    body.querySelector('[data-new-role]')?.addEventListener('click', async () => {
      const name = window.prompt('Nome do novo cargo:');
      if (!name?.trim()) return;
      await api('/api/admin/roles', { method: 'POST', body: JSON.stringify({ name, color: '#5865F2', permissions: { send_messages: true, join_voice: true, speak: true, camera: true, screen_share: true } }) });
      adminSelectedRoleId = '';
      notify('Cargo criado.');
      await renderAdminRoles();
    });
    body.querySelectorAll('[data-role-id]').forEach(btn => btn.addEventListener('click', () => {
      adminSelectedRoleId = btn.dataset.roleId;
      renderAdminRoles();
    }));
    body.querySelector('[data-save-role]')?.addEventListener('click', async () => {
      const name = body.querySelector('[data-role-name]')?.value || selected.name;
      const color = body.querySelector('[data-role-color]')?.value || selected.color;
      const permissions = {};
      body.querySelectorAll('[data-role-permission]').forEach(input => { permissions[input.dataset.rolePermission] = input.checked; });
      await api(`/api/admin/roles/${encodeURIComponent(selected.id)}`, { method: 'PATCH', body: JSON.stringify({ name, color, permissions }) });
      notify('Cargo atualizado.');
      await renderAdminRoles();
    });
    body.querySelector('[data-delete-role]')?.addEventListener('click', async () => {
      if (!window.confirm(`Excluir o cargo "${selected.name}"?`)) return;
      await api(`/api/admin/roles/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
      adminSelectedRoleId = '';
      notify('Cargo excluído.');
      await renderAdminRoles();
    });
    const colorInput = body.querySelector('[data-role-color]');
    colorInput?.addEventListener('input', () => { colorInput.nextElementSibling.textContent = colorInput.value.toUpperCase(); });
  }

  async function renderAdminMembers() {
    await ensureAdminRolesLoaded();
    const data = await api('/api/admin/members');
    adminMembers = Array.isArray(data.members) ? data.members : [];
    if (!adminSelectedMemberKey || !adminMembers.some(member => member.userKey === adminSelectedMemberKey)) adminSelectedMemberKey = adminMembers[0]?.userKey || '';
    const selected = adminMembers.find(member => member.userKey === adminSelectedMemberKey) || null;
    const selectedIds = new Set((selected?.roles || []).map(role => role.id));
    const body = adminBody();
    body.innerHTML = `
      <div class="admin-split members-admin-split">
        <aside class="admin-list-pane">
          <div class="admin-search-title">Membros cadastrados</div>
          <div class="admin-member-list">
            ${adminMembers.map(member => `
              <button type="button" class="admin-member-item${member.userKey === adminSelectedMemberKey ? ' active' : ''}" data-member-key="${escapeHtml(member.userKey)}">
                ${avatarMarkup(member.name, member.avatarUrl, member.avatarId)}
                <span><strong>${escapeHtml(member.name)}</strong><small>${member.isMaster ? 'ADM Master' : member.roles?.length ? member.roles.map(r => r.name).join(', ') : 'Sem cargo'}</small></span>
              </button>
            `).join('') || '<div class="admin-empty">Nenhum membro cadastrado.</div>'}
          </div>
        </aside>
        <section class="admin-editor-pane">
          ${selected ? `
            <div class="admin-editor-title admin-member-editor-title"><div class="admin-member-identity">${avatarMarkup(selected.name, selected.avatarUrl, selected.avatarId, 'admin-avatar')}<div><h3>${escapeHtml(selected.name)}</h3><p>${selected.isMaster ? 'ADM Master permanente. Os cargos adicionais podem ser alterados abaixo.' : 'Marque os cargos que este membro deve ter.'}</p></div></div>${selected.isMaster ? '<span class="protected-pill master">MASTER</span>' : ''}</div>
            <div class="admin-member-role-grid">
              ${adminRoles.map(role => `
                <label class="admin-role-toggle">
                  <input type="checkbox" value="${escapeHtml(role.id)}" ${selectedIds.has(role.id) ? 'checked' : ''}/>
                  <span class="role-color-dot" style="--role-color:${escapeHtml(role.color)}"></span>
                  <span><strong>${escapeHtml(role.name)}</strong><small>${role.systemKey === 'admin' ? 'Controle total igual ao dono' : 'Cargo personalizado'}</small></span>
                </label>
              `).join('')}
            </div>
            <div class="admin-editor-actions">
              <button type="button" class="admin-save" data-save-member-roles>Salvar cargos</button>
              ${selected.avatarUrl ? '<button type="button" class="admin-danger secondary" data-remove-member-avatar>Remover foto</button>' : ''}
            </div>
          ` : '<div class="admin-empty">Selecione um membro.</div>'}
        </section>
      </div>
    `;
    body.querySelectorAll('[data-member-key]').forEach(btn => btn.addEventListener('click', () => {
      adminSelectedMemberKey = btn.dataset.memberKey;
      renderAdminMembers();
    }));
    body.querySelector('[data-save-member-roles]')?.addEventListener('click', async () => {
      const roleIds = [...body.querySelectorAll('.admin-member-role-grid input:checked')].map(input => input.value);
      await setMemberRoles(selected.userKey, roleIds);
      notify('Cargos do membro atualizados.');
      await renderAdminMembers();
    });
    body.querySelector('[data-remove-member-avatar]')?.addEventListener('click', async () => {
      if (!window.confirm(`Remover a foto de perfil de "${selected.name}"?`)) return;
      await api(`/api/admin/members/${encodeURIComponent(selected.userKey)}/avatar`, { method: 'DELETE' });
      notify('Foto de perfil removida.');
      await renderAdminMembers();
    });
  }

  async function renderAdminChannels() {
    await ensureAdminRolesLoaded();
    const data = await api('/api/admin/channels');
    adminChannels = Array.isArray(data.channels) ? data.channels : [];
    const body = adminBody();
    body.innerHTML = `
      <div class="admin-channel-page">
        <div class="admin-page-copy"><h3>Quem pode ver cada canal</h3><p>Usuários sem cargo veem as Salas de Todos de texto e voz. ADMIN e ADM Master sempre enxergam tudo. A ordem dos canais pode ser alterada pelo menu ⋮ ao lado de cada canal.</p></div>
        <div class="admin-channel-list">
          ${adminChannels.map(channel => {
            const selected = new Set(channel.roleIds || []);
            return `
              <section class="admin-channel-card" data-access-channel="${escapeHtml(channel.id)}">
                <div class="admin-channel-card-head"><strong>${channel.type === 'text' ? '#' : '🔊'} ${escapeHtml(channel.name)}</strong>${channel.isLobby ? '<span class="lobby-pill">Todos</span>' : ''}</div>
                ${channel.isLobby ? '<p>Esta Sala de Todos é sempre visível e utilizável, inclusive para quem ainda não tem cargo.</p>' : `
                  <div class="admin-channel-role-grid">
                    ${adminRoles.filter(role => role.systemKey !== 'admin').map(role => `
                      <label><input type="checkbox" value="${escapeHtml(role.id)}" ${selected.has(role.id) ? 'checked' : ''}/><span class="role-color-dot" style="--role-color:${escapeHtml(role.color)}"></span><span>${escapeHtml(role.name)}</span></label>
                    `).join('') || '<span class="admin-empty">Crie cargos para liberar este canal.</span>'}
                  </div>
                  <button type="button" class="admin-save small" data-save-channel-access>Salvar acesso</button>
                `}
              </section>
            `;
          }).join('')}
        </div>
      </div>
    `;
    body.querySelectorAll('[data-access-channel]').forEach(card => {
      card.querySelector('[data-save-channel-access]')?.addEventListener('click', async () => {
        const roleIds = [...card.querySelectorAll('input:checked')].map(input => input.value);
        await api(`/api/admin/channels/${encodeURIComponent(card.dataset.accessChannel)}/access`, { method: 'PUT', body: JSON.stringify({ roleIds }) });
        notify('Acesso do canal atualizado.');
      });
    });
  }


  function ensureProfileModal() {
    if (profileModal) return profileModal;
    const wrap = document.createElement('div');
    wrap.className = 'profile-modal-backdrop hidden';
    wrap.innerHTML = `
      <section class="profile-modal" role="dialog" aria-modal="true" aria-label="Editar perfil">
        <header class="profile-modal-head">
          <div><strong>Editar perfil</strong><small>Foto de perfil do Conecta</small></div>
          <button type="button" data-profile-close aria-label="Fechar">×</button>
        </header>
        <div class="profile-modal-body">
          <div class="profile-avatar-area">
            <div data-profile-preview class="avatar profile-avatar-preview"></div>
            <div class="profile-avatar-copy">
              <strong>${escapeHtml(profileName || 'Seu perfil')}</strong>
              <span>JPG, PNG ou WebP • até 2 MB</span>
              <small>A foto é recortada automaticamente no centro e otimizada para 256×256.</small>
            </div>
          </div>
          <input class="hidden" data-profile-file type="file" accept="image/jpeg,image/png,image/webp" />
          <div class="profile-modal-actions">
            <button type="button" class="profile-choose" data-profile-choose>Escolher foto</button>
            <button type="button" class="profile-remove" data-profile-remove>Remover foto</button>
            <button type="button" class="profile-save" data-profile-save disabled>Salvar</button>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(wrap);

    wrap.addEventListener('click', event => {
      if (event.target === wrap || event.target.closest('[data-profile-close]')) closeProfileModal();
    });
    wrap.querySelector('[data-profile-choose]')?.addEventListener('click', () => wrap.querySelector('[data-profile-file]')?.click());
    wrap.querySelector('[data-profile-file]')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Escolha uma imagem JPG, PNG ou WebP.');
        if (file.size > 2 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 2 MB.');
        pendingAvatarDataUrl = await prepareAvatarImage(file);
        const preview = wrap.querySelector('[data-profile-preview]');
        setAvatarNode(preview, profileName, pendingAvatarDataUrl, currentUser.avatarId);
        wrap.querySelector('[data-profile-save]').disabled = false;
      } catch (error) {
        pendingAvatarDataUrl = '';
        wrap.querySelector('[data-profile-save]').disabled = true;
        notify(error.message || 'Não foi possível preparar esta imagem.', true);
      } finally {
        event.target.value = '';
      }
    });
    wrap.querySelector('[data-profile-save]')?.addEventListener('click', saveProfileAvatar);
    wrap.querySelector('[data-profile-remove]')?.addEventListener('click', removeProfileAvatar);
    profileModal = wrap;
    return wrap;
  }

  async function prepareAvatarImage(file) {
    const bitmap = 'createImageBitmap' in window ? await createImageBitmap(file) : null;
    let source = bitmap;
    let objectUrl = '';
    if (!source) {
      objectUrl = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Não foi possível abrir esta imagem.'));
        image.src = objectUrl;
      });
    }

    try {
      const width = Number(source.width || source.naturalWidth || 0);
      const height = Number(source.height || source.naturalHeight || 0);
      if (!width || !height) throw new Error('Imagem inválida.');
      const size = Math.min(width, height);
      const sx = Math.max(0, (width - size) / 2);
      const sy = Math.max(0, (height - size) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#232428';
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(source, sx, sy, size, size, 0, 0, 256, 256);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88))
        || await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Não foi possível otimizar a imagem.');
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
        reader.readAsDataURL(blob);
      });
    } finally {
      try { bitmap?.close?.(); } catch {}
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  function openProfileModal() {
    const modal = ensureProfileModal();
    pendingAvatarDataUrl = '';
    const preview = modal.querySelector('[data-profile-preview]');
    setAvatarNode(preview, profileName, currentUser.avatarUrl, currentUser.avatarId);
    const copy = modal.querySelector('.profile-avatar-copy strong');
    if (copy) copy.textContent = profileName || 'Seu perfil';
    const save = modal.querySelector('[data-profile-save]');
    if (save) save.disabled = true;
    const remove = modal.querySelector('[data-profile-remove]');
    if (remove) remove.disabled = !currentUser.avatarUrl;
    modal.classList.remove('hidden');
    closeMobilePanels();
  }

  function closeProfileModal() {
    pendingAvatarDataUrl = '';
    profileModal?.classList.add('hidden');
  }

  async function saveProfileAvatar() {
    if (!pendingAvatarDataUrl || avatarUploadBusy) return;
    avatarUploadBusy = true;
    const save = profileModal?.querySelector('[data-profile-save]');
    if (save) { save.disabled = true; save.textContent = 'Salvando…'; }
    try {
      const data = await api('/api/profile/avatar', {
        method: 'PUT',
        body: JSON.stringify({ imageData: pendingAvatarDataUrl }),
      });
      if (data.me) applyMe(data.me);
      pendingAvatarDataUrl = '';
      notify('Foto de perfil atualizada.');
      closeProfileModal();
    } catch (error) {
      notify(error.message || 'Não foi possível salvar sua foto.', true);
      if (save) save.disabled = false;
    } finally {
      avatarUploadBusy = false;
      if (save) save.textContent = 'Salvar';
    }
  }

  async function removeProfileAvatar() {
    if (avatarUploadBusy || !currentUser.avatarUrl) return;
    if (!window.confirm('Remover sua foto de perfil?')) return;
    avatarUploadBusy = true;
    try {
      const data = await api('/api/profile/avatar', { method: 'DELETE' });
      if (data.me) applyMe(data.me);
      notify('Foto de perfil removida.');
      closeProfileModal();
    } catch (error) {
      notify(error.message || 'Não foi possível remover sua foto.', true);
    } finally {
      avatarUploadBusy = false;
    }
  }

  fullscreenCallBtn?.addEventListener('click', toggleCallFullscreen);
  document.addEventListener('fullscreenchange', () => {
    if (!fullscreenCallBtn) return;
    const active = document.fullscreenElement === callStage;
    fullscreenCallBtn.textContent = active ? '⛶ Sair da tela cheia' : '⛶ Tela cheia';
    fullscreenCallBtn.title = active ? 'Sair da tela cheia' : 'Tela cheia';
    updateVideoLayout();
  });

  collapseCallBtn.addEventListener('click', () => {
    callCollapsed = !callCollapsed;
    if (callCollapsed) callStage.classList.add('hidden');
  });

  document.addEventListener('click', (event) => {
    if (suppressNextUserClick) { suppressNextUserClick = false; event.preventDefault(); event.stopPropagation(); return; }
    const voiceMember = event.target.closest('.voice-member.volume-user[data-participant]');
    if (voiceMember && currentVoiceRoom) {
      event.stopPropagation();
      openVolumePopover(voiceMember.dataset.participant, voiceMember.dataset.name || 'Volume', voiceMember);
      return;
    }
    if (volumePopover && !volumePopover.contains(event.target)) closeVolumePopover();
    if (userRoleMenu && !userRoleMenu.contains(event.target) && !event.target.closest('.manageable-user')) closeUserRoleMenu();
    if (channelMenuPopover && !channelMenuPopover.contains(event.target) && !event.target.closest('[data-channel-menu]')) closeChannelMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && volumePopoverIdentity) closeVolumePopover();
    if (event.key === 'Escape' && channelMenuTarget) closeChannelMenu();
    if (event.key === 'Escape') closeUserRoleMenu();
    if (event.key === 'Escape' && adminModal && !adminModal.classList.contains('hidden')) closeAdminPanel();
    if (event.key === 'Escape' && profileModal && !profileModal.classList.contains('hidden')) closeProfileModal();
    if (event.key === 'Escape' && isMobileLayout()) closeMobilePanels();
  });

  window.addEventListener('resize', () => {
    closeVolumePopover();
    closeChannelMenu();
    closeUserRoleMenu();
    if (!isMobileLayout()) closeMobilePanels();
    else syncMobileBackdrop();
  });

  mobileChannelsToggle?.addEventListener('click', () => {
    if (channelsPanel?.classList.contains('mobile-open')) closeMobileChannels();
    else openMobileChannels();
  });
  mobileChannelsClose?.addEventListener('click', closeMobileChannels);
  mobileDrawerBackdrop?.addEventListener('click', closeMobilePanels);

  document.addEventListener('contextmenu', event => {
    const target = event.target.closest('.manageable-user[data-user-key]');
    if (!target || !hasPermission('manage_members')) return;
    event.preventDefault();
    const user = findPresenceUserByKey(target.dataset.userKey) || {
      userKey: target.dataset.userKey,
      name: target.dataset.userName || 'Usuário',
      roleIds: [],
    };
    openUserRoleMenu(user, event.clientX, event.clientY);
  });

  document.addEventListener('pointerdown', event => {
    if (!isMobileLayout() || !hasPermission('manage_members')) return;
    const target = event.target.closest('.manageable-user[data-user-key]');
    if (!target) return;
    clearTimeout(userLongPressTimer);
    userLongPressTimer = setTimeout(() => {
      suppressNextUserClick = true;
      const user = findPresenceUserByKey(target.dataset.userKey) || {
        userKey: target.dataset.userKey,
        name: target.dataset.userName || 'Usuário',
        roleIds: [],
      };
      const rect = target.getBoundingClientRect();
      openUserRoleMenu(user, Math.min(window.innerWidth - 16, rect.left + 16), Math.min(window.innerHeight - 16, rect.top + 16));
    }, 600);
  }, { passive: true });
  ['pointerup', 'pointercancel', 'pointermove'].forEach(type => document.addEventListener(type, () => {
    clearTimeout(userLongPressTimer);
    userLongPressTimer = null;
  }, { passive: true }));

  editProfileBtn?.addEventListener('click', openProfileModal);
  selfAvatar?.addEventListener('click', openProfileModal);
  selfAvatar?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openProfileModal();
    }
  });
  adminSettingsBtn?.addEventListener('click', () => openAdminPanel('roles'));

  membersToggle.addEventListener('click', () => {
    if (isMobileLayout()) {
      channelsPanel?.classList.remove('mobile-open');
      membersPanel.classList.toggle('open');
      document.body.classList.toggle('mobile-panel-open', membersPanel.classList.contains('open'));
      syncMobileBackdrop();
      return;
    }
    membersPanel.classList.toggle('open');
  });
  logoutBtn.addEventListener('click', signOut);
  function signOut() {
    leaveVoice(false);
    socket?.disconnect();
    sessionStorage.removeItem('conecta.sessionId');
    sessionStorage.removeItem('conecta.name');
    localStorage.removeItem(SAVED_NAME_KEY);
    location.reload();
  }

  window.addEventListener('offline', () => {
    socketRecovering = true;
    if (currentVoiceRoom) setVoiceConnectionStatus('reconnecting');
    notify('Sem internet. O Conecta vai tentar voltar sozinho quando a conexão retornar.', true);
  });

  window.addEventListener('online', () => {
    if (socket && !socket.connected) socket.connect();
    notify('Internet voltou. Reconectando…');
  });

  window.addEventListener('beforeunload', () => {
    if (currentVoiceRoom) socket?.emit('voice-state', null);
  });

  const savedName = localStorage.getItem(SAVED_NAME_KEY) || '';
  if (savedName) nameInput.value = savedName;

  if (sessionId && profileName) {
    enterApp();
  } else if (savedName) {
    login(savedName, { remember: true, silent: true }).then((ok) => {
      if (!ok) notify('Não foi possível entrar automaticamente. Confira seu login.', true);
    });
  }
})();
