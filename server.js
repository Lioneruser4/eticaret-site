const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

let players = {};

io.on('connection', (socket) => {
    players[socket.id] = { pos: {x:0, y:0, z:0}, rot: 0, health: 100 };
    
    socket.on('move', (data) => {
        if(players[socket.id]) {
            players[socket.id].pos = data.pos;
            players[socket.id].rot = data.rot;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// Anlık durum güncelleme (30ms'de bir)
setInterval(() => {
    io.emit('state', players);
}, 30);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server ' + PORT + ' portunda aktif.'));
