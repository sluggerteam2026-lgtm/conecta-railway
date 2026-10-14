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

const textChannels = new Map();
const voiceRooms = new Map();

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

function cleanChannelName(value) {
  return String(value || '')
    .replace(/[<>\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

function slugifyChannelName(value) {
  const slug = cleanChannelName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `canal-${crypto.randomBytes(3).toString('hex')}`;
}

function serializeChannels() {
  return [
    ...[...textChannels.values()],
    ...[...voiceRooms.values()],
  ].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR'));
}

async function refreshChannelsCache() {
  if (!pool) return;
  const result = await pool.query(`
    SELECT id, type, slug, name, subtitle, sort_order, created_at
    FROM channels
    ORDER BY sort_order ASC, created_at ASC
  `);

  textChannels.clear();
  voiceRooms.clear();

  for (const row of result.rows) {
    const channel = {
      id: row.id,
      type: row.type,
      slug: row.slug,
      name: row.name,
      subtitle: row.subtitle || '',
      sortOrder: Number(row.sort_order) || 0,
    };
    if (row.type === 'text') textChannels.set(row.slug, channel);
    if (row.type === 'voice') voiceRooms.set(row.slug, channel);
  }
}

function emitChannels() {
  io.emit('channels-updated', { channels: serializeChannels() });
}

async function makeUniqueChannelSlug(name) {
  const base = slugifyChannelName(name);
  let slug = base;
  let suffix = 2;

  while (textChannels.has(slug) || voiceRooms.has(slug)) {
    slug = `${base.slice(0, 42)}-${suffix++}`;
  }
  return slug;
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
    CREATE TABLE IF NOT EXISTS channels (
      id UUID PRIMARY KEY,
      type VARCHAR(8) NOT NULL CHECK (type IN ('text', 'voice')),
      slug VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(48) NOT NULL,
      subtitle VARCHAR(160) NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const channelCount = await pool.query(`SELECT COUNT(*)::int AS total FROM channels`);
  if (Number(channelCount.rows[0]?.total || 0) === 0) {
    const defaults = [
      ['text', 'geral', 'geral', 'O papo principal da turma', 10],
      ['text', 'jogos', 'jogos', 'Partidas, convites e aquele GG', 20],
      ['text', 'links-e-assuntos', 'links-e-assuntos', 'Links, vídeos e assuntos aleatórios', 30],
      ['voice', 'sala-da-turma', 'Sala da turma', '', 110],
      ['voice', 'jogando-juntos', 'Jogando juntos', '', 120],
      ['voice', 'cinema-live', 'Cinema & live', '', 130],
    ];

    for (const [type, slug, name, subtitle, sortOrder] of defaults) {
      await pool.query(
        `
          INSERT INTO channels (id, type, slug, name, subtitle, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (slug) DO NOTHING
        `,
        [crypto.randomUUID(), type, slug, name, subtitle, sortOrder],
      );
    }
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

  await refreshChannelsCache();
  databaseReady = true;
  console.log('Conecta: PostgreSQL conectado; canais e mensagens estão prontos.');
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Conecta',
    livekitConfigured: Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    databaseConfigured: Boolean(DATABASE_URL),
    databaseReady,
    channels: textChannels.size + voiceRooms.size,
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


app.get('/api/channels', (req, res) => {
  const auth = getSession(req);
  if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
  if (!databaseReady || !pool) {
    return res.status(503).json({ error: 'O banco de canais ainda não está disponível.' });
  }
  res.json({ channels: serializeChannels() });
});

app.post('/api/channels', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!databaseReady || !pool) {
      return res.status(503).json({ error: 'O banco de canais ainda não está disponível.' });
    }

    const type = String(req.body?.type || '');
    const name = cleanChannelName(req.body?.name);
    if (!['text', 'voice'].includes(type)) {
      return res.status(400).json({ error: 'Tipo de canal inválido.' });
    }
    if (name.length < 2) {
      return res.status(400).json({ error: 'Use um nome com pelo menos 2 caracteres.' });
    }

    const slug = await makeUniqueChannelSlug(name);
    const maxOrder = await pool.query(
      `SELECT COALESCE(MAX(sort_order), $1)::int AS value FROM channels WHERE type = $2`,
      [type === 'text' ? 0 : 100, type],
    );
    const sortOrder = Number(maxOrder.rows[0]?.value || 0) + 10;
    const id = crypto.randomUUID();
    const subtitle = type === 'text' ? `Conversa em #${name}` : '';

    await pool.query(
      `
        INSERT INTO channels (id, type, slug, name, subtitle, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [id, type, slug, name, subtitle, sortOrder],
    );

    await refreshChannelsCache();
    emitChannels();
    res.status(201).json({ channels: serializeChannels() });
  } catch (error) {
    console.error('Erro ao criar canal:', error);
    res.status(500).json({ error: 'Não foi possível criar o canal.' });
  }
});

app.patch('/api/channels/:id', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!databaseReady || !pool) {
      return res.status(503).json({ error: 'O banco de canais ainda não está disponível.' });
    }

    const id = String(req.params.id || '').trim();
    const name = cleanChannelName(req.body?.name);
    if (!id || name.length < 2) {
      return res.status(400).json({ error: 'Use um nome com pelo menos 2 caracteres.' });
    }

    const result = await pool.query(
      `
        UPDATE channels
        SET name = $1,
            subtitle = CASE WHEN type = 'text' THEN $2 ELSE subtitle END
        WHERE id = $3
        RETURNING id
      `,
      [name, `Conversa em #${name}`, id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Canal não encontrado.' });
    }

    await refreshChannelsCache();
    emitChannels();
    res.json({ channels: serializeChannels() });
  } catch (error) {
    console.error('Erro ao renomear canal:', error);
    res.status(500).json({ error: 'Não foi possível renomear o canal.' });
  }
});

app.delete('/api/channels/:id', async (req, res) => {
  const client = pool ? await pool.connect().catch(() => null) : null;
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!databaseReady || !pool || !client) {
      return res.status(503).json({ error: 'O banco de canais ainda não está disponível.' });
    }

    const id = String(req.params.id || '').trim();
    const found = await client.query(
      `SELECT id, type, slug, name FROM channels WHERE id = $1`,
      [id],
    );
    if (!found.rowCount) {
      return res.status(404).json({ error: 'Canal não encontrado.' });
    }

    const channel = found.rows[0];
    if (channel.type === 'text') {
      const count = await client.query(`SELECT COUNT(*)::int AS total FROM channels WHERE type = 'text'`);
      if (Number(count.rows[0]?.total || 0) <= 1) {
        return res.status(400).json({ error: 'O Conecta precisa ter pelo menos um canal de texto.' });
      }
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM channels WHERE id = $1`, [id]);
    if (channel.type === 'text') {
      await client.query(`DELETE FROM messages WHERE channel = $1`, [channel.slug]);
    }
    await client.query('COMMIT');

    await refreshChannelsCache();

    if (channel.type === 'text') {
      const fallback = [...textChannels.keys()][0] || null;
      if (fallback) {
        for (const socket of io.sockets.sockets.values()) {
          if (socket.data.textChannel !== channel.slug) continue;
          socket.leave(`text:${channel.slug}`);
          socket.data.textChannel = fallback;
          socket.join(`text:${fallback}`);
        }
      }
    } else {
      for (const [sessionId, state] of voiceState.entries()) {
        if (state?.room === channel.slug) voiceState.delete(sessionId);
      }
      io.emit('voice-room-deleted', { room: channel.slug, name: channel.name });
      emitPresence();
    }

    emitChannels();
    res.json({ channels: serializeChannels() });
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch {}
    console.error('Erro ao excluir canal:', error);
    res.status(500).json({ error: 'Não foi possível excluir o canal.' });
  } finally {
    client?.release();
  }
});

app.get('/api/messages/:channel', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!databaseReady || !pool) {
      return res.status(503).json({ error: 'O banco de mensagens ainda não está disponível.' });
    }

    const channel = String(req.params.channel || '');
    if (!textChannels.has(channel)) {
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
    if (!voiceRooms.has(room)) {
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
  socket.data.textChannel = textChannels.has('geral') ? 'geral' : ([...textChannels.keys()][0] || null);
  if (socket.data.textChannel) socket.join(`text:${socket.data.textChannel}`);
  emitPresence();

  socket.on('join-text-channel', (channel) => {
    if (!textChannels.has(channel)) return;
    if (socket.data.textChannel) socket.leave(`text:${socket.data.textChannel}`);
    socket.data.textChannel = channel;
    socket.join(`text:${channel}`);
  });

  socket.on('chat-message', async (payload = {}) => {
    try {
      const channel = String(payload.channel || '');
      if (channel !== socket.data.textChannel) return;
      if (!textChannels.has(channel)) return;
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
      if (voiceRooms.has(payload)) {
        voiceState.set(sessionId, { room: payload, micEnabled: true, soundEnabled: true });
      }
      emitPresence();
      return;
    }

    const room = String(payload?.room || '').trim();
    if (!voiceRooms.has(room)) return;

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
