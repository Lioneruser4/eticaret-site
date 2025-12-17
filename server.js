const io = require('socket.io')(process.env.PORT || 3000, { cors: { origin: "*" } });

let players = {};
let gameTime = 300; // 5 Dakika

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        players[socket.id] = { id: data.id, name: data.name, team: 'hider', x: 0, y: 0, z: 0 };
        // Takım atama mantığı: Eğer ebe yoksa ilk giren ebe olur.
    });

    socket.on('move', (pos) => {
        if(players[socket.id]) {
            players[socket.id].x = pos.x;
            io.emit('update', players);
        }
    });
});
