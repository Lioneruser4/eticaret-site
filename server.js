/**
 * ULTRA STRIKE 3D - BATTLE SERVER
 * Multi-player Deathmatch Engine
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');

const MONGO_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/?appName=sayt';
mongoose.connect(MONGO_URI).then(() => console.log('DB Ready')).catch(e => console.error(e));

const User = mongoose.model('User', new mongoose.Schema({
    telegramId: String, name: String, photo: String, kills: { type: Number, default: 0 }, deaths: { type: Number, default: 0 }
}));

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", credentials: true } });

const players = {};
const projectiles = [];

// Arena Config
const SPAWN_POINTS = [
    { x: -15, z: -15 }, { x: 15, z: 15 }, { x: -15, z: 15 }, { x: 15, z: -15 },
    { x: 0, z: -20 }, { x: 0, z: 20 }, { x: -20, z: 0 }, { x: 20, z: 0 }
];

io.on('connection', async (socket) => {
    const q = socket.handshake.query;
    if (!q.id) return;

    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];

    players[socket.id] = {
        id: socket.id,
        userId: q.id,
        name: q.name || 'Agent',
        photo: q.photo || '',
        x: spawn.x, y: 1.7, z: spawn.z,
        ry: 0,
        hp: 100,
        kills: 0,
        deaths: 0,
        color: '#' + Math.floor(Math.random() * 16777215).toString(16)
    };

    if (!q.id.startsWith('guest_')) {
        await User.findOneAndUpdate({ telegramId: q.id }, { name: q.name, photo: q.photo }, { upsert: true });
    }

    // Handshake
    socket.emit('init', { id: socket.id, players });
    socket.broadcast.emit('player_joined', players[socket.id]);

    socket.on('move', (data) => {
        const p = players[socket.id];
        if (p) {
            p.x = data.x; p.y = data.y; p.z = data.z; p.ry = data.ry;
            socket.broadcast.emit('update', players);
        }
    });

    socket.on('shoot', (data) => {
        // Bullet data: position, direction, color
        const bullet = {
            owner: socket.id,
            pos: data.pos,
            dir: data.dir,
            color: players[socket.id]?.color || '#fff',
            time: Date.now()
        };
        socket.broadcast.emit('bullet_fired', bullet);
    });

    socket.on('hit', (data) => {
        const target = players[data.targetId];
        const shooter = players[socket.id];
        if (target && shooter && target.hp > 0) {
            target.hp -= 35; // 3 shots to kill (100 -> 65 -> 30 -> -5)

            if (target.hp <= 0) {
                target.deaths++;
                shooter.kills++;

                io.emit('kill_log', { killer: shooter.name, victim: target.name });

                // Respawn
                setTimeout(() => {
                    const rs = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
                    target.hp = 100;
                    target.x = rs.x; target.z = rs.z;
                    io.to(data.targetId).emit('respawn', { x: rs.x, z: rs.z });
                }, 2000);
            }

            io.emit('player_stats', players);
        }
    });

    socket.on('disconnect', () => {
        io.emit('player_left', socket.id);
        delete players[socket.id];
    });
});

server.listen(process.env.PORT || 3000, () => console.log('WARZONE ACTIVE'));
