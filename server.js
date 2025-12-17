/**
 * HIDE & SEEK 3D - PROFESSIONAL SERVER (v3.0)
 * Elite Multi-round, Smart Matchmaking, Anti-Bug Logic
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
const players = {};

io.on('connection', async (socket) => {
    const q = socket.handshake.query;
    if (!q.id) return;

    const pData = {
        socketId: socket.id, userId: q.id, name: q.name || 'Guest', photo: q.photo || '',
        room: null, role: null, x: 0, y: 1.7, z: 0, ry: 0, tagged: false, isWalking: false
    };
    players[socket.id] = pData;

    if (!q.id.startsWith('guest_')) {
        await User.findOneAndUpdate({ telegramId: q.id }, { name: q.name, photo: q.photo }, { upsert: true }).catch(e => { });
    }

    // Room List
    socket.on('get_rooms', () => {
        const roomData = Object.values(rooms).filter(r => r.status === 'waiting' && !r.isMatchmaking).map(r => ({
            id: r.id, name: r.name, players: r.players.length, max: r.maxPlayers, hasPass: !!r.pass
        }));
        socket.emit('room_list', roomData);
    });

    // Create Manual Room
    socket.on('create_room', (data) => {
        const roomId = 'room_' + Math.random().toString(36).substr(2, 6);
        rooms[roomId] = createRoomObject(roomId, data.name || 'Custom Arena', data.pass || '', data.maxPlayers || 10, false);
        joinRoom(socket, roomId, data.pass);
    });

    // Smart Matchmaking (Autofill existing ones)
    socket.on('join_matchmaking', () => {
        let targetRoom = Object.values(rooms).find(r =>
            r.status === 'waiting' && r.isMatchmaking && r.players.length < r.maxPlayers
        );

        if (!targetRoom) {
            const roomId = 'auto_' + Math.random().toString(36).substr(2, 6);
            targetRoom = createRoomObject(roomId, 'Global Match', '', 10, true);
            rooms[roomId] = targetRoom;
        }

        joinRoom(socket, targetRoom.id, '');
    });

    socket.on('join_room', (data) => {
        joinRoom(socket, data.id, data.pass);
    });

    socket.on('player_move', (data) => {
        const p = players[socket.id];
        if (p && p.room) {
            p.x = data.x; p.y = data.y; p.z = data.z; p.ry = data.ry; p.isWalking = data.isWalking;
            // Broadcast with optimized frequency if needed, but for now every update
            socket.to(p.room).emit('room_update', getRoomPlayers(p.room));

            if (p.role === 'SEEKER' && rooms[p.room]?.status === 'playing') {
                checkCollisions(p);
            }
        }
    });

    socket.on('disconnect', () => {
        const p = players[socket.id];
        if (p?.room) leaveRoom(socket, p.room);
        delete players[socket.id];
    });
});

function createRoomObject(id, name, pass, max, isMM) {
    return {
        id, name, pass,
        maxPlayers: Math.min(10, Math.max(2, max)),
        players: [], status: 'waiting',
        currentRound: 1, scores: { SEEKERS: 0, HIDERS: 0 },
        mazeSeed: Math.floor(Math.random() * 99999),
        isMatchmaking: isMM, timer: 180, roundBusy: false
    };
}

function joinRoom(socket, roomId, pass) {
    const room = rooms[roomId];
    if (!room) return socket.emit('error_msg', 'Arena fully closed');
    if (room.pass && room.pass !== pass) return socket.emit('error_msg', 'Refused: Identity mismatch');
    if (room.players.length >= room.maxPlayers) return socket.emit('error_msg', 'Arena capacity reached');

    const p = players[socket.id];
    if (p.room) leaveRoom(socket, p.room);

    p.room = roomId;
    socket.join(roomId);
    room.players.push(socket.id);

    io.to(roomId).emit('player_joined_room', { count: room.players.length, max: room.maxPlayers });

    if (room.status === 'waiting') {
        if (room.players.length === room.maxPlayers) {
            startMatch(roomId);
        } else if (room.players.length >= 2 && !room.startTimer) {
            room.startTimer = setTimeout(() => startMatch(roomId), 12000);
        }
    }
}

function startMatch(roomId) {
    const room = rooms[roomId];
    if (!room || room.status !== 'waiting') return;
    if (room.startTimer) clearTimeout(room.startTimer);
    room.status = 'playing';
    startRound(roomId);
}

function startRound(roomId) {
    const r = rooms[roomId];
    if (!r) return;
    r.timer = 180;
    r.roundBusy = false;

    // Team Balancing (5 vs 5 logic)
    const shuffled = [...r.players].sort(() => Math.random() - 0.5);
    const split = Math.ceil(shuffled.length / 2);

    shuffled.forEach((sid, i) => {
        const p = players[sid];
        if (!p) return;
        p.role = (i < split) ? 'SEEKER' : 'HIDER';
        p.tagged = false;
        // Spawning: Seekers at 20,20 | Hiders at -20,-20
        p.x = (p.role === 'SEEKER') ? 20 : -20;
        p.z = (p.role === 'SEEKER') ? 20 : -20;
        io.to(sid).emit('room_start', { role: p.role, seed: r.mazeSeed, round: r.currentRound, scores: r.scores });
    });

    if (r.int) clearInterval(r.int);
    r.int = setInterval(() => {
        if (!rooms[roomId]) return clearInterval(r.int);
        r.timer--;
        io.to(roomId).emit('tick', { time: r.timer, round: r.currentRound, scores: r.scores });
        if (r.timer <= 0) endRound(roomId, 'HIDERS', 'TIME UP! HIDERS WON ROUND.');
    }, 1000);
}

function checkCollisions(seeker) {
    const r = rooms[seeker.room];
    if (!r || r.roundBusy) return;

    r.players.forEach(sid => {
        const target = players[sid];
        if (target && target.role === 'HIDER' && !target.tagged) {
            const d = Math.sqrt((seeker.x - target.x) ** 2 + (seeker.z - target.z) ** 2);
            if (d < 1.4) {
                target.tagged = true;
                io.to(seeker.room).emit('tagged', { id: target.userId, name: target.name });
                checkRoundVictory(seeker.room);
            }
        }
    });
}

function checkRoundVictory(rid) {
    const r = rooms[rid];
    if (!r) return;
    const activeHiders = r.players.map(s => players[s]).filter(p => p && p.role === 'HIDER' && !p.tagged);
    if (activeHiders.length === 0) {
        endRound(rid, 'SEEKERS', 'ROUND OVER: ALL CAUGHT!');
    }
}

function endRound(rid, winTeam, msg) {
    const r = rooms[rid];
    if (!r || r.roundBusy) return;
    r.roundBusy = true;
    clearInterval(r.int);

    r.scores[winTeam]++;
    const wonMatch = r.scores[winTeam] >= 2;

    if (wonMatch) {
        finalizeMatch(rid, winTeam, `MATCH OVER: ${winTeam} ARE THE CHAMPIONS!`);
    } else {
        io.to(rid).emit('round_over', { winner: winTeam, msg });
        r.currentRound++;
        setTimeout(() => { if (rooms[rid]) startRound(rid); }, 4000);
    }
}

async function finalizeMatch(rid, winner, msg) {
    io.to(rid).emit('game_over', { winner, msg });
    const r = rooms[rid];
    if (r) {
        for (const sid of r.players) {
            const p = players[sid];
            if (p) {
                if (!p.userId.startsWith('guest_')) {
                    const won = (p.role === (winner === 'SEEKERS' ? 'SEEKER' : 'HIDER'));
                    await User.findOneAndUpdate({ telegramId: p.userId }, { $inc: { [won ? 'wins' : 'losses']: 1 } }).catch(e => { });
                }
                p.room = null;
            }
        }
        delete rooms[rid];
    }
}

function leaveRoom(socket, rid) {
    const r = rooms[rid];
    if (r) {
        r.players = r.players.filter(id => id !== socket.id);
        if (r.players.length === 0) {
            clearInterval(r.int);
            delete rooms[rid];
        } else {
            io.to(rid).emit('player_joined_room', { count: r.players.length, max: r.maxPlayers });
            if (r.status === 'playing') checkRoundVictory(rid);
        }
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

server.listen(process.env.PORT || 3000, () => console.log('GRID RUNNING'));
