// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');
const shortid = require('shortid');

// Connect to MongoDB (adjust connection string as needed)
mongoose.connect('mongodb+srv://user:admin@cluster0.lgrfo.mongodb.net', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define a message schema. Each message is associated with a room.
const messageSchema = new mongoose.Schema({
  room: String,
  text: String,
  x: Number,
  y: Number,
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);

// Serve static files from public folder
app.use(express.static('public'));

// When a client connects via Socket.IO:
io.on('connection', (socket) => {
  console.log('A user connected');

  // Expect the client to join a room
  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);

    // Load messages for this room from MongoDB and send to client
    Message.find({ room })
      .then((messages) => {
        socket.emit('loadMessages', messages);
      })
      .catch((err) => console.error(err));
  });

  // Listen for new messages
  socket.on('newMessage', (data) => {
    const message = new Message({
      room: data.room,
      text: data.text,
      x: data.x,
      y: data.y,
    });
    message.save()
      .then((savedMsg) => {
        // Emit only to the room so that only those clients get the update
        io.to(data.room).emit('newMessage', savedMsg);
      })
      .catch((err) => console.error(err));
  });

  // Listen for drag/update events
  socket.on('updatePosition', (data) => {
    // Broadcast the updated position only to those in the same room
    io.to(data.room).emit('updatePosition', data);
  });
});

// Listen on port 3000
http.listen(3000, () => {
  console.log('Server listening on port 3000');
});
