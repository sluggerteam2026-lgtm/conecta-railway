import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  transports: ['websocket', 'polling'],
});

const PORT = Number(process.env.PORT || 3000);
const ACCESS_CODE = String(process.env.ACCESS_CODE || 'SLG2026');
const MAX_USERS = Number(process.env.MAX_USERS || 20);
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '');
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '');
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '');

const sessions = new Map();
const socketsBySession = new Map();
const voiceState = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/', (_req, res) => {
  if (!existsSync(INDEX_FILE)) {
    return res.status(500).send('Conecta: public/index.html não foi encontrado no deploy.');
  }
  res.sendFile(INDEX_FILE);
});

function cleanName(value) {
  return String(value || '')
    .replace(/[<>\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
}

function onlineSessionsCount() {
  return socketsBySession.size;
}

function publicUsers() {
  const users = [];
  for (const [sessionId, socketId] of socketsBySession.entries()) {
    const session = sessions.get(sessionId);
    if (!session) continue;
    users.push({
      sessionId,
      socketId,
      name: session.name,
      voiceRoom: voiceState.get(sessionId)?.room || null,
      micEnabled: Boolean(voiceState.get(sessionId)?.micEnabled),
      soundEnabled: voiceState.get(sessionId)?.soundEnabled !== false,
    });
  }
  return users.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function emitPresence() {
  io.emit('presence', {
    users: publicUsers(),
    total: onlineSessionsCount(),
    max: MAX_USERS,
  });
}

function getSession(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.sessionId;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  session.lastSeen = Date.now();
  return { token, session };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Conecta',
    livekitConfigured: Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    frontendConfigured: existsSync(INDEX_FILE),
    online: onlineSessionsCount(),
    maxUsers: MAX_USERS,
  });
});

app.post('/api/login', (req, res) => {
  const name = cleanName(req.body?.name);
  const code = String(req.body?.code || '').trim();

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Digite um nome ou apelido com pelo menos 2 caracteres.' });
  }
  if (code !== ACCESS_CODE) {
    return res.status(401).json({ error: 'Código da turma incorreto.' });
  }
  if (onlineSessionsCount() >= MAX_USERS) {
    return res.status(429).json({ error: `A sala atingiu o limite de ${MAX_USERS} pessoas.` });
  }

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { name, createdAt: Date.now(), lastSeen: Date.now() });
  res.json({ sessionId, name, maxUsers: MAX_USERS });
});

app.post('/api/livekit-token', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(503).json({ error: 'LiveKit ainda não está configurado no servidor.' });
    }

    const room = String(req.body?.room || '').trim().slice(0, 64);
    const allowedRooms = new Set(['sala-da-turma', 'jogando-juntos', 'cinema-live']);
    if (!allowedRooms.has(room)) {
      return res.status(400).json({ error: 'Sala de voz inválida.' });
    }

    const identity = `${auth.session.name}-${auth.token.slice(0, 8)}`;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: auth.session.name,
      ttl: '15m',
    });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    res.json({
      token: await token.toJwt(),
      url: LIVEKIT_URL,
      identity,
    });
  } catch (error) {
    console.error('Erro ao gerar token LiveKit:', error);
    res.status(500).json({ error: 'Não foi possível preparar a sala de voz.' });
  }
});

io.use((socket, next) => {
  const sessionId = String(socket.handshake.auth?.sessionId || '');
  const session = sessions.get(sessionId);
  if (!session) return next(new Error('Sessão inválida'));

  const existingSocket = socketsBySession.get(sessionId);
  if (!existingSocket && onlineSessionsCount() >= MAX_USERS) {
    return next(new Error('Sala cheia'));
  }

  socket.data.sessionId = sessionId;
  socket.data.name = session.name;
  next();
});

io.on('connection', (socket) => {
  const { sessionId, name } = socket.data;
  const previous = socketsBySession.get(sessionId);
  if (previous && previous !== socket.id) {
    io.sockets.sockets.get(previous)?.disconnect(true);
  }
  socketsBySession.set(sessionId, socket.id);
  socket.data.textChannel = 'geral';
  socket.join('text:geral');
  emitPresence();

  socket.on('join-text-channel', (channel) => {
    const allowed = new Set(['geral', 'jogos', 'links-e-assuntos']);
    if (!allowed.has(channel)) return;
    if (socket.data.textChannel) socket.leave(`text:${socket.data.textChannel}`);
    socket.data.textChannel = channel;
    socket.join(`text:${channel}`);
  });

  socket.on('chat-message', (payload = {}) => {
    const channel = String(payload.channel || '');
    if (channel !== socket.data.textChannel) return;
    const allowed = new Set(['geral', 'jogos', 'links-e-assuntos']);
    if (!allowed.has(channel)) return;

    const text = String(payload.text || '').trim().slice(0, 1500);
    if (!text) return;

    io.to(`text:${channel}`).emit('chat-message', {
      id: crypto.randomUUID(),
      channel,
      name,
      text,
      ts: Date.now(),
    });
  });

  socket.on('voice-state', (payload) => {
    const allowed = new Set(['sala-da-turma', 'jogando-juntos', 'cinema-live']);

    if (payload === null || payload === '') {
      voiceState.delete(sessionId);
      emitPresence();
      return;
    }

    // Compatibilidade com versões antigas que enviavam apenas o nome da sala.
    if (typeof payload === 'string') {
      if (allowed.has(payload)) {
        voiceState.set(sessionId, { room: payload, micEnabled: true, soundEnabled: true });
      }
      emitPresence();
      return;
    }

    const room = String(payload?.room || '').trim();
    if (!allowed.has(room)) return;

    voiceState.set(sessionId, {
      room,
      micEnabled: Boolean(payload?.micEnabled),
      soundEnabled: payload?.soundEnabled !== false,
    });
    emitPresence();
  });

  socket.on('disconnect', () => {
    if (socketsBySession.get(sessionId) === socket.id) {
      socketsBySession.delete(sessionId);
      voiceState.delete(sessionId);
      emitPresence();
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 12;
  for (const [id, session] of sessions.entries()) {
    if (!socketsBySession.has(id) && session.lastSeen < cutoff) sessions.delete(id);
  }
}, 1000 * 60 * 30).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Conecta rodando em http://localhost:${PORT}`);
});
