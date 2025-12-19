const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {};
let ball = { x: 50, y: 50, dx: 0.2, dy: 0.2 }; // Topun konumu ve hızı
let scores = { p1: 0, p2: 0 };

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(7);
    
    // Maksimum 2 oyuncu
    if (Object.keys(players).length >= 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Oda dolu' }));
        ws.close();
        return;
    }

    players[id] = { ws, x: id === 0 ? 20 : 80, y: 50, score: 0 };
    console.log(`Oyuncu bağlandı: ${id}`);

    if (Object.keys(players).length === 2) {
        broadcast({ type: 'game_start' });
    }

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'move' && players[id]) {
            // Hareket sınırlandırma (Saha dışına çıkmasın)
            players[id].x = Math.max(5, Math.min(95, data.x));
            players[id].y = Math.max(5, Math.min(95, data.y));
        }
    });

    ws.on('close', () => {
        delete players[id];
        scores = { p1: 0, p2: 0 }; // Oyuncu çıkınca skoru sıfırla
    });
});

// Oyun Döngüsü (Saniyede 60 kez hesapla)
setInterval(() => {
    if (Object.keys(players).length < 2) return;

    // 1. Top Hareket Ettir
    ball.x += ball.dx;
    ball.y += ball.dy;

    // 2. Duvarlara Çarpma (Üst ve Alt)
    if (ball.y <= 0 || ball.y >= 100) ball.dy *= -1;

    // 3. Gol Kontrolü
    if (ball.x <= 0) {
        scores.p2++;
        resetBall();
    } else if (ball.x >= 100) {
        scores.p1++;
        resetBall();
    }

    // 4. Oyuncu-Top Çarpışma Kontrolü
    Object.values(players).forEach(p => {
        let dist = Math.hypot(p.x - ball.x, p.y - ball.y);
        if (dist < 5) { // Çarpışma mesafesi
            ball.dx *= -1.1; // Hızı artır ve yön değiştir
            ball.dy = (ball.y - p.y) * 0.5; // Açıyı değiştir
        }
    });

    // 5. Herkese Senkronize Et
    const playerArray = Object.values(players);
    broadcast({
        type: 'sync',
        positions: {
            ball,
            p1: { x: playerArray[0].x, y: playerArray[0].y },
            p2: { x: playerArray[1].x, y: playerArray[1].y }
        },
        score: scores
    });
}, 1000 / 60);

function resetBall() {
    ball = { x: 50, y: 50, dx: Math.random() > 0.5 ? 0.3 : -0.3, dy: 0.2 };
}

function broadcast(data) {
    Object.values(players).forEach(p => p.ws.send(JSON.stringify(data)));
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));
