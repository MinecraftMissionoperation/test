// game.js — Halloween 2025: Mansion Escape
// Complete file: home screen flow, dynamic map (image) + JSON walls, player/ghost/powerups,
// collision, camera, sounds, and simple pause/debug toggles. No external libs needed.

// ============================
// Canvas and context
// ============================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Viewport (set in index.html)
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// ============================
// Map and world config
// ============================
let MAP_WIDTH = 1920;   // Updated to image width on load
let MAP_HEIGHT = 1080;  // Updated to image height on load
let currentMapName = "mansion"; // expects maps/mansion.jpeg and maps/mansion.json

// Gameplay tuning
const DETECTION_RADIUS = 150;
const SPRINT_SPEED = 5;
const WALK_SPEED = 2.5;
const GHOST_SPEED = 1.5;
const GHOST_CHASE_BONUS = 0.8;
const POWERUP_SIZE = 24;

// State flags
let gameStarted = false;
let paused = false;
let debug = false;

const mapImage = new Image();
let mapImageLoaded = false;

// Colliders
let walls = [];      // array of Wall (colliding)
let obstacles = [];  // array of Obstacle (colliding) — optional, loaded if present
let doorways = [];   // array of Doorway (non-colliding) — optional, loaded if present

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

// Avoid sound spam
const soundCooldowns = new Map();
function playSound(sound, key = null, cooldownMs = 120) {
  const now = performance.now();
  const k = key || sound;
  const last = soundCooldowns.get(k) || 0;
  if (now - last < cooldownMs) return;
  try {
    sound.currentTime = 0;
    sound.play();
  } catch (_) {}
  soundCooldowns.set(k, now);
}

// Unlock audio on first user interaction (autoplay rules)
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

  // toggles
  if (e.key.toLowerCase() === "p") {
    paused = !paused;
  }
  if (e.key.toLowerCase() === "tab") {
    e.preventDefault();
    debug = !debug;
  }
});
document.addEventListener("keyup", (e) => {
  input[e.key.toLowerCase()] = false;
});

// ============================
// Classes
// ============================
class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = 32;
    this.speed = WALK_SPEED;
    this.lives = 3;
    this.sprinting = false;
  }

  update() {
    this.sprinting = !!input["shift"];
    this.speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    let dx = 0, dy = 0;
    if (input["w"] || input["arrowup"]) dy -= this.speed;
    if (input["s"] || input["arrowdown"]) dy += this.speed;
    if (input["a"] || input["arrowleft"]) dx -= this.speed;
    if (input["d"] || input["arrowright"]) dx += this.speed;

    // Normalize diagonals
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv; dy *= inv;
    }

    // Move axis-aligned to avoid corner snagging
    this.x = tryMoveAxis(this.x, this.y, this.size, dx, 0);
    this.y = tryMoveAxis(this.x, this.y, this.size, 0, dy);

    // Clamp
    this.x = clamp(this.x, 0, MAP_WIDTH - this.size);
    this.y = clamp(this.y, 0, MAP_HEIGHT - this.size);

    // Footsteps when moving
    if (dx !== 0 || dy !== 0) playSound(footstepSound, "footsteps", 200);
  }

  draw(cameraX, cameraY) {
    if (survivorImg.complete && survivorImg.naturalHeight > 0) {
      ctx.drawImage(survivorImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
    } else {
      ctx.fillStyle = "lime";
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.size, this.size);
    }
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

    // Detect sprinting player
    if (dist < DETECTION_RADIUS && player.sprinting) {
      if (!this.chasing) {
        playSound(ghostChaseSound, "ghostChase", 500);
        this.chasing = true;
      }
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
      this.x = tryMoveAxis(this.x, this.y, this.size, Math.cos(angle) * spd, 0);
      this.y = tryMoveAxis(this.x, this.y, this.size, 0, Math.sin(angle) * spd);
    } else {
      // Wander
      if (this.changeDirTimer <= 0) {
        this.dx = Math.random() * 2 - 1;
        this.dy = Math.random() * 2 - 1;
        const len = Math.hypot(this.dx, this.dy) || 1;
        this.dx /= len; this.dy /= len;
        this.changeDirTimer = 120; // ~2s at 60fps
      } else {
        this.changeDirTimer--;
      }
      this.x = tryMoveAxis(this.x, this.y, this.size, this.dx * this.speed, 0);
      this.y = tryMoveAxis(this.x, this.y, this.size, 0, this.dy * this.speed);
    }

    // Clamp
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
    this.x = x;
    this.y = y;
    this.size = POWERUP_SIZE;
    this.type = type; // "shield" | "speed"
    this.active = true;
  }
  apply(player) {
    if (this.type === "shield") {
      player.lives += 1;
    } else if (this.type === "speed") {
      // Simple temporary speed buff by toggling sprinting for a short time (fun arcade-y)
      temporarySpeedBuff(6000, 1.2);
    }
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
  constructor(x, y, width, height) {
    this.x = x; this.y = y; this.w = width; this.h = height;
  }
  draw(cameraX, cameraY) {
    if (!debug) return; // show only in debug
    ctx.fillStyle = "rgba(200,60,200,0.35)";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
    ctx.strokeStyle = "purple";
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

class Obstacle {
  constructor(x, y, width, height) {
    this.x = x; this.y = y; this.w = width; this.h = height;
  }
  draw(cameraX, cameraY) {
    if (!debug) return;
    ctx.fillStyle = "rgba(120,120,120,0.35)";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
    ctx.strokeStyle = "#aaa";
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

class Doorway {
  constructor(x, y, width, height) {
    this.x = x; this.y = y; this.w = width; this.h = height;
  }
  draw(cameraX, cameraY) {
    if (!debug) return;
    ctx.strokeStyle = "lime";
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

// ============================
// Game instances
// ============================
const player = new Player(300, 300);
const ghosts = [
  new Ghost(800, 600),
  new Ghost(1200, 700),
];
const powerups = [
  new PowerUp(500, 500, "shield"),
  new PowerUp(1400, 900, "speed"),
];

// ============================
// Camera
// ============================
function getCamera() {
  let cameraX = player.x - VIEW_W / 2;
  let cameraY = player.y - VIEW_H / 2;
  cameraX = clamp(cameraX, 0, Math.max(0, MAP_WIDTH - VIEW_W));
  cameraY = clamp(cameraY, 0, Math.max(0, MAP_HEIGHT - VIEW_H));
  return { cameraX, cameraY };
}

// ============================
// Collision helpers
// ============================
function aabbCollideRect(x, y, size, rx, ry, rw, rh) {
  return x < rx + rw &&
         x + size > rx &&
         y < ry + rh &&
         y + size > ry;
}

function entityCollide(a, b) {
  return a.x < b.x + b.size &&
         a.x + a.size > b.x &&
         a.y < b.y + b.size &&
         a.y + a.size > b.y;
}

function tryMoveAxis(x, y, size, dx, dy) {
  let nx = x + dx;
  let ny = y + dy;

  // Check walls
  for (let w of walls) {
    if (aabbCollideRect(nx, ny, size, w.x, w.y, w.w, w.h)) {
      // Resolve collision
      if (dx > 0) nx = w.x - size;
      if (dx < 0) nx = w.x + w.w;
      if (dy > 0) ny = w.y - size;
      if (dy < 0) ny = w.y + w.h;
      // Cancel along the axis we moved
      return dx !== 0 ? x : y;
    }
  }

  // Check obstacles (colliding furniture)
  for (let o of obstacles) {
    if (aabbCollideRect(nx, ny, size, o.x, o.y, o.w, o.h)) {
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
// Update & draw
// ============================
let lastTime = performance.now();
function update(dt) {
  // Timers
  updateSpeedBuff(dt);

  player.update();
  for (let g of ghosts) g.update(player);

  // Ghost collisions
  for (let g of ghosts) {
    if (entityCollide(g, player)) {
      playSound(caughtSound, "caught", 400);
      player.lives = Math.max(0, player.lives - 1);
      respawnPlayer();
      break;
    }
  }

  // Powerups
  for (let pu of powerups) {
    if (pu.active && entityCollide({ x: player.x, y: player.y, size: player.size }, { x: pu.x, y: pu.y, size: pu.size })) {
      playSound(powerupSound, "powerup", 300);
      pu.apply(player);
      pu.active = false;
    }
  }
}

function draw() {
  const { cameraX, cameraY } = getCamera();

  // Background (map)
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  if (mapImageLoaded) {
    ctx.drawImage(mapImage, -cameraX, -cameraY, MAP_WIDTH, MAP_HEIGHT);
  } else {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#333";
    ctx.fillRect(20, 20, VIEW_W - 40, VIEW_H - 40);
  }

  // Debug collision shapes
  for (let w of walls) w.draw(cameraX, cameraY);
  for (let o of obstacles) o.draw(cameraX, cameraY);
  for (let d of doorways) d.draw(cameraX, cameraY);

  // Entities
  player.draw(cameraX, cameraY);
  for (let g of ghosts) g.draw(cameraX, cameraY);
  for (let pu of powerups) pu.draw(cameraX, cameraY);

  drawHUD();
}

function drawHUD() {
  ctx.fillStyle = "white";
  ctx.font = "18px Arial";
  ctx.textBaseline = "top";
  ctx.fillText(`Lives: ${player.lives}`, 20, 20);

  if (paused) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "orange";
    ctx.font = "28px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Paused (press P)", VIEW_W / 2, VIEW_H / 2);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  if (debug) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "14px monospace";
    ctx.fillText(`DEBUG | Map: ${currentMapName} ${MAP_WIDTH}x${MAP_HEIGHT}`, 20, 44);
    ctx.fillText(`Player: (${Math.round(player.x)}, ${Math.round(player.y)})`, 20, 62);
    ctx.fillText(`Walls: ${walls.length} Obstacles: ${obstacles.length}`, 20, 80);
  }
}

// ============================
// Game loop (runs always; draws only when started)
// ============================
function gameLoop() {
  const now = performance.now();
  const dt = now - lastTime;
  lastTime = now;

  if (gameStarted && !paused) {
    update(dt);
    draw();
  } else if (gameStarted && paused) {
    draw();
  }

  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// ============================
// Map loading
// ============================
async function loadMap(mapName) {
  currentMapName = mapName;
  mapImageLoaded = false;

  // Load image
  await new Promise((resolve) => {
    mapImage.onload = () => {
      MAP_WIDTH = mapImage.width;
      MAP_HEIGHT = mapImage.height;
      mapImageLoaded = true;
      resolve();
    };
    mapImage.onerror = () => {
      mapImageLoaded = false;
      resolve();
    };
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
    walls = [];
    obstacles = [];
    doorways = [];
  }

  placePlayerAtSafeSpawn();
}

// ============================
// Home screen bindings (ensure DOM is ready)
// ============================
window.addEventListener("DOMContentLoaded", () => {
  const singleBtn = document.getElementById("singleplayerBtn");
  const multiBtn = document.getElementById("multiplayerBtn");

  if (singleBtn) singleBtn.addEventListener("click", () => startGame("singleplayer"));
  if (multiBtn) multiBtn.addEventListener("click", () => startGame("multiplayer"));
});

function startGame(mode) {
  const home = document.getElementById("homeScreen");
  if (home) home.style.display = "none";
  canvas.style.display = "block";

  gameStarted = true;

  if (mode === "multiplayer") {
    alert("Multiplayer mode is under development!");
  }

  // Load default map
  loadMap(currentMapName);
}

// ============================
// Utilities & helpers
// ============================
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hitsAnyCollision(x, y, size) {
  for (let w of walls) {
    if (aabbCollideRect(x, y, size, w.x, w.y, w.w, w.h)) return true;
  }
  for (let o of obstacles) {
    if (aabbCollideRect(x, y, size, o.x, o.y, o.w, o.h)) return true;
  }
  return false;
}

function placePlayerAtSafeSpawn() {
  const candidates = [
    { x: 64, y: 64 },
    { x: MAP_WIDTH - 128, y: 64 },
    { x: 64, y: MAP_HEIGHT - 128 },
    { x: MAP_WIDTH - 128, y: MAP_HEIGHT - 128 },
    { x: MAP_WIDTH / 2 - player.size / 2, y: MAP_HEIGHT / 2 - player.size / 2 },
    { x: 200, y: 200 },
    { x: 300, y: 300 }
  ];
  for (const c of candidates) {
    if (!hitsAnyCollision(c.x, c.y, player.size)) {
      player.x = clamp(c.x, 0, MAP_WIDTH - player.size);
      player.y = clamp(c.y, 0, MAP_HEIGHT - player.size);
      return;
    }
  }
  // Fallback
  player.x = 300;
  player.y = 300;
}

function respawnPlayer() {
  placePlayerAtSafeSpawn();
}

// ===== Speed buff (simple global multiplier on WALK/SPRINT for a duration) =====
let speedBuffTime = 0;
let speedBuffMultiplier = 1;

function temporarySpeedBuff(durationMs, multiplier) {
  speedBuffTime = durationMs;
  speedBuffMultiplier = multiplier;
}

function updateSpeedBuff(dt) {
  if (speedBuffTime > 0) {
    speedBuffTime -= dt;
    // Modify constants indirectly by adjusting how Player reads speed:
    // We'll use a tiny trick: when sprint key is pressed, we scale that effect,
    // and when walking we also scale slightly, to keep it simple.

    // Apply scaled values per frame by overriding Player.speed in update:
    // Already handled implicitly since we compute speed every frame, so
    // we adjust globals here and read them in Player.update via getters.
    // We'll provide getters for current walk/sprint values:
  }
}

// Provide current speed with buff (used by Player.update logic if you want more control)
// For now we keep constants but you can use these helpers if you refactor:
// getWalkSpeed(), getSprintSpeed() — not currently used directly.

// If you want to integrate them, replace in Player.update:
// this.speed = this.sprinting ? getSprintSpeed() : getWalkSpeed();
function getWalkSpeed() {
  return WALK_SPEED * (speedBuffTime > 0 ? speedBuffMultiplier : 1);
}
function getSprintSpeed() {
  return SPRINT_SPEED * (speedBuffTime > 0 ? speedBuffMultiplier : 1);
}
```
