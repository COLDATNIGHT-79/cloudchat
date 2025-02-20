// client.js
const socket = io();

// Grab the room from URL
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
  // If no room, go back to index
  window.location.href = '/';
}

document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;

// Join the room
socket.emit('joinRoom', roomId);

// Matter.js Setup
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

const engine = Engine.create();
const world = engine.world;

// Lower gravity a bit for a lighter feel
engine.world.gravity.y = 0.7;

// Canvas
const canvas = document.getElementById('world');
const render = Render.create({
  canvas,
  engine,
  options: {
    width: 1024,
    height: 768,
    wireframes: false,
    background: '#181818',
  },
});
Render.run(render);
const runner = Runner.create();
Runner.run(runner, engine);

// Boundaries
const thickness = 50;
const boundaries = [
  Bodies.rectangle(512, -thickness / 2, 1024, thickness, { isStatic: true }),
  Bodies.rectangle(512, 768 + thickness / 2, 1024, thickness, { isStatic: true }),
  Bodies.rectangle(-thickness / 2, 384, thickness, 768, { isStatic: true }),
  Bodies.rectangle(1024 + thickness / 2, 384, thickness, 768, { isStatic: true }),
];
Composite.add(world, boundaries);

// Mouse constraint (works on mobile too)
const mouse = Mouse.create(render.canvas);
const mouseConstraint = MouseConstraint.create(engine, { mouse });
Composite.add(world, mouseConstraint);

// Store blocks by ID
const blocks = {};

// Helper: measure multi-line text to size blocks
function getMaxLineWidth(ctx, lines) {
  let max = 0;
  lines.forEach(line => {
    const w = ctx.measureText(line).width;
    if (w > max) max = w;
  });
  return max;
}

// Create block
function createMessageBlock(msg) {
  const lines = msg.text.split('\n');
  const tmpCanvas = document.createElement('canvas');
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.font = '16px Arial';
  const blockWidth = Math.max(120, getMaxLineWidth(tmpCtx, lines) + 20);
  const blockHeight = Math.max(50, lines.length * 20 + 10);

  // Position exactly at the chat box location
  // We'll use the chat container's bottom-left as the spawn point
  const chatRect = document.getElementById('chat').getBoundingClientRect();
  const x = msg.x || (chatRect.left + chatRect.width / 2);
  const y = msg.y || (chatRect.top + chatRect.height / 2);

  // Random color
  const color = `hsl(${Math.random() * 360}, 70%, 50%)`;

  // Let’s define mass based on area
  const area = blockWidth * blockHeight;
  const density = 0.0004 * area; // Adjust for a lighter or heavier feel

  const block = Bodies.rectangle(x, y, blockWidth, blockHeight, {
    chamfer: { radius: 10 },
    friction: 0.6,
    frictionAir: 0.02,
    restitution: 0.1,
    density,
    render: { fillStyle: color },
    label: msg.text,
  });
  block.messageId = msg._id || Common.nextId();
  block.text = msg.text;
  Composite.add(world, block);
  blocks[block.messageId] = block;
  return block;
}

// Animate chat fade
const chatDiv = document.getElementById('chat');
function animateChatFade(cb) {
  chatDiv.style.opacity = 0;
  setTimeout(() => {
    if (cb) cb();
    setTimeout(() => {
      chatDiv.style.opacity = 1;
    }, 200);
  }, 200);
}

// Send message
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;

  // We'll spawn from the chat container's position
  const chatRect = chatDiv.getBoundingClientRect();
  const x = chatRect.left + chatRect.width / 2;
  const y = chatRect.top + chatRect.height / 2;

  const message = { room: roomId, text, x, y };
  animateChatFade(() => {
    socket.emit('newMessage', message);
  });
  input.value = '';
}

// Listen for button click or Shift+Enter
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Socket events
socket.on('loadMessages', (msgs) => {
  msgs.forEach((m) => createMessageBlock(m));
});

socket.on('newMessage', (m) => {
  createMessageBlock(m);
});

// On drag end, broadcast new position
Events.on(mouseConstraint, 'enddrag', (evt) => {
  const body = evt.body;
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

socket.on('updatePosition', (data) => {
  const block = blocks[data.id];
  if (block) {
    Body.setPosition(block, { x: data.x, y: data.y });
    Body.setAngle(block, data.angle);
  }
});

// Draw multi-line text
Events.on(render, 'afterRender', () => {
  const ctx = render.context;
  ctx.font = '16px Arial';
  ctx.fillStyle = '#ffffff';
  for (let id in blocks) {
    const block = blocks[id];
    const pos = block.position;
    const angle = block.angle;
    const lines = block.text.split('\n');

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);
    lines.forEach((line, i) => {
      const lineWidth = ctx.measureText(line).width;
      // center each line, 20px apart
      ctx.fillText(line, -lineWidth / 2, -(lines.length - 1) * 10 + i * 20);
    });
    ctx.restore();
  }
});
