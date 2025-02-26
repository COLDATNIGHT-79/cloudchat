/**
 * server.js
 *
 * A client-side physics simulation with server broadcasting
 * - Server only relays messages and inputs
 * - All physics calculations happen on client
 * - Initial random artifacts stay throughout the session
 * - Supports up to 4 players per room with real-time interaction
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');

// Express config
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Data structures for rooms
const rooms = {}; 
// rooms[roomId] = {
//   messages: { [messageId]: messageData },
//   players: { [userId]: {color1, color2, socketId} },
//   artifactsSeeded: false,
//   artifactSeed: null
// }

// Helper: generate unique IDs
function genId() {
  return Math.random().toString(36).substring(2, 10);
}

//
// Socket.IO handlers
//
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('joinRoom', ({ room, userId, color1, color2 }) => {
    socket.join(room);
    
    // Create room if doesn't exist
    if (!rooms[room]) {
      rooms[room] = { 
        messages: {}, 
        players: {},
        artifactsSeeded: false,
        artifactSeed: Math.random()
      };
    }
    
    // Add player to room
    rooms[room].players[userId] = {
      socketId: socket.id,
      color1,
      color2
    };
    
    // Send existing messages to this client
    const allMsgs = Object.values(rooms[room].messages);
    socket.emit('loadMessages', allMsgs);
    
    // Send artifact seed to ensure all clients create the same artifacts
    socket.emit('artifactSeed', {
      seed: rooms[room].artifactSeed,
      seeded: rooms[room].artifactsSeeded
    });
    
    // Send list of current players to everyone
    io.to(room).emit('playerList', Object.keys(rooms[room].players).map(id => ({
      userId: id,
      color1: rooms[room].players[id].color1,
      color2: rooms[room].players[id].color2
    })));
    
    rooms[room].artifactsSeeded = true;
  });

  // A new chat message
  // A new chat message
socket.on('newMessage', (data) => {
  const room = data.room;
  if (!rooms[room]) {
    rooms[room] = { 
      messages: {}, 
      players: {},
      artifactsSeeded: false,
      artifactSeed: Math.random()
    };
  }

  // MODIFIED: Only fade out messages from the same user
  for (let msgId in rooms[room].messages) {
    const msg = rooms[room].messages[msgId];
    
    // Only reduce opacity for messages from the same user
    if (msg.userId === data.userId) {
      msg.opacity = Math.max(0, msg.opacity - 10);

      // If opacity hits 0, remove from server
      if (msg.opacity <= 0) {
        delete rooms[room].messages[msgId];
        io.to(room).emit('removeMessage', { id: msgId });
      } else {
        // Otherwise, broadcast updated opacity
        io.to(room).emit('updateOpacity', { id: msgId, opacity: msg.opacity });
      }
    }
  }

  // Create the new message
  const messageId = genId();
  const newMsg = {
    _id: messageId,
    room: data.room,
    text: data.text,
    x: data.x,
    y: data.y,
    userId: data.userId,
    color1: data.color1,
    color2: data.color2,
    opacity: 100,
    length: data.text.length
  };
  rooms[room].messages[messageId] = newMsg;

  // Broadcast to clients
  io.to(room).emit('newMessage', newMsg);
});
  // Relay user input (drag, throw, etc.)
  socket.on('userInput', (data) => {
    const room = data.room;
    if (!rooms[room]) return;
    
    // Simply relay the input to all other clients
    socket.to(room).emit('userInput', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove player from any rooms they were in
    for (const roomId in rooms) {
      const room = rooms[roomId];
      for (const userId in room.players) {
        if (room.players[userId].socketId === socket.id) {
          delete room.players[userId];
          
          // Notify other players
          io.to(roomId).emit('playerList', Object.keys(room.players).map(id => ({
            userId: id,
            color1: room.players[id].color1,
            color2: room.players[id].color2
          })));
          
          // Clean up empty rooms
          if (Object.keys(room.players).length === 0) {
            delete rooms[roomId];
          }
          break;
        }
      }
    }
  });
});

http.listen(3000, () => {
  console.log('Server listening on port 3000');
});