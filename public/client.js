// client.js
const socket = io();

// Read room ID from query string, e.g. room.html?room=abc123
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (!roomId) {
  alert('No room specified. Redirecting to lobby.');
  window.location.href = '/';
}
document.getElementById('roomIdDisplay').textContent = "Room ID: " + roomId;
socket.emit('joinRoom', roomId);

// Set up canvas for rendering the simulation state received from the server
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

// Local storage for the simulation state
let blocks = {};

// When the server sends a state update, update our local state and redraw
socket.on('stateUpdate', (state) => {
  blocks = {}; // reset local blocks
  state.forEach((b) => {
    blocks[b.id] = b;
  });
  draw();
});

// Draw the simulation state on the canvas
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let id in blocks) {
    const b = blocks[id];
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    // Draw rectangle block with received dimensions
    ctx.fillStyle = "#00AAFF";
    ctx.fillRect(-b.width/2, -b.height/2, b.width, b.height);
    // Draw the text centered
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px Arial";
    const textWidth = ctx.measureText(b.text).width;
    ctx.fillText(b.text, -textWidth/2, 5);
    ctx.restore();
  }
}

// Helper: Get spawn position from chat box location
function getSpawnPosition() {
  const chatRect = document.getElementById('chat').getBoundingClientRect();
  return {
    x: chatRect.left + chatRect.width / 2,
    y: chatRect.top + chatRect.height / 2
  };
}

// When "Send" is clicked, send newBlock event to server
document.getElementById('sendBtn').addEventListener('click', () => {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  const spawn = getSpawnPosition();
  // Calculate block dimensions based on text length (you may adjust as needed)
  const width = Math.max(100, text.length * 10);
  const height = 50;
  const blockData = {
    id: Date.now().toString(),
    text: text,
    x: spawn.x,
    y: spawn.y,
    width: width,
    height: height,
    density: 0.001, // Adjust density so larger blocks are heavier if desired
    room: roomId
  };
  socket.emit('newBlock', blockData);
  input.value = '';
});

// When dragging a block, send an "input" event (drag logic not fully implemented here)
// You might add mouse/touch event listeners to your canvas to detect dragging and then:
// socket.emit('input', { id: blockId, x: newX, y: newY, room: roomId });
