const WebSocket = require('ws');
const server = require('http').createServer();
const wss = new WebSocket.Server({ server });

let gameState = {
    ball: { x: 0, y: 0.8, z: 0, vx: 0, vz: 0 },
    players: {},
    score: [0, 0]
};

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(7);
    gameState.players[id] = { x: 0, z: 20, team: Object.keys(gameState.players).length === 0 ? 0 : 1 };

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if(data.type === 'input') {
            const p = gameState.players[id];
            p.x += data.dx * 0.5;
            p.z += data.dz * 0.5;

            // Topa Vuruş Kontrolü
            let dist = Math.hypot(p.x - gameState.ball.x, p.z - gameState.ball.z);
            if(dist < 2) {
                gameState.ball.vx = (gameState.ball.x - p.x) * 0.8;
                gameState.ball.vz = (gameState.ball.z - p.z) * 0.8;
                if(data.shoot) { gameState.ball.vz *= 3; gameState.ball.vx *= 3; }
            }
        }
    });
});

// Fizik Döngüsü
setInterval(() => {
    // Sürtünme ve Hareket
    gameState.ball.x += gameState.ball.vx;
    gameState.ball.z += gameState.ball.vz;
    gameState.ball.vx *= 0.98;
    gameState.ball.vz *= 0.98;

    // Gol Kontrolü
    if(Math.abs(gameState.ball.z) > 50) {
        if(Math.abs(gameState.ball.x) < 7.5) {
            gameState.ball.z > 0 ? gameState.score[0]++ : gameState.score[1]++;
            resetBall();
        } else {
            gameState.ball.vx *= -1; // Direkten veya dışarıdan dönme
        }
    }
    
    // Herkese Yayınla
    const update = JSON.stringify({ type: 'sync', state: gameState });
    wss.clients.forEach(c => c.send(update));
}, 1000 / 60);

function resetBall() {
    gameState.ball = { x: 0, y: 0.8, z: 0, vx: 0, vz: 0 };
}

server.listen(10000);
