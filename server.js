/**
 * HIDE & SEEK 3D - ADVANCED SERVER
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');

const MONGO_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
mongoose.connect(MONGO_URI).then(() => console.log('DB Connected')).catch(err => console.error(err));

const User = mongoose.model('User', new mongoose.Schema({
    telegramId: String, name: String, photo: String, wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }
}));

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", credentials: true } });

const rooms = {};
const matchmakingQueue = [];
const players = {};

io.on('connection', async (socket) => {
    const q = socket.handshake.query;
    if (!q.id) return;

    players[socket.id] = {
        socketId: socket.id, userId: q.id, name: q.name || 'Guest', photo: q.photo || '',
        room: null, role: null, x: 0, y: 1.7, z: 0, ry: 0, tagged: false, isWalking: false
    };

    if (!q.id.startsWith('guest_')) {
        await User.findOneAndUpdate({ telegramId: q.id }, { name: q.name, photo: q.photo }, { upsert: true });
    }

    // Room Management
    socket.on('get_rooms', () => {
        const roomData = Object.values(rooms).filter(r => r.status === 'waiting').map(r => ({
            id: r.id, name: r.name, players: r.players.length, hasPass: !!r.pass
        }));
        socket.emit('room_list', roomData);
    });

    socket.on('create_room', (data) => {
        const roomId = 'room_' + Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            id: roomId, name: data.name || 'ArenaX', pass: data.pass || '',
            players: [], status: 'waiting', timer: 300, mazeSeed: Math.floor(Math.random() * 99999)
        };
        joinRoom(socket, roomId, data.pass);
    });

    socket.on('join_room', (data) => {
        joinRoom(socket, data.id, data.pass);
    });

    socket.on('join_matchmaking', () => {
        if (!matchmakingQueue.includes(socket.id)) matchmakingQueue.push(socket.id);
        checkMatchmaking();
    });

    socket.on('player_move', (data) => {
        const p = players[socket.id];
        if (p && p.room) {
            p.x = data.x; p.y = data.y; p.z = data.z; p.ry = data.ry; p.isWalking = data.isWalking;
            socket.to(p.room).emit('room_update', getRoomPlayers(p.room));
            if (p.role === 'SEEKER' && rooms[p.room]?.status === 'playing') checkCollisions(socket, p);
        }
    });

    socket.on('disconnect', () => {
        const p = players[socket.id];
        if (p?.room) leaveRoom(socket, p.room);
        delete players[socket.id];
        const idx = matchmakingQueue.indexOf(socket.id);
        if (idx > -1) matchmakingQueue.splice(idx, 1);
    });
});

function joinRoom(socket, roomId, pass) {
    const room = rooms[roomId];
    if (!room) return socket.emit('error_msg', 'Room not found');
    if (room.pass && room.pass !== pass) return socket.emit('error_msg', 'Wrong password');
    if (room.players.length >= 8) return socket.emit('error_msg', 'Room full');

    const p = players[socket.id];
    if (p.room) leaveRoom(socket, p.room);

    p.room = roomId;
    socket.join(roomId);
    room.players.push(socket.id);

    if (room.players.length >= 2 && room.status === 'waiting') {
        setTimeout(() => startLevel(roomId), 2000);
    }
}

function checkMatchmaking() {
    if (matchmakingQueue.length >= 2) {
        const id = 'mm_' + Date.now();
        rooms[id] = { id, name: 'Quick Arena', pass: '', players: [], status: 'waiting', timer: 300, mazeSeed: 42 };
        matchmakingQueue.splice(0, 4).forEach(sid => {
            const s = io.sockets.sockets.get(sid);
            if (s) joinRoom(s, id, '');
        });
    }
}

function startLevel(roomId) {
    const room = rooms[roomId];
    if (!room || room.status !== 'waiting') return;
    room.status = 'playing';

    const sIdx = Math.floor(Math.random() * room.players.length);
    room.players.forEach((sid, i) => {
        const p = players[sid];
        p.role = (i === sIdx) ? 'SEEKER' : 'HIDER';
        p.tagged = false;
        p.x = (p.role === 'SEEKER') ? 15 : -15;
        p.z = (p.role === 'SEEKER') ? 15 : -15;
        io.to(sid).emit('room_start', { role: p.role, seed: room.mazeSeed });
    });

    const timer = setInterval(() => {
        if (!rooms[roomId]) return clearInterval(timer);
        room.timer--;
        io.to(roomId).emit('tick', room.timer);
        if (room.timer <= 0) {
            endGame(roomId, 'HIDERS', 'Time ran out! Hiders win.');
            clearInterval(timer);
        }
    }, 1000);
}

function checkCollisions(seekerSocket, seeker) {
    const room = rooms[seeker.room];
    room.players.forEach(sid => {
        const target = players[sid];
        if (target.role === 'HIDER' && !target.tagged) {
            const dist = Math.sqrt((seeker.x - target.x) ** 2 + (seeker.z - target.z) ** 2);
            if (dist < 1.4) {
                target.tagged = true;
                io.to(seeker.room).emit('tagged', { id: target.userId, name: target.name });
                checkWins(seeker.room);
            }
        }
    });
}

function checkWins(roomId) {
    const r = rooms[roomId];
    const hiders = r.players.map(s => players[s]).filter(p => p.role === 'HIDER');
    if (hiders.every(h => h.tagged)) endGame(roomId, 'SEEKERS', 'All hiders caught!');
}

async function endGame(roomId, winner, msg) {
    io.to(roomId).emit('game_over', { winner, msg });
    const r = rooms[roomId];
    if (r) {
        for (const sid of r.players) {
            const p = players[sid];
            if (p && !p.userId.startsWith('guest_')) {
                const won = (p.role === 'SEEKER' && winner === 'SEEKERS') || (p.role === 'HIDER' && winner === 'HIDERS');
                await User.findOneAndUpdate({ telegramId: p.userId }, { $inc: { [won ? 'wins' : 'losses']: 1 } });
            }
            if (p) p.room = null;
        }
        delete rooms[roomId];
    }
}

function leaveRoom(socket, roomId) {
    const r = rooms[roomId];
    if (r) {
        r.players = r.players.filter(id => id !== socket.id);
        if (r.players.length === 0) delete rooms[roomId];
    }
}

function getRoomPlayers(rid) {
    const data = {};
    rooms[rid]?.players.forEach(sid => {
        const p = players[sid];
        if (p) data[p.userId] = { n: p.name, x: p.x, y: p.y, z: p.z, ry: p.ry, r: p.role, t: p.tagged, w: p.isWalking };
    });
    return data;
}

server.listen(process.env.PORT || 3000, () => console.log('Server Ready'));
