/**
 * server.js
 *
 * Run with: node server.js
 */
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Matter = require('matter-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Connect to MongoDB (adjust your connection string)
mongoose.connect('mongodb+srv://user:admin@cluster0.lgrfo.mongodb.net/', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// --- Schemas & Models ---
const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  color1: String,
  color2: String,
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  room: String,
  text: String,
  x: Number,
  y: Number,
  angle: { type: Number, default: 0 },
  userId: String,
  color1: String,
  color2: String,
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);

// --- Express Setup ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Matter.js Setup (Server Authoritative) ---
const { Engine, World, Bodies, Body, Composite, Constraint } = Matter;
const engine = Engine.create();
const world = engine.world;
world.gravity.y = 1.0; // Adjust gravity as desired

// Canvas dimensions (should match client)
const WIDTH = 1024;
const HEIGHT = 768;
const WALL_THICKNESS = 50;

const walls = [
  Bodies.rectangle(WIDTH / 2, -WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
  Bodies.rectangle(WIDTH / 2, HEIGHT + WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
  Bodies.rectangle(-WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
  Bodies.rectangle(WIDTH + WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
];
Composite.add(world, walls);

// Dictionaries to keep track of bodies and constraints
const bodies = {}; // messageId -> Matter body
const mouseBodies = {}; // socket.id -> virtual mouse body
const mouseConstraints = {}; // socket.id -> Constraint

// Increase solver iterations for more stable collision handling
engine.positionIterations = 20;
engine.velocityIterations = 20;

// Run physics simulation and broadcast positions
const timeStep = 1000 / 60; // 60 FPS simulation
setInterval(() => {
  Engine.update(engine, timeStep);
  // Broadcast every body's position to all clients
  for (let id in bodies) {
    const b = bodies[id];
    io.emit('updatePosition', {
      id,
      x: b.position.x,
      y: b.position.y,
      angle: b.angle,
    });
  }
}, timeStep);

// Helper: create a Matter body for a message
async function createMessageBody(msg) {
  const lines = msg.text.split('\n');
  const longestLine = Math.max(...lines.map(line => line.length));
  const width = Math.max(50, 10 * longestLine);
  const height = 25 * lines.length + 20;
  const body = Bodies.rectangle(
    msg.x || WIDTH / 2,
    msg.y || HEIGHT / 2,
    width,
    height,
    {
      friction: 0.9,
      frictionAir: 0.02,
      restitution: 0.1,
      label: msg.text,
    }
  );
  body.messageId = msg._id.toString();
  body.userId = msg.userId;
  body.color1 = msg.color1;
  body.color2 = msg.color2;
  body.customWidth = width;
  body.customHeight = height;
  
  Composite.add(world, body);
  bodies[body.messageId] = body;
  console.log(`Created body for message ${body.messageId}`);
}

// Helper: load messages for a room
async function loadMessagesForRoom(room, socket) {
  try {
    const messages = await Message.find({ room });
    for (const msg of messages) {
      if (!bodies[msg._id]) {
        await createMessageBody(msg);
      }
    }
    socket.emit('loadMessages', messages);
  } catch (err) {
    console.error(err);
  }
}

// --- Socket.IO Handlers ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create a virtual mouse body for this client (a small static circle)
  const mouseBody = Bodies.circle(-100, -100, 5, { isSensor: true, isStatic: true });
  mouseBodies[socket.id] = mouseBody;
  Composite.add(world, mouseBody);

  socket.on('joinRoom', async ({ room, userId }) => {
    // Enforce max users per room (4)
    const clients = io.sockets.adapter.rooms.get(room);
    if (clients && clients.size >= 4) {
      socket.emit('roomError', 'max users in room');
      return;
    }
    socket.join(room);
    console.log(`Socket ${socket.id} (uid: ${userId}) joined room ${room}`);
    await loadMessagesForRoom(room, socket);
  });

  socket.on('newMessage', async (data) => {
    try {
      const msg = new Message({
        room: data.room,
        text: data.text,
        x: data.x,
        y: data.y,
        userId: data.userId,
        color1: data.color1,
        color2: data.color2,
      });
      const saved = await msg.save();
      await createMessageBody(saved);
      io.to(data.room).emit('newMessage', saved);
    } catch (err) {
      console.error(err);
    }
  });

  // Start drag: create a constraint between virtual mouse and the block
  socket.on('startDrag', async (data) => {
    // data: { room, messageId, userId, x, y }
    try {
      const msg = await Message.findById(data.messageId);
      if (!msg || msg.userId !== data.userId) {
        console.warn(`Socket ${socket.id} attempted to drag message ${data.messageId} without ownership.`);
        return;
      }
      const blockBody = bodies[data.messageId];
      if (!blockBody) {
        console.warn(`No body found for message ${data.messageId}`);
        return;
      }
      // Move the virtual mouse to the start drag position
      const mb = mouseBodies[socket.id];
      if (mb) {
        Body.setPosition(mb, { x: data.x, y: data.y });
      }
      // Create a constraint between the virtual mouse and the block
      const c = Constraint.create({
        bodyA: mb,
        bodyB: blockBody,
        stiffness: 0.02,
        damping: 0.1,
        length: Matter.Vector.magnitude(Matter.Vector.sub(mb.position, blockBody.position))
      });
      Composite.add(world, c);
      mouseConstraints[socket.id] = c;
      console.log(`Socket ${socket.id} started dragging message ${data.messageId}`);
    } catch (err) {
      console.error(err);
    }
  });

  // Drag move: update the virtual mouse position
  socket.on('dragMove', (data) => {
    // data: { x, y }
    const mb = mouseBodies[socket.id];
    if (mb) {
      Body.setPosition(mb, { x: data.x, y: data.y });
    }
  });

  // End drag: remove the constraint
  socket.on('endDrag', () => {
    const c = mouseConstraints[socket.id];
    if (c) {
      Composite.remove(world, c);
      delete mouseConstraints[socket.id];
      console.log(`Socket ${socket.id} ended drag.`);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Clean up constraint and mouse body
    const c = mouseConstraints[socket.id];
    if (c) {
      Composite.remove(world, c);
      delete mouseConstraints[socket.id];
    }
    const mb = mouseBodies[socket.id];
    if (mb) {
      Composite.remove(world, mb);
      delete mouseBodies[socket.id];
    }
  });
});

// --- REST Endpoints for User Colors ---
app.get('/api/user/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    let user = await User.findOne({ userId });
    if (!user) {
      user = new User({
        userId,
        color1: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        color2: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
      });
      await user.save();
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/:userId/colors', async (req, res) => {
  const userId = req.params.userId;
  const { color1, color2 } = req.body;
  try {
    let user = await User.findOneAndUpdate(
      { userId },
      { color1, color2 },
      { new: true, upsert: true }
    );
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
