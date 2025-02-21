// client.js
const socket = io();

// Read the room ID from query string, e.g. room.html?room=abc123
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
  alert('No room specified. Redirecting to lobby.');
  window.location.href = '/';
}

// Display the room ID on the page
document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;

// Join the room on the server
socket.emit('joinRoom', roomId);

// Matter.js modules
const {
  Engine,
  Render,
  Runner,
  Bodies,
  Composite,
  Mouse,
  MouseConstraint,
  Events,
  Body,
  Common,
} = Matter;

// Create the physics engine and world
const engine = Engine.create();
const world = engine.world;

// Fixed canvas dimensions
const canvasWidth = 1024;
const canvasHeight = 768;

// Adjust gravity and other parameters for a smooth drop
engine.world.gravity.y = 1.0;

// Setup canvas and rendering
const canvas = document.getElementById('world');
const render = Render.create({
  canvas: canvas,
  engine: engine,
  options: {
    width: canvasWidth,
    height: canvasHeight,
    wireframes: false,
    background: '#181818',
  },
});

Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// Create boundary walls (left, right, top, bottom)
const thickness = 50;
const boundaries = [
  // Top
  Bodies.rectangle(canvasWidth / 2, -thickness / 2, canvasWidth, thickness, { isStatic: true }),
  // Bottom
  Bodies.rectangle(canvasWidth / 2, canvasHeight + thickness / 2, canvasWidth, thickness, { isStatic: true }),
  // Left
  Bodies.rectangle(-thickness / 2, canvasHeight / 2, thickness, canvasHeight, { isStatic: true }),
  // Right
  Bodies.rectangle(canvasWidth + thickness / 2, canvasHeight / 2, thickness, canvasHeight, { isStatic: true }),
];
Composite.add(world, boundaries);

// Enable mouse control for dragging bodies
const mouse = Mouse.create(render.canvas);
const mouseConstraint = MouseConstraint.create(engine, { mouse: mouse });
Composite.add(world, mouseConstraint);

// Container to track created blocks by their message id
const blocks = {};

// Utility to create a message block with smooth physics and rounded corners
function createMessageBlock(message) {
  // Set a minimum width based on text length
  const width = Math.max(100, message.text.length * 10);
  const height = 50;
  // Starting position from chat container location
  const chatRect = document.getElementById('chat').getBoundingClientRect();
  const x = message.x || chatRect.left + chatRect.width / 2;
  const y = message.y || chatRect.bottom;
  // Random color from HSL
  const color = `hsl(${Math.random() * 360}, 70%, 50%)`;

  // Create the block with tuned parameters for natural movement
  const block = Bodies.rectangle(x, y, width, height, {
    chamfer: { radius: 10 },
    friction: 0.8,
    frictionAir: 0.03,
    restitution: 0.05,
    render: { fillStyle: color },
    label: message.text,
  });
  block.messageId = message._id || Common.nextId();
  block.text = message.text;
  // Apply some angular damping to avoid wild spins
  block.frictionAir = 0.05;
  Composite.add(world, block);
  return block;
}

// Animate chat fade out/in (simulate dialogue transforming into a block)
const chatContainer = document.getElementById('chat');
function animateChatFade(callback) {
  chatContainer.style.opacity = 0;
  setTimeout(() => {
    if (callback) callback();
    setTimeout(() => {
      chatContainer.style.opacity = 1;
    }, 200);
  }, 200);
}

// Send a new message with animation
document.getElementById('sendBtn').addEventListener('click', () => {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  const chatRect = chatContainer.getBoundingClientRect();
  const x = chatRect.left + chatRect.width / 2;
  const y = chatRect.bottom;
  const message = { room: roomId, text, x, y };

  animateChatFade(() => {
    socket.emit('newMessage', message);
  });
  input.value = '';
});

// Load stored messages when connected
socket.on('loadMessages', (messages) => {
  messages.forEach((msg) => {
    const block = createMessageBlock(msg);
    blocks[msg._id] = block;
  });
});

// Listen for new messages broadcast from server
socket.on('newMessage', (msg) => {
  const block = createMessageBlock(msg);
  blocks[msg._id] = block;
});

// When a drag ends, send updated position to others in the room
Events.on(mouseConstraint, 'enddrag', (event) => {
  const body = event.body;
  if (body) {
    socket.emit('updatePosition', {
      room: roomId,
      id: body.messageId,
      x: body.position.x,
      y: body.position.y,
      angle: body.angle,
    });
  }
});

// Listen for position updates from other clients
socket.on('updatePosition', (data) => {
  if (data.id && blocks[data.id]) {
    Body.setPosition(blocks[data.id], { x: data.x, y: data.y });
    Body.setAngle(blocks[data.id], data.angle);
  }
});

// Draw text on each block that rotates with the block
Events.on(render, 'afterRender', () => {
  const context = render.context;
  context.font = '16px Arial';
  context.fillStyle = '#ffffff';
  for (let id in blocks) {
    const block = blocks[id];
    const pos = block.position;
    const angle = block.angle;
    const text = block.text;
    const textWidth = context.measureText(text).width;

    context.save();
    context.translate(pos.x, pos.y);
    context.rotate(angle);
    context.fillText(text, -textWidth / 2, 5);
    context.restore();
  }
});

