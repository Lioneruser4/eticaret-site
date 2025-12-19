const WebSocket = require('ws');
const server = require('http').createServer();
const wss = new WebSocket.Server({ server });

let players = {};
let gameStarted = false;

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(7);
    // İlk giren canavar başlar, diğerleri insan
    const isFirst = Object.keys(players).length === 0;
    players[id] = { id, x: 0, z: 0, ry: 0, role: isFirst ? 'monster' : 'human', health: 100 };

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);

        if (data.type === 'update') {
            if (players[id]) {
                players[id].x = data.pos.x;
                players[id].z = data.pos.z;
                players[id].ry = data.pos.ry;
            }
        }

        if (data.type === 'hit') {
            // Vurma mantığı: Eğer insan canavara vurursa role değişir
            const targetId = data.targetId;
            if (players[targetId] && players[id].role !== players[targetId].role) {
                players[id].role = 'monster';
                players[targetId].role = 'human';
            }
        }

        // Tüm oyunculara güncel durumu gönder
        broadcast({ type: 'sync', players, playerCount: Object.keys(players).length });
    });

    ws.on('close', () => {
        delete players[id];
        broadcast({ type: 'sync', players });
    });
});

function broadcast(data) {
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); });
}

server.listen(process.env.PORT || 10000);
