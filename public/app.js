(() => {
  const landing = document.querySelector('#landing');
  const app = document.querySelector('#app');
  const loginForm = document.querySelector('#loginForm');
  const loginBtn = document.querySelector('#loginBtn');
  const nameInput = document.querySelector('#nameInput');
  const codeInput = document.querySelector('#codeInput');
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
  const leaveVoiceBtn = document.querySelector('#leaveVoiceBtn');
  const micBtn = document.querySelector('#micBtn');
  const audioBtn = document.querySelector('#audioBtn');
  const micStatusText = document.querySelector('#micStatusText');
  const soundStatusText = document.querySelector('#soundStatusText');
  const cameraBtn = document.querySelector('#cameraBtn');
  const screenBtn = document.querySelector('#screenBtn');
  const callStage = document.querySelector('#callStage');
  const callStageTitle = document.querySelector('#callStageTitle');
  const collapseCallBtn = document.querySelector('#collapseCallBtn');
  const videoGrid = document.querySelector('#videoGrid');
  const emptyVideo = document.querySelector('#emptyVideo');
  const audioBin = document.querySelector('#audioBin');

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
  const SAVED_CODE_KEY = 'conecta.savedCode';

  let sessionId = sessionStorage.getItem('conecta.sessionId') || '';
  let profileName = sessionStorage.getItem('conecta.name') || '';
  let socket = null;
  let reauthenticating = false;
  let currentChannel = 'geral';
  let currentVoiceRoom = null;
  let lkRoom = null;
  let micEnabled = false;
  let roomSoundEnabled = true;
  let cameraEnabled = false;
  let screenEnabled = false;
  let callCollapsed = false;
  let cueAudioContext = null;
  const voiceTokenCache = new Map();
  const voiceTokenRequests = new Map();


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

  function applyRoomSoundState() {
    audioBin.querySelectorAll('audio').forEach(el => {
      el.muted = !roomSoundEnabled;
      el.volume = roomSoundEnabled ? 1 : 0;
    });
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

  async function login(name, code, { remember = true, silent = false } = {}) {
    loginBtn.disabled = true;
    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ name, code }),
      });
      sessionId = data.sessionId;
      profileName = data.name;
      voiceTokenCache.clear();
      voiceTokenRequests.clear();
      sessionStorage.setItem('conecta.sessionId', sessionId);
      sessionStorage.setItem('conecta.name', profileName);
      if (remember) {
        localStorage.setItem(SAVED_NAME_KEY, profileName);
        localStorage.setItem(SAVED_CODE_KEY, String(code || '').trim());
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
    await login(nameInput.value, codeInput.value);
  });

  function enterApp() {
    landing.classList.add('hidden');
    app.classList.remove('hidden');
    selfName.textContent = profileName;
    selfAvatar.textContent = initials(profileName);
    connectSocket();
  }

  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io({ auth: { sessionId } });

    socket.on('connect', () => {
      // Deixa os tokens das salas prontos em segundo plano para o clique responder mais rápido.
      setTimeout(() => {
        document.querySelectorAll('.voice-channel').forEach(button => {
          prefetchVoiceToken(button.dataset.room);
        });
      }, 120);
    });

    socket.on('connect_error', async (error) => {
      const message = error.message || 'Não foi possível entrar na turma.';
      if (/sessão/i.test(message)) {
        const savedName = localStorage.getItem(SAVED_NAME_KEY) || '';
        const savedCode = localStorage.getItem(SAVED_CODE_KEY) || '';
        if (!reauthenticating && savedName && savedCode) {
          reauthenticating = true;
          socket?.disconnect();
          sessionStorage.removeItem('conecta.sessionId');
          sessionStorage.removeItem('conecta.name');
          sessionId = '';
          profileName = '';
          const ok = await login(savedName, savedCode, { remember: true, silent: true });
          reauthenticating = false;
          if (!ok) {
            landing.classList.remove('hidden');
            app.classList.add('hidden');
            nameInput.value = savedName;
            codeInput.value = savedCode;
            notify('Seu login salvo não pôde ser validado. Entre novamente.', true);
          }
          return;
        }
      }
      notify(message, true);
    });

    socket.on('presence', ({ users, total, max }) => {
      onlineCount.textContent = `${total} online`;
      membersCount.textContent = `${total} / ${max}`;
      membersList.innerHTML = users.map(user => `
        <div class="member">
          <div class="member-avatar-wrap"><div class="avatar">${escapeHtml(initials(user.name))}</div><span class="status-dot"></span></div>
          <div class="member-info"><strong>${escapeHtml(user.name)}${user.sessionId === sessionId ? ' (você)' : ''}</strong><span>${user.voiceRoom ? `em ${escapeHtml(voiceNames[user.voiceRoom] || 'voz')}` : 'online'}</span></div>
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
          <div class="voice-member" title="${escapeHtml(user.name)}">
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
    });

    socket.on('chat-message', (msg) => {
      if (msg.channel !== currentChannel) return;
      appendMessage(msg);
    });
  }

  function clearMessagesForChannel() {
    messages.innerHTML = `
      <div class="welcome-message">
        <div class="hash-bubble">#</div>
        <h2>Bem-vindo ao <span>#${escapeHtml(channelNames[currentChannel][0])}</span></h2>
        <p>As mensagens aparecem ao vivo e não ficam salvas no servidor.</p>
      </div>`;
  }

  document.querySelectorAll('.text-channel').forEach(button => {
    button.addEventListener('click', () => {
      const channel = button.dataset.channel;
      if (channel === currentChannel) return;
      currentChannel = channel;
      document.querySelectorAll('.text-channel').forEach(el => el.classList.toggle('active', el === button));
      socket?.emit('join-text-channel', channel);
      document.querySelector('#channelTitle').textContent = channelNames[channel][0];
      document.querySelector('#channelSubtitle').textContent = channelNames[channel][1];
      messageInput.placeholder = `Conversar em #${channelNames[channel][0]}`;
      clearMessagesForChannel();
    });
  });

  messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !socket?.connected) return;
    socket.emit('chat-message', { channel: currentChannel, text });
    messageInput.value = '';
  });

  function appendMessage(msg) {
    const div = document.createElement('div');
    div.className = 'message';
    const time = new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="avatar">${escapeHtml(initials(msg.name))}</div>
      <div><div class="message-head"><strong>${escapeHtml(msg.name)}</strong><time>${time}</time></div><p>${escapeHtml(msg.text)}</p></div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  document.querySelectorAll('.voice-channel').forEach(button => {
    const warmRoom = () => prefetchVoiceToken(button.dataset.room);
    button.addEventListener('pointerenter', warmRoom, { passive: true });
    button.addEventListener('pointerdown', warmRoom, { passive: true });
    button.addEventListener('focus', warmRoom);
    button.addEventListener('click', () => joinVoice(button.dataset.room));
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
    voiceRoomLabel.textContent = voiceNames[roomName];
    callStageTitle.textContent = voiceNames[roomName];
    callStage.classList.remove('hidden');
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

  async function joinVoice(roomName) {
    if (currentVoiceRoom === roomName && lkRoom) {
      callCollapsed = false;
      callStage.classList.remove('hidden');
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
      lkRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
          degradationPreference: 'maintain-framerate',
        },
      });

      lkRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          el.muted = !roomSoundEnabled;
          el.volume = roomSoundEnabled ? 1 : 0;
          audioBin.appendChild(el);
        } else if (track.kind === Track.Kind.Video) {
          addVideoTrack(track, participant.name || participant.identity, track.source === Track.Source.ScreenShare, false);
        }
      });

      lkRoom.on(RoomEvent.TrackUnsubscribed, (track) => removeTrack(track));
      lkRoom.on(RoomEvent.ParticipantConnected, () => {
        playVoiceCue('join');
      });
      lkRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        playVoiceCue('leave');
        document.querySelectorAll(`[data-participant="${CSS.escape(participant.identity)}"]`).forEach(el => el.remove());
        updateEmptyVideo();
      });
      lkRoom.on(RoomEvent.Disconnected, () => {
        if (currentVoiceRoom) finishVoiceUi();
      });

      await lkRoom.connect(data.url, data.token);

      try {
        await lkRoom.localParticipant.setMicrophoneEnabled(true);
        micEnabled = true;
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

  function addVideoTrack(track, label, isScreen, local) {
    const sid = track.sid || track.mediaStreamTrack?.id || Math.random().toString(36).slice(2);
    const id = `track-${sid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    document.getElementById(id)?.remove();
    const tile = document.createElement('div');
    tile.id = id;
    tile.className = `video-tile${isScreen ? ' screen' : ''}`;
    if (!local && track?.participant?.identity) tile.dataset.participant = track.participant.identity;
    const video = track.attach();
    video.autoplay = true;
    video.playsInline = true;
    if (local && !isScreen) video.muted = true;
    tile.appendChild(video);
    const badge = document.createElement('div');
    badge.className = 'video-label';
    badge.textContent = `${label}${local ? ' (você)' : ''}${isScreen ? ' • tela' : ''}`;
    tile.appendChild(badge);
    videoGrid.appendChild(tile);
    updateEmptyVideo();
  }

  function removeTrack(track) {
    if (!track) return;
    track.detach().forEach(el => el.remove());
    const sid = track.sid || track.mediaStreamTrack?.id || '';
    if (sid) document.getElementById(`track-${sid.replace(/[^a-zA-Z0-9_-]/g, '')}`)?.remove();
    updateEmptyVideo();
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
      const isScreen = publication.source === LivekitClient.Track.Source.ScreenShare;
      const sid = track.sid || track.mediaStreamTrack?.id || Math.random().toString(36).slice(2);
      const tile = document.createElement('div');
      tile.id = `track-${String(sid).replace(/[^a-zA-Z0-9_-]/g, '')}`;
      tile.dataset.local = 'true';
      tile.className = `video-tile${isScreen ? ' screen' : ''}`;
      const video = track.attach();
      video.autoplay = true; video.playsInline = true; video.muted = true;
      tile.appendChild(video);
      const badge = document.createElement('div'); badge.className = 'video-label'; badge.textContent = `${profileName} (você)${isScreen ? ' • tela' : ''}`; tile.appendChild(badge);
      videoGrid.appendChild(tile);
    }
    updateEmptyVideo();
  }

  function updateEmptyVideo() {
    const hasTiles = videoGrid.querySelector('.video-tile');
    emptyVideo.classList.toggle('hidden', Boolean(hasTiles));
  }

  micBtn.addEventListener('click', async () => {
    if (!lkRoom) return;
    try {
      micEnabled = !micEnabled;
      await lkRoom.localParticipant.setMicrophoneEnabled(micEnabled);
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
      await lkRoom.localParticipant.setCameraEnabled(cameraEnabled);
      setTimeout(refreshLocalVideo, 100);
      updateControlButtons();
    } catch (error) {
      cameraEnabled = false;
      updateControlButtons();
      notify('Não consegui acessar a câmera.', true);
    }
  });

  screenBtn.addEventListener('click', async () => {
    if (!lkRoom) return;
    try {
      screenEnabled = !screenEnabled;
      if (screenEnabled) {
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

    cameraBtn.classList.toggle('active', cameraEnabled); cameraBtn.textContent = cameraEnabled ? '◉' : '◎';
    screenBtn.classList.toggle('active', screenEnabled);
  }

  leaveVoiceBtn.addEventListener('click', () => leaveVoice(true));
  async function leaveVoice(showToast = true) {
    if (showToast && currentVoiceRoom) playVoiceCue('leave');
    if (lkRoom) {
      try { await lkRoom.disconnect(); } catch {}
      lkRoom = null;
    }
    if (currentVoiceRoom) socket?.emit('voice-state', null);
    finishVoiceUi();
    if (showToast) notify('Você saiu da sala de voz.');
  }

  function finishVoiceUi() {
    currentVoiceRoom = null;
    micEnabled = cameraEnabled = screenEnabled = false;
    voiceDock.classList.add('hidden');
    callStage.classList.add('hidden');
    document.querySelectorAll('.voice-channel').forEach(el => el.classList.remove('connected'));
    document.querySelectorAll('.video-tile').forEach(el => el.remove());
    audioBin.innerHTML = '';
    updateControlButtons();
    updateEmptyVideo();
  }

  collapseCallBtn.addEventListener('click', () => {
    callCollapsed = !callCollapsed;
    if (callCollapsed) callStage.classList.add('hidden');
  });

  membersToggle.addEventListener('click', () => membersPanel.classList.toggle('open'));
  logoutBtn.addEventListener('click', signOut);
  function signOut() {
    leaveVoice(false);
    socket?.disconnect();
    sessionStorage.removeItem('conecta.sessionId');
    sessionStorage.removeItem('conecta.name');
    localStorage.removeItem(SAVED_NAME_KEY);
    localStorage.removeItem(SAVED_CODE_KEY);
    location.reload();
  }

  window.addEventListener('beforeunload', () => {
    if (currentVoiceRoom) socket?.emit('voice-state', null);
  });

  const savedName = localStorage.getItem(SAVED_NAME_KEY) || '';
  const savedCode = localStorage.getItem(SAVED_CODE_KEY) || '';
  if (savedName) nameInput.value = savedName;
  if (savedCode) codeInput.value = savedCode;

  if (sessionId && profileName) {
    enterApp();
  } else if (savedName && savedCode) {
    login(savedName, savedCode, { remember: true, silent: true }).then((ok) => {
      if (!ok) notify('Não foi possível entrar automaticamente. Confira seu login.', true);
    });
  }
})();
