import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const socket = io({ reconnection: true, reconnectionAttempts: Infinity });
const $ = (id) => document.getElementById(id);
const EYE_HEIGHT = 1.62;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.32;
const MOVE_SPEED = 7.5;
const SPRINT_SPEED = 10.5;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8bcce8);
scene.fog = new THREE.Fog(0x8bcce8, 28, 78);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 180);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xe6f7ff, 0x64734b, 1.55));
const sun = new THREE.DirectionalLight(0xfff3d8, 2.1);
sun.position.set(-22, 38, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
scene.add(sun);

const controls = new PointerLockControls(camera, document.body);
const overlay = $('overlay');
const nameInput = $('name-input');
let myId = null;
let myName = 'Jugador';
let selectedType = 1;
let initialized = false;
let canJump = false;
let lastNetworkUpdate = 0;
let toastTimer = null;
let chatMode = false;
const keys = Object.create(null);
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const blocks = new Map();
const blockMeshes = new Map();
const instanceKeys = new Map();
const remotePlayers = new Map();
const raycaster = new THREE.Raycaster();
raycaster.far = 7;

const blockMaterials = {
  1: new THREE.MeshLambertMaterial({ color: 0x63b84f }),
  2: new THREE.MeshLambertMaterial({ color: 0x8a5a3c }),
  3: new THREE.MeshLambertMaterial({ color: 0x92999c }),
  4: new THREE.MeshLambertMaterial({ color: 0xa8794b }),
  5: new THREE.MeshLambertMaterial({ color: 0x4f9844 })
};
const blockNames = { 1: 'Césped', 2: 'Tierra', 3: 'Piedra', 4: 'Madera', 5: 'Hojas' };
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

function blockKey(x, y, z) { return `${x},${y},${z}`; }
function showToast(message) {
  $('toast').textContent = message;
  $('toast').style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').style.opacity = '0', 1800);
}
function setStatus(connected, label) {
  $('status-dot').style.background = connected ? '#8ee36d' : '#f6bd4b';
  $('status-text').textContent = label;
}
function selectBlock(type) {
  selectedType = type;
  document.querySelectorAll('.slot').forEach((slot) => slot.classList.toggle('selected', Number(slot.dataset.type) === type));
  showToast(`Bloque seleccionado: ${blockNames[type]}`);
}
document.querySelectorAll('.slot').forEach((slot) => slot.addEventListener('click', () => selectBlock(Number(slot.dataset.type))));

function rebuildBlockMeshes() {
  for (const mesh of blockMeshes.values()) scene.remove(mesh);
  blockMeshes.clear();
  instanceKeys.clear();
  const grouped = new Map();
  for (const [key, type] of blocks) {
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(key);
  }
  for (const [type, keysForType] of grouped) {
    const mesh = new THREE.InstancedMesh(cubeGeometry, blockMaterials[type], keysForType.length);
    mesh.castShadow = type !== 5;
    mesh.receiveShadow = true;
    const lookup = [];
    keysForType.forEach((key, index) => {
      const [x, y, z] = key.split(',').map(Number);
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      lookup[index] = key;
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    blockMeshes.set(type, mesh);
    instanceKeys.set(type, lookup);
  }
}

function addBlock(data, rebuild = true) {
  const key = blockKey(data.x, data.y, data.z);
  if (blocks.has(key)) return;
  blocks.set(key, data.type);
  if (rebuild) rebuildBlockMeshes();
}
function removeBlock(data, rebuild = true) {
  const key = blockKey(data.x, data.y, data.z);
  if (!blocks.has(key)) return;
  blocks.delete(key);
  if (rebuild) rebuildBlockMeshes();
}

function makeNameSprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(8,15,20,.72)';
  ctx.beginPath();
  ctx.roundRect(4, 5, 248, 54, 12);
  ctx.fill();
  ctx.font = 'bold 30px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name.slice(0, 16), 128, 32, 230);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.25, 0.56, 1);
  sprite.position.y = 1.55;
  return sprite;
}
function createPlayerAvatar(player) {
  const group = new THREE.Group();
  const color = new THREE.Color(player.color || 0x65b8ff);
  const material = new THREE.MeshLambertMaterial({ color });
  const darkMaterial = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.72) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.95, 0.38), material);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.58), new THREE.MeshLambertMaterial({ color: 0xe4bd91 }));
  head.position.y = 1.72;
  head.castShadow = true;
  const armGeo = new THREE.BoxGeometry(0.22, 0.78, 0.25);
  const leftArm = new THREE.Mesh(armGeo, darkMaterial);
  leftArm.position.set(-0.48, 0.98, 0);
  const rightArm = new THREE.Mesh(armGeo, darkMaterial);
  rightArm.position.set(0.48, 0.98, 0);
  const legsGeo = new THREE.BoxGeometry(0.28, 0.62, 0.3);
  const leftLeg = new THREE.Mesh(legsGeo, darkMaterial);
  leftLeg.position.set(-0.19, 0.31, 0);
  const rightLeg = new THREE.Mesh(legsGeo, darkMaterial);
  rightLeg.position.set(0.19, 0.31, 0);
  group.add(body, head, leftArm, rightArm, leftLeg, rightLeg, makeNameSprite(player.name || 'Jugador'));
  group.position.set(player.x, player.y - EYE_HEIGHT, player.z);
  group.rotation.y = player.ry || 0;
  scene.add(group);
  return { group, target: new THREE.Vector3(player.x, player.y - EYE_HEIGHT, player.z), targetRotation: player.ry || 0, name: player.name || 'Jugador' };
}
function updatePlayerList(players) {
  const entries = Object.values(players);
  $('player-count').textContent = String(entries.length);
  $('player-list').textContent = entries.map((p) => p.name || 'Jugador').join(', ') || 'Solo en el mundo';
}
function refreshNameSprite(remote, name) {
  const oldSprite = remote.group.children[remote.group.children.length - 1];
  remote.group.remove(oldSprite);
  oldSprite.material.map?.dispose();
  oldSprite.material.dispose();
  remote.group.add(makeNameSprite(name));
  remote.name = name;
}

function collidesAt(x, feetY, z) {
  const minX = Math.floor(x - PLAYER_RADIUS - 0.5);
  const maxX = Math.ceil(x + PLAYER_RADIUS + 0.5);
  const minZ = Math.floor(z - PLAYER_RADIUS - 0.5);
  const maxZ = Math.ceil(z + PLAYER_RADIUS + 0.5);
  const minY = Math.floor(feetY - 0.5);
  const maxY = Math.ceil(feetY + PLAYER_HEIGHT + 0.5);
  for (let bx = minX; bx <= maxX; bx++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let by = minY; by <= maxY; by++) {
        if (!blocks.has(blockKey(bx, by, bz))) continue;
        const horizontal = Math.abs(x - bx) < PLAYER_RADIUS + 0.5 && Math.abs(z - bz) < PLAYER_RADIUS + 0.5;
        const vertical = by + 0.5 > feetY + 0.04 && by - 0.5 < feetY + PLAYER_HEIGHT - 0.04;
        if (horizontal && vertical) return true;
      }
    }
  }
  return false;
}
function findGround(x, z, previousFeet, nextFeet) {
  let landing = null;
  const cx = Math.round(x);
  const cz = Math.round(z);
  for (let bx = cx - 1; bx <= cx + 1; bx++) {
    for (let bz = cz - 1; bz <= cz + 1; bz++) {
      if (Math.abs(x - bx) > PLAYER_RADIUS + 0.5 || Math.abs(z - bz) > PLAYER_RADIUS + 0.5) continue;
      for (let by = -3; by <= 32; by++) {
        if (!blocks.has(blockKey(bx, by, bz))) continue;
        const top = by + 0.5;
        if (previousFeet >= top - 0.03 && nextFeet <= top && (landing === null || top > landing)) landing = top;
      }
    }
  }
  return landing;
}

function getTargetBlock() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const meshes = [...blockMeshes.values()];
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  const hit = hits[0];
  const type = [...blockMeshes.entries()].find(([, mesh]) => mesh === hit.object)?.[0];
  if (type === undefined || hit.instanceId === undefined) return null;
  const key = instanceKeys.get(type)?.[hit.instanceId];
  if (!key) return null;
  return { key, position: key.split(',').map(Number), normal: hit.face.normal.clone(), type };
}

renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('mousedown', (event) => {
  if (!controls.isLocked || !initialized || event.button > 2) return;
  const target = getTargetBlock();
  if (!target) return;
  if (event.button === 0) {
    const [x, y, z] = target.position;
    socket.emit('breakBlock', { x, y, z });
  } else if (event.button === 2) {
    const [x, y, z] = target.position;
    const nx = Math.round(target.normal.x);
    const ny = Math.round(target.normal.y);
    const nz = Math.round(target.normal.z);
    socket.emit('placeBlock', { x: x + nx, y: y + ny, z: z + nz, type: selectedType });
  }
});

$('play-button').addEventListener('click', () => {
  myName = nameInput.value.trim().slice(0, 16) || 'Jugador';
  socket.emit('setName', myName);
  controls.lock();
});
controls.addEventListener('lock', () => { overlay.style.display = 'none'; });
controls.addEventListener('unlock', () => {
  if (initialized && !chatMode) overlay.style.display = 'grid';
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') event.preventDefault();
  keys[event.code] = true;
  if (event.code.startsWith('Digit')) {
    const type = Number(event.code.slice(5));
    if (type >= 1 && type <= 5) selectBlock(type);
  }
  if (event.code === 'Enter' && document.activeElement !== $('chat-input') && controls.isLocked) {
    event.preventDefault();
    chatMode = true;
    controls.unlock();
    overlay.style.display = 'none';
    $('chat-input').focus();
  }
});
window.addEventListener('keyup', (event) => { keys[event.code] = false; });
window.addEventListener('blur', () => Object.keys(keys).forEach((key) => { keys[key] = false; }));

$('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('chat-input');
  const message = input.value.trim();
  if (message) socket.emit('chatMessage', message);
  input.value = '';
  input.blur();
  chatMode = false;
  if (initialized) controls.lock();
});
$('chat-input').addEventListener('focus', () => {
  chatMode = true;
  if (controls.isLocked) controls.unlock();
  overlay.style.display = 'none';
});
function addChatMessage(data) {
  const line = document.createElement('div');
  line.className = 'chat-line';
  const name = document.createElement('strong');
  name.textContent = `${data.name}: `;
  const message = document.createElement('span');
  message.textContent = data.message;
  line.append(name, message);
  $('chat-log').append(line);
  while ($('chat-log').children.length > 6) $('chat-log').firstElementChild.remove();
}

socket.on('connect', () => setStatus(true, 'Conectado'));
socket.on('disconnect', () => setStatus(false, 'Reconectando...'));
socket.on('connect_error', () => setStatus(false, 'Sin conexión'));
socket.on('init', (data) => {
  myId = data.id;
  blocks.clear();
  for (const [key, type] of Object.entries(data.world)) blocks.set(key, type);
  rebuildBlockMeshes();
  for (const [id, player] of Object.entries(data.players)) {
    if (id === myId) {
      camera.position.set(player.x, player.y, player.z);
      myName = player.name || myName;
    } else {
      remotePlayers.set(id, createPlayerAvatar(player));
    }
  }
  updatePlayerList(data.players);
  initialized = true;
  setStatus(true, 'Mundo sincronizado');
});
socket.on('playerJoined', ({ id, player }) => {
  if (id === myId || remotePlayers.has(id)) return;
  remotePlayers.set(id, createPlayerAvatar(player));
  const all = { me: { name: myName } };
  remotePlayers.forEach((p, key) => { all[key] = { name: p.name }; });
  updatePlayerList(all);
  showToast(`${player.name || 'Un jugador'} se unió al mundo`);
});
socket.on('playerUpdated', ({ id, player }) => {
  if (id === myId) { myName = player.name; return; }
  const remote = remotePlayers.get(id);
  if (remote) refreshNameSprite(remote, player.name || 'Jugador');
  const all = { me: { name: myName } };
  remotePlayers.forEach((p, key) => { all[key] = { name: p.name }; });
  updatePlayerList(all);
});
socket.on('playerMoved', ({ id, position }) => {
  const remote = remotePlayers.get(id);
  if (!remote) return;
  remote.target.set(position.x, position.y - EYE_HEIGHT, position.z);
  remote.targetRotation = position.ry;
});
socket.on('playerLeft', (id) => {
  const remote = remotePlayers.get(id);
  if (!remote) return;
  scene.remove(remote.group);
  remote.group.traverse((object) => {
    if (object.material?.map) object.material.map.dispose();
    object.material?.dispose?.();
  });
  remotePlayers.delete(id);
  const all = { me: { name: myName } };
  remotePlayers.forEach((p, key) => { all[key] = { name: p.name }; });
  updatePlayerList(all);
  showToast(`${remote.name} salió del mundo`);
});
socket.on('blockPlaced', (data) => addBlock(data));
socket.on('blockBroken', (data) => removeBlock(data));
socket.on('chatMessage', addChatMessage);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if (controls.isLocked && initialized) {
    const feet = camera.position.y - EYE_HEIGHT;
    const friction = Math.exp(-12 * delta);
    velocity.x *= friction;
    velocity.z *= friction;
    velocity.y -= 25 * delta;

    direction.set(Number(keys.KeyD) - Number(keys.KeyA), 0, Number(keys.KeyS) - Number(keys.KeyW));
    if (direction.lengthSq() > 0) direction.normalize();
    const speed = keys.ShiftLeft || keys.ShiftRight ? SPRINT_SPEED : MOVE_SPEED;
    velocity.x += direction.x * speed * delta * 7;
    velocity.z += direction.z * speed * delta * 7;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    if (horizontalSpeed > speed) { velocity.x *= speed / horizontalSpeed; velocity.z *= speed / horizontalSpeed; }

    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const dx = right.x * velocity.x * delta + forward.x * (-velocity.z) * delta;
    const dz = right.z * velocity.x * delta + forward.z * (-velocity.z) * delta;
    const oldX = camera.position.x;
    const oldZ = camera.position.z;
    if (!collidesAt(oldX + dx, feet, oldZ)) camera.position.x += dx;
    else velocity.x = 0;
    const updatedFeet = camera.position.y - EYE_HEIGHT;
    if (!collidesAt(camera.position.x, updatedFeet, oldZ + dz)) camera.position.z += dz;
    else velocity.z = 0;

    const previousFeet = camera.position.y - EYE_HEIGHT;
    const nextFeet = previousFeet + velocity.y * delta;
    if (velocity.y <= 0) {
      const ground = findGround(camera.position.x, camera.position.z, previousFeet, nextFeet);
      if (ground !== null) {
        camera.position.y = ground + EYE_HEIGHT;
        velocity.y = 0;
        canJump = true;
      } else {
        camera.position.y += velocity.y * delta;
        canJump = false;
      }
    } else {
      if (collidesAt(camera.position.x, nextFeet, camera.position.z)) velocity.y = 0;
      else camera.position.y += velocity.y * delta;
      canJump = false;
    }

    if (keys.Space && canJump) { velocity.y = 9.2; canJump = false; keys.Space = false; }
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -23, 23);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -23, 23);

    if (now - lastNetworkUpdate > 50) {
      socket.volatile.emit('move', { x: camera.position.x, y: camera.position.y, z: camera.position.z, ry: camera.rotation.y });
      lastNetworkUpdate = now;
    }

    const target = getTargetBlock();
    $('target-hint').style.opacity = target ? '1' : '0';
  }

  for (const remote of remotePlayers.values()) {
    remote.group.position.lerp(remote.target, 1 - Math.exp(-12 * delta));
    remote.group.rotation.y = THREE.MathUtils.lerp(remote.group.rotation.y, remote.targetRotation, 1 - Math.exp(-12 * delta));
  }
  renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
});
animate();
