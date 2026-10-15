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
const io = new Server(server, { cors: { origin: false }, transports: ['websocket', 'polling'] });

const PORT = Number(process.env.PORT || 3000);
const MAX_USERS = Number(process.env.MAX_USERS || 20);
const LIVEKIT_URL = String(process.env.LIVEKIT_URL || '');
const LIVEKIT_API_KEY = String(process.env.LIVEKIT_API_KEY || '');
const LIVEKIT_API_SECRET = String(process.env.LIVEKIT_API_SECRET || '');
const DATABASE_URL = String(process.env.DATABASE_URL || '');
const MASTER_NAME = 'yCsLouco';
const TEXT_LOBBY_SLUG = 'sala-de-todos';
const VOICE_LOBBY_SLUG = 'sala-de-todos-voz';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const ALL_PERMISSIONS = {
  send_messages: true,
  join_voice: true,
  speak: true,
  camera: true,
  screen_share: true,
  manage_channels: true,
  manage_roles: true,
  manage_members: true,
};

const EMPTY_PERMISSIONS = {
  send_messages: false,
  join_voice: false,
  speak: false,
  camera: false,
  screen_share: false,
  manage_channels: false,
  manage_roles: false,
  manage_members: false,
};

const DEFAULT_ROLE_PERMISSIONS = {
  ...EMPTY_PERMISSIONS,
  send_messages: true,
  join_voice: true,
  speak: true,
  camera: true,
  screen_share: true,
};

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
app.use(express.json({ limit: '4mb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/', (_req, res) => {
  if (!existsSync(INDEX_FILE)) return res.status(500).send('Conecta: public/index.html não foi encontrado no deploy.');
  res.sendFile(INDEX_FILE);
});

function cleanName(value) {
  return String(value || '').replace(/[<>\\/]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}
function cleanUserKey(value) {
  const key = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(key) ? key : crypto.randomUUID();
}
function cleanMessage(value) { return String(value || '').trim().slice(0, 1500); }
function cleanChannelName(value) {
  return String(value || '').replace(/[<>\\/]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
}
function cleanRoleName(value) {
  return String(value || '').replace(/[<>\\/]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}
function cleanColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : '#5865F2';
}

function avatarUrl(publicId, version, hasAvatar = true) {
  if (!hasAvatar || !publicId) return null;
  return `/api/avatar/${encodeURIComponent(String(publicId))}?v=${Number(version) || 0}`;
}
function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
function decodeAvatarDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const declaredMime = match[1].toLowerCase();
  if (!AVATAR_MIME_TYPES.has(declaredMime)) return null;
  let buffer;
  try { buffer = Buffer.from(match[2], 'base64'); } catch { return null; }
  if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) return null;
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || detectedMime !== declaredMime) return null;
  return { buffer, mime: detectedMime };
}
function slugifyChannelName(value) {
  const slug = cleanChannelName(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || `canal-${crypto.randomBytes(3).toString('hex')}`;
}
function normalizePermissions(value = {}) {
  const out = {};
  for (const key of Object.keys(EMPTY_PERMISSIONS)) out[key] = Boolean(value?.[key]);
  return out;
}
function onlineSessionsCount() { return socketsBySession.size; }
function serializeChannels() {
  return [...textChannels.values(), ...voiceRooms.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR'));
}
function publicRole(role) {
  return { id: role.id, name: role.name, color: role.color, systemKey: role.systemKey || null };
}
function rowToMessage(row, mine = false) {
  return {
    id: row.id,
    channel: row.channel,
    name: row.author_name,
    text: row.body,
    ts: new Date(row.created_at).getTime(),
    editedAt: row.edited_at ? new Date(row.edited_at).getTime() : null,
    avatarId: row.avatar_public_id ? String(row.avatar_public_id) : null,
    avatarUrl: avatarUrl(row.avatar_public_id, row.avatar_version, row.has_avatar),
    mine,
  };
}
function getSession(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.sessionId;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  session.lastSeen = Date.now();
  return { token, session };
}

async function refreshChannelsCache() {
  if (!pool) return;
  const result = await pool.query(`
    SELECT id, type, slug, name, subtitle, sort_order, is_lobby, created_at
    FROM channels ORDER BY sort_order ASC, created_at ASC
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
      isLobby: Boolean(row.is_lobby),
    };
    if (row.type === 'text') textChannels.set(row.slug, channel);
    else if (row.type === 'voice') voiceRooms.set(row.slug, channel);
  }
}

async function makeUniqueChannelSlug(name) {
  const base = slugifyChannelName(name);
  let slug = base;
  let suffix = 2;
  while (textChannels.has(slug) || voiceRooms.has(slug)) slug = `${base.slice(0, 42)}-${suffix++}`;
  return slug;
}

async function getMasterUserKey() {
  if (!pool) return '';
  const result = await pool.query(`SELECT user_key FROM profiles WHERE is_master = TRUE LIMIT 1`);
  return String(result.rows[0]?.user_key || '');
}

async function getProfilePresentation(userKey) {
  if (!pool || !userKey) return { avatarId: null, avatarUrl: null };
  const result = await pool.query(`
    SELECT public_id, avatar_version, avatar_data IS NOT NULL AS has_avatar
    FROM profiles WHERE user_key = $1 LIMIT 1
  `, [userKey]);
  const row = result.rows[0];
  if (!row) return { avatarId: null, avatarUrl: null };
  return {
    avatarId: row.public_id ? String(row.public_id) : null,
    avatarUrl: avatarUrl(row.public_id, row.avatar_version, row.has_avatar),
  };
}

async function syncSessionPresentation(session) {
  if (!session) return session;
  const presentation = await getProfilePresentation(session.userKey);
  session.avatarId = presentation.avatarId;
  session.avatarUrl = presentation.avatarUrl;
  return session;
}

async function publishAvatarChange(userKey) {
  const presentation = await getProfilePresentation(userKey);
  for (const session of sessions.values()) {
    if (session.userKey !== userKey) continue;
    session.avatarId = presentation.avatarId;
    session.avatarUrl = presentation.avatarUrl;
  }
  io.emit('avatar-updated', presentation);
  await emitPresence();
  return presentation;
}

async function getUserRoles(userKey) {
  if (!pool || !userKey) return [];
  const result = await pool.query(`
    SELECT r.id, r.name, r.color, r.system_key, r.permissions, r.created_at
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_key = $1
    ORDER BY CASE WHEN r.system_key = 'admin' THEN 0 ELSE 1 END, r.created_at ASC, r.name ASC
  `, [userKey]);
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    systemKey: row.system_key || null,
    permissions: normalizePermissions(row.permissions || {}),
  }));
}

async function getUserAccess(session) {
  if (!session || !pool) return { isMaster: false, isAdmin: false, roles: [], permissions: { ...EMPTY_PERMISSIONS } };
  const profile = await pool.query(`SELECT is_master FROM profiles WHERE user_key = $1 LIMIT 1`, [session.userKey]);
  const isMaster = Boolean(profile.rows[0]?.is_master);
  const roles = await getUserRoles(session.userKey);
  const isAdmin = roles.some(role => role.systemKey === 'admin');
  if (isMaster || isAdmin) return { isMaster, isAdmin, roles, permissions: { ...ALL_PERMISSIONS } };

  const permissions = { ...EMPTY_PERMISSIONS };
  for (const role of roles) {
    for (const key of Object.keys(permissions)) permissions[key] ||= Boolean(role.permissions?.[key]);
  }
  return { isMaster, isAdmin, roles, permissions };
}

function publicMe(session, access) {
  return {
    name: session.name,
    userKey: session.userKey,
    isMaster: access.isMaster,
    isAdmin: access.isAdmin,
    roles: access.roles.map(publicRole),
    permissions: access.permissions,
    avatarId: session.avatarId || null,
    avatarUrl: session.avatarUrl || null,
  };
}

async function visibleChannelsForSession(session) {
  const all = serializeChannels();
  const access = await getUserAccess(session);
  if (access.isMaster || access.isAdmin) return { channels: all, access };

  const allowed = new Set(all.filter(channel => channel.isLobby).map(channel => channel.id));
  const roleIds = access.roles.map(role => role.id);
  if (roleIds.length) {
    const result = await pool.query(`
      SELECT DISTINCT channel_id FROM channel_role_access
      WHERE role_id = ANY($1::uuid[]) AND can_view = TRUE
    `, [roleIds]);
    for (const row of result.rows) allowed.add(row.channel_id);
  }
  return { channels: all.filter(channel => allowed.has(channel.id)), access };
}

async function canSeeChannel(session, slug) {
  const channel = textChannels.get(slug) || voiceRooms.get(slug);
  if (!channel) return false;
  if (channel.isLobby) return true;
  const access = await getUserAccess(session);
  if (access.isMaster || access.isAdmin) return true;
  const roleIds = access.roles.map(role => role.id);
  if (!roleIds.length) return false;
  const result = await pool.query(`
    SELECT 1 FROM channel_role_access
    WHERE channel_id = $1 AND role_id = ANY($2::uuid[]) AND can_view = TRUE LIMIT 1
  `, [channel.id, roleIds]);
  return result.rowCount > 0;
}

async function canManage(session, permission) {
  const access = await getUserAccess(session);
  return Boolean(access.isMaster || access.isAdmin || access.permissions?.[permission]);
}

async function emitChannelsForSocket(socket) {
  const session = sessions.get(socket.data.sessionId);
  if (!session) return;
  const { channels } = await visibleChannelsForSession(session);
  socket.emit('channels-updated', { channels });
}
async function emitChannels() {
  await Promise.all([...io.sockets.sockets.values()].map(socket => emitChannelsForSocket(socket)));
}

async function buildPublicUsersForViewer(viewerSession) {
  const viewerAccess = await getUserAccess(viewerSession);
  const canManageMembers = viewerAccess.isMaster || viewerAccess.isAdmin || viewerAccess.permissions.manage_members || viewerAccess.permissions.manage_roles;
  const { channels } = await visibleChannelsForSession(viewerSession);
  const visibleVoice = new Set(channels.filter(channel => channel.type === 'voice').map(channel => channel.slug));

  const entries = [...socketsBySession.entries()];
  const onlineUserKeys = new Set(entries.map(([sessionId]) => sessions.get(sessionId)?.userKey).filter(Boolean));

  const profilesResult = await pool.query(`
    SELECT user_key, name, is_master, banned, public_id, avatar_version,
           avatar_data IS NOT NULL AS has_avatar, updated_at
    FROM profiles
    ORDER BY is_master DESC, updated_at DESC, name ASC
  `);
  const allUserKeys = profilesResult.rows.map(row => row.user_key);

  const roleMap = new Map();
  if (allUserKeys.length) {
    const result = await pool.query(`
      SELECT ur.user_key, r.id, r.name, r.color, r.system_key, r.created_at
      FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_key = ANY($1::varchar[])
      ORDER BY CASE WHEN r.system_key = 'admin' THEN 0 ELSE 1 END, r.created_at ASC
    `, [allUserKeys]);
    for (const row of result.rows) {
      if (!roleMap.has(row.user_key)) roleMap.set(row.user_key, []);
      roleMap.get(row.user_key).push({ id: row.id, name: row.name, color: row.color, systemKey: row.system_key || null });
    }
  }

  const profileMap = new Map(profilesResult.rows.map(row => [row.user_key, {
    userKey: row.user_key,
    name: row.name,
    isMaster: Boolean(row.is_master),
    banned: Boolean(row.banned),
    avatarId: row.public_id ? String(row.public_id) : null,
    avatarUrl: avatarUrl(row.public_id, row.avatar_version, row.has_avatar),
  }]));

  const masterKey = await getMasterUserKey();
  const users = [];

  for (const [sessionId, socketId] of entries) {
    const session = sessions.get(sessionId);
    if (!session) continue;
    const state = voiceState.get(sessionId);
    const roles = roleMap.get(session.userKey) || [];
    const isMaster = session.userKey === masterKey;
    const displayRoles = isMaster
      ? [{ id: 'master', name: 'ADM MASTER', color: '#F0B232', systemKey: 'master' }, ...roles]
      : roles;
    const profile = profileMap.get(session.userKey) || {};
    users.push({
      sessionId,
      socketId,
      name: session.name,
      online: true,
      banned: Boolean(profile.banned),
      livekitIdentity: session.livekitIdentity || `conecta-${sessionId.slice(0, 12)}`,
      voiceRoom: state?.room && visibleVoice.has(state.room) ? state.room : null,
      micEnabled: Boolean(state?.micEnabled),
      soundEnabled: state?.soundEnabled !== false,
      roles: displayRoles,
      roleIds: roles.map(role => role.id),
      primaryRole: displayRoles[0] || null,
      isMaster,
      avatarId: profile.avatarId || null,
      avatarUrl: profile.avatarUrl || null,
      ...(canManageMembers ? { userKey: session.userKey } : {}),
    });
  }

  for (const profile of profilesResult.rows) {
    if (onlineUserKeys.has(profile.user_key)) continue;
    const roles = roleMap.get(profile.user_key) || [];
    const isMaster = profile.user_key === masterKey || Boolean(profile.is_master);
    const displayRoles = isMaster
      ? [{ id: 'master', name: 'ADM MASTER', color: '#F0B232', systemKey: 'master' }, ...roles]
      : roles;
    users.push({
      sessionId: null,
      socketId: null,
      name: profile.name,
      online: false,
      banned: Boolean(profile.banned),
      livekitIdentity: null,
      voiceRoom: null,
      micEnabled: false,
      soundEnabled: false,
      roles: displayRoles,
      roleIds: roles.map(role => role.id),
      primaryRole: displayRoles[0] || null,
      isMaster,
      avatarId: profile.public_id ? String(profile.public_id) : null,
      avatarUrl: avatarUrl(profile.public_id, profile.avatar_version, profile.has_avatar),
      ...(canManageMembers ? { userKey: profile.user_key } : {}),
    });
  }

  return users.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.isMaster !== b.isMaster) return a.isMaster ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

async function emitPresence() {
  await Promise.all([...io.sockets.sockets.values()].map(async socket => {
    const viewerSession = sessions.get(socket.data.sessionId);
    if (!viewerSession) return;
    socket.emit('presence', {
      users: await buildPublicUsersForViewer(viewerSession),
      total: onlineSessionsCount(),
      max: MAX_USERS,
    });
  }));
}

async function refreshOnlineSessionAccess(targetUserKey = null) {
  for (const [sessionId, session] of sessions.entries()) {
    if (targetUserKey && session.userKey !== targetUserKey) continue;
    await syncSessionPresentation(session);
    const access = await getUserAccess(session);
    session.isMaster = access.isMaster;
    session.isAdmin = access.isAdmin;
    const socketId = socketsBySession.get(sessionId);
    const socket = socketId ? io.sockets.sockets.get(socketId) : null;
    if (!socket) continue;

    const { channels } = await visibleChannelsForSession(session);
    socket.emit('permissions-updated', { me: publicMe(session, access), channels });

    const visibleText = channels.filter(channel => channel.type === 'text');
    if (!visibleText.some(channel => channel.slug === socket.data.textChannel)) {
      if (socket.data.textChannel) socket.leave(`text:${socket.data.textChannel}`);
      const fallback = visibleText.find(channel => channel.isLobby) || visibleText[0] || null;
      socket.data.textChannel = fallback?.slug || null;
      if (fallback) socket.join(`text:${fallback.slug}`);
    }

    const state = voiceState.get(sessionId);
    if (state && !channels.some(channel => channel.type === 'voice' && channel.slug === state.room)) {
      voiceState.delete(sessionId);
      socket.emit('voice-access-revoked', { room: state.room });
    }
  }
  await emitChannels();
  await emitPresence();
}

async function initDatabase() {
  if (!pool) {
    console.warn('Conecta: DATABASE_URL não configurada.');
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
  await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_lobby BOOLEAN NOT NULL DEFAULT FALSE`);

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
      await pool.query(`
        INSERT INTO channels (id, type, slug, name, subtitle, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (slug) DO NOTHING
      `, [crypto.randomUUID(), type, slug, name, subtitle, sortOrder]);
    }
  }

  await pool.query(`
    INSERT INTO channels (id, type, slug, name, subtitle, sort_order, is_lobby)
    VALUES ($1, 'text', $2, 'Sala de Todos', 'Sala de entrada para todos', 1, TRUE)
    ON CONFLICT (slug) DO UPDATE SET is_lobby = TRUE, name = EXCLUDED.name, subtitle = EXCLUDED.subtitle
  `, [crypto.randomUUID(), TEXT_LOBBY_SLUG]);

  await pool.query(`
    INSERT INTO channels (id, type, slug, name, subtitle, sort_order, is_lobby)
    VALUES ($1, 'voice', $2, 'Sala de Todos', '', 101, TRUE)
    ON CONFLICT (slug) DO UPDATE SET is_lobby = TRUE, name = EXCLUDED.name
  `, [crypto.randomUUID(), VOICE_LOBBY_SLUG]);

  await pool.query(`
    UPDATE channels
    SET is_lobby = FALSE
    WHERE is_lobby = TRUE AND slug NOT IN ($1, $2)
  `, [TEXT_LOBBY_SLUG, VOICE_LOBBY_SLUG]);

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
  await pool.query(`CREATE INDEX IF NOT EXISTS messages_channel_created_idx ON messages (channel, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_key VARCHAR(128) PRIMARY KEY,
      name VARCHAR(32) NOT NULL,
      is_master BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS one_master_only_idx ON profiles (is_master) WHERE is_master = TRUE`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS public_id UUID`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_data BYTEA`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_mime VARCHAR(32)`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_version BIGINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ NULL`);
  const profilesWithoutPublicId = await pool.query(`SELECT user_key FROM profiles WHERE public_id IS NULL`);
  for (const row of profilesWithoutPublicId.rows) {
    await pool.query(`UPDATE profiles SET public_id = $1 WHERE user_key = $2 AND public_id IS NULL`, [crypto.randomUUID(), row.user_key]);
  }
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_id_unique_idx ON profiles (public_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY,
      name VARCHAR(32) NOT NULL,
      color VARCHAR(7) NOT NULL DEFAULT '#5865F2',
      system_key VARCHAR(32) UNIQUE NULL,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_key VARCHAR(128) NOT NULL REFERENCES profiles(user_key) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_key, role_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_role_access (
      channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      can_view BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (channel_id, role_id)
    )
  `);

  await pool.query(`
    INSERT INTO roles (id, name, color, system_key, permissions)
    VALUES ($1, 'ADMIN', '#ED4245', 'admin', $2::jsonb)
    ON CONFLICT (system_key) DO NOTHING
  `, [crypto.randomUUID(), JSON.stringify(ALL_PERMISSIONS)]);

  await refreshChannelsCache();
  databaseReady = true;
  console.log('Conecta: PostgreSQL conectado; canais, cargos e permissões estão prontos.');
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

app.post('/api/login', async (req, res) => {
  try {
    if (!databaseReady || !pool) {
      return res.status(503).json({ error: 'O banco do Conecta ainda está iniciando. Tente novamente em alguns segundos.' });
    }

    let name = cleanName(req.body?.name);
    if (!name || name.length < 2) return res.status(400).json({ error: 'Digite um nome ou apelido com pelo menos 2 caracteres.' });
    if (onlineSessionsCount() >= MAX_USERS) return res.status(429).json({ error: `A sala atingiu o limite de ${MAX_USERS} pessoas.` });

    const userKey = cleanUserKey(req.body?.userKey);
    const existingProfile = await pool.query(`SELECT banned FROM profiles WHERE user_key = $1 LIMIT 1`, [userKey]);
    if (existingProfile.rows[0]?.banned) {
      return res.status(403).json({ error: 'Este usuário foi banido do Conecta.' });
    }

    const masterKey = await getMasterUserKey();
    if (masterKey && masterKey === userKey) name = MASTER_NAME;
    const wantsMasterName = name.localeCompare(MASTER_NAME, 'pt-BR', { sensitivity: 'accent' }) === 0;
    if (masterKey && wantsMasterName && masterKey !== userKey) {
      return res.status(403).json({ error: 'Esse nome pertence ao ADM Master do Conecta.' });
    }

    await pool.query(`
      INSERT INTO profiles (user_key, name, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_key) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    `, [userKey, name]);

    if (!masterKey && wantsMasterName) {
      await pool.query(`UPDATE profiles SET is_master = TRUE, name = $2, updated_at = NOW() WHERE user_key = $1`, [userKey, MASTER_NAME]);
      name = MASTER_NAME;
    }

    await pool.query(`UPDATE profiles SET public_id = $2 WHERE user_key = $1 AND public_id IS NULL`, [userKey, crypto.randomUUID()]);

    const sessionId = crypto.randomUUID();
    const session = {
      name,
      userKey,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      isMaster: false,
      isAdmin: false,
      avatarId: null,
      avatarUrl: null,
      livekitIdentity: `conecta-${sessionId.slice(0, 12)}`,
    };
    await syncSessionPresentation(session);
    const access = await getUserAccess(session);
    session.isMaster = access.isMaster;
    session.isAdmin = access.isAdmin;
    sessions.set(sessionId, session);

    res.json({ sessionId, name, userKey, maxUsers: MAX_USERS, me: publicMe(session, access) });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Não foi possível entrar no Conecta.' });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    const access = await getUserAccess(auth.session);
    res.json({ me: publicMe(auth.session, access) });
  } catch (error) {
    console.error('Erro ao carregar perfil:', error);
    res.status(500).json({ error: 'Não foi possível carregar suas permissões.' });
  }
});


app.get('/api/avatar/:publicId', async (req, res) => {
  try {
    const publicId = String(req.params.publicId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(publicId) || !pool) return res.status(404).end();
    const result = await pool.query(`
      SELECT avatar_data, avatar_mime, avatar_version
      FROM profiles WHERE public_id = $1 LIMIT 1
    `, [publicId]);
    const row = result.rows[0];
    if (!row?.avatar_data || !AVATAR_MIME_TYPES.has(row.avatar_mime)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(row.avatar_mime);
    res.send(row.avatar_data);
  } catch (error) {
    console.error('Erro ao carregar avatar:', error);
    res.status(404).end();
  }
});

app.put('/api/profile/avatar', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    const decoded = decodeAvatarDataUrl(req.body?.imageData);
    if (!decoded) return res.status(400).json({ error: 'Use uma imagem JPG, PNG ou WebP válida de até 2 MB.' });

    const result = await pool.query(`
      UPDATE profiles
      SET avatar_data = $1, avatar_mime = $2, avatar_version = avatar_version + 1, updated_at = NOW()
      WHERE user_key = $3
      RETURNING public_id, avatar_version
    `, [decoded.buffer, decoded.mime, auth.session.userKey]);
    if (!result.rowCount) return res.status(404).json({ error: 'Perfil não encontrado.' });

    const presentation = await publishAvatarChange(auth.session.userKey);
    const access = await getUserAccess(auth.session);
    res.json({ ok: true, avatar: presentation, me: publicMe(auth.session, access) });
  } catch (error) {
    console.error('Erro ao salvar avatar:', error);
    res.status(500).json({ error: 'Não foi possível salvar sua foto de perfil.' });
  }
});

app.delete('/api/profile/avatar', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    await pool.query(`
      UPDATE profiles
      SET avatar_data = NULL, avatar_mime = NULL, avatar_version = avatar_version + 1, updated_at = NOW()
      WHERE user_key = $1
    `, [auth.session.userKey]);
    const presentation = await publishAvatarChange(auth.session.userKey);
    const access = await getUserAccess(auth.session);
    res.json({ ok: true, avatar: presentation, me: publicMe(auth.session, access) });
  } catch (error) {
    console.error('Erro ao remover avatar:', error);
    res.status(500).json({ error: 'Não foi possível remover sua foto de perfil.' });
  }
});

app.get('/api/channels', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    const result = await visibleChannelsForSession(auth.session);
    res.json({ channels: result.channels, me: publicMe(auth.session, result.access) });
  } catch (error) {
    console.error('Erro ao carregar canais:', error);
    res.status(500).json({ error: 'Não foi possível carregar os canais.' });
  }
});

app.post('/api/channels', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!(await canManage(auth.session, 'manage_channels'))) return res.status(403).json({ error: 'Você não tem permissão para criar canais.' });

    const type = String(req.body?.type || '');
    const name = cleanChannelName(req.body?.name);
    if (!['text', 'voice'].includes(type)) return res.status(400).json({ error: 'Tipo de canal inválido.' });
    if (name.length < 2) return res.status(400).json({ error: 'Use um nome com pelo menos 2 caracteres.' });

    const slug = await makeUniqueChannelSlug(name);
    const maxOrder = await pool.query(`SELECT COALESCE(MAX(sort_order), $1)::int AS value FROM channels WHERE type = $2`, [type === 'text' ? 0 : 100, type]);
    const sortOrder = Number(maxOrder.rows[0]?.value || 0) + 10;
    const id = crypto.randomUUID();
    const subtitle = type === 'text' ? `Conversa em #${name}` : '';
    await pool.query(`
      INSERT INTO channels (id, type, slug, name, subtitle, sort_order, is_lobby)
      VALUES ($1, $2, $3, $4, $5, $6, FALSE)
    `, [id, type, slug, name, subtitle, sortOrder]);

    const access = await getUserAccess(auth.session);
    if (!(access.isMaster || access.isAdmin) && access.roles.length) {
      for (const role of access.roles) {
        await pool.query(`
          INSERT INTO channel_role_access (channel_id, role_id, can_view)
          VALUES ($1, $2, TRUE)
          ON CONFLICT (channel_id, role_id) DO UPDATE SET can_view = TRUE
        `, [id, role.id]);
      }
    }

    await refreshChannelsCache();
    await emitChannels();
    const visible = await visibleChannelsForSession(auth.session);
    res.status(201).json({ channels: visible.channels });
  } catch (error) {
    console.error('Erro ao criar canal:', error);
    res.status(500).json({ error: 'Não foi possível criar o canal.' });
  }
});

app.patch('/api/channels/:id', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!(await canManage(auth.session, 'manage_channels'))) return res.status(403).json({ error: 'Você não tem permissão para renomear canais.' });

    const id = String(req.params.id || '').trim();
    const name = cleanChannelName(req.body?.name);
    if (!id || name.length < 2) return res.status(400).json({ error: 'Use um nome com pelo menos 2 caracteres.' });
    const current = await pool.query(`SELECT is_lobby FROM channels WHERE id = $1`, [id]);
    if (!current.rowCount) return res.status(404).json({ error: 'Canal não encontrado.' });
    if (current.rows[0].is_lobby) return res.status(400).json({ error: 'A Sala de Todos é fixa e não pode ser renomeada.' });

    const result = await pool.query(`
      UPDATE channels
      SET name = $1, subtitle = CASE WHEN type = 'text' THEN $2 ELSE subtitle END
      WHERE id = $3 RETURNING id
    `, [name, `Conversa em #${name}`, id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Canal não encontrado.' });

    await refreshChannelsCache();
    await emitChannels();
    const visible = await visibleChannelsForSession(auth.session);
    res.json({ channels: visible.channels });
  } catch (error) {
    console.error('Erro ao renomear canal:', error);
    res.status(500).json({ error: 'Não foi possível renomear o canal.' });
  }
});

app.patch('/api/channels/:id/order', async (req, res) => {
  const client = pool ? await pool.connect().catch(() => null) : null;
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!(await canManage(auth.session, 'manage_channels'))) return res.status(403).json({ error: 'Você não tem permissão para mover canais.' });
    if (!client) return res.status(503).json({ error: 'O banco ainda não está disponível.' });

    const id = String(req.params.id || '').trim();
    const direction = String(req.body?.direction || '').toLowerCase();
    if (!id || !['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Movimento inválido.' });

    await client.query('BEGIN');
    const found = await client.query(`SELECT id, type FROM channels WHERE id = $1 FOR UPDATE`, [id]);
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Canal não encontrado.' });
    }

    const type = found.rows[0].type;
    const ordered = await client.query(`
      SELECT id FROM channels
      WHERE type = $1
      ORDER BY sort_order ASC, created_at ASC
      FOR UPDATE
    `, [type]);
    const ids = ordered.rows.map(row => row.id);
    const index = ids.indexOf(id);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) {
      await client.query('ROLLBACK');
      const visible = await visibleChannelsForSession(auth.session);
      return res.json({ channels: visible.channels, moved: false });
    }

    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    const start = type === 'text' ? 10 : 110;
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(`UPDATE channels SET sort_order = $1 WHERE id = $2`, [start + i * 10, ids[i]]);
    }
    await client.query('COMMIT');

    await refreshChannelsCache();
    await emitChannels();
    const visible = await visibleChannelsForSession(auth.session);
    res.json({ channels: visible.channels, moved: true });
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch {}
    console.error('Erro ao mover canal:', error);
    res.status(500).json({ error: 'Não foi possível mover o canal.' });
  } finally {
    client?.release();
  }
});

app.delete('/api/channels/:id', async (req, res) => {
  const client = pool ? await pool.connect().catch(() => null) : null;
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!(await canManage(auth.session, 'manage_channels'))) return res.status(403).json({ error: 'Você não tem permissão para excluir canais.' });
    if (!client) return res.status(503).json({ error: 'O banco ainda não está disponível.' });

    const id = String(req.params.id || '').trim();
    const found = await client.query(`SELECT id, type, slug, name, is_lobby FROM channels WHERE id = $1`, [id]);
    if (!found.rowCount) return res.status(404).json({ error: 'Canal não encontrado.' });
    const channel = found.rows[0];
    if (channel.is_lobby) return res.status(400).json({ error: 'A Sala de Todos não pode ser excluída.' });

    if (channel.type === 'text') {
      const count = await client.query(`SELECT COUNT(*)::int AS total FROM channels WHERE type = 'text'`);
      if (Number(count.rows[0]?.total || 0) <= 1) return res.status(400).json({ error: 'O Conecta precisa ter pelo menos um canal de texto.' });
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM channels WHERE id = $1`, [id]);
    if (channel.type === 'text') await client.query(`DELETE FROM messages WHERE channel = $1`, [channel.slug]);
    await client.query('COMMIT');
    await refreshChannelsCache();

    if (channel.type === 'text') {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.textChannel !== channel.slug) continue;
        const session = sessions.get(socket.data.sessionId);
        const { channels } = await visibleChannelsForSession(session);
        const fallback = channels.find(item => item.type === 'text' && item.isLobby) || channels.find(item => item.type === 'text') || null;
        socket.leave(`text:${channel.slug}`);
        socket.data.textChannel = fallback?.slug || null;
        if (fallback) socket.join(`text:${fallback.slug}`);
      }
    } else {
      for (const [sessionId, state] of voiceState.entries()) {
        if (state?.room !== channel.slug) continue;
        voiceState.delete(sessionId);
        const socketId = socketsBySession.get(sessionId);
        io.sockets.sockets.get(socketId)?.emit('voice-room-deleted', { room: channel.slug, name: channel.name });
      }
    }

    await emitChannels();
    await emitPresence();
    const visible = await visibleChannelsForSession(auth.session);
    res.json({ channels: visible.channels });
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
    const channel = String(req.params.channel || '');
    if (!textChannels.has(channel) || !(await canSeeChannel(auth.session, channel))) {
      return res.status(403).json({ error: 'Você não tem acesso a este canal.' });
    }

    const result = await pool.query(`
      SELECT recent.id, recent.channel, recent.author_key, recent.author_name, recent.body, recent.created_at, recent.edited_at,
             p.public_id AS avatar_public_id, p.avatar_version,
             (p.avatar_data IS NOT NULL) AS has_avatar
      FROM (
        SELECT id, channel, author_key, author_name, body, created_at, edited_at
        FROM messages WHERE channel = $1
        ORDER BY created_at DESC LIMIT 100
      ) recent
      LEFT JOIN profiles p ON p.user_key = recent.author_key
      ORDER BY recent.created_at ASC
    `, [channel]);
    res.json({ messages: result.rows.map(row => rowToMessage(row, row.author_key === auth.session.userKey)) });
  } catch (error) {
    console.error('Erro ao carregar mensagens:', error);
    res.status(500).json({ error: 'Não foi possível carregar as mensagens.' });
  }
});

app.post('/api/livekit-token', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return res.status(503).json({ error: 'LiveKit ainda não está configurado no servidor.' });

    const room = String(req.body?.room || '').trim().slice(0, 64);
    if (!voiceRooms.has(room) || !(await canSeeChannel(auth.session, room))) return res.status(403).json({ error: 'Você não tem acesso a esta sala de voz.' });

    const access = await getUserAccess(auth.session);
    const voiceChannel = voiceRooms.get(room);
    const lobbyAccess = Boolean(voiceChannel?.isLobby);
    if (!lobbyAccess && !(access.isMaster || access.isAdmin || access.permissions.join_voice)) {
      return res.status(403).json({ error: 'Seu cargo não permite entrar em salas de voz.' });
    }

    const effectivePermissions = lobbyAccess
      ? { ...access.permissions, join_voice: true, speak: true, camera: true, screen_share: true }
      : access.permissions;

    const identity = auth.session.livekitIdentity || `conecta-${auth.token.slice(0, 12)}`;
    auth.session.livekitIdentity = identity;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name: auth.session.name, ttl: '15m' });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: Boolean(effectivePermissions.speak || effectivePermissions.camera || effectivePermissions.screen_share),
      canSubscribe: true,
      canPublishData: true,
    });
    res.json({ token: await token.toJwt(), url: LIVEKIT_URL, identity, permissions: effectivePermissions });
  } catch (error) {
    console.error('Erro ao gerar token LiveKit:', error);
    res.status(500).json({ error: 'Não foi possível preparar a sala de voz.' });
  }
});

app.get('/api/admin/roles', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!(await canManage(auth.session, 'manage_roles'))) return res.status(403).json({ error: 'Sem permissão para gerenciar cargos.' });

    const result = await pool.query(`
      SELECT r.id, r.name, r.color, r.system_key, r.permissions,
             COUNT(ur.user_key)::int AS member_count
      FROM roles r
      LEFT JOIN user_roles ur ON ur.role_id = r.id
      GROUP BY r.id
      ORDER BY CASE WHEN r.system_key = 'admin' THEN 0 ELSE 1 END, r.created_at ASC, r.name ASC
    `);
    res.json({ roles: result.rows.map(row => ({
      id: row.id,
      name: row.name,
      color: row.color,
      systemKey: row.system_key || null,
      protected: row.system_key === 'admin',
      permissions: row.system_key === 'admin' ? { ...ALL_PERMISSIONS } : normalizePermissions(row.permissions || {}),
      memberCount: Number(row.member_count) || 0,
    })) });
  } catch (error) {
    console.error('Erro ao carregar cargos:', error);
    res.status(500).json({ error: 'Não foi possível carregar os cargos.' });
  }
});

app.post('/api/admin/roles', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!(await canManage(auth.session, 'manage_roles'))) return res.status(403).json({ error: 'Sem permissão para criar cargos.' });

    const name = cleanRoleName(req.body?.name);
    const color = cleanColor(req.body?.color);
    const permissions = normalizePermissions(req.body?.permissions || DEFAULT_ROLE_PERMISSIONS);
    if (name.length < 2) return res.status(400).json({ error: 'Use um nome de cargo com pelo menos 2 caracteres.' });

    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO roles (id, name, color, permissions) VALUES ($1, $2, $3, $4::jsonb)`, [id, name, color, JSON.stringify(permissions)]);
    await refreshOnlineSessionAccess();
    res.status(201).json({ ok: true, id });
  } catch (error) {
    console.error('Erro ao criar cargo:', error);
    res.status(500).json({ error: 'Não foi possível criar o cargo.' });
  }
});

app.patch('/api/admin/roles/:id', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!(await canManage(auth.session, 'manage_roles'))) return res.status(403).json({ error: 'Sem permissão para editar cargos.' });

    const id = String(req.params.id || '');
    const existing = await pool.query(`SELECT system_key, name, color, permissions FROM roles WHERE id = $1`, [id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'Cargo não encontrado.' });
    const current = existing.rows[0];
    const name = cleanRoleName(req.body?.name || current.name);
    const color = cleanColor(req.body?.color || current.color);
    const permissions = current.system_key === 'admin' ? { ...ALL_PERMISSIONS } : normalizePermissions(req.body?.permissions || current.permissions || {});
    if (name.length < 2) return res.status(400).json({ error: 'Nome de cargo inválido.' });

    await pool.query(`UPDATE roles SET name = $1, color = $2, permissions = $3::jsonb WHERE id = $4`, [name, color, JSON.stringify(permissions), id]);
    await refreshOnlineSessionAccess();
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao editar cargo:', error);
    res.status(500).json({ error: 'Não foi possível editar o cargo.' });
  }
});

app.delete('/api/admin/roles/:id', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!(await canManage(auth.session, 'manage_roles'))) return res.status(403).json({ error: 'Sem permissão para excluir cargos.' });

    const id = String(req.params.id || '');
    const existing = await pool.query(`SELECT system_key FROM roles WHERE id = $1`, [id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'Cargo não encontrado.' });
    if (existing.rows[0].system_key === 'admin') return res.status(400).json({ error: 'O cargo ADMIN não pode ser excluído.' });

    await pool.query(`DELETE FROM roles WHERE id = $1`, [id]);
    await refreshOnlineSessionAccess();
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir cargo:', error);
    res.status(500).json({ error: 'Não foi possível excluir o cargo.' });
  }
});

app.get('/api/admin/members', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!(await canManage(auth.session, 'manage_members'))) return res.status(403).json({ error: 'Sem permissão para gerenciar membros.' });

    const result = await pool.query(`
      SELECT p.user_key, p.name, p.is_master, p.banned, p.updated_at, p.public_id, p.avatar_version,
             (p.avatar_data IS NOT NULL) AS has_avatar,
             COALESCE(
               json_agg(json_build_object('id', r.id, 'name', r.name, 'color', r.color, 'systemKey', r.system_key)
                 ORDER BY CASE WHEN r.system_key = 'admin' THEN 0 ELSE 1 END, r.created_at ASC)
                 FILTER (WHERE r.id IS NOT NULL),
               '[]'::json
             ) AS roles
      FROM profiles p
      LEFT JOIN user_roles ur ON ur.user_key = p.user_key
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY p.user_key
      ORDER BY p.is_master DESC, p.updated_at DESC, p.name ASC
    `);
    res.json({ members: result.rows.map(row => ({
      userKey: row.user_key,
      name: row.name,
      isMaster: Boolean(row.is_master),
      banned: Boolean(row.banned),
      roles: row.roles || [],
      avatarId: row.public_id ? String(row.public_id) : null,
      avatarUrl: avatarUrl(row.public_id, row.avatar_version, row.has_avatar),
    })) });
  } catch (error) {
    console.error('Erro ao carregar membros:', error);
    res.status(500).json({ error: 'Não foi possível carregar os membros.' });
  }
});

app.put('/api/admin/members/:userKey/roles', async (req, res) => {
  const client = pool ? await pool.connect().catch(() => null) : null;
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!(await canManage(auth.session, 'manage_members'))) return res.status(403).json({ error: 'Sem permissão para alterar cargos.' });
    if (!client) return res.status(503).json({ error: 'Banco indisponível.' });

    const targetUserKey = String(req.params.userKey || '').slice(0, 128);
    const roleIds = Array.isArray(req.body?.roleIds)
      ? [...new Set(req.body.roleIds.map(id => String(id)).filter(id => /^[0-9a-f-]{36}$/i.test(id)))]
      : [];
    const profile = await client.query(`SELECT is_master FROM profiles WHERE user_key = $1`, [targetUserKey]);
    if (!profile.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });

    if (roleIds.length) {
      const valid = await client.query(`SELECT id FROM roles WHERE id = ANY($1::uuid[])`, [roleIds]);
      if (valid.rowCount !== roleIds.length) return res.status(400).json({ error: 'Um dos cargos não existe mais.' });
    }

    const actorAccess = await getUserAccess(auth.session);
    const adminRole = await client.query(`SELECT id FROM roles WHERE system_key = 'admin' LIMIT 1`);
    const adminRoleId = String(adminRole.rows[0]?.id || '');
    const currentAdmin = await client.query(`
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_key = $1 AND r.system_key = 'admin' LIMIT 1
    `, [targetUserKey]);
    const changingAdmin = adminRoleId && (roleIds.includes(adminRoleId) !== (currentAdmin.rowCount > 0));
    if (changingAdmin && !(actorAccess.isMaster || actorAccess.isAdmin || actorAccess.permissions.manage_roles)) {
      return res.status(403).json({ error: 'Somente quem gerencia cargos pode adicionar ou remover ADMIN.' });
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM user_roles WHERE user_key = $1`, [targetUserKey]);
    for (const roleId of roleIds) {
      await client.query(`INSERT INTO user_roles (user_key, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [targetUserKey, roleId]);
    }
    await client.query('COMMIT');

    await refreshOnlineSessionAccess(targetUserKey);
    res.json({ ok: true });
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch {}
    console.error('Erro ao alterar cargos do membro:', error);
    res.status(500).json({ error: 'Não foi possível alterar os cargos.' });
  } finally {
    client?.release();
  }
});



async function requireModerationTarget(req, res, { allowSelf = false } = {}) {
  const auth = getSession(req);
  if (!auth) {
    res.status(401).json({ error: 'Sessão inválida.' });
    return null;
  }
  if (!(await canManage(auth.session, 'manage_members'))) {
    res.status(403).json({ error: 'Sem permissão para gerenciar membros.' });
    return null;
  }
  const targetUserKey = String(req.params.userKey || '').slice(0, 128);
  const result = await pool.query(`SELECT user_key, name, is_master, banned FROM profiles WHERE user_key = $1 LIMIT 1`, [targetUserKey]);
  if (!result.rowCount) {
    res.status(404).json({ error: 'Usuário não encontrado.' });
    return null;
  }
  const target = result.rows[0];
  if (target.is_master) {
    res.status(403).json({ error: 'O ADM Master é protegido e não pode sofrer esta ação.' });
    return null;
  }
  if (!allowSelf && targetUserKey === auth.session.userKey) {
    res.status(400).json({ error: 'Você não pode aplicar esta ação em si mesmo.' });
    return null;
  }
  return { auth, targetUserKey, target };
}

async function disconnectUserSessions(userKey, payload) {
  const targets = [...sessions.entries()].filter(([, session]) => session.userKey === userKey);
  for (const [targetSessionId] of targets) {
    voiceState.delete(targetSessionId);
    const socketId = socketsBySession.get(targetSessionId);
    const targetSocket = socketId ? io.sockets.sockets.get(socketId) : null;
    if (targetSocket) {
      targetSocket.emit('moderation-action', payload);
      setTimeout(() => {
        try { targetSocket.disconnect(true); } catch {}
      }, 180);
    }
    socketsBySession.delete(targetSessionId);
    sessions.delete(targetSessionId);
  }
  await emitPresence();
}

app.patch('/api/admin/members/:userKey/nickname', async (req, res) => {
  try {
    const targetInfo = await requireModerationTarget(req, res, { allowSelf: true });
    if (!targetInfo) return;
    const name = cleanName(req.body?.name);
    if (!name || name.length < 2) return res.status(400).json({ error: 'Use um nick com pelo menos 2 caracteres.' });
    if (name.localeCompare(MASTER_NAME, 'pt-BR', { sensitivity: 'accent' }) === 0) {
      return res.status(400).json({ error: 'Esse nick é reservado ao ADM Master.' });
    }

    await pool.query(`UPDATE profiles SET name = $1, updated_at = NOW() WHERE user_key = $2`, [name, targetInfo.targetUserKey]);
    for (const [targetSessionId, session] of sessions.entries()) {
      if (session.userKey !== targetInfo.targetUserKey) continue;
      session.name = name;
      const socketId = socketsBySession.get(targetSessionId);
      const targetSocket = socketId ? io.sockets.sockets.get(socketId) : null;
      if (targetSocket) {
        targetSocket.data.name = name;
        targetSocket.emit('nickname-changed', { name });
      }
    }
    await emitPresence();
    res.json({ ok: true, name });
  } catch (error) {
    console.error('Erro ao trocar nick:', error);
    res.status(500).json({ error: 'Não foi possível trocar o nick.' });
  }
});

app.post('/api/admin/members/:userKey/disconnect', async (req, res) => {
  try {
    const targetInfo = await requireModerationTarget(req, res);
    if (!targetInfo) return;
    await disconnectUserSessions(targetInfo.targetUserKey, {
      action: 'disconnect',
      message: 'Você foi desconectado por um administrador.'
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao desconectar usuário:', error);
    res.status(500).json({ error: 'Não foi possível desconectar o usuário.' });
  }
});

app.post('/api/admin/members/:userKey/ban', async (req, res) => {
  try {
    const targetInfo = await requireModerationTarget(req, res);
    if (!targetInfo) return;
    await pool.query(`UPDATE profiles SET banned = TRUE, banned_at = NOW(), updated_at = NOW() WHERE user_key = $1`, [targetInfo.targetUserKey]);
    await disconnectUserSessions(targetInfo.targetUserKey, {
      action: 'ban',
      message: 'Você foi banido do Conecta por um administrador.'
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao banir usuário:', error);
    res.status(500).json({ error: 'Não foi possível banir o usuário.' });
  }
});

app.delete('/api/admin/members/:userKey/ban', async (req, res) => {
  try {
    const targetInfo = await requireModerationTarget(req, res, { allowSelf: true });
    if (!targetInfo) return;
    await pool.query(`UPDATE profiles SET banned = FALSE, banned_at = NULL, updated_at = NOW() WHERE user_key = $1`, [targetInfo.targetUserKey]);
    await emitPresence();
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao desbanir usuário:', error);
    res.status(500).json({ error: 'Não foi possível desbanir o usuário.' });
  }
});

app.delete('/api/admin/members/:userKey', async (req, res) => {
  try {
    const targetInfo = await requireModerationTarget(req, res);
    if (!targetInfo) return;
    await disconnectUserSessions(targetInfo.targetUserKey, {
      action: 'delete',
      message: 'Seu usuário foi removido do Conecta por um administrador.'
    });
    await pool.query(`DELETE FROM profiles WHERE user_key = $1`, [targetInfo.targetUserKey]);
    await emitPresence();
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    res.status(500).json({ error: 'Não foi possível excluir o usuário.' });
  }
});

app.delete('/api/admin/members/:userKey/avatar', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!(await canManage(auth.session, 'manage_members'))) return res.status(403).json({ error: 'Sem permissão para remover fotos de perfil.' });

    const targetUserKey = String(req.params.userKey || '').slice(0, 128);
    const result = await pool.query(`
      UPDATE profiles
      SET avatar_data = NULL, avatar_mime = NULL, avatar_version = avatar_version + 1, updated_at = NOW()
      WHERE user_key = $1
      RETURNING user_key
    `, [targetUserKey]);
    if (!result.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
    await publishAvatarChange(targetUserKey);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao remover avatar do membro:', error);
    res.status(500).json({ error: 'Não foi possível remover a foto deste membro.' });
  }
});

app.get('/api/admin/channels', async (req, res) => {
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    const access = await getUserAccess(auth.session);
    if (!(access.isMaster || access.isAdmin || access.permissions.manage_channels || access.permissions.manage_roles)) {
      return res.status(403).json({ error: 'Sem permissão para editar acesso aos canais.' });
    }

    const result = await pool.query(`
      SELECT c.id, c.type, c.slug, c.name, c.is_lobby,
             COALESCE(array_agg(cra.role_id) FILTER (WHERE cra.role_id IS NOT NULL), ARRAY[]::uuid[]) AS role_ids
      FROM channels c
      LEFT JOIN channel_role_access cra ON cra.channel_id = c.id AND cra.can_view = TRUE
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.created_at ASC
    `);
    res.json({ channels: result.rows.map(row => ({
      id: row.id,
      type: row.type,
      slug: row.slug,
      name: row.name,
      isLobby: Boolean(row.is_lobby),
      roleIds: row.role_ids || [],
    })) });
  } catch (error) {
    console.error('Erro ao carregar permissões de canais:', error);
    res.status(500).json({ error: 'Não foi possível carregar as permissões dos canais.' });
  }
});

app.put('/api/admin/channels/:id/access', async (req, res) => {
  const client = pool ? await pool.connect().catch(() => null) : null;
  try {
    const auth = getSession(req);
    if (!auth) return res.status(401).json({ error: 'Sessão inválida.' });
    const access = await getUserAccess(auth.session);
    if (!(access.isMaster || access.isAdmin || access.permissions.manage_channels || access.permissions.manage_roles)) {
      return res.status(403).json({ error: 'Sem permissão para editar acesso aos canais.' });
    }
    if (!client) return res.status(503).json({ error: 'Banco indisponível.' });

    const id = String(req.params.id || '');
    const channel = await client.query(`SELECT is_lobby FROM channels WHERE id = $1`, [id]);
    if (!channel.rowCount) return res.status(404).json({ error: 'Canal não encontrado.' });
    if (channel.rows[0].is_lobby) return res.status(400).json({ error: 'A Sala de Todos é sempre visível para todos.' });

    const roleIds = Array.isArray(req.body?.roleIds)
      ? [...new Set(req.body.roleIds.map(roleId => String(roleId)).filter(roleId => /^[0-9a-f-]{36}$/i.test(roleId)))]
      : [];
    if (roleIds.length) {
      const valid = await client.query(`SELECT id FROM roles WHERE id = ANY($1::uuid[])`, [roleIds]);
      if (valid.rowCount !== roleIds.length) return res.status(400).json({ error: 'Um dos cargos não existe mais.' });
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM channel_role_access WHERE channel_id = $1`, [id]);
    for (const roleId of roleIds) {
      await client.query(`
        INSERT INTO channel_role_access (channel_id, role_id, can_view)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (channel_id, role_id) DO UPDATE SET can_view = TRUE
      `, [id, roleId]);
    }
    await client.query('COMMIT');

    await refreshOnlineSessionAccess();
    res.json({ ok: true });
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch {}
    console.error('Erro ao alterar acesso ao canal:', error);
    res.status(500).json({ error: 'Não foi possível alterar o acesso ao canal.' });
  } finally {
    client?.release();
  }
});

io.use((socket, next) => {
  const sessionId = String(socket.handshake.auth?.sessionId || '');
  const session = sessions.get(sessionId);
  if (!session) return next(new Error('Sessão inválida'));

  const existingSocket = socketsBySession.get(sessionId);
  if (!existingSocket && onlineSessionsCount() >= MAX_USERS) return next(new Error('Sala cheia'));

  socket.data.sessionId = sessionId;
  socket.data.name = session.name;
  socket.data.userKey = session.userKey;
  next();
});

io.on('connection', async socket => {
  const { sessionId, name, userKey } = socket.data;
  const session = sessions.get(sessionId);
  const previous = socketsBySession.get(sessionId);
  if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect(true);
  socketsBySession.set(sessionId, socket.id);

  const visible = await visibleChannelsForSession(session);
  const defaultText = visible.channels.find(channel => channel.type === 'text' && channel.isLobby)
    || visible.channels.find(channel => channel.type === 'text')
    || null;
  socket.data.textChannel = defaultText?.slug || null;
  if (defaultText) socket.join(`text:${defaultText.slug}`);

  await emitChannelsForSocket(socket);
  await emitPresence();

  socket.on('join-text-channel', async channel => {
    const slug = String(channel || '');
    if (!textChannels.has(slug) || !(await canSeeChannel(session, slug))) return;
    if (socket.data.textChannel) socket.leave(`text:${socket.data.textChannel}`);
    socket.data.textChannel = slug;
    socket.join(`text:${slug}`);
  });

  socket.on('chat-message', async (payload = {}) => {
    try {
      const channel = String(payload.channel || '');
      if (channel !== socket.data.textChannel) return;
      if (!textChannels.has(channel) || !(await canSeeChannel(session, channel))) return;

      const channelInfo = textChannels.get(channel);
      const access = await getUserAccess(session);
      if (!channelInfo?.isLobby && !(access.isMaster || access.isAdmin || access.permissions.send_messages)) {
        socket.emit('chat-error', { message: 'Seu cargo não permite enviar mensagens aqui.' });
        return;
      }

      const text = cleanMessage(payload.text);
      if (!text) return;
      const displayName = session.name;
      const id = crypto.randomUUID();
      const createdAt = new Date();
      await pool.query(`
        INSERT INTO messages (id, channel, author_key, author_name, body, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [id, channel, userKey, displayName, text, createdAt]);

      const message = {
        id, channel, name: displayName, text, ts: createdAt.getTime(), editedAt: null,
        avatarId: session.avatarId || null,
        avatarUrl: session.avatarUrl || null,
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
      const id = String(payload.id || '').trim();
      const text = cleanMessage(payload.text);
      if (!id || !text) return;
      const result = await pool.query(`
        UPDATE messages SET body = $1, edited_at = NOW()
        WHERE id = $2 AND author_key = $3
        RETURNING id, channel, body, edited_at
      `, [text, id, userKey]);
      if (!result.rowCount) return socket.emit('chat-error', { message: 'Você só pode editar suas próprias mensagens.' });
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
      const id = String(payload.id || '').trim();
      if (!id) return;
      const result = await pool.query(`DELETE FROM messages WHERE id = $1 AND author_key = $2 RETURNING id, channel`, [id, userKey]);
      if (!result.rowCount) return socket.emit('chat-error', { message: 'Você só pode excluir suas próprias mensagens.' });
      const row = result.rows[0];
      io.to(`text:${row.channel}`).emit('message-deleted', { id: row.id, channel: row.channel });
    } catch (error) {
      console.error('Erro ao excluir mensagem:', error);
      socket.emit('chat-error', { message: 'Não foi possível excluir a mensagem.' });
    }
  });

  socket.on('voice-state', async payload => {
    if (payload === null || payload === '') {
      voiceState.delete(sessionId);
      await emitPresence();
      return;
    }

    const room = typeof payload === 'string' ? payload : String(payload?.room || '').trim();
    if (!voiceRooms.has(room) || !(await canSeeChannel(session, room))) return;
    const access = await getUserAccess(session);
    const voiceChannel = voiceRooms.get(room);
    if (!voiceChannel?.isLobby && !(access.isMaster || access.isAdmin || access.permissions.join_voice)) return;

    voiceState.set(sessionId, {
      room,
      micEnabled: typeof payload === 'string' ? true : Boolean(payload?.micEnabled),
      soundEnabled: typeof payload === 'string' ? true : payload?.soundEnabled !== false,
    });
    await emitPresence();
  });

  socket.on('disconnect', async () => {
    if (socketsBySession.get(sessionId) === socket.id) {
      socketsBySession.delete(sessionId);
      voiceState.delete(sessionId);
      await emitPresence();
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
