// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const mongoose = require('mongoose');
const path = require('path');
const bodyParser = require('body-parser');
const Matter = require('matter-js');

// --- MongoDB Setup ---
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

// --- Express Middleware ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Server-Side Physics Setup ---
const engine = Matter.Engine.create();
const world = engine.world;
// Use simpler settings to reduce extreme motion.
world.gravity.y = 0.5; // moderate gravity

// Canvas boundaries
const WIDTH = 1024;
const HEIGHT = 768;
const WALL_THICKNESS = 50;

// Add walls
const walls = [
  Matter.Bodies.rectangle(WIDTH / 2, -WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
  Matter.Bodies.rectangle(WIDTH / 2, HEIGHT + WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
  Matter.Bodies.rectangle(-WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
  Matter.Bodies.rectangle(WIDTH + WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
];
Matter.Composite.add(world, walls);

// Keep track of message bodies in memory
const bodies = {}; // key: messageId, value: Matter body

// Helper: create a body for a message
async function createMessageBody(msg) {
  const lines = msg.text.split('\n');
  const longestLine = Math.max(...lines.map(line => line.length));
  const width = Math.max(50, 10 * longestLine);
  const height = 25 * lines.length + 20;
  const body = Matter.Bodies.rectangle(
    msg.x || WIDTH / 2,
    msg.y || HEIGHT / 2,
    width,
    height,
    {
      friction: 0.05,
      frictionAir: 0.01,
      restitution: 0.2,
      label: msg.text,
    }
  );
  body.messageId = msg._id.toString();
  body.userId = msg.userId;
  body.color1 = msg.color1;
  body.color2 = msg.color2;
  body.customWidth = width;
  body.customHeight = height;
  
  Matter.Composite.add(world, body);
  bodies[body.messageId] = body;
}

// Load existing messages in a room, create bodies if needed
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

// Physics update loop
setInterval(() => {
  Matter.Engine.update(engine, 1000 / 60); // 60fps

  // Broadcast positions to all clients
  for (let id in bodies) {
    const b = bodies[id];
    io.emit('updatePosition', {
      id,
      x: b.position.x,
      y: b.position.y,
      angle: b.angle,
    });
  }
}, 1000 / 30); // broadcast ~30 fps

// --- REST Endpoints ---
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

// --- Socket.IO Setup ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', async ({ room, userId }) => {
    // Enforce max 4 users
    const clients = io.sockets.adapter.rooms.get(room);
    if (clients && clients.size >= 4) {
      socket.emit('roomError', 'max users in room');
      return;
    }
    socket.join(room);
    console.log(`User ${socket.id} (uid: ${userId}) joined room ${room}`);
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

  // Client wants to move/drag a block
  // We'll apply a direct position set or a small "teleport" approach
  socket.on('dragBlock', async (data) => {
    // data: { room, messageId, x, y, userId }
    const { messageId, x, y, userId, room } = data;
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return; // no such message
      if (msg.userId !== userId) {
        console.warn(`User ${userId} tried to move someone else's message ${messageId}`);
        return; // not the owner, ignore
      }
      // Update Matter body position
      const body = bodies[messageId];
      if (body) {
        Matter.Body.setPosition(body, { x, y });
        Matter.Body.setVelocity(body, { x: 0, y: 0 }); // stop it from flying off
      }
      // Update DB for persistence
      msg.x = x;
      msg.y = y;
      await msg.save();
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

http.listen(3000, () => {
  console.log('Server listening on port 3000');
});
