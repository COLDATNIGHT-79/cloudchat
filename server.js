// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const mongoose = require('mongoose');
const path = require('path');
const bodyParser = require('body-parser');

// Connect to MongoDB – update the connection string as needed.
mongoose.connect('mongodb+srv://user:admin@cluster0.lgrfo.mongodb.net/', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// MODELS

// User schema: stores a persistent userId and the two chosen gradient colors.
const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  color1: String,
  color2: String,
});
const User = mongoose.model('User', userSchema);

// Message schema: each message (block) is tagged with a userId and the creator’s gradient colors.
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

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// REST endpoint: Get user data (create new if not exists)
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

// Socket.IO: Real-time messaging and sync.
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // When a client joins a room. Data: { room, userId }
  socket.on('joinRoom', async (data) => {
    const { room, userId } = data;
    socket.join(room);
    console.log(`User ${socket.id} (userId: ${userId}) joined room: ${room}`);
    try {
      const messages = await Message.find({ room });
      socket.emit('loadMessages', messages);
    } catch (err) {
      console.error(err);
    }
  });

  // When a new message is created. Data: { room, text, x, y, userId, color1, color2 }
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
      io.to(data.room).emit('newMessage', saved);
    } catch (err) {
      console.error(err);
    }
  });

  // When a position update is sent. Data: { room, id, x, y, angle, userId }
  socket.on('updatePosition', async (data) => {
    try {
      const msg = await Message.findById(data.id);
      if (msg && msg.userId === data.userId) {
        msg.x = data.x;
        msg.y = data.y;
        msg.angle = data.angle;
        await msg.save();
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
