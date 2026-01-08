const express = require('express');
const socketIo = require('socket.io');
const app = express();
const server = require('http').createServer(app);

const io = socketIo(server, { cors: { origin: "*" } });
const players = {};

io.on('connection', (socket) => {
    console.log('Yeni oyuncu bağlandı:', socket.id);
    players[socket.id] = { x: 0, y: 0, z: 0, name: `User_${socket.id}` };

    // Yeni gelen oyuncuya mevcut oyuncuları gönder
    socket.emit('currentPlayers', players);
    // Diğer oyunculara yeni oyuncuyu haber ver
    socket.broadcast.emit('newPlayer', { id: socket.id, ...players[socket.id] });

    // Bir oyuncu hareket ettiğinde
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id] = { ...players[socket.id], ...movementData };
            // Hareketi tüm oyunculara yay
            socket.broadcast.emit('playerMoved', { id: socket.id, ...movementData });
        }
    });

    socket.on('disconnect', () => {
        console.log('Oyuncu ayrıldı:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

server.listen(3000, () => console.log('Sunucu 3000 portunda çalışıyor.'));
