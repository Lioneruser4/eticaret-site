/**
 * HIDE & SEEK 3D - SERVER
 * Real-time Multiplayer Server
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

// MongoDB Setup (Using the URI from previous session context or a placeholder)
const MONGO_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

const userSchema = new mongoose.Schema({
    telegramId: String,
    name: String,
    photo: String,
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    lastLogin: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// Game State Storage
const rooms = {};
const matchmakingQueue = [];
const players = {}; // All connected players by socket.id

// Configuration
const CONFIG = {
    MAX_PLAYERS_PER_ROOM: 4,
    GAME_DURATION: 300, // 5 minutes
    SEEKER_WAIT_TIME: 15, // Seconds seekers must wait at start
};

io.on('connection', async (socket) => {
    const userId = socket.handshake.query.id;
    const userName = socket.handshake.query.name || 'Guest';
    const userPhoto = socket.handshake.query.photo || '';

    console.log(`Player connected: ${userName} (${userId})`);

    // Account Creation / Update
    if (!userId.startsWith('guest_')) {
        try {
            await User.findOneAndUpdate(
                { telegramId: userId },
                { name: userName, photo: userPhoto, lastLogin: new Date() },
                { upsert: true, new: true }
            );
        } catch (e) {
            console.error('Error saving user:', e);
        }
    }

    const playerData = {
        socketId: socket.id,
        userId,
        name: userName,
        photo: userPhoto,
        room: null,
        role: null,
        x: 0, y: 1.7, z: 0, ry: 0,
        tagged: false
    };

    players[socket.id] = playerData;

    // --- Matchmaking ---
    socket.on('join_queue', () => {
        if (!matchmakingQueue.includes(socket.id)) {
            matchmakingQueue.push(socket.id);
            console.log(`Player ${userName} joined queue. Queue size: ${matchmakingQueue.length}`);
            checkMatchmaking();
        }
    });

    socket.on('leave_queue', () => {
        const index = matchmakingQueue.indexOf(socket.id);
        if (index > -1) matchmakingQueue.splice(index, 1);
    });

    // --- Manual Room Creation ---
    socket.on('create_room', () => {
        const roomId = 'room_' + Math.random().toString(36).substr(2, 9);
        joinRoom(socket, roomId);
    });

    // --- Game Actions ---
    socket.on('player_move', (data) => {
        const p = players[socket.id];
        if (p && p.room) {
            p.x = data.x;
            p.y = data.y;
            p.z = data.z;
            p.ry = data.ry;

            // Broadcast to others in room
            socket.to(p.room).emit('player_update', getRoomPlayers(p.room));

            // Check for tagging if Seeker
            if (p.role === 'SEEKER') {
                checkCollisions(socket, p);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${userName}`);
        const p = players[socket.id];
        if (p && p.room) {
            leaveRoom(socket, p.room);
        }
        delete players[socket.id];
        const index = matchmakingQueue.indexOf(socket.id);
        if (index > -1) matchmakingQueue.splice(index, 1);
    });
});

function checkMatchmaking() {
    if (matchmakingQueue.length >= 2) {
        const roomId = 'match_' + Date.now();
        const playersToJoin = matchmakingQueue.splice(0, CONFIG.MAX_PLAYERS_PER_ROOM);

        playersToJoin.forEach(socketId => {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) joinRoom(socket, roomId);
        });
    }
}

function joinRoom(socket, roomId) {
    const p = players[socket.id];
    p.room = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) {
        rooms[roomId] = {
            id: roomId,
            players: [],
            status: 'waiting',
            timer: CONFIG.GAME_DURATION,
            mazeSeed: Math.floor(Math.random() * 100000)
        };
    }

    rooms[roomId].players.push(socket.id);
    console.log(`Player ${p.name} joined room ${roomId}`);

    // If room full or start triggered
    if (rooms[roomId].players.length >= 2 && rooms[roomId].status === 'waiting') {
        initGame(roomId);
    }
}

function initGame(roomId) {
    const room = rooms[roomId];
    room.status = 'playing';

    // Assign Roles: 1 Seeker, others Hiders
    const seekerIndex = Math.floor(Math.random() * room.players.length);

    room.players.forEach((sid, index) => {
        const p = players[sid];
        p.role = (index === seekerIndex) ? 'SEEKER' : 'HIDER';
        p.tagged = false;

        // Starting Positions
        if (p.role === 'SEEKER') {
            p.x = 15; p.z = 15; // Red Base
        } else {
            p.x = -15; p.z = -15; // Blue Base
        }

        io.to(sid).emit('match_found', {
            roomId: roomId,
            role: p.role,
            mazeSeed: room.mazeSeed,
            players: getRoomPlayers(roomId)
        });
    });

    // Start Timer
    const interval = setInterval(() => {
        if (!rooms[roomId]) {
            clearInterval(interval);
            return;
        }

        room.timer--;
        io.to(roomId).emit('timer_update', room.timer);

        if (room.timer <= 0) {
            endGame(roomId, 'HIDERS', 'Time is up! Hiders win.');
            clearInterval(interval);
        }
    }, 1000);
}

function checkCollisions(seekerSocket, seeker) {
    const room = rooms[seeker.room];
    if (!room) return;

    room.players.forEach(sid => {
        const target = players[sid];
        if (target.role === 'HIDER' && !target.tagged) {
            const dist = Math.sqrt(
                Math.pow(seeker.x - target.x, 2) +
                Math.pow(seeker.z - target.z, 2)
            );

            if (dist < 1.5) { // Tag distance
                target.tagged = true;
                io.to(seeker.room).emit('player_tagged', { id: target.userId, name: target.name });
                checkWinCondition(seeker.room);
            }
        }
    });
}

function checkWinCondition(roomId) {
    const room = rooms[roomId];
    const hiders = room.players.map(sid => players[sid]).filter(p => p.role === 'HIDER');
    const allTagged = hiders.every(p => p.tagged);

    if (allTagged) {
        endGame(roomId, 'SEEKERS', 'All hiders have been caught!');
    }
}

async function endGame(roomId, winner, message) {
    io.to(roomId).emit('game_over', { winner, message });

    // Update Stats in DB
    const room = rooms[roomId];
    if (room) {
        for (const sid of room.players) {
            const p = players[sid];
            if (p && !p.userId.startsWith('guest_')) {
                const isWinner = p.role === (winner === 'SEEKERS' ? 'SEEKER' : 'HIDER');
                try {
                    await User.findOneAndUpdate(
                        { telegramId: p.userId },
                        { $inc: { [isWinner ? 'wins' : 'losses']: 1 } }
                    );
                } catch (e) {
                    console.error('Error updating stats:', e);
                }
            }
        }

        // Cleanup room
        room.players.forEach(sid => {
            if (players[sid]) players[sid].room = null;
        });
        delete rooms[roomId];
    }
}

function leaveRoom(socket, roomId) {
    const room = rooms[roomId];
    if (room) {
        room.players = room.players.filter(id => id !== socket.id);
        if (room.players.length === 0) {
            delete rooms[roomId];
        } else {
            // If seeker leaves, hiders win
            const p = players[socket.id];
            if (p && p.role === 'SEEKER') {
                endGame(roomId, 'HIDERS', 'The seeker left the game!');
            }
        }
    }
}

function getRoomPlayers(roomId) {
    const room = rooms[roomId];
    const data = {};
    if (room) {
        room.players.forEach(sid => {
            const p = players[sid];
            if (p) {
                data[p.userId] = {
                    name: p.name,
                    role: p.role,
                    x: p.x, y: p.y, z: p.z, ry: p.ry,
                    photo: p.photo,
                    tagged: p.tagged
                };
            }
        });
    }
    return data;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Hide & Seek Server running on port ${PORT}`);
});
