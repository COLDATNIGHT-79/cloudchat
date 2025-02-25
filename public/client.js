/**
 * client.js
 *
 * This file assumes that the HTML has:
 *   - A canvas with id="world"
 *   - Elements with ids "roomIdDisplay", "userColors", "gradientDisplayRoom", "chat", "messageInput", and "sendBtn"
 */
const socket = io();

// Get or generate userId
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = Math.random().toString(36).substring(2, 10);
  localStorage.setItem('userId', userId);
}

// Fetch user colors
let userColors = { color1: '#66d76', color2: '#b8e9a7' };
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

// Read room id from URL
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
  alert('No room specified.');
  window.location.href = '/';
}
document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;

// Handle room error
socket.on('roomError', (msg) => {
  alert(msg);
  window.location.href = '/';
});

// Join room
socket.emit('joinRoom', { room: roomId, userId });

// Canvas and rendering
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

// Store blocks (messages) for rendering
const blocks = {};

// Helper: create a block object from a message
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
    userId: msg.userId,
  };
}

// Load initial messages
socket.on('loadMessages', (messages) => {
  messages.forEach((msg) => {
    blocks[msg._id] = createBlock(msg);
  });
});

// New message added
socket.on('newMessage', (msg) => {
  blocks[msg._id] = createBlock(msg);
});

// Update positions from server
socket.on('updatePosition', (data) => {
  const b = blocks[data.id];
  if (b) {
    b.x = data.x;
    b.y = data.y;
    b.angle = data.angle;
  }
});

// Send a new message
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

// Render loop: draw all blocks
function renderBlocks() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  Object.values(blocks).forEach(b => {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    
    // Draw gradient rectangle
    const gradient = ctx.createLinearGradient(-b.width/2, -b.height/2, b.width/2, b.height/2);
    gradient.addColorStop(0, b.color1);
    gradient.addColorStop(1, b.color2);
    ctx.fillStyle = gradient;
    
    const radius = 15;
    ctx.beginPath();
    ctx.moveTo(-b.width/2 + radius, -b.height/2);
    ctx.lineTo(b.width/2 - radius, -b.height/2);
    ctx.quadraticCurveTo(b.width/2, -b.height/2, b.width/2, -b.height/2 + radius);
    ctx.lineTo(b.width/2, b.height/2 - radius);
    ctx.quadraticCurveTo(b.width/2, b.height/2, b.width/2 - radius, b.height/2);
    ctx.lineTo(-b.width/2 + radius, b.height/2);
    ctx.quadraticCurveTo(-b.width/2, b.height/2, -b.width/2, b.height/2 - radius);
    ctx.lineTo(-b.width/2, -b.height/2 + radius);
    ctx.quadraticCurveTo(-b.width/2, -b.height/2, -b.width/2 + radius, -b.height/2);
    ctx.closePath();
    ctx.fill();
    
    // Draw text
    ctx.fillStyle = '#fff';
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = b.text.split('\n');
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

// --- Dragging using Server MouseConstraint ---
let dragging = null;
let offsetX = 0;
let offsetY = 0;

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Find the top-most block under the cursor
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
  // Only allow dragging if the user owns the block
  if (found && found.userId === userId) {
    dragging = found;
    offsetX = mouseX - found.x;
    offsetY = mouseY - found.y;
    socket.emit('startDrag', {
      room: roomId,
      messageId: found.id,
      userId,
      x: mouseX,
      y: mouseY,
    });
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (dragging) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    socket.emit('dragMove', { x: mouseX, y: mouseY });
  }
});

canvas.addEventListener('mouseup', () => {
  if (dragging) {
    socket.emit('endDrag');
    dragging = null;
  }
});

canvas.addEventListener('mouseleave', () => {
  if (dragging) {
    socket.emit('endDrag');
    dragging = null;
  }
});
