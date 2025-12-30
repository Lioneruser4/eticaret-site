const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let rooms = {};

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => {
        const roomId = "Room_" + Math.random().toString(36).substr(2, 9);
        rooms[roomId] = {
            id: roomId,
            duration: data.duration * 60,
            timer: data.duration * 60,
            players: {},
            ball: { x: 0, y: 1, z: 0, vx: 0, vz: 0 },
            score: { red: 0, blue: 0 }
        };
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinRoom', ({ roomId, user }) => {
        if (!rooms[roomId]) return;
        socket.join(roomId);
        rooms[roomId].players[socket.id] = {
            id: socket.id,
            name: user.name,
            img: user.img,
            team: 'red', // Varsayılan
            x: Math.random() * 10,
            z: Math.random() * 10,
            anim: 'idle'
        };
        io.to(roomId).emit('updateState', rooms[roomId]);
    });

    socket.on('move', (data) => {
        if (rooms[data.roomId] && rooms[data.roomId].players[socket.id]) {
            let p = rooms[data.roomId].players[socket.id];
            p.x = data.x;
            p.z = data.z;
            p.anim = data.anim;
            socket.to(data.roomId).emit('playerMoved', { id: socket.id, x: p.x, z: p.z, anim: p.anim });
        }
    });
});

server.listen(10000, () => console.log('Saskio Arena Running...'));
