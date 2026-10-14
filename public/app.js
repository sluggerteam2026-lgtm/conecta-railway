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
  let volumePopover = null;
  let volumePopoverIdentity = '';
  let historyLoadToken = 0;
  let channelCatalog = [];
  let lastPresence = { users: [], total: 0, max: 20 };
  let channelMenuPopover = null;
  let channelMenuTarget = null;


  function notify(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
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

  function channelInfo(slug) {
    return channelNames[slug] || [slug || 'canal', ''];
  }

  function voiceRoomName(slug) {
    return voiceNames[slug] || slug || 'Sala de voz';
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

    setTimeout(() => {
      document.querySelectorAll('.voice-channel').forEach(button => {
        prefetchVoiceToken(button.dataset.room);
      });
    }, 30);
  }

  function renderChannels() {
    const text = channelCatalog.filter(item => item.type === 'text');
    const voice = channelCatalog.filter(item => item.type === 'voice');

    textChannelsList.innerHTML = text.map(item => `
      <button class="channel text-channel${item.slug === currentChannel ? ' active' : ''}" data-channel="${escapeHtml(item.slug)}" data-channel-id="${escapeHtml(item.id)}" type="button">
        <span class="channel-icon">#</span>
        <span>${escapeHtml(item.name)}</span>
        <span class="channel-tail"><span class="channel-more" data-channel-menu="${escapeHtml(item.id)}" title="Opções" role="button" tabindex="0">⋮</span></span>
      </button>
    `).join('');

    voiceChannelsList.innerHTML = voice.map(item => `
      <button class="channel voice-channel${item.slug === currentVoiceRoom ? ' connected' : ''}" data-room="${escapeHtml(item.slug)}" data-channel-id="${escapeHtml(item.id)}" type="button">
        <span class="channel-icon">🔊</span>
        <span>${escapeHtml(item.name)}</span>
        <span class="channel-tail">
          <b class="voice-count" data-count="${escapeHtml(item.slug)}">0</b>
          <span class="channel-more" data-channel-menu="${escapeHtml(item.id)}" title="Opções" role="button" tabindex="0">⋮</span>
        </span>
      </button>
      <div class="voice-members hidden"></div>
    `).join('');
  }

  function renderPresence(payload = lastPresence) {
    const users = payload?.users || [];
    const total = Number(payload?.total || 0);
    const max = Number(payload?.max || 20);
    lastPresence = { users, total, max };

    onlineCount.textContent = `${total} online`;
    membersCount.textContent = `${total} / ${max}`;
    membersList.innerHTML = users.map(user => `
      <div class="member"${user.livekitIdentity ? ` data-participant="${escapeHtml(user.livekitIdentity)}"` : ''}>
        <div class="member-avatar-wrap"><div class="avatar">${escapeHtml(initials(user.name))}</div><span class="status-dot"></span></div>
        <div class="member-info"><strong>${escapeHtml(user.name)}${user.sessionId === sessionId ? ' (você)' : ''}</strong><span>${user.voiceRoom ? `em ${escapeHtml(voiceRoomName(user.voiceRoom))}` : 'online'}</span></div>
      </div>
    `).join('');

    document.querySelectorAll('.voice-channel').forEach(button => {
      const room = button.dataset.room;
      const people = users.filter(user => user.voiceRoom === room);
      const count = button.querySelector('[data-count]');
      if (count) count.textContent = people.length;

      let list = button.nextElementSibling;
      if (!list || !list.classList.contains('voice-members')) {
        list = document.createElement('div');
        list.className = 'voice-members';
        button.insertAdjacentElement('afterend', list);
      }

      list.innerHTML = people.map(user => `
        <div class="voice-member${user.sessionId !== sessionId && user.livekitIdentity ? ' volume-user' : ''}" title="${escapeHtml(user.name)}${user.sessionId !== sessionId && user.livekitIdentity ? ' • clique para ajustar volume' : ''}"${user.livekitIdentity ? ` data-participant="${escapeHtml(user.livekitIdentity)}" data-name="${escapeHtml(user.name)}"` : ''}>
          <span class="voice-member-dot"></span>
          <span>${escapeHtml(user.name)}${user.sessionId === sessionId ? ' (você)' : ''}</span>
          <span class="voice-member-states">
            <span class="voice-state-icon${user.micEnabled ? '' : ' off'}" title="${user.micEnabled ? 'Microfone desmutado' : 'Microfone mutado'}">${user.micEnabled ? '🎙' : '🔇'}</span>
            <span class="voice-state-icon${user.soundEnabled ? '' : ' off'}" title="${user.soundEnabled ? 'Som da sala ligado' : 'Som da sala desligado'}">${user.soundEnabled ? '🔊' : '🔈'}</span>
          </span>
        </div>
      `).join('');
      list.classList.toggle('hidden', people.length === 0);
    });
  }

  async function loadChannels({ loadHistory = false } = {}) {
    try {
      const data = await api('/api/channels');
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

  function ensureChannelMenu() {
    if (channelMenuPopover) return channelMenuPopover;
    channelMenuPopover = document.createElement('div');
    channelMenuPopover.className = 'channel-menu-popover hidden';
    channelMenuPopover.innerHTML = `
      <button type="button" data-channel-rename>✎ Renomear</button>
      <button type="button" class="danger" data-channel-delete>🗑 Excluir</button>
    `;
    document.body.appendChild(channelMenuPopover);

    channelMenuPopover.addEventListener('click', (event) => {
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
    menu.classList.remove('hidden');

    const rect = anchor.getBoundingClientRect();
    const width = 170;
    const gap = 6;
    let left = rect.right - width;
    if (left < gap) left = gap;
    let top = rect.bottom + gap;
    if (top + 90 > window.innerHeight) top = Math.max(gap, rect.top - 90);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function closeChannelMenu() {
    channelMenuTarget = null;
    channelMenuPopover?.classList.add('hidden');
  }

  function switchTextChannel(channel) {
    if (!channel || channel === currentChannel) return;
    currentChannel = channel;
    document.querySelectorAll('.text-channel').forEach(el => {
      el.classList.toggle('active', el.dataset.channel === channel);
    });
    socket?.emit('join-text-channel', channel);
    const [name, subtitle] = channelInfo(channel);
    document.querySelector('#channelTitle').textContent = name;
    document.querySelector('#channelSubtitle').textContent = subtitle;
    messageInput.placeholder = `Conversar em #${name}`;
    loadChannelHistory(channel);
  }

  function getParticipantVolume(identity) {
    return participantVolumes.has(identity) ? participantVolumes.get(identity) : 1;
  }

  function isParticipantMuted(identity) {
    return participantMuted.get(identity) === true;
  }

  function applyParticipantAudioState(identity) {
    if (!identity) return;
    audioBin.querySelectorAll('audio').forEach(el => {
      if (el.dataset.participant !== identity) return;
      el.muted = !roomSoundEnabled || isParticipantMuted(identity);
      el.volume = getParticipantVolume(identity);
    });
  }

  function applyRoomSoundState() {
    audioBin.querySelectorAll('audio').forEach(el => {
      const identity = el.dataset.participant || '';
      el.muted = !roomSoundEnabled || (identity && isParticipantMuted(identity));
      el.volume = identity ? getParticipantVolume(identity) : 1;
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
    selfAvatar.textContent = initials(profileName);
    connectSocket();
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
      <div class="avatar">${escapeHtml(initials(msg.name))}</div>
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
    if (!roomName || !sessionId) return;
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
          const el = track.attach();
          el.autoplay = true;
          el.dataset.participant = participant.identity;
          audioBin.appendChild(el);
          applyParticipantAudioState(participant.identity);
        } else if (track.kind === Track.Kind.Video) {
          addVideoTrack(
            track,
            participant.name || participant.identity,
            track.source === Track.Source.ScreenShare,
            false,
            participant.identity,
          );
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => removeTrack(track));
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

      try {
        await lkRoom.localParticipant.setMicrophoneEnabled(true, microphoneCaptureOptions());
        micEnabled = true;
        startKrispInBackground({ notifyOnFallback: true });
      } catch {
        micEnabled = false;
        notify('Entre na sala de voz. Se quiser falar, permita o microfone no navegador.', true);
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
    const badge = document.createElement('div');
    badge.className = 'video-label';
    badge.textContent = `${label}${local ? ' (você)' : ''}${isScreen ? ' • tela' : ''}`;
    tile.appendChild(badge);
    prepareVideoTile(tile);
    videoGrid.appendChild(tile);
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
      const badge = document.createElement('div'); badge.className = 'video-label'; badge.textContent = `${profileName} (você)${isScreen ? ' • tela' : ''}`; tile.appendChild(badge);
      prepareVideoTile(tile);
      videoGrid.appendChild(tile);

      if (isScreen && track.mediaStreamTrack) {
        const mediaTrack = track.mediaStreamTrack;
        mediaTrack.addEventListener('ended', () => {
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

  screenBtn.addEventListener('click', async () => {
    if (!lkRoom) return;
    try {
      screenEnabled = !screenEnabled;
      if (screenEnabled) {
        callCollapsed = false;
        await lkRoom.localParticipant.setScreenShareEnabled(
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
      } else {
        await lkRoom.localParticipant.setScreenShareEnabled(false);
      }
      setTimeout(refreshLocalVideo, 100);
      updateControlButtons();
    } catch (error) {
      screenEnabled = false;
      updateControlButtons();
      notify('O compartilhamento de tela foi cancelado ou bloqueado.', true);
    }
  });

  function updateControlButtons() {
    micBtn.classList.toggle('active', micEnabled);
    micBtn.classList.toggle('off', !micEnabled);
    micBtn.textContent = micEnabled ? '🎙' : '🔇';
    micBtn.title = micEnabled ? 'Mutar microfone' : 'Desmutar microfone';
    micBtn.setAttribute('aria-label', micBtn.title);

    audioBtn.classList.toggle('active', roomSoundEnabled);
    audioBtn.classList.toggle('off', !roomSoundEnabled);
    audioBtn.textContent = roomSoundEnabled ? '🔊' : '🔈';
    audioBtn.title = roomSoundEnabled ? 'Silenciar áudio da sala' : 'Ativar áudio da sala';
    audioBtn.setAttribute('aria-label', audioBtn.title);

    if (micStatusText) {
      micStatusText.textContent = micEnabled ? '🎙 Microfone ligado' : '🔇 Microfone mutado';
      micStatusText.classList.toggle('off', !micEnabled);
    }
    if (soundStatusText) {
      soundStatusText.textContent = roomSoundEnabled ? '🔊 Som ligado' : '🔈 Som desligado';
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
    setVoiceConnectionStatus('connected');
    callStage.classList.add('hidden');
    document.querySelectorAll('.voice-channel').forEach(el => el.classList.remove('connected'));
    document.querySelectorAll('.video-tile').forEach(el => el.remove());
    document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'));
    participantVolumes.clear();
    participantMuted.clear();
    closeVolumePopover();
    audioBin.innerHTML = '';
    updateControlButtons();
    updateEmptyVideo();
    updateVideoLayout();
    if (document.fullscreenElement === callStage) document.exitFullscreen().catch(() => {});
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
    const voiceMember = event.target.closest('.voice-member.volume-user[data-participant]');
    if (voiceMember && currentVoiceRoom) {
      event.stopPropagation();
      openVolumePopover(voiceMember.dataset.participant, voiceMember.dataset.name || 'Volume', voiceMember);
      return;
    }
    if (volumePopover && !volumePopover.contains(event.target)) closeVolumePopover();
    if (channelMenuPopover && !channelMenuPopover.contains(event.target) && !event.target.closest('[data-channel-menu]')) closeChannelMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && volumePopoverIdentity) closeVolumePopover();
    if (event.key === 'Escape' && channelMenuTarget) closeChannelMenu();
  });

  window.addEventListener('resize', () => {
    closeVolumePopover();
    closeChannelMenu();
  });

  membersToggle.addEventListener('click', () => membersPanel.classList.toggle('open'));
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
