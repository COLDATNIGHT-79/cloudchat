const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config();
const mongoDBUri = process.env.MONGODB_URI || "mongodb+srv://user:admin@cluster0.lgrfo.mongodb.net/";

mongoose.connect(mongoDBUri) // Removed deprecated options
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

const messageSchema = new mongoose.Schema({
    _id: String,
    room: String,
    text: String,
    x: Number,
    y: Number,
    userId: String,
    sessionId: String,
    color1: String,
    color2: String,
    opacity: Number,
    length: Number,
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

const roomSettingSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true }
});

const RoomSetting = mongoose.model('RoomSetting', roomSettingSchema);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};
const genId = () => Math.random().toString(36).substring(2, 7);

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', async ({ room, userId, color1, color2 }) => {
        socket.join(room);
        console.log(`User ${userId} (session ${socket.id}) joined room ${room}`);

        let roomSettings;
        try {
            roomSettings = await RoomSetting.findOne({ roomId: room });
            if (!roomSettings) {
                roomSettings = new RoomSetting({ roomId: room });
                await roomSettings.save();
                console.log(`Created default settings for room ${room} in MongoDB`);
            } else {
                console.log(`Loaded settings for room ${room} from MongoDB`);
            }
        } catch (error) {
            console.error('Error loading/creating room settings:', error);
        }

        if (!rooms[room]) {
            rooms[room] = {
                messages: {},
                players: {},
                artifacts: {}
            };
        }

        rooms[room].players[socket.id] = {
            userId: userId,
            color1: color1,
            color2: color2
        };

        try {
            const allMsgsFromDB = await Message.find({ room: room })
                .sort({ timestamp: 1 })
                .limit(500);
            const allMsgs = allMsgsFromDB.map(msg => msg.toObject());
            socket.emit('loadMessages', allMsgs);
            rooms[room].messages = allMsgs.reduce((msgsObj, msg) => {
                msgsObj[msg._id] = msg;
                return msgsObj;
            }, {});
        } catch (error) {
            console.error('Error fetching messages from MongoDB:', error);
            socket.emit('loadMessages', []);
        }

        const playerListForRoom = Object.values(rooms[room].players).map(playerSession => ({
            userId: playerSession.userId,
            color1: playerSession.color1,
            color2: playerSession.color2
        }));
        io.to(room).emit('playerList', playerListForRoom);
    });

    socket.on('newMessage', async (data) => {
        const room = data.room;
        if (!rooms[room]) {
            rooms[room] = {
                messages: {},
                players: {},
                artifacts: {}
            };
        }

        for (let msgId in rooms[room].messages) {
            const msg = rooms[room].messages[msgId];
            if (msg.userId === data.userId) {
                msg.opacity = Math.max(0, msg.opacity - 10);
                if (msg.opacity <= 0) {
                    delete rooms[room].messages[msgId];
                    io.to(room).emit('removeMessage', { id: msgId });
                } else {
                    io.to(room).emit('updateOpacity', { id: msgId, opacity: msg.opacity });
                }
            }
        }

        const messageId = genId();
        const newMsg = {
            _id: messageId,
            room: data.room,
            text: data.text,
            x: data.x,
            y: data.y,
            userId: data.userId,
            sessionId: socket.id,
            color1: data.color1,
            color2: data.color2,
            opacity: 100,
            length: data.text.length
        };
        rooms[room].messages[messageId] = newMsg;

        try {
            const mongoMessage = new Message(newMsg);
            await mongoMessage.save();
            console.log('Message saved to MongoDB:', mongoMessage);
        } catch (error) {
            console.error('Error saving message to MongoDB:', error);
        }

        io.to(room).emit('newMessage', newMsg);
    });

    socket.on('updateOpacity', (data) => {
        const room = data.room;
        if (rooms[room] && rooms[room].messages[data.id]) {
            rooms[room].messages[data.id].opacity = data.opacity;
            io.to(room).emit('updateOpacity', data);
        }
    });

    socket.on('removeMessage', (data) => {
        const room = data.room;
        if (rooms[room] && rooms[room].messages[data.id]) {
            delete rooms[room].messages[data.id];
            io.to(room).emit('removeMessage', data);
        }
    });

    socket.on('userInput', (data) => {
        const room = data.room;
        if (rooms[room] && rooms[room].messages[data.messageId]) {
            const message = rooms[room].messages[data.messageId];
            if (message.sessionId === socket.id) {
                socket.to(data.room).emit('userInput', data);
            } else {
                console.log(`User ${socket.id} tried to manipulate message ${data.messageId} they don't own.`);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const room in rooms) {
            if (rooms[room].players[socket.id]) {
                const userId = rooms[room].players[socket.id].userId;
                console.log(`Session ${socket.id} (User ${userId}) left room ${room}`);
                delete rooms[room].players[socket.id];

                const playerListForRoom = Object.values(rooms[room].players).map(playerSession => ({
                    userId: playerSession.userId,
                    color1: playerSession.color1,
                    color2: playerSession.color2
                }));
                io.to(room).emit('playerList', playerListForRoom);

                if (Object.keys(rooms[room].players).length === 0) {
                    console.log(`Room ${room} is empty, cleaning up`);
                    delete rooms[room];
                }
            }
        }
    });
});

function getRoomIdFromSocket(socket) {
    for (const room of socket.rooms) {
        if (room !== socket.id) {
            return room;
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server listening on http://localhost:3000`);
});
