// game.js — Halloween 2025: Mansion Escape
// Complete file with: home screen flow, dynamic map + JSON walls, player/ghost/powerups,
// collision, camera, sounds, and small QoL toggles (pause/debug). No external libs needed.

// ----------------------------
// Canvas and context
// ----------------------------
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Canvas size is controlled by index.html; camera scales to map size.
const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

// ----------------------------
// Map and world config
// ----------------------------
let MAP_WIDTH = 1920;   // Will be updated to image dimensions on load
let MAP_HEIGHT = 1080;  // Will be updated to image dimensions on load

// Player/ghost tuning
const DETECTION_RADIUS = 150;
const SPRINT_SPEED = 5;
const WALK_SPEED = 2.5;
const GHOST_SPEED = 1.5;
const GHOST_CHASE_BONUS = 0.8;

// Powerups
const POWERUP_SIZE = 24;

// Game state flags
let gameStarted = false;
let paused = false;
let debug = false;

// Map image and walls
let currentMapName = "mansion"; // default map key (maps/mansion.jpeg, maps/mansion.json)
const mapImage = new Image();
let mapImageLoaded = false;

let walls = [];  // array of Wall instances
let doorways = []; // optional doors (non-colliding)
let obstacles = []; // optional obstacles (colliding)

// ----------------------------
// Sounds
// ----------------------------
const footstepSound = new Audio("sounds/footsteps.mp3");
const ghostChaseSound = new Audio("sounds/ghost_chase.mp3");
const caughtSound = new Audio("sounds/caught.mp3");
const powerupSound = new Audio("sounds/powerup.mp3");

// Optional simple volume tweaks
footstepSound.volume = 0.35;
ghostChaseSound.volume = 0.7;
caughtSound.volume = 0.8;
powerupSound.volume = 0.7;

// Avoid spamming overlapping playbacks (very basic throttling)
const soundCooldowns = new Map();
function playSound(sound, key = null, cooldownMs = 120) {
  const now = performance.now();
  const k = key || sound; // key to track cooldown
  const last = soundCooldowns.get(k) || 0;
  if (now - last < cooldownMs) return;
  sound.currentTime = 0;
  sound.play().catch(() => {});
  soundCooldowns.set(k, now);
}

// Unlock audio on first interaction (some browsers block auto-play)
function unlockAudio() {
  [footstepSound, ghostChaseSound, caughtSound, powerupSound].forEach(a => {
    try { a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {}); } catch(e){}
  });
  document.removeEventListener("pointerdown", unlockAudio);
  document.removeEventListener("keydown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("keydown", unlockAudio);

// ----------------------------
// Assets: sprites
// ----------------------------
const survivorImg = new Image();
survivorImg.src = "images/survivor.png";
const ghostImg = new Image();
ghostImg.src = "images/ghost.png";
const powerupImg = new Image();
powerupImg.src = "images/powerup.png";

// ----------------------------
// Input handling
// ----------------------------
const input = {};
document.addEventListener("keydown", (e) => {
  input[e.key.toLowerCase()] = true;

  // Quick toggles
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

// ----------------------------
// Classes
// ----------------------------
class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = 32;
    this.speed = WALK_SPEED;
    this.lives = 3;
    this.sprinting = false;

    // For sound pacing
    this.movedLastFrame = false;
  }

  update() {
    this.sprinting = !!input["shift"];
    this.speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    let dx = 0;
    let dy = 0;

    if (input["w"] || input["arrowup"]) dy -= this.speed;
    if (input["s"] || input["arrowdown"]) dy += this.speed;
    if (input["a"] || input["arrowleft"]) dx -= this.speed;
    if (input["d"] || input["arrowright"]) dx += this.speed;

    // Diagonal normalization (optional)
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv;
      dy *= inv;
    }

    // Move with axis separation to reduce clipping on corners
    this.x = tryMoveAxis(this.x, this.y, this.size, dx, 0);
    this.y = tryMoveAxis(this.x, this.y, this.size, 0, dy);

    // Clamp to map
    this.x = clamp(this.x, 0, MAP_WIDTH - this.size);
    this.y = clamp(this.y, 0, MAP_HEIGHT - this.size);

    // Footsteps: only when actually moving
    const isMoving = (dx !== 0 || dy !== 0);
    if (isMoving) {
      // Slightly longer cooldown so it doesn't spam constantly
      playSound(footstepSound, "footsteps", 200);
    }
    this.movedLastFrame = isMoving;
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

    // Simple stealth: only detect if within radius and player is sprinting
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
      const speed = this.speed + GHOST_CHASE_BONUS;
      this.x = tryMoveAxis(this.x, this.y, this.size, Math.cos(angle) * speed, 0);
      this.y = tryMoveAxis(this.x, this.y, this.size, 0, Math.sin(angle) * speed);
    } else {
      // Wander behavior
      if (this.changeDirTimer <= 0) {
        this.dx = Math.random() * 2 - 1;
        this.dy = Math.random() * 2 - 1;
        // Normalize to avoid super slow drift
        const len = Math.hypot(this.dx, this.dy) || 1;
        this.dx /= len;
        this.dy /= len;
        this.changeDirTimer = 120; // ~2 seconds @60fps
      } else {
        this.changeDirTimer--;
      }
      this.x = tryMoveAxis(this.x, this.y, this.size, this.dx * this.speed, 0);
      this.y = tryMoveAxis(this.x, this.y, this.size, 0, this.dy * this.speed);
    }

    // Clamp to map
    this.x = clamp(this.x, 0, MAP_WIDTH - this.size);
    this.y = clamp(this.y, 0, MAP_HEIGHT - this.size);
  }

  draw(cameraX, cameraY) {
    if (ghostImg.complete && ghostImg.naturalHeight > 0) {
      ctx.drawImage(ghostImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
    } else {
      ctx.fillStyle = "rgba(150,150,255,0.7)";
      ctx.fillRect(this.x - cameraX, this.y - cameraY, this.size, this.size);
    }
  }
}

class PowerUp {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.size = POWERUP_SIZE;
    this.type = type;
    this.active = true;
  }
  apply(player) {
    if (this.type === "shield") {
      player.lives += 1;
    } else if (this.type === "speed") {
      // Temporary speed modifier for 6 seconds
      const originalWalk = WALK_SPEED;
      const originalSprint = SPRINT_SPEED;
      // We won't change constants; we add a timed buff by tracking a timer on player
      addTimedSpeedBuff(player, 6000, 1.2); // 20% buff for 6s
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
    this.x = x;
    this.y = y;
    this.w = width;
    this.h = height;
  }
  draw(cameraX, cameraY) {
    // Visible only in debug to keep map art clean
    if (!debug) return;
    ctx.fillStyle = "rgba(200,60,200,0.35)";
    ctx.fillRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
    ctx.strokeStyle = "purple";
    ctx.lineWidth = 2;
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

// Optional: non-colliding doorway/zone marker (unused but handy if you expand)
class Doorway {
  constructor(x, y, width, height, toRoomId = null) {
    this.x = x; this.y = y; this.w = width; this.h = height;
    this.toRoomId = toRoomId;
  }
  draw(cameraX, cameraY) {
    if (!debug) return;
    ctx.strokeStyle = "lime";
    ctx.strokeRect(this.x - cameraX, this.y - cameraY, this.w, this.h);
  }
}

// Optional: colliding obstacle (furniture)
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

// ----------------------------
// Game state instances
// ----------------------------
const player = new Player(300, 300);
const ghosts = [
  new Ghost(800, 600),
  new Ghost(1200, 700),
];
const powerups = [
  new PowerUp(500, 500, "shield"),
  new PowerUp(1400, 900, "speed"),
];

// Speed buff system (lightweight)
let speedBuffTimerMs = 0;
let speedBuffMultiplier = 1;
function addTimedSpeedBuff(player, durationMs, multiplier) {
  speedBuffTimerMs = durationMs;
  speedBuffMultiplier = multiplier;
}

// ----------------------------
// Camera
// ----------------------------
function getCamera() {
  let cameraX = player.x - VIEW_W / 2;
  let cameraY = player.y - VIEW_H / 2;
  cameraX = clamp(cameraX, 0, Math.max(0, MAP_WIDTH - VIEW_W));
  cameraY = clamp(cameraY, 0, Math.max(0, MAP_HEIGHT - VIEW_H));
  return { cameraX, cameraY };
}

// ----------------------------
// Collision helpers
// ----------------------------
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

// Axis-separated movement to avoid snagging on corners
function tryMoveAxis(x, y, size, dx, dy) {
  let nx = x + dx;
  let ny = y + dy;
  // Check walls
  for (let w of walls) {
    if (aabbCollideRect(nx, ny, size, w.x, w.y, w.w, w.h)) {
      // Resolve collision along the moving axis
      if (dx > 0) nx = w.x - size;
      if (dx < 0) nx = w.x + w.w;
      if (dy > 0) ny = w.y - size;
      if (dy < 0) ny = w.y + w.h;
      // Stop movement along that axis
      if (dx !== 0) nx = x; // if we were moving in x, cancel x-move
      if (dy !== 0) ny = y; // if we were moving in y, cancel y-move
      return dx !== 0 ? x : y; // This return isn't used; we handle after loop.
    }
  }
  // Check obstacles (colliding furniture)
  for (let o of obstacles) {
    if (aabbCollideRect(nx, ny, size, o.x, o.y, o.w, o.h)) {
      if (dx > 0) nx = o.x - size;
      if (dx < 0) nx = o.x + o.w;
      if (dy > 0) ny = o.y - size;
      if (dy < 0) ny = o.y + o.h;
      if (dx !== 0) nx = x;
      if (dy !== 0) ny = y;
      return dx !== 0 ? x : y;
    }
  }

  // If no collision, return updated coordinate
  return dx !== 0 ? nx : ny;
}

// ----------------------------
// Update & draw
// ----------------------------
let lastTime = performance.now();
function update(dt) {
  // Apply timed speed buffs
  if (speedBuffTimerMs > 0) {
    speedBuffTimerMs -= dt;
    // Dynamically increase movement while buff is active (multiplying per-frame deltas)
    // We'll implement by temporarily scaling the computed speed
    // We already compute speed in Player.update; inject by global multiplier:
    injectSpeedMultiplier(speedBuffTimerMs > 0 ? speedBuffMultiplier : 1);
  } else {
    injectSpeedMultiplier(1);
  }

  player.update();
  for (let g of ghosts) g.update(player);

  // Collisions: ghosts with player
  for (let g of ghosts) {
    if (entityCollide(g, player)) {
      playSound(caughtSound, "caught", 400);
      player.lives = Math.max(0, player.lives - 1);
      // Respawn player near a safe spot
      respawnPlayer();
      // Break early so we don't multi-hit in same frame
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

  // Background/map
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  if (mapImageLoaded) {
    ctx.drawImage(mapImage, -cameraX, -cameraY, MAP_WIDTH, MAP_HEIGHT);
  } else {
    // Placeholder background if map not loaded yet
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#333";
    ctx.fillRect(20, 20, VIEW_W - 40, VIEW_H - 40);
  }

  // Debug draw for walls/obstacles/doors
  for (let w of walls) w.draw(cameraX, cameraY);
  for (let o of obstacles) o.draw(cameraX, cameraY);
  for (let d of doorways) d.draw(cameraX, cameraY);

  // Entities
  player.draw(cameraX, cameraY);
  for (let g of ghosts) g.draw(cameraX, cameraY);
  for (let pu of powerups) pu.draw(cameraX, cameraY);

  // HUD
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
    ctx.fillText(`DEBUG ON | Map: ${currentMapName} ${MAP_WIDTH}x${MAP_HEIGHT}`, 20, 44);
    ctx.fillText(`Player: (${Math.round(player.x)}, ${Math.round(player.y)})`, 20, 62);
    ctx.fillText(`Walls: ${walls.length} | Obstacles: ${obstacles.length}`, 20, 80);
  }
}

// ----------------------------
// Game loop
// ----------------------------
function gameLoop() {
  const now = performance.now();
  const dt = now - lastTime;
  lastTime = now;

  if (gameStarted && !paused) {
    update(dt);
    draw();
  } else if (gameStarted && paused) {
    draw(); // Still draw the paused frame overlay
  }

  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// ----------------------------
// Map loading
// ----------------------------
async function loadMap(mapName) {
  currentMapName = mapName;
  mapImageLoaded = false;

  // Load image
  await new Promise((resolve) => {
    mapImage.onload = () => {
      // Set MAP_WIDTH/HEIGHT to image size (keeps pixel-perfect alignment with JSON coords)
      MAP_WIDTH = mapImage.width;
      MAP_HEIGHT = mapImage.height;
      mapImageLoaded = true;
      resolve();
    };
    mapImage.onerror = () => {
      // Fallback: keep default map size
      mapImageLoaded = false;
      resolve();
    };
    mapImage.src = `maps/${mapName}.jpeg`;
  });

  // Load JSON walls (and optional obstacles/doorways if you include them)
  try {
    const res = await fetch(`maps/${mapName}.json`);
    const data = await res.json();

    // Expected format:
    // {
    //   "walls": [{ "x":..., "y":..., "width":..., "height":... }, ...],
    //   "obstacles": [{ "x":..., "y":..., "width":..., "height":... }, ...],   // optional
    //   "doorways": [{ "x":..., "y":..., "width":..., "height":..., "to":null }...]  // optional
    // }

    walls = (data.walls || []).map(w => new Wall(w.x, w.y, w.width, w.height));
    obstacles = (data.obstacles || []).map(o => new Obstacle(o.x, o.y, o.width, o.height));
    doorways = (data.doorways || []).map(d => new Doorway(d.x, d.y, d.width, d.height, d.to || null));

  } catch (e) {
    // If JSON load fails, set empty collision so at least the map shows
    walls = [];
    obstacles = [];
    doorways = [];
    // You can log if you want; keeping it silent for release
  }

  // After loading a map, relocate player to a safe starting tile if needed
  placePlayerAtSpawn();
}

// ----------------------------
// Start game flow (home screen bindings)
// ----------------------------
const singleBtn = document.getElementById("singleplayerBtn");
const multiBtn = document.getElementById("multiplayerBtn");

if (singleBtn) {
  singleBtn.addEventListener("click", () => startGame("singleplayer"));
}
if (multiBtn) {
  multiBtn.addEventListener("click", () => startGame("multiplayer"));
}

function startGame(mode) {
  const home = document.getElementById("homeScreen");
  if (home) home.style.display = "none";
  canvas.style.display = "block";
  gameStarted = true;

  if (mode === "multiplayer") {
    alert("Multiplayer mode is under development!");
  }

  // Load default map
  loadMap(currentMapName).then(() => {
    // Optional: anything to run once map is loaded
  });
}

// ----------------------------
// Utility & helpers
// ----------------------------
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function respawnPlayer() {
  // Basic respawn: place near a top-left safe position
  const candidates = [
    { x: 100, y: 100 },
    { x: 200, y: 200 },
    { x: 300, y: 300 },
  ];
  for (const c of candidates) {
    if (!hitsAnyCollision(c.x, c.y, player.size)) {
      player.x = c.x;
      player.y = c.y;
      return;
    }
  }
  // Fallback
  player.x = 300;
  player.y = 300;
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

function placePlayerAtSpawn() {
  // Try a set of spawn points (corners and center)
  const candidates = [
    { x: 64, y: 64 },
    { x: MAP_WIDTH - 128, y: 64 },
    { x: 64, y: MAP_HEIGHT - 128 },
    { x: MAP_WIDTH - 128, y: MAP_HEIGHT - 128 },
    { x: MAP_WIDTH / 2 - player.size / 2, y: MAP_HEIGHT / 2 - player.size / 2 },
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

// Inject a temporary speed multiplier that affects player movement
let globalSpeedMultiplier = 1;
function injectSpeedMultiplier(mult) {
  globalSpeedMultiplier = mult;
  // We won't change constants; we scale movement inputs indirectly by scaling Player.speed via sprint/walk.
// To keep it simple, we will scale inside Player.update by adjusting speed after sprint/walk calc:
  Player.prototype._applySpeedScale = function() {
    // In case we want to extend later; not used directly in code below
  };
}
// Patch Player.update to apply multiplier cleanly without rewriting logic:
// We'll wrap the original method:
(function patchPlayerSpeed() {
  const originalUpdate = Player.prototype.update;
  Player.prototype.update = function() {
    // temporarily adjust speeds
    const baseSprint = SPRINT_SPEED * globalSpeedMultiplier;
    const baseWalk = WALK_SPEED * globalSpeedMultiplier;

    // Save current
    const savedSprint = this.sprinting;

    // compute movement using a temporary override
    const prevSpeed = this.speed;

    // We need to run like original, but ensure speed computed uses scaled values:
    // We'll emulate original logic but reusing movement portion:
    this.sprinting = !!input["shift"];
    const desiredSpeed = this.sprinting ? baseSprint : baseWalk;
    this.sprinting = savedSprint; // restore for ghost detection (uses sprinting state)
    this.speed = desiredSpeed;

    // Now proceed with the rest of original update, but we must run its body with our speed.
    // We'll copy the original logic minus first two lines to avoid recursion.
    // To keep this maintainable: we'll call a helper that mirrors original body loosely.

    // BEGIN mirrored body of original (lightly adjusted)
    let dx = 0, dy = 0;
    if (input["w"] || input["arrowup"]) dy -= this.speed;
    if (input["s"] || input["arrowdown"]) dy += this.speed;
    if (input["a"] || input["arrowleft"]) dx -= this.speed;
    if (input["d"] || input["arrowright"]) dx += this.speed;

    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv;
      dy *= inv;
    }

    this.x = tryMoveAxis(this.x, this.y, this.size, dx, 0);
    this.y = tryMoveAxis(this.x, this.y, this.size, 0, dy);

    this.x = clamp(this.x, 0, MAP_WIDTH - this.size);
    this.y = clamp(this.y, 0, MAP_HEIGHT - this.size);

    const isMoving = (dx !== 0 || dy !== 0);
    if (isMoving) {
      playSound(footstepSound, "footsteps", 200);
    }
    this.movedLastFrame = isMoving;
    // END mirrored body

    // Restore speed (not strictly necessary)
    this.speed = prevSpeed;
  };
})();

// ----------------------------
// End of file
// ----------------------------
```
