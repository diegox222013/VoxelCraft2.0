'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5
});

const PORT = Number(process.env.PORT) || 3000;
const WORLD_RADIUS = 16;
const WORLD_LIMIT = 24;
const MAX_BLOCKS = 18000;
const BLOCK_TYPES = new Set([1, 2, 3, 4, 5]);
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.32;
const world = Object.create(null);
const players = Object.create(null);

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));
app.get('/health', (_req, res) => res.json({ ok: true, players: Object.keys(players).length }));

const keyOf = (x, y, z) => `${x},${y},${z}`;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function addTree(x, z) {
  for (let y = 1; y <= 3; y++) world[keyOf(x, y, z)] = 4;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = 2; dy <= 4; dy++) {
        if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy - 3) <= 4) {
          const key = keyOf(x + dx, dy, z + dz);
          if (!world[key]) world[key] = 5;
        }
      }
    }
  }
}

function generateWorld() {
  for (let x = -WORLD_RADIUS; x < WORLD_RADIUS; x++) {
    for (let z = -WORLD_RADIUS; z < WORLD_RADIUS; z++) {
      world[keyOf(x, 0, z)] = 1;
      world[keyOf(x, -1, z)] = 2;
      world[keyOf(x, -2, z)] = 3;
    }
  }
  [[-10, -9], [10, -10], [-11, 9], [10, 10], [0, -13], [-14, 1], [14, -2]]
    .forEach(([x, z]) => addTree(x, z));
}
generateWorld();

function randomSpawn() {
  return {
    x: Math.random() * 4 - 2,
    y: 2.12,
    z: Math.random() * 4 - 2,
    ry: 0,
    color: Math.floor(Math.random() * 0xffffff),
    name: 'Jugador'
  };
}

function validBlockPosition(x, y, z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
    && Math.abs(x) <= WORLD_LIMIT && Math.abs(z) <= WORLD_LIMIT
    && y >= -3 && y <= 32;
}

function distanceFromPlayer(player, x, y, z) {
  const dx = player.x - x;
  const dy = player.y - y;
  const dz = player.z - z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function blockIntersectsPlayer(player, x, y, z) {
  const feet = player.y - 1.62;
  const horizontal = Math.abs(player.x - x) < PLAYER_RADIUS + 0.5
    && Math.abs(player.z - z) < PLAYER_RADIUS + 0.5;
  const vertical = y + 0.5 > feet + 0.05 && y - 0.5 < feet + PLAYER_HEIGHT - 0.05;
  return horizontal && vertical;
}

io.on('connection', (socket) => {
  const player = randomSpawn();
  players[socket.id] = player;
  console.log(`+ ${socket.id} (${Object.keys(players).length} en línea)`);

  socket.emit('init', { id: socket.id, world, players });
  socket.broadcast.emit('playerJoined', { id: socket.id, player });

  socket.on('setName', (rawName) => {
    if (typeof rawName !== 'string' || !players[socket.id]) return;
    const name = rawName.trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 16);
    if (!name) return;
    players[socket.id].name = name;
    io.emit('playerUpdated', { id: socket.id, player: players[socket.id] });
  });

  socket.on('move', (data) => {
    const current = players[socket.id];
    if (!current || !data || ![data.x, data.y, data.z, data.ry].every(isFiniteNumber)) return;
    const dx = data.x - current.x;
    const dy = data.y - current.y;
    const dz = data.z - current.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 1.8
      || Math.abs(data.x) > WORLD_LIMIT || Math.abs(data.z) > WORLD_LIMIT
      || data.y < 1.5 || data.y > 40) return;
    current.x = data.x;
    current.y = data.y;
    current.z = data.z;
    current.ry = data.ry;
    socket.broadcast.volatile.emit('playerMoved', { id: socket.id, position: current });
  });

  socket.on('placeBlock', (data) => {
    const current = players[socket.id];
    if (!current || !data || !validBlockPosition(data.x, data.y, data.z) || !BLOCK_TYPES.has(data.type)) return;
    const key = keyOf(data.x, data.y, data.z);
    if (world[key] !== undefined || Object.keys(world).length >= MAX_BLOCKS) return;
    if (distanceFromPlayer(current, data.x, data.y, data.z) > 7) return;
    if (Object.values(players).some((p) => blockIntersectsPlayer(p, data.x, data.y, data.z))) return;
    world[key] = data.type;
    io.emit('blockPlaced', { x: data.x, y: data.y, z: data.z, type: data.type });
  });

  socket.on('breakBlock', (data) => {
    const current = players[socket.id];
    if (!current || !data || !validBlockPosition(data.x, data.y, data.z)) return;
    const key = keyOf(data.x, data.y, data.z);
    if (world[key] === undefined || distanceFromPlayer(current, data.x, data.y, data.z) > 7) return;
    delete world[key];
    io.emit('blockBroken', { x: data.x, y: data.y, z: data.z });
  });

  socket.on('chatMessage', (rawMessage) => {
    const current = players[socket.id];
    if (!current || typeof rawMessage !== 'string') return;
    const now = Date.now();
    if (now - (current.lastChatAt || 0) < 650) return;
    const message = rawMessage.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 120);
    if (!message) return;
    current.lastChatAt = now;
    io.emit('chatMessage', { id: socket.id, name: current.name, message, time: now });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
    console.log(`- ${socket.id} (${Object.keys(players).length} en línea)`);
  });
});

server.listen(PORT, () => {
  console.log(`VoxelCraft listo en http://localhost:${PORT}`);
});
