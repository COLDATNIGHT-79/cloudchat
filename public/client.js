// client.js
const socket = io();

// Get persistent userId.
let userId = localStorage.getItem('userId');
if (!userId) {
  userId = Math.random().toString(36).substring(2, 10);
  localStorage.setItem('userId', userId);
}

// Load user colors from server.
let userColors = { color1: '#00AAFF', color2: '#FFFFFF' };
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

// Read room ID from query string.
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
  alert('No room specified. Redirecting to lobby.');
  window.location.href = '/';
}
document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;

// Listen for room errors (e.g. too many users)
socket.on('roomError', (msg) => {
  alert(msg);
  window.location.href = '/';
});

// Join room.
socket.emit('joinRoom', { room: roomId, userId });

// --- Rendering Setup ---
// We use a canvas for rendering messages.
// For simplicity, we do not run a full local physics simulation.
// Instead, we store message block positions from the server and redraw them.
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

// We'll store message blocks in an object keyed by message id.
const blocks = {};

// Create a message block object for rendering.
function createMessageBlock(msg) {
  // Calculate dimensions based on text content.
  const lines = msg.text.split('\n');
  const longestLine = Math.max(...lines.map(line => line.length));
  const width = Math.max(50, 10 * longestLine);
  const height = 25 * lines.length + 20;
  
  // Starting position; later updated via server events.
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

// Render all message blocks.
function renderBlocks() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  Object.values(blocks).forEach(block => {
    ctx.save();
    ctx.translate(block.x, block.y);
    ctx.rotate(block.angle);
    
    // Create gradient background.
    const gradient = ctx.createLinearGradient(-block.width / 2, -block.height / 2, block.width / 2, block.height / 2);
    gradient.addColorStop(0, block.color1);
    gradient.addColorStop(1, block.color2);
    ctx.fillStyle = gradient;
    
    // Draw rounded rectangle.
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
    
    // Render multi-line text.
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = 25;
    const totalTextHeight = lineHeight * lines.length;
    const textLines = block.text.split('\n');
    textLines.forEach((line, index) => {
      ctx.fillText(line, 0, -totalTextHeight/2 + lineHeight/2 + index * lineHeight);
    });
    
    ctx.restore();
  });
}

// Re-render at a set framerate.
setInterval(renderBlocks, 50);

// Load existing messages from server.
socket.on('loadMessages', (messages) => {
  messages.forEach((msg) => {
    blocks[msg._id] = createMessageBlock(msg);
  });
});

// New message from server.
socket.on('newMessage', (msg) => {
  blocks[msg._id] = createMessageBlock(msg);
});

// Update message position from server.
socket.on('updatePosition', (data) => {
  if (blocks[data.id]) {
    blocks[data.id].x = data.x;
    blocks[data.id].y = data.y;
    blocks[data.id].angle = data.angle;
  }
});

// --- Sending Messages ---
// Send new message function.
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  
  // Determine spawn position based on the chat container.
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
  input.value = '';
  socket.emit('newMessage', blockData);
}

// Allow sending message via button or Shift+Enter.
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keydown', (e) => {
  if (e.shiftKey && e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});

// --- Drag Interaction ---
// We'll allow dragging only for blocks the user created.
// This sample uses mouse events on the canvas for simple drag handling.
let draggingBlock = null;
let offsetX, offsetY;

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Check if mouse is inside any block (naively, not accounting for rotation)
  for (let id in blocks) {
    const block = blocks[id];
    const left = block.x - block.width/2;
    const right = block.x + block.width/2;
    const top = block.y - block.height/2;
    const bottom = block.y + block.height/2;
    if (mouseX >= left && mouseX <= right && mouseY >= top && mouseY <= bottom) {
      if (block.userId === userId) { // Only allow dragging if the block belongs to this user.
        draggingBlock = block;
        offsetX = mouseX - block.x;
        offsetY = mouseY - block.y;
      }
      break;
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (draggingBlock) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // Update block's position locally
    draggingBlock.x = mouseX - offsetX;
    draggingBlock.y = mouseY - offsetY;
    // Optionally compute a new angle if desired.
    // For now, we'll send updated position on each move.
    socket.emit('updatePosition', {
      room: roomId,
      id: draggingBlock.id,
      x: draggingBlock.x,
      y: draggingBlock.y,
      angle: draggingBlock.angle,
      userId,
    });
  }
});

canvas.addEventListener('mouseup', () => {
  draggingBlock = null;
});
canvas.addEventListener('mouseleave', () => {
  draggingBlock = null;
});
