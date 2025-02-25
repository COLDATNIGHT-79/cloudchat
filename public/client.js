// client.js
const socket = io();

// Get persistent userId.
let userId = localStorage.getItem('userId');

// Load user colors from server.
let userColors = { color1: '#ff0000', color2: '#0000ff' };
function updateUserColorDisplay() {
  const div = document.getElementById('userColors');
  if (div) {
    div.textContent = `Your Gradient: ${userColors.color1} to ${userColors.color2}`;
  }
  const gradDiv = document.getElementById('gradientDisplayRoom');
  if (gradDiv) {
    gradDiv.style.background = `linear-gradient(45deg, ${userColors.color1}, ${userColors.color2})`;
  }
}
fetch(`/api/user/${userId}`)
  .then(res => res.json())
  .then(data => {
    userColors = data;
    updateUserColorDisplay();
  })
  .catch(err => console.error(err));

// Read room ID from URL.
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
  alert('No room specified. Redirecting to lobby.');
  window.location.href = '/';
}
document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;

// Join room.
socket.emit('joinRoom', { room: roomId, userId });

// Matter.js setup.
const { Engine, Render, Runner, Bodies, Composite, Mouse, MouseConstraint, Events, Body, Common } = Matter;
const engine = Engine.create();
const world = engine.world;
engine.world.gravity.y = 1.0;

const canvasWidth = 1024;
const canvasHeight = 768;
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

// Create boundaries.
const thickness = 50;
const boundaries = [
  Bodies.rectangle(canvasWidth/2, -thickness/2, canvasWidth, thickness, { isStatic: true }),
  Bodies.rectangle(canvasWidth/2, canvasHeight+thickness/2, canvasWidth, thickness, { isStatic: true }),
  Bodies.rectangle(-thickness/2, canvasHeight/2, thickness, canvasHeight, { isStatic: true }),
  Bodies.rectangle(canvasWidth+thickness/2, canvasHeight/2, thickness, canvasHeight, { isStatic: true }),
];
Composite.add(world, boundaries);

// Mouse control.
const mouse = Mouse.create(render.canvas);
const mouseConstraint = MouseConstraint.create(engine, { mouse: mouse });
Composite.add(world, mouseConstraint);

// Store blocks by messageId.
const blocks = {};
const lastPositions = {};

// Create a Matter body for a message with fixed dimensions.
function createMessageBlock(msg) {
  const lines = msg.text.split('\n');
  const numLines = lines.length;
  // Compute width based on the longest line.
  const longestLine = Math.max(...lines.map(line => line.length));
  const width = Math.max(50, 10 * longestLine); // For a single character, 50px minimum.
  const height = 25 * numLines + 20; // 25px per line plus padding.
  const chamferRadius = 15; // Fixed rounded corners.

  // Spawn near the chat area.
  const chatRect = document.getElementById('chat').getBoundingClientRect();
  const x = msg.x || chatRect.left + chatRect.width/2;
  const y = msg.y || chatRect.bottom;

  const block = Bodies.rectangle(x, y, width, height, {
    chamfer: { radius: chamferRadius },
    friction: 0.9,
    frictionAir: 0.02,
    restitution: 0.1,
    render: { fillStyle: 'transparent' },
    label: msg.text,
  });
  block.messageId = msg._id || Common.nextId();
  block.text = msg.text;
  block.userId = msg.userId;
  block.color1 = msg.color1;
  block.color2 = msg.color2;
  block.customWidth = width;
  block.customHeight = height;
  Composite.add(world, block);
  return block;
}

// Load existing messages.
socket.on('loadMessages', (messages) => {
  messages.forEach((msg) => {
    const block = createMessageBlock(msg);
    blocks[block.messageId] = block;
  });
});

// New message from server.
socket.on('newMessage', (msg) => {
  const block = createMessageBlock(msg);
  blocks[block.messageId] = block;
});

// Send new message.
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  const chatRect = document.getElementById('chat').getBoundingClientRect();
  const x = chatRect.left + chatRect.width/2;
  const y = chatRect.bottom;
  const blockData = {
    room: roomId,
    text,
    x,
    y,
    userId,
    color1: userColors.color1,
    color2: userColors.color2,
  };
  input.value = '';
  socket.emit('newMessage', blockData);
}
document.getElementById('sendBtn').addEventListener('click', sendMessage);
// Allow sending via Shift+Enter.
document.getElementById('messageInput').addEventListener('keydown', (e) => {
  if (e.shiftKey && e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});

// Send position updates for blocks you own.
setInterval(() => {
  for (let id in blocks) {
    const block = blocks[id];
    if (block.userId === userId) {
      const { x, y } = block.position;
      const angle = block.angle;
      const last = lastPositions[id] || { x: 0, y: 0, angle: 0 };
      if (Math.abs(x - last.x) > 0.01 || Math.abs(y - last.y) > 0.01 || Math.abs(angle - last.angle) > 0.01) {
        socket.emit('updatePosition', { room: roomId, id, x, y, angle, userId });
        lastPositions[id] = { x, y, angle };
      }
    }
  }
}, 50);

// Update positions from server for all blocks.
socket.on('updatePosition', (data) => {
  const { id, x, y, angle } = data;
  if (blocks[id]) {
    Body.setPosition(blocks[id], { x, y });
    Body.setAngle(blocks[id], angle);
  }
});

// Allow dragging only for blocks you own.
Events.on(mouseConstraint, 'drag', (event) => {
  const body = event.body;
  if (body && body.userId === userId) {
    socket.emit('updatePosition', {
      room: roomId,
      id: body.messageId,
      x: body.position.x,
      y: body.position.y,
      angle: body.angle,
      userId,
    });
  }
});

// Custom rendering: draw each block with gradient and rounded rectangle.
Events.on(render, 'afterRender', () => {
  const context = render.context;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let id in blocks) {
    const block = blocks[id];
    const { x, y } = block.position;
    const angle = block.angle;
    const w = block.customWidth;
    const h = block.customHeight;
    const text = block.text || '';
    context.save();
    context.translate(x, y);
    context.rotate(angle);

    // Draw gradient background.
    const gradient = context.createLinearGradient(-w/2, -h/2, w/2, h/2);
    gradient.addColorStop(0, block.color1 || '#999999');
    gradient.addColorStop(1, block.color2 || '#cccccc');
    context.fillStyle = gradient;

    // Draw a rounded rectangle.
    const radius = 15;
    context.beginPath();
    context.moveTo(-w/2 + radius, -h/2);
    context.lineTo(w/2 - radius, -h/2);
    context.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + radius);
    context.lineTo(w/2, h/2 - radius);
    context.quadraticCurveTo(w/2, h/2, w/2 - radius, h/2);
    context.lineTo(-w/2 + radius, h/2);
    context.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - radius);
    context.lineTo(-w/2, -h/2 + radius);
    context.quadraticCurveTo(-w/2, -h/2, -w/2 + radius, -h/2);
    context.closePath();
    context.fill();

    // Render multi-line text.
    context.fillStyle = '#ffffff';
    context.font = '18px Arial';
    const lines = text.split('\n');
    const lineHeight = 25;
    const totalTextHeight = lineHeight * lines.length;
    lines.forEach((line, index) => {
      context.fillText(line, 0, -totalTextHeight/2 + lineHeight/2 + index * lineHeight);
    });
    context.restore();
  }
});
