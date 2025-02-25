// client.js
const socket = io();

// Get or generate userId.
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = Math.random().toString(36).substring(2, 10);
  localStorage.setItem('userId', userId);
}

// Fetch user colors from server.
let userColors = { color1: '#00AAFF', color2: '#FFFFFF' };
function updateUserColorDisplay() {
  const div = document.getElementById('userColors');
  if (div) div.textContent = `Your Gradient: ${userColors.color1} to ${userColors.color2}`;
  const gradDiv = document.getElementById('gradientDisplayRoom');
  if (gradDiv) gradDiv.style.background = `linear-gradient(45deg, ${userColors.color1}, ${userColors.color2})`;
}
fetch(`/api/user/${userId}`)
  .then(res => res.json())
  .then(data => {
    userColors = data;
    updateUserColorDisplay();
  })
  .catch(err => console.error(err));

// Room setup.
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
  alert('No room specified.');
  window.location.href = '/';
}
document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;

// Listen for room errors.
socket.on('roomError', (msg) => {
  alert(msg);
  window.location.href = '/';
});

// Join room.
socket.emit('joinRoom', { room: roomId, userId });

// Canvas setup.
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
const blocks = {};

// Helper: Create a block object for rendering.
function createBlock(msg) {
  const lines = msg.text.split('\n');
  const longestLine = Math.max(...lines.map(line => line.length));
  const width = Math.max(50, 10 * longestLine);
  const height = 25 * lines.length + 20;
  return {
    id: msg._id,
    text: msg.text,
    x: msg.x || canvas.width / 2,
    y: msg.y || canvas.height / 2,
    angle: msg.angle || 0,
    width,
    height,
    color1: msg.color1,
    color2: msg.color2,
    opacity: msg.opacity !== undefined ? msg.opacity : 100,
    userId: msg.userId,
  };
}

// Load initial messages.
socket.on('loadMessages', (messages) => {
  messages.forEach(msg => {
    blocks[msg._id] = createBlock(msg);
  });
});

// New message received.
socket.on('newMessage', (msg) => {
  blocks[msg._id] = createBlock(msg);
});

// Update position updates.
socket.on('updatePosition', (data) => {
  const block = blocks[data.id];
  if (block) {
    block.x = data.x;
    block.y = data.y;
    block.angle = data.angle;
  }
});

// Listen for opacity updates.
socket.on('updateOpacity', (data) => {
  const block = blocks[data.id];
  if (block) {
    block.opacity = data.opacity;
  }
});

// Remove message.
socket.on('removeMessage', (data) => {
  delete blocks[data.id];
});

// Send new message.
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  const chatRect = document.getElementById('chat').getBoundingClientRect();
  const x = chatRect.left + chatRect.width / 2;
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

// Render loop with opacity applied.
// Render loop with smooth opacity transition
function renderBlocks() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  Object.values(blocks).forEach(block => {
    // If a target opacity is set, interpolate toward it:
    if (block.targetOpacity !== undefined) {
      const lerpFactor = 0.1; // adjust for smoother or faster transition
      block.opacity += (block.targetOpacity - block.opacity) * lerpFactor;
    }
    
    ctx.save();
    ctx.translate(block.x, block.y);
    ctx.rotate(block.angle);
    
    // Apply opacity transition for the block's fill
    ctx.globalAlpha = block.opacity / 100; // scale 0-100 to 0-1
    const gradient = ctx.createLinearGradient(-block.width/2, -block.height/2, block.width/2, block.height/2);
    gradient.addColorStop(0, block.color1);
    gradient.addColorStop(1, block.color2);
    ctx.fillStyle = gradient;
    
    const radius = 15;
    ctx.beginPath();
    ctx.moveTo(-block.width/2 + radius, -block.height/2);
    ctx.lineTo(block.width/2 - radius, -block.height/2);
    ctx.quadraticCurveTo(block.width/2, -block.height/2, block.width/2, -block.height/2 + radius);
    ctx.lineTo(block.width/2, block.height/2 - radius);
    ctx.quadraticCurveTo(block.width/2, block.height/2, block.width/2 - radius, block.height/2);
    ctx.lineTo(-block.width/2 + radius, block.height/2);
    ctx.quadraticCurveTo(-block.width/2, block.height/2, -block.width/2, block.height/2 - radius);
    ctx.lineTo(-block.width/2, -block.height/2 + radius);
    ctx.quadraticCurveTo(-block.width/2, -block.height/2, -block.width/2 + radius, -block.height/2);
    ctx.closePath();
    ctx.fill();
    
    // Draw text with full opacity (reset alpha)
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = block.text.split('\n');
    const lineHeight = 25;
    const totalTextHeight = lineHeight * lines.length;
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, -totalTextHeight/2 + lineHeight/2 + i * lineHeight);
    });
    ctx.restore();
  });
  
  requestAnimationFrame(renderBlocks);
}
requestAnimationFrame(renderBlocks);


// Drag logic – send drag events to the server.
let dragging = null;
let offsetX = 0, offsetY = 0;
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  let found = null;
  const blockIds = Object.keys(blocks);
  for (let i = blockIds.length - 1; i >= 0; i--) {
    const b = blocks[blockIds[i]];
    const left = b.x - b.width/2;
    const right = b.x + b.width/2;
    const top = b.y - b.height/2;
    const bottom = b.y + b.height/2;
    if (mouseX >= left && mouseX <= right && mouseY >= top && mouseY <= bottom) {
      found = b;
      break;
    }
  }
  if (found && found.userId === userId) {
    dragging = found;
    offsetX = mouseX - found.x;
    offsetY = mouseY - found.y;
  }
});
canvas.addEventListener('mousemove', (e) => {
  if (dragging) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const newX = mouseX - offsetX;
    const newY = mouseY - offsetY;
    socket.emit('dragBlock', {
      room: roomId,
      messageId: dragging.id,
      userId,
      x: newX,
      y: newY,
    });
  }
});
canvas.addEventListener('mouseup', () => { dragging = null; });
canvas.addEventListener('mouseleave', () => { dragging = null; });

