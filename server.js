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

// Connect to MongoDB (update connection string accordingly)
mongoose.connect('mongodb+srv://user:admin@cluster0.lgrfo.mongodb.net/', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// MODELS

// User schema: stores a persistent userId and chosen gradient colors.
const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  color1: String,
  color2: String,
});
const User = mongoose.model('User', userSchema);

// Message schema: each message is tagged with userId and the gradient colors.
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

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files (adjust if your public folder is different)
app.use(express.static(path.join(__dirname, 'public')));

// --- Physics Engine Setup (Server-based Sandbox) ---
const engine = Matter.Engine.create();
const world = engine.world;
world.gravity.y = 1.0; // set gravity

// Create boundaries (adjust canvas dimensions if needed)
const canvasWidth = 1024;
const canvasHeight = 768;
const thickness = 50;
const boundaries = [
  Matter.Bodies.rectangle(canvasWidth / 2, -thickness / 2, canvasWidth, thickness, { isStatic: true }),
  Matter.Bodies.rectangle(canvasWidth / 2, canvasHeight + thickness / 2, canvasWidth, thickness, { isStatic: true }),
  Matter.Bodies.rectangle(-thickness / 2, canvasHeight / 2, thickness, canvasHeight, { isStatic: true }),
  Matter.Bodies.rectangle(canvasWidth + thickness / 2, canvasHeight / 2, thickness, canvasHeight, { isStatic: true }),
];
Matter.Composite.add(world, boundaries);

// In-memory mapping from message _id to Matter body.
const bodies = {};

// Helper: create a Matter body for a message.
async function createMessageBody(msg) {
  // Compute dimensions similar to client-side code.
  const lines = msg.text.split('\n');
  const longestLine = Math.max(...lines.map(line => line.length));
  const width = Math.max(50, 10 * longestLine);
  const height = 25 * lines.length + 20;
  const chamferRadius = 15;
  
  const body = Matter.Bodies.rectangle(
    msg.x || canvasWidth / 2,
    msg.y || canvasHeight / 2,
    width,
    height,
    {
      chamfer: { radius: chamferRadius },
      friction: 0.9,
      frictionAir: 0.02,
      restitution: 0.1,
      label: msg.text,
    }
  );
  // Save additional properties on the body for later use.
  body.messageId = msg._id.toString();
  body.userId = msg.userId;
  body.color1 = msg.color1;
  body.color2 = msg.color2;
  body.customWidth = width;
  body.customHeight = height;
  
  Matter.Composite.add(world, body);
  bodies[body.messageId] = body;
}

// Load existing messages on room join and create their Matter bodies.
async function loadMessagesToWorld(room, socket) {
  try {
    const messages = await Message.find({ room });
    for (const msg of messages) {
      // Only create the body if it doesn't exist yet.
      if (!bodies[msg._id.toString()]) {
        await createMessageBody(msg);
      }
    }
    // Send all messages to the client so they can render them.
    socket.emit('loadMessages', messages);
  } catch (err) {
    console.error(err);
  }
}

// Run the physics simulation loop.
setInterval(() => {
  Matter.Engine.update(engine, 50);
  
  // Broadcast the updated positions of all bodies.
  for (let id in bodies) {
    const body = bodies[id];
    const data = {
      id,
      x: body.position.x,
      y: body.position.y,
      angle: body.angle
    };
    // Using room information: you may want to maintain a mapping of room to messages,
    // but for simplicity, broadcast to all sockets.
    io.emit('updatePosition', data);
  }
}, 50);

// REST endpoint: Get user data (create if not exists)
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
    res.status(500).json({ error: err.message });
  }
});

// REST endpoint: Update user colors.
app.post('/api/user/:userId/colors', async (req, res) => {
  const userId = req.params.userId;
  const { color1, color2 } = req.body;
  try {
    let user = await User.findOneAndUpdate({ userId }, { color1, color2 }, { new: true, upsert: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.IO: Real-time messaging and syncing.
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // When a client joins a room.
  socket.on('joinRoom', async (data) => {
    // data: { room, userId }
    const { room, userId } = data;
    // Enforce max 4 users per room.
    const clients = io.sockets.adapter.rooms.get(room);
    if (clients && clients.size >= 4) {
      socket.emit('roomError', 'max users in room');
      return;
    }
    socket.join(room);
    console.log(`User ${socket.id} (userId: ${userId}) joined room: ${room}`);
    await loadMessagesToWorld(room, socket);
  });

  // New message event.
  socket.on('newMessage', async (data) => {
    // data: { room, text, x, y, userId, color1, color2 }
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
      // Create a Matter body for the new message.
      await createMessageBody(saved);
      // Broadcast the new message to the room.
      io.to(data.room).emit('newMessage', saved);
    } catch (err) {
      console.error(err);
    }
  });

  // Update message position.
  socket.on('updatePosition', async (data) => {
    // data: { room, id, x, y, angle, userId }
    // Only allow if the user is the creator.
    try {
      const msg = await Message.findById(data.id);
      if (msg && msg.userId === data.userId) {
        // Update DB record.
        msg.x = data.x;
        msg.y = data.y;
        msg.angle = data.angle;
        await msg.save();
        // Update Matter body.
        const body = bodies[data.id];
        if (body) {
          Matter.Body.setPosition(body, { x: data.x, y: data.y });
          Matter.Body.setAngle(body, data.angle);
        }
        io.to(data.room).emit('updatePosition', data);
      } else {
        console.warn(`Unauthorized update by ${data.userId} on message ${data.id}`);
      }
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
