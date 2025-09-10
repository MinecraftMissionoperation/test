// Halloween 2025 - Escape (Google Doodle Inspired)

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1200;

const DETECTION_RADIUS = 150;
const SPRINT_SPEED = 5;
const WALK_SPEED = 2.5;

let gameStarted = false;

// --- ASSETS ---
const survivorImg = new Image();
survivorImg.src = "images/Player-removebg-preview.png";
const ghostImg = new Image();
ghostImg.src = "images/ghost-removebg-preview.png";
const powerupImg = new Image();
powerupImg.src = "images/powerup-removebg-preview.png";

// --- INPUT ---
const input = {};
document.addEventListener("keydown", e => input[e.key.toLowerCase()] = true);
document.addEventListener("keyup", e => input[e.key.toLowerCase()] = false);

// --- GAME OBJECTS ---
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
    this.sprinting = input["shift"] ? true : false;
    this.speed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    if (input["w"] || input["arrowup"]) this.y -= this.speed;
    if (input["s"] || input["arrowdown"]) this.y += this.speed;
    if (input["a"] || input["arrowleft"]) this.x -= this.speed;
    if (input["d"] || input["arrowright"]) this.x += this.speed;

    this.x = Math.max(0, Math.min(MAP_WIDTH - this.size, this.x));
    this.y = Math.max(0, Math.min(MAP_HEIGHT - this.size, this.y));
  }
  draw(cameraX, cameraY) {
    if (survivorImg.complete && survivorImg.naturalHeight !== 0) {
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
    this.speed = 1.5;
    this.state = "wander";
    this.target = null;
    this.dx = Math.random()*2-1;
    this.dy = Math.random()*2-1;
    this.changeDirTimer = 0;
  }
  update(player) {
    let dist = Math.hypot(player.x - this.x, player.y - this.y);

    if (dist < DETECTION_RADIUS && player.sprinting) {
      this.state = "chase";
      this.target = player;
    } else if (this.state === "chase" && dist > DETECTION_RADIUS * 2) {
      this.state = "wander";
    }

    if (this.state === "chase" && this.target) {
      let angle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
      this.x += Math.cos(angle) * (this.speed + 0.8);
      this.y += Math.sin(angle) * (this.speed + 0.8);
    } else {
      if (this.changeDirTimer <= 0) {
        this.dx = Math.random()*2-1;
        this.dy = Math.random()*2-1;
        this.changeDirTimer = 120;
      } else {
        this.changeDirTimer--;
      }
      this.x += this.dx * this.speed;
      this.y += this.dy * this.speed;
    }

    this.x = Math.max(0, Math.min(MAP_WIDTH - this.size, this.x));
    this.y = Math.max(0, Math.min(MAP_HEIGHT - this.size, this.y));
  }
  draw(cameraX, cameraY) {
    ctx.drawImage(ghostImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
  }
}

class PowerUp {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.size = 24;
    this.type = type;
    this.active = true;
  }
  draw(cameraX, cameraY) {
    if (!this.active) return;
    ctx.drawImage(powerupImg, this.x - cameraX, this.y - cameraY, this.size, this.size);
  }
}

// --- GAME STATE ---
const player = new Player(200, 200);
const ghosts = [new Ghost(500, 400), new Ghost(900, 800), new Ghost(1200, 600)];
const powerups = [new PowerUp(300, 300, "shield"), new PowerUp(1100, 900, "speed")];

// CAMERA system
function getCamera() {
  let cameraX = player.x - WIDTH/2;
  let cameraY = player.y - HEIGHT/2;

  cameraX = Math.max(0, Math.min(MAP_WIDTH - WIDTH, cameraX));
  cameraY = Math.max(0, Math.min(MAP_HEIGHT - HEIGHT, cameraY));

  return {cameraX, cameraY};
}

// --- LOOP ---
function update() {
  player.update();
  for(let g of ghosts) g.update(player);

  for (let g of ghosts) {
    if (collide(g, player)) {
      player.lives--;
      player.x = 200; player.y = 200;
    }
  }

  for (let pu of powerups) {
    if (pu.active && collide(pu, player)) {
      if (pu.type === "shield") {
        player.lives += 1;
      } else if (pu.type === "speed") {
        player.speed += 1.5;
      }
      pu.active = false;
    }
  }
}

function draw() {
  const {cameraX, cameraY} = getCamera();

  ctx.fillStyle = "#111";
  ctx.fillRect(0,0,WIDTH,HEIGHT);

  ctx.strokeStyle = "purple";
  ctx.strokeRect(-cameraX, -cameraY, MAP_WIDTH, MAP_HEIGHT);

  player.draw(cameraX, cameraY);
  for(let g of ghosts) g.draw(cameraX, cameraY);
  for(let pu of powerups) pu.draw(cameraX, cameraY);

  ctx.fillStyle = "white";
  ctx.font = "18px Arial";
  ctx.fillText("Lives: " + player.lives, 20, 30);
}

function gameLoop() {
  if (gameStarted) {
    update();
    draw();
  }
  requestAnimationFrame(gameLoop);
}
gameLoop();

// --- HELPER ---
function collide(a,b){
  return a.x < b.x + b.size &&
         a.x + a.size > b.x &&
         a.y < b.y + b.size &&
         a.y + a.size > b.y;
}

// --- HOME SCREEN BUTTONS ---
document.getElementById("singleplayerBtn").addEventListener("click", () => {
  startGame("singleplayer");
});

document.getElementById("multiplayerBtn").addEventListener("click", () => {
  startGame("multiplayer");
});

function startGame(mode) {
  document.getElementById("homeScreen").style.display = "none";
  canvas.style.display = "block";
  gameStarted = true;

  if (mode === "multiplayer") {
    alert("Multiplayer mode is under development!");
  }
}
