// game.js — Halloween 2025: Mansion Escape (Among Us-style camera and lighter lighting)

// ============================
// Canvas and context
// ============================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Viewport (set in index.html)
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// ============================
// Camera and lighting tuning
// ============================
// Zoom in so you see a smaller portion of the map (Among Us vibe)
const CAMERA_ZOOM = 1.6;          // 1.0 = no zoom; 1.6 shows a smaller area (more zoomed-in)
const CAMERA_LERP = 0.2;          // camera smoothing (0 = instant, 1 = no movement)

// Softer lighting: not pitch-black
const FOG_ENABLED = true;         // set to false to disable vignette
const AMBIENT_DARKNESS = 0.35;    // how dark the edges are (0.0–0.8 is reasonable)
const LIGHT_RADIUS = 260;         // soft visibility radius in pixels (pre-zoom)
const CONE_ENABLED = false;       // optional directional cone; off for clearer view

// ============================
// Game/world config
// ============================
let MAP_WIDTH = 1920;     // Updated to map image size on load
let MAP_HEIGHT = 1080;
let currentMapName = "mansion"; // expects maps/mansion.jpeg + maps/mansion.json

// Tuning
const DETECTION_RADIUS = 150;
const SPRINT_SPEED = 5;
const WALK_SPEED = 2.5;
const GHOST_SPEED = 1.5;
const GHOST_CHASE_BONUS = 0.8;
const POWERUP_SIZE = 24;
const PLAYER_SIZE = 32;

// State flags
let gameStarted = false;
let paused = false;
let debug = false;
let multiplayer = false;

// Map image and colliders
const mapImage = new Image();
let mapImageLoaded = false;

let walls = [];      // colliding rectangles
let obstacles = [];  // optional extra colliders (furniture)
let doorways = [];   // non-colliding zones (not used for collision)

// ============================
// Sounds
// ============================
const footstepSound = new Audio("sounds/footsteps.mp3");
const ghostChaseSound = new Audio("sounds/ghost_chase.mp3");
const caughtSound = new Audio("sounds/caught.mp3");
const powerupSound = new Audio("sounds/powerup.mp3");

footstepSound.volume = 0.35;
ghostChaseSound.volume = 0.7;
caughtSound.volume = 0.8;
powerupSound.volume = 0.7;

const soundCooldowns = new Map();
function playSound(snd, key = null, cooldownMs = 120) {
  const now = performance.now();
  const k = key || snd;
  const last = soundCooldowns.get(k) || 0;
  if (now - last < cooldownMs) return;
  try { snd.currentTime = 0; snd.play(); } catch (_) {}
  soundCooldowns.set(k, now);
}

// Unlock audio on first interaction
function unlockAudio() {
  [footstepSound, ghostChaseSound, caughtSound, powerupSound].forEach(a => {
    try { a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {}); } catch(e){}
  });
  document.removeEventListener("pointerdown", unlockAudio);
  document.removeEventListener("keydown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("keydown", unlockAudio);

// ============================
// Sprites
// ============================
const survivorImg = new Image();
survivorImg.src = "images/survivor.png";

const ghostImg = new Image();
ghostImg.src = "images/ghost.png";

const powerupImg = new Image();
powerupImg.src = "images/powerup.png";

// ============================
// Input handling
// ============================
const input = {};
document.addEventListener("keydown", (e) => {
  input[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "p") paused = !paused;
  if (e.key.toLowerCase() === "tab") { e.preventDefault(); debug = !debug; }
});
document.addEventListener("keyup", (e) => {
  input[e.key.toLowerCase()] = false;
});

// ============================
// Utility helpers
// ============================
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function aabbRectHit(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function aabbEntityHit(A, B) {
  return aabbRectHit(A.x, A.y, A.size, A.size, B.x, B.y, B.size, B.size);
}

// Move only one axis at a time to reduce corner snagging
function moveAxis(x, y, size, dx, dy) {
  let nx = x + dx;
  let ny = y + dy;

  for (const w of walls) {
    if (aabbRectHit(nx, ny, size, size, w.x, w.y, w.w, w.h)) {
      if (dx > 0) nx = w.x - size;
      if (dx < 0) nx = w.x + w.w;
      if (dy > 0) ny = w.y - size;
      if (dy < 0) ny = w.y + w.h;
      return dx !== 0 ? x : y;
    }
  }
  for (const o of obstacles) {
    if (aabbRectHit(nx, ny, size, size, o.x, o.y, o.w, o.h)) {
      if (dx > 0) nx = o.x - size;
      if (dx < 0) nx = o.x + o.w;
      if (dy > 0) ny = o.y - size;
      if (dy < 0) ny = o.y + o.h;
      return dx !== 0 ? x : y;
    }
  }
  return dx !== 0 ? nx : ny;
}

// ============================
// Entities
// ============================
class Player {
  constructor(id, x, y, color = "lime") {
    this.id = id;
    this.x = x;
    this.y = y;
    this.size = PLAYER_SIZE;
    this.speed = WALK_SPEED;
    this.lives = 3;
    this.sprinting = false;
    this.color = color;
    this.name = id === "me" ? "You" : id;
  }

  update() {
    this.sprinting = !!input["shift"];
    this.speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    let dx = 0, dy = 0;
    if (input["w"] || input["arrowup"]) dy -= this.speed;
    if (input["s"] || input["arrowdown"]) dy += this.speed;
    if (input["a"] || input["arrowleft"]) dx -= this.speed;
    if (input["d"] || input["arrowright"]) dx += this.speed;

    if (dx !== 0 && dy !== 0) { const inv = 1 / Math.sqrt(2); dx *= inv; dy *= inv; }

    this.x = moveAxis(this.x, this.y, this.size, dx, 0);
    this.y = moveAxis(this.x, this.y, this.size, 0, dy);

    this.x = clamp(this.x, 0, MAP_WIDTH - this.size);
    this.y = clamp(this.y, 0, MAP_HEIGHT - this.size);

    if (dx !== 0 || dy !== 0) {
      playSound(footstepSound, "footsteps", 200);
      if (multiplayer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "move", x: this.x, y: this.y, sprinting: this.sprinting }));
      }
    }
  }

  draw(cameraX, cameraY) {
    // Prefer sprite; fallback square
    if (survivorImg.complete && survivorImg.naturalHeight > 0) {
      ctx.drawImage(survivorImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
    } else {
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.size, this.size);
    }
    // Name tag
    ctx.fillStyle = "white";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(this.name, this.x - cameraX + this.size / 2, this.y - cameraY - 4);
    ctx.textAlign = "start";
  }
}

class Ghost {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = 32;
    this.speed = GHOST_SPEED;
    this.state = "wander"; // "wander" | "chase"
    this.target = null;
    this.dx = Math.random() * 2 - 1;
    this.dy = Math.random() * 2 - 1;
    this.changeDirTimer = 0;
    this.chasing = false;
  }

  update(player) {
    const dist = Math.hypot(player.x - this.x, player.y - this.y);

    if (dist < DETECTION_RADIUS && player.sprinting) {
      if (!this.chasing) { playSound(ghostChaseSound, "ghostChase", 500); this.chasing = true; }
      this.state = "chase";
      this.target = player;
    } else if (this.state === "chase" && dist > DETECTION_RADIUS * 2) {
      this.state = "wander";
      this.chasing = false;
      this.target = null;
    }

    if (this.state === "chase" && this.target) {
      const angle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
      const spd = this.speed + GHOST_CHASE_BONUS;
      this.x = moveAxis(this.x, this.y, this.size, Math.cos(angle) * spd, 0);
      this.y = moveAxis(this.x, this.y, this.size, 0, Math.sin(angle) * spd);
    } else {
      if (this.changeDirTimer <= 0) {
        this.dx = Math.random() * 2 - 1; this.dy = Math.random() * 2 - 1;
        const len = Math.hypot(this.dx, this.dy) || 1; this.dx /= len; this.dy /= len;
        this.changeDirTimer = 120; // ~2 seconds
      } else {
        this.changeDirTimer--;
      }
      this.x = moveAxis(this.x, this.y, this.size, this.dx * this.speed, 0);
      this.y = moveAxis(this.x, this.y, this.size, 0, this.dy * this.speed);
    }

    this.x = clamp(this.x, 0, MAP_WIDTH - this.size);
    this.y = clamp(this.y, 0, MAP_HEIGHT - this.size);
  }

  draw(cameraX, cameraY) {
    if (ghostImg.complete && ghostImg.naturalHeight > 0) {
      ctx.drawImage(ghostImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
    } else {
      ctx.fillStyle = "rgba(160,160,255,0.7)";
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.size, this.size);
    }
  }
}

class PowerUp {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.size = POWERUP_SIZE;
    this.type = type; // "shield" | "speed"
    this.active = true;
  }
  apply(player) {
    if (this.type === "shield") player.lives += 1;
    else if (this.type === "speed") startSpeedBuff(6000, 1.2);
  }
  draw(cameraX, cameraY) {
    if (!this.active) return;
    if (powerupImg.complete && powerupImg.naturalHeight > 0) {
      ctx.drawImage(powerupImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
    } else {
      ctx.fillStyle = "gold";
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.size, this.size);
    }
  }
}

class Wall {
  constructor(x, y, width, height) { this.x = x; this.y = y; this.w = width; this.h = height; }
  draw(cameraX, cameraY) {
    if (!debug) return;
    ctx.fillStyle = "rgba(200,60,200,0.35)";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
    ctx.strokeStyle = "purple";
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

class Obstacle {
  constructor(x, y, width, height) { this.x = x; this.y = y; this.w = width; this.h = height; }
  draw(cameraX, cameraY) {
    if (!debug) return;
    ctx.fillStyle = "rgba(120,120,120,0.35)";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
    ctx.strokeStyle = "#aaa";
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

class Doorway {
  constructor(x, y, width, height) { this.x = x; this.y = y; this.w = width; this.h = height; }
  draw(cameraX, cameraY) {
    if (!debug) return;
    ctx.strokeStyle = "lime";
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

// ============================
// Game instances and systems
// ============================
const player = new Player("me", 300, 300);
const ghosts = [ new Ghost(800, 600), new Ghost(1200, 700) ];
const powerups = [ new PowerUp(500, 500, "shield"), new PowerUp(1400, 900, "speed") ];

// Multiplayer: remote players
let socket = null;
const otherPlayers = {}; // id -> Player

// Speed buff system
let speedBuffTime = 0;
let speedBuffMultiplier = 1;
function startSpeedBuff(durationMs, multiplier) { speedBuffTime = durationMs; speedBuffMultiplier = multiplier; }
function getWalkSpeed() { return WALK_SPEED * (speedBuffTime > 0 ? speedBuffMultiplier : 1); }
function getSprintSpeed() { return SPRINT_SPEED * (speedBuffTime > 0 ? speedBuffMultiplier : 1); }

// Patch Player.update to use buffed speeds without rewriting logic everywhere
(function patchPlayerForSpeedBuff(){
  const origUpdate = Player.prototype.update;
  Player.prototype.update = function() {
    const prevSprint = this.sprinting;
    const prevSpeed = this.speed;

    this.sprinting = !!input["shift"];
    this.speed = this.sprinting ? getSprintSpeed() : getWalkSpeed();

    let dx = 0, dy = 0;
    if (input["w"] || input["arrowup"]) dy -= this.speed;
    if (input["s"] || input["arrowdown"]) dy += this.speed;
    if (input["a"] || input["arrowleft"]) dx -= this.speed;
    if (input["d"] || input["arrowright"]) dx += this.speed;

    if (dx !== 0 && dy !== 0) { const inv = 1 / Math.sqrt(2); dx *= inv; dy *= inv; }

    this.x = moveAxis(this.x, this.y, this.size, dx, 0);
    this.y = moveAxis(this.x, this.y, this.size, 0, dy);

    this.x = clamp(this.x, 0, MAP_WIDTH - this.size);
    this.y = clamp(this.y, 0, MAP_HEIGHT - this.size);

    if (dx !== 0 || dy !== 0) {
      playSound(footstepSound, "footsteps", 200);
      if (multiplayer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "move", x: this.x, y: this.y, sprinting: this.sprinting }));
      }
    }

    this.sprinting = prevSprint;
    this.speed = prevSpeed;
  };
})();

// ============================
// Camera (with smoothing) + Fog/Vignette
// ============================
let camX = 0;
let camY = 0;

function getTargetCamera() {
  // Use virtual view size (pre-zoom) to compute camera bounds
  const viewW = VIEW_W / CAMERA_ZOOM;
  const viewH = VIEW_H / CAMERA_ZOOM;

  let targetX = player.x - viewW / 2;
  let targetY = player.y - viewH / 2;

  targetX = clamp(targetX, 0, Math.max(0, MAP_WIDTH - viewW));
  targetY = clamp(targetY, 0, Math.max(0, MAP_HEIGHT - viewH));
  return { targetX, targetY, viewW, viewH };
}

function updateCamera() {
  const { targetX, targetY } = getTargetCamera();
  camX += (targetX - camX) * CAMERA_LERP;
  camY += (targetY - camY) * CAMERA_LERP;
}

function drawVignette() {
  if (!FOG_ENABLED) return;

  // Player screen position (post-zoom)
  const px = (player.x - camX + player.size / 2) * CAMERA_ZOOM;
  const py = (player.y - camY + player.size / 2) * CAMERA_ZOOM;

  ctx.save();
  // Soft vignette: darkens edges, leaves center lighter
  const grd = ctx.createRadialGradient(px, py, 10, px, py, LIGHT_RADIUS * CAMERA_ZOOM);
  grd.addColorStop(0, "rgba(0,0,0,0.0)");
  grd.addColorStop(1, `rgba(0,0,0,${AMBIENT_DARKNESS})`);

  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (CONE_ENABLED) {
    // Optional directional cone (kept subtle)
    const dirX = (input["d"]?1:0) - (input["a"]?1:0);
    const dirY = (input["s"]?1:0) - (input["w"]?1:0);
    const angle = Math.atan2(dirY, dirX);
    const facing = Number.isFinite(angle) ? angle : 0;

    ctx.translate(px, py);
    ctx.rotate(facing);
    const cone = ctx.createLinearGradient(0, 0, 320 * CAMERA_ZOOM, 0);
    cone.addColorStop(0, "rgba(0,0,0,0.0)");
    cone.addColorStop(1, `rgba(0,0,0,${AMBIENT_DARKNESS})`);
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(320 * CAMERA_ZOOM, -120 * CAMERA_ZOOM);
    ctx.lineTo(320 * CAMERA_ZOOM, 120 * CAMERA_ZOOM);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ============================
// Update & draw
// ============================
let lastTime = performance.now();
function update(dt) {
  if (speedBuffTime > 0) speedBuffTime -= dt;

  player.update();
  for (const g of ghosts) g.update(player);

  for (const g of ghosts) {
    if (aabbEntityHit(g, player)) {
      playSound(caughtSound, "caught", 400);
      player.lives = Math.max(0, player.lives - 1);
      respawnPlayer();
      break;
    }
  }

  for (const pu of powerups) {
    if (pu.active && aabbRectHit(player.x, player.y, player.size, pu.x, pu.y, pu.size, pu.size)) {
      pu.active = false;
      playSound(powerupSound, "powerup", 300);
      pu.apply(player);
      if (multiplayer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "powerupTaken", x: pu.x, y: pu.y }));
      }
    }
  }

  updateCamera();
}

function draw() {
  // WORLD SPACE (scaled)
  ctx.save();
  ctx.scale(CAMERA_ZOOM, CAMERA_ZOOM);

  const viewW = VIEW_W / CAMERA_ZOOM;
  const viewH = VIEW_H / CAMERA_ZOOM;

  ctx.clearRect(0, 0, viewW, viewH);

  // Map background
  if (mapImageLoaded) {
    ctx.drawImage(mapImage, -camX, -camY, MAP_WIDTH, MAP_HEIGHT);
  } else {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = "#333";
    ctx.fillRect(16 - camX, 16 - camY, viewW - 32, viewH - 32);
  }

  // Debug colliders
  for (const w of walls) w.draw(camX, camY);
  for (const o of obstacles) o.draw(camX, camY);
  for (const d of doorways) d.draw(camX, camY);

  // Powerups
  for (const pu of powerups) pu.draw(camX, camY);

  // Ghosts
  for (const g of ghosts) g.draw(camX, camY);

  // Other players
  Object.values(otherPlayers).forEach(op => op.draw(camX, camY));

  // Local player
  player.draw(camX, camY);

  ctx.restore();

  // SCREEN SPACE (post-scale) — Vignette/HUD
  drawVignette();
  drawHUD();
}

function drawHUD() {
  ctx.fillStyle = "white";
  ctx.font = "18px Arial";
  ctx.textBaseline = "top";
  ctx.fillText(`Lives: ${player.lives}`, 20, 20);

  if (multiplayer) ctx.fillText(`Online: ${1 + Object.keys(otherPlayers).length}`, 20, 44);

  if (paused) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "orange";
    ctx.font = "28px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Paused (P)", VIEW_W / 2, VIEW_H / 2);
    ctx.textAlign = "start";
    ctx.textBaseline = "top";
  }

  if (debug) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px monospace";
    ctx.fillText(`DEBUG | Map: ${currentMapName} ${MAP_WIDTH}x${MAP_HEIGHT}`, 20, 68);
    ctx.fillText(`Player: (${Math.round(player.x)}, ${Math.round(player.y)})`, 20, 86);
    ctx.fillText(`Walls: ${walls.length} Obst: ${obstacles.length}`, 20, 104);
    ctx.fillText(`Zoom: ${CAMERA_ZOOM.toFixed(2)}`, 20, 122);
  }
}

// ============================
// Game loop
// ============================
function loop() {
  const now = performance.now();
  const dt = now - lastTime;
  lastTime = now;

  if (gameStarted && !paused) {
    update(dt);
    draw();
  } else if (gameStarted && paused) {
    draw();
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ============================
// Map loading
// ============================
async function loadMap(mapName) {
  currentMapName = mapName;
  mapImageLoaded = false;

  // Load image
  await new Promise((resolve) => {
    mapImage.onload = () => {
      // Ensure image is bigger than view to see scrolling
      MAP_WIDTH = mapImage.width || Math.max(MAP_WIDTH, VIEW_W * 1.5);
      MAP_HEIGHT = mapImage.height || Math.max(MAP_HEIGHT, VIEW_H * 1.5);
      mapImageLoaded = true;
      resolve();
    };
    mapImage.onerror = () => resolve();
    mapImage.src = `maps/${mapName}.jpeg`;
  });

  // Load JSON
  try {
    const res = await fetch(`maps/${mapName}.json`, { cache: "no-store" });
    const data = await res.json();
    walls = (data.walls || []).map(w => new Wall(w.x, w.y, w.width, w.height));
    obstacles = (data.obstacles || []).map(o => new Obstacle(o.x, o.y, o.width, o.height));
    doorways = (data.doorways || []).map(d => new Doorway(d.x, d.y, d.width, d.height));
  } catch (_) {
    walls = []; obstacles = []; doorways = [];
  }

  placePlayerAtSafeSpawn();

  // Snap camera to player immediately on load
  const { targetX, targetY } = getTargetCamera();
  camX = targetX;
  camY = targetY;
}

// ============================
// Spawning
// ============================
function hitsCollision(x, y, size) {
  for (const w of walls) if (aabbRectHit(x, y, size, w.x, w.y, w.w, w.h)) return true;
  for (const o of obstacles) if (aabbRectHit(x, y, size, o.x, o.y, o.w, o.h)) return true;
  return false;
}

function placePlayerAtSafeSpawn() {
  const candidates = [
    { x: 64, y: 64 },
    { x: MAP_WIDTH - 160, y: 64 },
    { x: 64, y: MAP_HEIGHT - 160 },
    { x: MAP_WIDTH - 160, y: MAP_HEIGHT - 160 },
    { x: MAP_WIDTH / 2 - PLAYER_SIZE / 2, y: MAP_HEIGHT / 2 - PLAYER_SIZE / 2 },
    { x: 200, y: 200 },
    { x: 300, y: 300 }
  ];
  for (const c of candidates) {
    if (!hitsCollision(c.x, c.y, PLAYER_SIZE)) {
      player.x = clamp(c.x, 0, MAP_WIDTH - PLAYER_SIZE);
      player.y = clamp(c.y, 0, MAP_HEIGHT - PLAYER_SIZE);
      return;
    }
  }
  player.x = 300; player.y = 300;
}

function respawnPlayer() {
  placePlayerAtSafeSpawn();
  if (multiplayer && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "move", x: player.x, y: player.y, sprinting: false }));
  }
}

// ============================
// Home screen bindings
// ============================
function startGame(mode) {
  const home = document.getElementById("homeScreen");
  if (home) home.style.display = "none";
  canvas.style.display = "block";

  gameStarted = true;
  multiplayer = (mode === "multiplayer");

  if (multiplayer) {
    initMultiplayer().then(() => loadMap(currentMapName));
  } else {
    loadMap(currentMapName);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const singleBtn = document.getElementById("singleplayerBtn");
  const multiBtn = document.getElementById("multiplayerBtn");
  if (singleBtn) singleBtn.addEventListener("click", () => startGame("singleplayer"));
  if (multiBtn) multiBtn.addEventListener("click", () => startGame("multiplayer"));
});

// ============================
// Multiplayer client (simple WebSocket protocol)
// ============================
let reconnectTimer = null;

async function initMultiplayer() {
  await connectSocket();
  setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping", t: Date.now() }));
    }
  }, 5000);
}

function connectSocket() {
  return new Promise((resolve) => {
    try {
      socket = new WebSocket("ws://localhost:8080"); // Replace with your server URL

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "hello", name: `Player-${Math.floor(Math.random()*1000)}` }));
        resolve();
      });

      socket.addEventListener("message", (ev) => {
        try { handleServerMessage(JSON.parse(ev.data)); } catch (_) {}
      });

      socket.addEventListener("close", () => {
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectSocket();
          }, 3000);
        }
      });
    } catch (_) {
      resolve();
    }
  });
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "welcome":
      if (msg.map && msg.map !== currentMapName) currentMapName = msg.map;
      otherPlayersClear();
      if (Array.isArray(msg.players)) {
        msg.players.forEach(p => {
          if (p.id !== "me") {
            otherPlayers[p.id] = new Player(p.id, p.x || 300, p.y || 300, "cyan");
            otherPlayers[p.id].name = p.name || p.id;
          }
        });
      }
      break;

    case "playerJoined":
      if (!otherPlayers[msg.id]) {
        otherPlayers[msg.id] = new Player(msg.id, msg.x || 300, msg.y || 300, "cyan");
        otherPlayers[msg.id].name = msg.name || msg.id;
      }
      break;

    case "playerMoved":
      if (otherPlayers[msg.id]) {
        otherPlayers[msg.id].x = msg.x;
        otherPlayers[msg.id].y = msg.y;
      } else {
        otherPlayers[msg.id] = new Player(msg.id, msg.x || 300, msg.y || 300, "cyan");
      }
      break;

    case "playerLeft":
      delete otherPlayers[msg.id];
      break;

    case "powerupTaken":
      for (const pu of powerups) {
        if (!pu.active) continue;
        if (Math.hypot(pu.x - msg.x, pu.y - msg.y) < 20) {
          pu.active = false;
          break;
        }
      }
      break;

    case "pong":
      break;
  }
}

function otherPlayersClear() {
  for (const k of Object.keys(otherPlayers)) delete otherPlayers[k];
}
