import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const { Pool } = pg;

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
const MAX_USERS = Number(process.env.MAX_USERS || 20);
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '');
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '');
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '');
const DATABASE_URL = String(process.env.DATABASE_URL || '');

const TEXT_CHANNELS = new Set(['geral', 'jogos', 'links-e-assuntos']);
const VOICE_ROOMS = new Set(['sala-da-turma', 'jogando-juntos', 'cinema-live']);

const sessions = new Map();
const socketsBySession = new Map();
const voiceState = new Map();

let databaseReady = false;
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

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

function cleanUserKey(value) {
  const key = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{8,128}$/.test(key)) return key;
  return crypto.randomUUID();
}

function cleanMessage(value) {
  return String(value || '').trim().slice(0, 1500);
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
      livekitIdentity: `${session.name}-${sessionId.slice(0, 8)}`,
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

function rowToMessage(row, mine = false) {
  return {
    id: row.id,
    channel: row.channel,
    name: row.author_name,
    text: row.body,
    ts: new Date(row.created_at).getTime(),
    editedAt: row.edited_at ? new Date(row.edited_at).getTime() : null,
    mine,
  };
}

async function initDatabase() {
  if (!pool) {
    console.warn('Conecta: DATABASE_URL não configurada. O chat persistente ficará indisponível.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      channel VARCHAR(64) NOT NULL,
      author_key VARCHAR(128) NOT NULL,
      author_name VARCHAR(32) NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      edited_at TIMESTAMPTZ NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_channel_created_idx
    ON messages (channel, created_at DESC)
  `);

  databaseReady = true;
  console.log('Conecta: PostgreSQL conectado e tabela de mensagens pronta.');
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Conecta',
    livekitConfigured: Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    databaseConfigured: Boolean(DATABASE_URL),
    databaseReady,
    frontendConfigured: existsSync(INDEX_FILE),
    online: onlineSessionsCount(),
    maxUsers: MAX_USERS,
  });
});

app.post('/api/login', (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Digite um nome ou apelido com pelo menos 2 caracteres.' });
  }
  if (onlineSessionsCount() >= MAX_USERS) {
    return res.status(429).json({ error: `A sala atingiu o limite de ${MAX_USERS} pessoas.` });
  }

  const userKey = cleanUserKey(req.body?.userKey);
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { name, userKey, createdAt: Date.now(), lastSeen: Date.now() });
  res.json({ sessionId, name, userKey, maxUsers: MAX_USERS });
});

app.get('/api/messages/:channel', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!databaseReady || !pool) {
      return res.status(503).json({ error: 'O banco de mensagens ainda não está disponível.' });
    }

    const channel = String(req.params.channel || '');
    if (!TEXT_CHANNELS.has(channel)) {
      return res.status(400).json({ error: 'Canal de texto inválido.' });
    }

    const result = await pool.query(
      `
        SELECT id, channel, author_key, author_name, body, created_at, edited_at
        FROM (
          SELECT id, channel, author_key, author_name, body, created_at, edited_at
          FROM messages
          WHERE channel = $1
          ORDER BY created_at DESC
          LIMIT 100
        ) recent
        ORDER BY created_at ASC
      `,
      [channel],
    );

    res.json({
      messages: result.rows.map(row => rowToMessage(row, row.author_key === auth.session.userKey)),
    });
  } catch (error) {
    console.error('Erro ao carregar mensagens:', error);
    res.status(500).json({ error: 'Não foi possível carregar as mensagens.' });
  }
});

app.post('/api/livekit-token', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(503).json({ error: 'LiveKit ainda não está configurado no servidor.' });
    }

    const room = String(req.body?.room || '').trim().slice(0, 64);
    if (!VOICE_ROOMS.has(room)) {
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
  socket.data.userKey = session.userKey;
  next();
});

io.on('connection', (socket) => {
  const { sessionId, name, userKey } = socket.data;
  const previous = socketsBySession.get(sessionId);
  if (previous && previous !== socket.id) {
    io.sockets.sockets.get(previous)?.disconnect(true);
  }
  socketsBySession.set(sessionId, socket.id);
  socket.data.textChannel = 'geral';
  socket.join('text:geral');
  emitPresence();

  socket.on('join-text-channel', (channel) => {
    if (!TEXT_CHANNELS.has(channel)) return;
    if (socket.data.textChannel) socket.leave(`text:${socket.data.textChannel}`);
    socket.data.textChannel = channel;
    socket.join(`text:${channel}`);
  });

  socket.on('chat-message', async (payload = {}) => {
    try {
      const channel = String(payload.channel || '');
      if (channel !== socket.data.textChannel) return;
      if (!TEXT_CHANNELS.has(channel)) return;
      if (!databaseReady || !pool) {
        socket.emit('chat-error', { message: 'O banco de mensagens está indisponível no momento.' });
        return;
      }

      const text = cleanMessage(payload.text);
      if (!text) return;

      const id = crypto.randomUUID();
      const createdAt = new Date();

      await pool.query(
        `
          INSERT INTO messages (id, channel, author_key, author_name, body, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [id, channel, userKey, name, text, createdAt],
      );

      const message = {
        id,
        channel,
        name,
        text,
        ts: createdAt.getTime(),
        editedAt: null,
      };

      socket.emit('chat-message', { ...message, mine: true });
      socket.to(`text:${channel}`).emit('chat-message', { ...message, mine: false });
    } catch (error) {
      console.error('Erro ao salvar mensagem:', error);
      socket.emit('chat-error', { message: 'Não foi possível salvar a mensagem.' });
    }
  });

  socket.on('edit-message', async (payload = {}) => {
    try {
      if (!databaseReady || !pool) {
        socket.emit('chat-error', { message: 'O banco de mensagens está indisponível no momento.' });
        return;
      }

      const id = String(payload.id || '').trim();
      const text = cleanMessage(payload.text);
      if (!id || !text) return;

      const result = await pool.query(
        `
          UPDATE messages
          SET body = $1, edited_at = NOW()
          WHERE id = $2 AND author_key = $3
          RETURNING id, channel, body, edited_at
        `,
        [text, id, userKey],
      );

      if (!result.rowCount) {
        socket.emit('chat-error', { message: 'Você só pode editar suas próprias mensagens.' });
        return;
      }

      const row = result.rows[0];
      io.to(`text:${row.channel}`).emit('message-edited', {
        id: row.id,
        channel: row.channel,
        text: row.body,
        editedAt: new Date(row.edited_at).getTime(),
      });
    } catch (error) {
      console.error('Erro ao editar mensagem:', error);
      socket.emit('chat-error', { message: 'Não foi possível editar a mensagem.' });
    }
  });

  socket.on('delete-message', async (payload = {}) => {
    try {
      if (!databaseReady || !pool) {
        socket.emit('chat-error', { message: 'O banco de mensagens está indisponível no momento.' });
        return;
      }

      const id = String(payload.id || '').trim();
      if (!id) return;

      const result = await pool.query(
        `
          DELETE FROM messages
          WHERE id = $1 AND author_key = $2
          RETURNING id, channel
        `,
        [id, userKey],
      );

      if (!result.rowCount) {
        socket.emit('chat-error', { message: 'Você só pode excluir suas próprias mensagens.' });
        return;
      }

      const row = result.rows[0];
      io.to(`text:${row.channel}`).emit('message-deleted', {
        id: row.id,
        channel: row.channel,
      });
    } catch (error) {
      console.error('Erro ao excluir mensagem:', error);
      socket.emit('chat-error', { message: 'Não foi possível excluir a mensagem.' });
    }
  });

  socket.on('voice-state', (payload) => {
    if (payload === null || payload === '') {
      voiceState.delete(sessionId);
      emitPresence();
      return;
    }

    // Compatibilidade com versões antigas que enviavam apenas o nome da sala.
    if (typeof payload === 'string') {
      if (VOICE_ROOMS.has(payload)) {
        voiceState.set(sessionId, { room: payload, micEnabled: true, soundEnabled: true });
      }
      emitPresence();
      return;
    }

    const room = String(payload?.room || '').trim();
    if (!VOICE_ROOMS.has(room)) return;

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

try {
  await initDatabase();
} catch (error) {
  databaseReady = false;
  console.error('Conecta: não foi possível preparar o PostgreSQL:', error);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Conecta rodando em http://localhost:${PORT}`);
});
