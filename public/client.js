// client.js

const socket = io();

// Get or generate a unique userId.
let userId = localStorage.getItem('userId');
if (!userId) {
 userId = Math.random().toString(36).substring(2, 10);
 localStorage.setItem('userId', userId);
}

// Fetch user colors from local storage or use defaults.
let userColors = { color1: '#00AAFF', color2: '#FFFFFF' };
if (localStorage.getItem('userColor1') && localStorage.getItem('userColor2')) {
 userColors.color1 = localStorage.getItem('userColor1');
 userColors.color2 = localStorage.getItem('userColor2');
}

function updateUserColorDisplay() {
 const div = document.getElementById('userColors');
 if (div) div.textContent = `Your Gradient: ${userColors.color1} to ${userColors.color2}`;
 const gradDiv = document.getElementById('gradientDisplayRoom');
 if (gradDiv) gradDiv.style.background = `linear-gradient(45deg, ${userColors.color1}, ${userColors.color2})`;
}
updateUserColorDisplay();

// Get room id from URL.
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
 alert('No room specified.');
 window.location.href = '/';
}
document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;


// Join room.
socket.emit('joinRoom', {
 room: roomId,
 userId,
 color1: userColors.color1,
 color2: userColors.color2
});

// --- Setup Matter.js physics (CLIENT-SIDE ONLY) ---
const Engine = Matter.Engine,
 Render = Matter.Render,
 Runner = Matter.Runner,
 World = Matter.World,
 Bodies = Matter.Bodies,
 Body = Matter.Body,
 Composite = Matter.Composite,
 Events = Matter.Events,
 Common = Matter.Common,
 Mouse = Matter.Mouse,
 MouseConstraint = Matter.MouseConstraint;

// Create engine with improved timing
const engine = Engine.create({
 enableSleeping: true,
 constraintIterations: 4,
 positionIterations: 6,
 velocityIterations: 4
});
const world = engine.world;
world.gravity.y = 1.2; // Blocks fall faster - INCREASED GRAVITY - SLIGHTLY MORE INCREASED

// Create canvas & context.
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// Add static walls.
const WALL_THICKNESS = 50;
const walls = [
 Bodies.rectangle(WIDTH / 2, -WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
 Bodies.rectangle(WIDTH / 2, HEIGHT + WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
 Bodies.rectangle(-WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
 Bodies.rectangle(WIDTH + WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
];
World.add(world, walls);

// A dictionary to hold message blocks (by message id).
const blocks = {};
// A dictionary to track artifacts
const artifacts = {};
let artifactSeed = Math.random();

// --- NEW VARIABLE: CONFIGURABLE NUMBER OF FANS ---
let numberOfFans = 5; // Default to 2 fans - YOU CAN CHANGE THIS VALUE

// Seeded random function
function seededRandom(seed) {
 const x = Math.sin(seed++) * 10000;
 return x - Math.floor(x);
}

// Particle system for fan effects
const particles = [];
class Particle {
 constructor(x, y, vx, vy) {
  this.x = x;
  this.y = y;
  this.vx = vx;
  this.vy = vy;
  this.alpha = 1;
  this.size = Math.random() * 4 + 1;
  this.color = `rgba(255, 255, 255, ${this.alpha})`;
 }

 update() {
  this.x += this.vx;
  this.y += this.vy;
  this.vy -= 0.05; // Upward acceleration
  this.alpha -= 0.01;
  this.color = `rgba(255, 255, 255, ${this.alpha})`;
  return this.alpha > 0;
 }

 draw(ctx) {
  ctx.fillStyle = this.color;
  ctx.beginPath();
  // Sharp spike particle - MODIFIED PARTICLE DRAWING
  ctx.moveTo(this.x, this.y - this.size * 2); // Top point
  ctx.lineTo(this.x + this.size, this.y + this.size);  // Bottom right
  ctx.lineTo(this.x - this.size, this.y + this.size);  // Bottom left
  ctx.closePath();
  ctx.fill();
 }
}

// Create artifacts from seed - only create fans
// In client.js, modify the createArtifacts function

function createArtifacts(seed) {
 let rng = seed;
 // Clear any existing artifacts
 Object.values(artifacts).forEach(artifact => {
  World.remove(world, artifact);
 });

 // --- MODIFIED: CREATE MULTIPLE FANS BASED ON numberOfFans ---
 for (let i = 0; i < numberOfFans; i++) {
  const fanX = seededRandom(rng++) * (WIDTH - 200) + 100 + (i * (WIDTH / numberOfFans)); // Spread fans more evenly
  const artifact = Bodies.rectangle(
   fanX,
   HEIGHT - 10, // Position closer to ground
   80, // Smaller collision area
   10, // Thinner collision
   { isStatic: true }
  );
  artifact.type = 'fan';
  artifact.strength = 0.001 + seededRandom(rng++) * 0.001;

  World.add(world, artifact);
  artifacts[i] = artifact; // Use index 'i' as the key
 }
}

// Helper: Create a Matter.js body for a message block.
// In client.js, modify createBlock function for better scaling

function createBlock(msg) {
 const lines = msg.text.split('\n');
 const longestLine = Math.max(...lines.map(line => line.length));
 // Improved width calculation with minimum and maximum constraints
 const width = Math.max(80, Math.min(15 * longestLine, 400));
 const height = 30 * lines.length + 30;

 // Simplified mass calculation - decoupled from opacity
 const mass = 1 + (msg.text.length / 50);

 // Random spawn position at the top
 const spawnX = Math.random() * (canvas.width - width) + width / 2;

 const body = Bodies.rectangle(
  msg.x || spawnX,
  msg.y || 50, // Near the top
  width,
  height,
  {
   chamfer: { radius: 15 },
   friction: 0.1,
   frictionAir: 0.03, // Slightly increased for less wild rotation
   restitution: 0.4,
   mass: mass
  }
 );

 // Other properties remain the same
 body.messageId = msg._id;
 body.userId = msg.userId;
 body.text = msg.text;
 body.color1 = msg.color1;
 body.color2 = msg.color2;
 body.opacity = msg.opacity !== undefined ? msg.opacity : 100;
 body.targetOpacity = body.opacity;
 body.width = width;
 body.height = height;
 return body;
}

// --- Socket.IO message events ---

// When loading the room, load any pre‑existing messages.
socket.on('loadMessages', (messages) => {
 messages.forEach(msg => {
  const blockBody = createBlock(msg);
  blocks[msg._id] = blockBody;
  World.add(world, blockBody);
 });
});

// When we receive artifact seed
socket.on('artifactSeed', (data) => {
 artifactSeed = data.seed;
 createArtifacts(artifactSeed);
});

// When player list updates
socket.on('playerList', (players) => {
 // updatePlayersList(players); // Removed player list update

 // Find this player's index
 playerIndex = players.findIndex(player => player.userId === userId);
 if (playerIndex >= 0) {
  // Chat box position is now FIXED, remove dynamic positioning
  // const chatBox = document.getElementById('chat');
  // const spawnPos = playerSpawnPositions[playerIndex % 4];
  // chatBox.style.transition = 'all 0.5s ease';
  // chatBox.style.left = `${spawnPos.x}px`;
  // chatBox.style.top = `${spawnPos.y}px`;
 }
});


// When a new message arrives: fade out existing messages, then add the new one.
// When a new message arrives: fade out only messages from the same user
socket.on('newMessage', (msg) => {
 // Lower opacity only for blocks from the same user
 for (let id in blocks) {
  let block = blocks[id];
  if (block.userId === msg.userId) { // Modified condition: Only reduce opacity of messages from the same user.
   block.targetOpacity = Math.max(0, block.targetOpacity - 10);
  }
 }
 const blockBody = createBlock(msg);
 blocks[msg._id] = blockBody;
 World.add(world, blockBody);
});

// When a block's opacity is updated (from server command).
socket.on('updateOpacity', (data) => {
 if (blocks[data.id]) {
  blocks[data.id].targetOpacity = data.opacity;
 }
});

// When a message is removed (opacity reached 0).
socket.on('removeMessage', (data) => {
 if (blocks[data.id]) {
  World.remove(world, blocks[data.id]);
  delete blocks[data.id];
 }
});

// When another user sends input (drag, throw, etc.)
socket.on('userInput', (data) => {
 if (data.type === 'drag' && blocks[data.messageId]) {
  let block = blocks[data.messageId];
  // Only update if the input is from the owner but not ourselves
  if (block.userId === data.userId && data.userId !== userId) {
   Body.setPosition(block, { x: data.x, y: data.y });
   Body.setVelocity(block, { x: 0, y: 0 });
  }
 } else if (data.type === 'throw' && blocks[data.messageId]) {
  let block = blocks[data.messageId];
  // Only update if the input is from the owner but not ourselves
  if (block.userId === data.userId && data.userId !== userId) {
   Body.setVelocity(block, { x: data.vx, y: data.vy });
  }
 }
});
// Background ripple/impact effect system
const backgroundEffects = [];

// Color palette for a cozy, abstract feel
const bgColors = [
 'rgba(65, 54, 89, 0.3)',  // Deep purple
 'rgba(45, 74, 83, 0.3)',  // Teal
 'rgba(87, 61, 28, 0.3)',  // Warm brown
 'rgba(92, 45, 70, 0.3)'   // Burgundy
];

class BackgroundRipple {
 constructor(x, y, impact) {
  this.x = x;
  this.y = y;
  this.radius = 5;
  this.maxRadius = 75 + impact * 200; // Make ripples "louder" - INCREASED maxRadius
  this.opacity = 0.7;
  this.expandSpeed = 1.5 + impact * 3; // Make ripples "louder" - INCREASED expandSpeed
  this.color = bgColors[Math.floor(Math.random() * bgColors.length)];
  this.rotationAngle = Math.random() * Math.PI * 2;
  this.rotationSpeed = (Math.random() - 0.5) * 0.02;
  // Shape variance (0 = circle, 1 = more abstract)
  this.variance = Math.random() * 0.4;
  this.variances = [];
  for (let i = 0; i < 8; i++) {
   this.variances.push((Math.random() - 0.5) * this.variance);
  }
 }

 update() {
  this.radius += this.expandSpeed;
  this.expandSpeed *= 0.98; // Slow down expansion
  this.opacity *= 0.975;   // Fade out
  this.rotationAngle += this.rotationSpeed;
  return this.opacity > 0.01 && this.radius < this.maxRadius;
 }

 draw(ctx) {
  ctx.save();
  ctx.globalAlpha = this.opacity;
  ctx.fillStyle = this.color;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 0.5;

  // Draw abstract, organic shape
  ctx.beginPath();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.rotationAngle);

  const points = 8;
  for (let i = 0; i < points; i++) {
   const angle = (i / points) * Math.PI * 2;
   const radiusVariance = this.radius * (1 + this.variances[i]);
   const x = Math.cos(angle) * radiusVariance;
   const y = Math.sin(angle) * radiusVariance;

   if (i === 0) {
    ctx.moveTo(x, y);
   } else {
    // Use bezier curves for smoother, organic shapes
    const prevAngle = ((i - 1) / points) * Math.PI * 2;
    const prevX = Math.cos(prevAngle) * this.radius * (1 + this.variances[i - 1]);
    const prevY = Math.sin(prevAngle) * this.radius * (1 + this.variances[i - 1]);

    const cp1x = prevX + Math.cos(angle - Math.PI / 2) * this.radius * 0.5;
    const cp1y = prevY + Math.sin(angle - Math.PI / 2) * this.radius * 0.5;
    const cp2x = x + Math.cos(angle + Math.PI / 2) * this.radius * 0.5;
    const cp2y = y + Math.sin(angle + Math.PI / 2) * this.radius * 0.5;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
   }
  }

  // Close the path back to the first point
  const firstAngle = 0;
  const firstX = Math.cos(firstAngle) * this.radius * (1 + this.variances[0]);
  const firstY = Math.sin(firstAngle) * this.radius * (1 + this.variances[0]);

  const lastAngle = ((points - 1) / points) * Math.PI * 2;
  const lastX = Math.cos(lastAngle) * this.radius * (1 + this.variances[points - 1]);
  const lastY = Math.sin(lastAngle) * this.radius * (1 + this.variances[points - 1]);

  const cp1x = lastX + Math.cos(firstAngle - Math.PI / 2) * this.radius * 0.5;
  const cp1y = lastY + Math.sin(firstAngle - Math.PI / 2) * this.radius * 0.5;
  const cp2x = firstX + Math.cos(firstAngle + Math.PI / 2) * this.radius * 0.5;
  const cp2y = firstY + Math.sin(firstAngle + Math.PI / 2) * this.radius * 0.5;

  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, firstX, firstY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
 }
}


// Add collision detection to create ripples
Events.on(engine, 'collisionStart', (event) => {
 event.pairs.forEach((pair) => {
  // Calculate collision impact based on velocity difference
  const bodyA = pair.bodyA;
  const bodyB = pair.bodyB;

  // Skip walls
  if (bodyA.isStatic && bodyB.isStatic) return;

  // Calculate impact force
  const velDiffX = bodyA.velocity.x - bodyB.velocity.x;
  const velDiffY = bodyA.velocity.y - bodyB.velocity.y;
  const impactForce = Math.sqrt(velDiffX * velDiffX + velDiffY * velDiffY);

  // Only create effects for significant collisions
  if (impactForce > 1) {
   // Calculate collision position
   const collisionPoint = pair.collision.supports[0] || {
    x: (bodyA.position.x + bodyB.position.x) / 2,
    y: (bodyA.position.y + bodyB.position.y) / 2
   };

   // Create new ripple at collision point
   const normalizedImpact = Math.min(1, impactForce / 10);
   backgroundEffects.push(new BackgroundRipple(
    collisionPoint.x,
    collisionPoint.y,
    normalizedImpact
   ));
  }
 });
});

// Update the render function to draw background effects
function render() {
 // Clear the canvas first
 ctx.clearRect(0, 0, canvas.width, canvas.height);

 // Night sky background - UPDATED BACKGROUND
 const gradient = ctx.createRadialGradient(
  WIDTH / 2, HEIGHT / 2, 0,
  WIDTH / 2, HEIGHT / 2, Math.max(WIDTH, HEIGHT) / 2
 );
 gradient.addColorStop(0, '#090423');   // Darker purple/blue - Center of night sky
 gradient.addColorStop(0.5, '#12122b'); // Slightly lighter
 gradient.addColorStop(1, '#0a0a1a');   // Dark grey/black - Edges of night sky
 ctx.fillStyle = gradient;
 ctx.fillRect(0, 0, WIDTH, HEIGHT);


 // Update and draw background effects
 for (let i = backgroundEffects.length - 1; i >= 0; i--) {
  if (!backgroundEffects[i].update()) {
   backgroundEffects.splice(i, 1);
  } else {
   backgroundEffects[i].draw(ctx);
  }
 }

 // Update physics engine
 Engine.update(engine, 1000 / 60);
 // ctx.clearRect(0, 0, canvas.width, canvas.height); // No need to clear again, already cleared at the start of render

 // Draw blocks
 Object.values(blocks).forEach(block => {
  // Smooth opacity transition with improved easing
  if (block.targetOpacity !== undefined) {
   const lerpFactor = 0.05; // Slower for smoother transitions
   block.opacity += (block.targetOpacity - block.opacity) * lerpFactor;
  }

  ctx.save();
  ctx.translate(block.position.x, block.position.y);
  ctx.rotate(block.angle);

  ctx.globalAlpha = block.opacity / 100;
  const gradient = ctx.createLinearGradient(-block.width / 2, -block.height / 2, block.width / 2, block.height / 2);
  gradient.addColorStop(0, block.color1);
  gradient.addColorStop(1, block.color2);
  ctx.fillStyle = gradient;

  // Draw rounded rectangle.
  const radius = 15;
  ctx.beginPath();
  ctx.moveTo(-block.width / 2 + radius, -block.height / 2);
  ctx.lineTo(block.width / 2 - radius, -block.height / 2);
  ctx.quadraticCurveTo(block.width / 2, -block.height / 2, block.width / 2, -block.height / 2 + radius);
  ctx.lineTo(block.width / 2, block.height / 2 - radius);
  ctx.quadraticCurveTo(block.width / 2, block.height / 2, block.width / 2 - radius, block.height / 2);
  ctx.lineTo(-block.width / 2 + radius, block.height / 2);
  ctx.quadraticCurveTo(-block.width / 2, block.height / 2, -block.width / 2, block.height / 2 - radius);
  ctx.lineTo(-block.width / 2, -block.height / 2 + radius);
  ctx.quadraticCurveTo(-block.width / 2, -block.height / 2, -block.width / 2 + radius, -block.height / 2);
  ctx.closePath();
  ctx.fill();

  // Draw the message text.
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = block.text.split('\n');
  const lineHeight = 25;
  const totalTextHeight = lineHeight * lines.length;
  lines.forEach((line, i) => {
   ctx.fillText(line, 0, -totalTextHeight / 2 + lineHeight / 2 + i * lineHeight);
  });
  ctx.restore();
 });

 // In the render function, update the fan drawing code

 // Draw artifacts - only fans now
 Object.values(artifacts).forEach(artifact => {
  if (artifact.type === 'fan') {
   ctx.save();
   ctx.translate(artifact.position.x, artifact.position.y);
   ctx.rotate(artifact.angle);

   // Fan base - smaller and more clearly attached to ground
   ctx.fillStyle = 'rgba(100, 100, 100, 0.9)';
   ctx.fillRect(-40, -5, 80, 10);

   // Visual indicator of fan's effect area -  Slightly more prominent
   ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; // Increased opacity
   ctx.lineWidth = 1.5; // Increased line width
   ctx.beginPath();
   ctx.moveTo(-40, 0);
   ctx.lineTo(-100, -300);
   ctx.lineTo(100, -300);
   ctx.lineTo(40, 0);
   ctx.closePath();
   ctx.stroke();

   // Draw fan blades - SHARPER, SPIKE-LIKE PARTICLES
   ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
   const fanAngle = (Date.now() / 100) % (Math.PI * 2);
   for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(fanAngle + (i * Math.PI * 2 / 3));
    ctx.beginPath(); // Sharp, modern blade shape - TRIANGLE BLADE
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, -30);
    ctx.lineTo(10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
   }

   ctx.restore();
  }
 });

 // Draw Walls - MORE PROMINENT WALLS
 ctx.fillStyle = 'rgba(150, 150, 150, 0.8)'; // Grey color for walls, more prominent
 walls.forEach(wall => {
  ctx.fillRect(
   wall.bounds.min.x,
   wall.bounds.min.y,
   wall.bounds.max.x - wall.bounds.min.x,
   wall.bounds.max.y - wall.bounds.min.y
  );
 });


 // Update and draw particles
 for (let i = particles.length - 1; i >= 0; i--) {
  if (!particles[i].update()) {
   particles.splice(i, 1);
  } else {
   particles[i].draw(ctx);
  }
 }

 requestAnimationFrame(render);
}

// Start the render loop
requestAnimationFrame(render);

// Physics engine interaction handling
Events.on(engine, 'afterUpdate', () => {
 // Apply forces from artifacts
 Object.values(artifacts).forEach(artifact => {
  if (artifact.type === 'fan') {
   // Fan blows blocks upward with stronger force
   Object.values(blocks).forEach(block => {
    const dx = block.position.x - artifact.position.x;
    const dy = block.position.y - artifact.position.y;

    // Only affect blocks above the fan and within range
    if (Math.abs(dx) < 200 && dy < 0 && dy > -400) {
     // Stronger force for more realistic fan effect
     const forceY = artifact.strength * (1 - Math.abs(dy) / 400) * (1 - Math.abs(dx) / 200) * 3;
     const forceX = (dx / 200) * forceY * 0.3; // Slight horizontal force based on position

     Body.applyForce(block, block.position, {
      x: forceX,
      y: -forceY
     });
    }
   });

   // Generate more particles for the fan
   if (Math.random() < 0.5) {
    for (let i = 0; i < 5; i++) {
     particles.push(new Particle(
      artifact.position.x + (Math.random() - 0.5) * 80,
      artifact.position.y,
      (Math.random() - 0.5) * 2,
      -Math.random() * 5 - 3
     ));
    }
   }
  }
 });
});

// Create a mouse constraint for more natural interactions
const mouse = Mouse.create(canvas);
const mouseConstraint = MouseConstraint.create(engine, {
 mouse: mouse,
 constraint: {
  stiffness: 0.2,
  render: {
   visible: false
  }
 }
});

// Add the mouse constraint to the world
World.add(world, mouseConstraint);

// --- Drag and Throw Logic now using Matter.js mouse constraint ---
// This will allow for pivot-like behavior and natural physics interactions

// Track when a block is being manipulated by this client
let activeBlock = null;
let lastMousePos = { x: 0, y: 0 };
let velocities = [];

// Listen for mouse down events on blocks
Events.on(mouseConstraint, 'startdrag', function (event) {
 if (event.body && event.body.messageId) {
  // Only allow manipulation of your own blocks
  if (event.body.userId === userId) {
   activeBlock = event.body;
   velocities = [];
   lastMousePos = { x: mouse.position.x, y: mouse.position.y };

   // Send drag start to others
   socket.emit('userInput', {
    type: 'drag',
    room: roomId,
    messageId: activeBlock.messageId,
    userId: userId,
    x: activeBlock.position.x,
    y: activeBlock.position.y
   });
  }
 }
});

// Track mouse movement for velocity calculation
canvas.addEventListener('mousemove', (e) => {
 const rect = canvas.getBoundingClientRect();
 const mouseX = e.clientX - rect.left;
 const mouseY = e.clientY - rect.top;

 if (activeBlock) {
  // Store velocity data
  velocities.push({
   x: mouseX - lastMousePos.x,
   y: mouseY - lastMousePos.y,
   time: Date.now()
  });

  // Keep only the last 5 velocity measurements
  if (velocities.length > 5) {
   velocities.shift();
  }

  // Send position updates
  socket.emit('userInput', {
   type: 'drag',
   room: roomId,
   messageId: activeBlock.messageId,
   userId: userId,
   x: activeBlock.position.x,
   y: activeBlock.position.y
  });
 }

 lastMousePos = { x: mouseX, y: mouseY };
});

// Handle end of drag
Events.on(mouseConstraint, 'enddrag', function (event) {
 if (activeBlock) {
  // Calculate throw velocity based on recent mouse movements
  let vx = 0, vy = 0, count = 0;
  const now = Date.now();
  const recentVelocities = velocities.filter(v => now - v.time < 100);

  if (recentVelocities.length > 0) {
   recentVelocities.forEach(v => {
    vx += v.x;
    vy += v.y;
    count++;
   });

   vx = (vx / count) * 0.2; // Scale factor for throw strength
   vy = (vy / count) * 0.2;

   // Apply the throw velocity (Matter.js will do this naturally,
   // but we boost it slightly for better feedback)
   const currentVel = activeBlock.velocity;
   Body.setVelocity(activeBlock, {
    x: currentVel.x + vx * 0.5,
    y: currentVel.y + vy * 0.5
   });

   // Send throw event to other clients
   socket.emit('userInput', {
    type: 'throw',
    room: roomId,
    messageId: activeBlock.messageId,
    userId: userId,
    vx: currentVel.x + vx * 0.5,
    vy: currentVel.y + vy * 0.5
   });
  }

  activeBlock = null;
  velocities = [];
 }
});

// In client.js, add player spawn positions management

// Create different spawn positions for each player (4 corners)
const playerSpawnPositions = { // Spawn point in center - UPDATED SPAWN POINTS
 0: { x: WIDTH / 2, y: HEIGHT / 2 }
};

let playerIndex = 0; // Will be set when joining room

// Modify the joinRoom handler - Player list update moved to playerList event

// Modify sendMessage function to use player's spawn position
function sendMessage() {
 const input = document.getElementById('messageInput');
 const text = input.value.trim();

 // Automatically insert newline for long sentences before sending
 const words = text.split(' ');
 let line = '';
 let formattedText = '';
 for (const word of words) {
  if (line.length + word.length + 1 > 30) { // Adjust 30 as needed for line length
   formattedText += line.trim() + '\n';
   line = word + ' ';
  } else {
   line += word + ' ';
  }
 }
 formattedText += line.trim();
 const processedText = formattedText;


 if (!processedText) return;

 // Get spawn position based on player index
 const spawnPos = playerSpawnPositions[playerIndex % 1]; // Use modulo 1 for single center spawn

 const blockData = {
  room: roomId,
  text: processedText, // Use processed text with line breaks
  x: spawnPos.x,
  y: spawnPos.y - 50, // Slightly above spawn point
  userId,
  color1: userColors.color1,
  color2: userColors.color2,
  opacity: 100
 };

 socket.emit('newMessage', blockData);
 input.value = '';
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keydown', (e) => {
 if (e.shiftKey && e.key === 'Enter') {
  e.preventDefault();
  sendMessage();
 }
});


// ---  Ambient Background Update for Breathing Effect  ---
class AmbientBackground {
 constructor() {
  this.points = [];
  this.numPoints = 12;
  for (let i = 0; i < this.numPoints; i++) {
   this.points.push({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.2,
    size: Math.random() * 100 + 50,
    // More vibrant colors with higher opacity
    color: bgColors[Math.floor(Math.random() * bgColors.length)].replace('0.3', '0.5')
   });
  }
 }

 update() {
  this.points.forEach(point => {
   // Move points gently
   point.x += point.vx;
   point.y += point.vy;

   // Bounce off edges with dampening
   if (point.x < 0 || point.x > WIDTH) {
    point.vx *= -0.8;
    point.x = Math.max(0, Math.min(WIDTH, point.x));
   }
   if (point.y < 0 || point.y > HEIGHT) {
    point.vy *= -0.8;
    point.y = Math.max(0, Math.min(HEIGHT, point.y));
   }

   // Apply slight random movement
   if (Math.random() < 0.05) {
    point.vx += (Math.random() - 0.5) * 0.1;
    point.vy += (Math.random() - 0.5) * 0.1;
   }

   // Limit velocity
   const maxVel = 0.5;
   const vel = Math.sqrt(point.vx * point.vx + point.vy * point.vy);
   if (vel > maxVel) {
    point.vx = (point.vx / vel) * maxVel;
    point.vy = (point.vy / vel) * maxVel;
   }
  });
 }
 draw(ctx) {
  // Draw more vibrant background
  const gradient = ctx.createRadialGradient(
   WIDTH / 2, HEIGHT / 2, 0,
   WIDTH / 2, HEIGHT / 2, WIDTH / 2
  );
  gradient.addColorStop(0, '#1a1a2e');
  gradient.addColorStop(1, '#121212');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Draw each ambient point with higher opacity and breathing effect
  this.points.forEach(point => {
   const gradient = ctx.createRadialGradient(
    point.x, point.y, 0,
    point.x, point.y, point.size
   );
   // Make inner color more vibrant
   const color = point.color.replace('rgba', 'rgba').replace('0.5', '0.7');
   gradient.addColorStop(0, color);
   gradient.addColorStop(0.7, color.replace('0.7', '0.3')); // Add middle stop
   gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

   ctx.fillStyle = gradient;
   ctx.beginPath();
   ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
   // Breathing effect - modulate opacity with sine wave
   const opacityFactor = 0.8 + 0.2 * Math.sin(Date.now() / 1000); // Opacity between 0.6 and 1
   ctx.globalAlpha = opacityFactor;
   ctx.fill();
   ctx.globalAlpha = 1; // Reset alpha
  });
 }
}