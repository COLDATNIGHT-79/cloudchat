// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const Matter = require('matter-js');
const shortid = require('shortid');
const path = require('path');

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------
// HOST-AUTHORITATIVE SIMULATION
// ----------------------------

// Create a Matter.js engine and world
const Engine = Matter.Engine,
      World = Matter.World,
      Bodies = Matter.Bodies,
      Body = Matter.Body;

const engine = Engine.create();
engine.world.gravity.y = 1.0; // tweak gravity as needed

// Canvas dimensions (used for simulation boundaries)
const canvasWidth = 1024;
const canvasHeight = 768;

// Create boundary walls
const thickness = 50;
const boundaries = [
  // Top
  Bodies.rectangle(canvasWidth / 2, -thickness / 2, canvasWidth, thickness, { isStatic: true }),
  // Bottom
  Bodies.rectangle(canvasWidth / 2, canvasHeight + thickness / 2, canvasWidth, thickness, { isStatic: true }),
  // Left
  Bodies.rectangle(-thickness / 2, canvasHeight / 2, thickness, canvasHeight, { isStatic: true }),
  // Right
  Bodies.rectangle(canvasWidth + thickness / 2, canvasHeight / 2, thickness, canvasHeight, { isStatic: true })
];
World.add(engine.world, boundaries);

// Store all blocks in an in‑memory object
let blocks = {}; // key: blockId, value: Matter body

// ----------------------------
// SOCKET.IO COMMUNICATION
// ----------------------------
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Client joins a room (we still support rooms for grouping)
  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`Client ${socket.id} joined room ${room}`);

    // Send the current simulation state immediately upon joining
    let state = [];
    for (let id in blocks) {
      const b = blocks[id];
      state.push({
        id,
        x: b.position.x,
        y: b.position.y,
        angle: b.angle,
        text: b.label,
        width: b.bounds.max.x - b.bounds.min.x,
        height: b.bounds.max.y - b.bounds.min.y
      });
    }
    socket.emit('stateUpdate', state);
  });

  // When a client creates a new block
  socket.on('newBlock', (data) => {
    // Data expected: { id, text, x, y, width, height, density, room }
    const block = Bodies.rectangle(data.x, data.y, data.width, data.height, {
      density: data.density || 0.001,
      friction: 0.6,
      restitution: 0.1,
      chamfer: { radius: 10 },
      label: data.text
    });
    block.blockId = data.id;
    blocks[data.id] = block;
    World.add(engine.world, block);
    console.log(`Block ${data.id} created in room ${data.room} by client ${socket.id}`);
  });

  // When a client sends an input (e.g. dragging a block)
  socket.on('input', (data) => {
    // Data expected: { id, x, y, room }
    let block = blocks[data.id];
    if (block) {
      // For a simple model, we set the block's position directly.
      Body.setPosition(block, { x: data.x, y: data.y });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ----------------------------
// SIMULATION UPDATE LOOP
// ----------------------------
// Run simulation at ~60 FPS and broadcast state to all clients in each room.
setInterval(() => {
  Engine.update(engine, 16);
  // Build simulation state from all blocks.
  let state = [];
  for (let id in blocks) {
    const block = blocks[id];
    state.push({
      id: id,
      x: block.position.x,
      y: block.position.y,
      angle: block.angle,
      text: block.label,
      width: block.bounds.max.x - block.bounds.min.x,
      height: block.bounds.max.y - block.bounds.min.y
    });
  }
  io.emit('stateUpdate', state);
}, 16);

// Start the server on port 3000
http.listen(3000, () => {
  console.log('Server listening on port 3000');
});
