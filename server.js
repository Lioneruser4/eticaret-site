const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = {}; // { roomId: { players: {}, ball: {}, timeLeft, scores: {blue:0, red:0} } }

io.on('connection', (socket) => {
    console.log('Bağlandı:', socket.id);

    socket.on('joinLobby', (data) => {
        socket.userData = data;
    });

    socket.on('createRoom', ({ time }) => {
        const roomId = Math.random().toString(36).substr(2, 8).toUpperCase();
        rooms[roomId] = { players: {}, scores: { blue: 0, red: 0 }, timeLeft: time };
        socket.emit('roomCreated', roomId);
        socket.emit('joinRoomSuccess', { roomId });
    });

    socket.on('joinRoom', (roomId) => {
        if (rooms[roomId]) {
            socket.join(roomId);
            const team = Object.values(rooms[roomId].players).filter(p => p.team === 'blue').length <= 
                        Object.values(rooms[roomId].players).filter(p => p.team === 'red').length ? 'blue' : 'red';
            rooms[roomId].players[socket.id] = { team, username: socket.userData.username };
            io.to(roomId).emit('playerJoined', rooms[roomId].players);
            socket.emit('joinRoomSuccess', { roomId, team });
        }
    });

    socket.on('kick', ({ power }) => {
        const roomId = [...socket.rooms][1];
        if (roomId) io.to(roomId).emit('kickBall', power);
    });

    socket.on('disconnect', () => {
        // Oda temizleme vs.
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT}'da çalışıyor`));
