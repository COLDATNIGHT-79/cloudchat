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
const DEFAULT_OPACITY = 100;
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
  opacity: { type: Number, default: DEFAULT_OPACITY },
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);



app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const engine = Matter.Engine.create();
const world = engine.world;
world.gravity.y = 1.0;

const WIDTH = 1024;
const HEIGHT = 768;
const WALL_THICKNESS = 50;
const walls = [
  Matter.Bodies.rectangle(WIDTH / 2, -WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
  Matter.Bodies.rectangle(WIDTH / 2, HEIGHT + WALL_THICKNESS / 2, WIDTH, WALL_THICKNESS, { isStatic: true }),
  Matter.Bodies.rectangle(-WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
  Matter.Bodies.rectangle(WIDTH + WALL_THICKNESS / 2, HEIGHT / 2, WALL_THICKNESS, HEIGHT, { isStatic: true }),
];
Matter.Composite.add(world, walls);

const bodies = {}; 

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
      chamfer: { radius: 15 },
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
  body.opacity = msg.opacity; // store opacity on the body too
  body.customWidth = width;
  body.customHeight = height;
  
  Matter.Composite.add(world, body);
  bodies[body.messageId] = body;
}

async function createMessageBody(msg) {
  const lines = msg.text.split('\n');
  const longestLine = Math.max(...lines.map(line => line.length));
  const width = Math.max(50, 10 * longestLine);
  const height = 25 * lines.length + 20;
  
  // Use similar friction and restitution as your client settings
  const body = Matter.Bodies.rectangle(
    msg.x || WIDTH / 2,
    msg.y || HEIGHT / 2,
    width,
    height,
    {
      chamfer: { radius: 15 },
      friction: 0.9,
      frictionAir: 0.02,
      restitution: 0.1, // adjust for bounce behavior
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
async function updateOpacityForRoom(room) {
  try {
    // Find messages in this room (excluding ones already at 0)
    const messages = await Message.find({ room, opacity: { $gt: 0 } });
    for (const msg of messages) {
      msg.opacity -= 10;
      if (msg.opacity <= 0) {
        // Remove from DB and physics world.
        await Message.findByIdAndDelete(msg._id);
        const body = bodies[msg._id];
        if (body) {
          Matter.Composite.remove(world, body);
          delete bodies[msg._id];
        }
        // Broadcast removal so clients remove it.
        io.to(room).emit('removeMessage', { id: msg._id });
      } else {
        await msg.save();
        // Also update the corresponding Matter body opacity
        const body = bodies[msg._id];
        if (body) {
          body.opacity = msg.opacity;
        }
        // Broadcast the new opacity so clients update their render.
        io.to(room).emit('updateOpacity', { id: msg._id, opacity: msg.opacity });
      }
    }
  } catch (err) {
    console.error(err);
  }
}

// Increase solver iterations for more accurate collision resolution
engine.positionIterations = 20;
engine.velocityIterations = 20;

// Run the simulation at 120 FPS for higher fidelity
const timeStep = 1000 / 120;

setInterval(() => {
  Matter.Engine.update(engine, timeStep);

  // Broadcast the updated positions of all bodies to all clients
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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', async ({ room, userId }) => {
    const clients = io.sockets.adapter.rooms.get(room);
    if (clients && clients.size >= 4) {
      socket.emit('roomError', 'max users in room');
      return;
    }
    socket.join(room);
    console.log(`User ${socket.id} (uid: ${userId}) joined room ${room}`);
    // Load messages for the room and create bodies.
    const messages = await Message.find({ room });
    for (const msg of messages) {
      if (!bodies[msg._id]) {
        await createMessageBody(msg);
      }
    }
    socket.emit('loadMessages', messages);
  });

  socket.on('newMessage', async (data) => {
    try {
      // Create new message with full opacity.
      const msg = new Message({
        room: data.room,
        text: data.text,
        x: data.x,
        y: data.y,
        userId: data.userId,
        color1: data.color1,
        color2: data.color2,
        opacity: DEFAULT_OPACITY,
      });
      const saved = await msg.save();
      await createMessageBody(saved);
      // Broadcast the new message.
      io.to(data.room).emit('newMessage', saved);
      // Update opacity for all previous messages.
      updateOpacityForRoom(data.room);
    } catch (err) {
      console.error(err);
    }
  });


   // Drag event – only allow owner's control
   socket.on('dragBlock', async (data) => {
    const { messageId, x, y, userId, room } = data;
    try {
      const msg = await Message.findById(messageId);
      if (!msg || msg.userId !== userId) {
        console.warn(`User ${userId} attempted to move message ${messageId} they don't own`);
        return;
      }
      const body = bodies[messageId];
      if (body) {
        Matter.Body.setPosition(body, { x, y });
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
      }
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
