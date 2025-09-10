// game.js — Halloween 2025: Mansion Escape (Among Us–style camera, zoom, and soft vision)
// Full, integrated client. Drop-in replacement.
// Features:
// - Home screen Singleplayer/Multiplayer buttons (wired on DOMContentLoaded)
// - Dynamic map loading (image + JSON walls/obstacles/doors)
// - Player, Ghost AI, Powerups
// - Camera follow with zoom (Among Us feel), smooth scrolling
// - Soft, short-range visibility (vignette), adjustable
// - Footsteps, ghost chase, caught, powerup sounds
// - Pause/debug toggles (P / Tab)
// - Multiplayer (WebSocket placeholder: ws://localhost:8080)
// - Map image scales to screen size if needed; background scrolls as you move

// ============================
// Canvas and context
// ============================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Viewport from index.html
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// ============================
// Camera and lighting tuning
// ============================
// Zoomed-in camera like Among Us: player appears larger; less map visible.
const CAMERA_ZOOM = 2.0;      // 1.0 = no zoom; 2.0 is closer
const CAMERA_LERP = 0.22;     // 0 -> instant, 1 -> never moves (0.15-0.25 feels smooth)

// Soft limited vision (vignette), not pitch-black
const FOG_ENABLED = true;         // set false to disable
const AMBIENT_DARKNESS = 0.32;    // 0.0-0.5 suggested
const LIGHT_RADIUS = 170;         // in world pixels before zoom (adjust to taste)
const CONE_ENABLED = false;       // optional directional cone (off for clarity)

// ============================
// World/game config
// ============================
let MAP_WIDTH = 1920;     // Updated on image load
let MAP_HEIGHT = 1080;
let currentMapName = "mansion"; // expects maps/mansion.jpeg + maps/mansion.json

const DETECTION_RADIUS = 150;
const SPRINT_SPEED = 5;
const WALK_SPEED = 2.5;
const GHOST_SPEED = 1.5;
const GHOST_CHASE_BONUS = 0.8;
const POWERUP_SIZE = 24;
const PLAYER_SIZE = 32;

let gameStarted = false;
let paused = false;
let debug = false;
let multiplayer = false;

// Map image
const mapImage = new Image();
let mapImageLoaded = false;

// Colliders
let walls = [];      // colliding rectangles
let obstacles = [];  // extra colliders (furniture)
let doorways = [];   // non-colliding regions

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
// Input
// ============================
const input = {};
document.addEventListener("keydown", (e) => {
  input[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "p") paused = !paused;
  if (e.key.toLowerCase() === "tab") { e.preventDefault(); debug = !debug; }
});
document.addEventListener("keyup", (e) => { input[e.key.toLowerCase()] = false; });

// ============================
// Utilities
// ============================
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function aabbRectHit(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function aabbEntityHit(A, B) {
  return aabbRectHit(A.x, A.y, A.size, A.size, B.x, B.y, B.size, B.size);
}
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
function hitsCollision(x, y, size) {
  for (const w of walls) if (aabbRectHit(x, y, size, w.x, w.y, w.w, w.h)) return true;
  for (const o of obstacles) if (aabbRectHit(x, y, size, o.x, o.y, o.w, o.h)) return true;
  return false;
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
  }
  draw(cameraX, cameraY) {
    if (survivorImg.complete && survivorImg.naturalHeight > 0) {
      ctx.drawImage(survivorImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
    } else {
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.size, this.size);
    }
    ctx.fillStyle = "white";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(this.name, this.x - cameraX + this.size / 2, this.y - cameraY - 4);
    ctx.textAlign = "start";
  }
}

class Ghost {
  constructor(x, y) {
    this.x = x; this.y = y;
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
      this.state = "chase"; this.target = player;
    } else if (this.state === "chase" && dist > DETECTION_RADIUS * 2) {
      this.state = "wander"; this.chasing = false; this.target = null;
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
        this.changeDirTimer = 120;
      } else { this.changeDirTimer--; }
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
      ctx.fillStyle = "rgba(160,160,255,0.75)";
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
// Instances
// ============================
const player = new Player("me", 300, 300);
const ghosts = [ new Ghost(800, 600), new Ghost(1200, 700) ];
const powerups = [ new PowerUp(500, 500, "shield"), new PowerUp(1400, 900, "speed") ];

// Multiplayer (client)
let socket = null;
const otherPlayers = {}; // id -> Player
let reconnectTimer = null;

// Speed buff system
let speedBuffTime = 0;
let speedBuffMultiplier = 1;
function startSpeedBuff(durationMs, multiplier) { speedBuffTime = durationMs; speedBuffMultiplier = multiplier; }
function getWalkSpeed() { return WALK_SPEED * (speedBuffTime > 0 ? speedBuffMultiplier : 1); }
function getSprintSpeed() { return SPRINT_SPEED * (speedBuffTime > 0 ? speedBuffMultiplier : 1); }

// ============================
// Camera (zoom + smoothing)
// ============================
let camX = 0;
let camY = 0;

function getViewSize() {
  return { viewW: VIEW_W / CAMERA_ZOOM, viewH: VIEW_H / CAMERA_ZOOM };
}
function getTargetCamera() {
  const { viewW, viewH } = getViewSize();
  let targetX = player.x - viewW / 2;
  let targetY = player.y - viewH / 2;
  targetX = clamp(targetX, 0, Math.max(0, MAP_WIDTH - viewW));
  targetY = clamp(targetY, 0, Math.max(0, MAP_HEIGHT - viewH));
  return { targetX, targetY };
}
function updateCamera() {
  const { targetX, targetY } = getTargetCamera();
  camX += (targetX - camX) * CAMERA_LERP;
  camY += (targetY - camY) * CAMERA_LERP;
}

// ============================
// Fog/vignette (short visibility)
// ============================
function drawVignette() {
  if (!FOG_ENABLED) return;

  const px = (player.x - camX + player.size / 2) * CAMERA_ZOOM;
  const py = (player.y - camY + player.size / 2) * CAMERA_ZOOM;
  const vision = LIGHT_RADIUS * CAMERA_ZOOM;

  ctx.save();
  // Base darkening layer
  ctx.fillStyle = `rgba(0,0,0,${AMBIENT_DARKNESS})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Clear circle with smooth edges
  ctx.globalCompositeOperation = "destination-out";
  const grad = ctx.createRadialGradient(px, py, vision * 0.35, px, py, vision);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(px, py, vision, 0, Math.PI * 2);
  ctx.fill();

  if (CONE_ENABLED) {
    const dirX = (input["d"]?1:0) - (input["a"]?1:0);
    const dirY = (input["s"]?1:0) - (input["w"]?1:0);
    const ang = Math.atan2(dirY, dirX);
    const facing = Number.isFinite(ang) ? ang : 0;

    ctx.translate(px, py);
    ctx.rotate(facing);
    const coneLen = 320 * CAMERA_ZOOM;
    const coneGrad = ctx.createLinearGradient(0, 0, coneLen, 0);
    coneGrad.addColorStop(0, "rgba(0,0,0,1)");
    coneGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(coneLen, -120 * CAMERA_ZOOM);
    ctx.lineTo(coneLen, 120 * CAMERA_ZOOM);
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

  // Player-ghost collision
  for (const g of ghosts) {
    if (aabbEntityHit(g, player)) {
      playSound(caughtSound, "caught", 400);
      player.lives = Math.max(0, player.lives - 1);
      respawnPlayer();
      break;
    }
  }

  // Powerups
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
  ctx.save();
  ctx.scale(CAMERA_ZOOM, CAMERA_ZOOM);
  const { viewW, viewH } = getViewSize();

  ctx.clearRect(0, 0, viewW, viewH);

  // Map background scaled to world
  if (mapImageLoaded) {
    ctx.drawImage(mapImage, -camX, -camY, MAP_WIDTH, MAP_HEIGHT);
  } else {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = "#333";
    ctx.fillRect(16 - camX, 16 - camY, viewW - 32, viewH - 32);
  }

  // Colliders in debug
  for (const w of walls) w.draw(camX, camY);
  for (const o of obstacles) o.draw(camX, camY);
  for (const d of doorways) d.draw(camX, camY);

  // Powerups
  for (const pu of powerups) pu.draw(camX, camY);

  // Ghosts
  for (const g of ghosts) g.draw(camX, camY);

  // Other players
  Object.values(otherPlayers).forEach(op => op.draw(camX, camY));

  // Local player last
  player.draw(camX, camY);

  ctx.restore();

  // Post-scale overlay and HUD
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
// Loop
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
// Map loading (image + JSON)
// ============================
async function loadMap(mapName) {
  currentMapName = mapName;
  mapImageLoaded = false;

  // Load image
  await new Promise((resolve) => {
    mapImage.onload = () => {
      // Fit map to at least the screen so it's never smaller than view; still scrolls if bigger
      const minW = Math.max(VIEW_W / CAMERA_ZOOM, 800);
      const minH = Math.max(VIEW_H / CAMERA_ZOOM, 600);
      MAP_WIDTH = Math.max(mapImage.width || MAP_WIDTH, minW);
      MAP_HEIGHT = Math.max(mapImage.height || MAP_HEIGHT, minH);
      mapImageLoaded = true;
      resolve();
    };
    mapImage.onerror = () => {
      // If image fails, fall back to a map roughly screen-sized to still play
      MAP_WIDTH = Math.max(MAP_WIDTH, VIEW_W / CAMERA_ZOOM);
      MAP_HEIGHT = Math.max(MAP_HEIGHT, VIEW_H / CAMERA_ZOOM);
      resolve();
    };
    mapImage.src = `maps/${mapName}.jpeg`;
  });

  // Load JSON colliders
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
// Home screen and start flow
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
// Multiplayer client (WebSocket)
// ============================
// Protocol (example):
// Client -> Server: {type:"hello",name}, {type:"move",x,y,sprinting}, {type:"powerupTaken",x,y}, {type:"ping"}
// Server -> Client: {type:"welcome",id,map,players:[{id,x,y,name}]}, {type:"playerJoined",id,x,y,name}, {type:"playerMoved",id,x,y}, {type:"playerLeft",id}, {type:"powerupTaken",x,y}, {type:"pong"}

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
          if (!otherPlayers[p.id]) {
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
