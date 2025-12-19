const WebSocket = require('ws');
const server = require('http').createServer();
const wss = new WebSocket.Server({ server });

let players = {};

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(7);
    players[id] = { x: 0, z: 0, ry: 0 };
    console.log("Yeni oyuncu girdi:", id);

    ws.on('message', (msg) => {
        try {
            const pos = JSON.parse(msg);
            players[id] = pos;
            
            // Herkese diğer oyuncuların yerini gönder
            const data = JSON.stringify({ type: 'sync', players });
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(data);
            });
        } catch(e) {}
    });

    ws.on('close', () => {
        delete players[id];
    });
});

server.listen(process.env.PORT || 10000);
