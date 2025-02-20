// server.js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

// Connect to MongoDB (Atlas or local)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatroom', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const messageSchema = new mongoose.Schema({
  room: String,
  text: String,
  x: Number,
  y: Number,
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);

// Express setup
const app = express();
const httpServer = createServer(app);

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// If user visits '/', serve index.html from public
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO setup
const io = new Server(httpServer, {
  // Potentially set cors options here if needed
});

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('A user connected.');

  // Listen for joinRoom
  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);

    // Load existing messages
    Message.find({ room })
      .then((messages) => {
        socket.emit('loadMessages', messages);
      })
      .catch((err) => console.error(err));
  });

  // newMessage
  socket.on('newMessage', (data) => {
    const message = new Message({
      room: data.room,
      text: data.text,
      x: data.x,
      y: data.y,
    });
    message
      .save()
      .then((savedMsg) => {
        io.to(data.room).emit('newMessage', savedMsg);
      })
      .catch((err) => console.error(err));
  });

  // updatePosition
  socket.on('updatePosition', (data) => {
    io.to(data.room).emit('updatePosition', data);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected.');
  });
});

// For Vercel serverless:
module.exports = httpServer;
