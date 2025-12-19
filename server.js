const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

let players = {};
let matchmakingQueue = [];
let gameActive = false;
const MAX_PLAYERS = 10;

wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Message parse error:', error);
        }
    });

    ws.on('close', () => {
        if (playerId && players[playerId]) {
            delete players[playerId];
            broadcastPlayerCount();
            
            // Matchmaking kuyruğundan çıkar
            const index = matchmakingQueue.indexOf(playerId);
            if (index > -1) {
                matchmakingQueue.splice(index, 1);
            }
            
            console.log(`Player disconnected: ${playerId}`);
            
            // Eğer oyun devam ediyorsa ve oyuncu kaldıysa
            if (gameActive && Object.keys(players).length < 2) {
                endGame();
            }
        }
    });

    function handleMessage(ws, data) {
        switch(data.type) {
            case 'join':
                playerId = data.playerId;
                players[playerId] = {
                    id: playerId,
                    ws: ws,
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    isMonster: false,
                    connected: true
                };
                console.log(`Player joined: ${playerId}`);
                broadcastPlayerCount();
                break;

            case 'findMatch':
                if (!matchmakingQueue.includes(playerId)) {
                    matchmakingQueue.push(playerId);
                    console.log(`Player ${playerId} added to matchmaking queue`);
                    
                    if (matchmakingQueue.length >= 2) {
                        startMatch();
                    }
                }
                break;

            case 'startGame':
                if (Object.keys(players).length >= 2 && !gameActive) {
                    startGame();
                }
                break;

            case 'position':
                if (players[playerId]) {
                    players[playerId].position = data.position;
                    players[playerId].rotation = data.rotation;
                    broadcastPlayerUpdate();
                }
                break;

            case 'attack':
                if (players[playerId] && players[playerId].isMonster && gameActive) {
                    handleAttack(playerId);
                }
                break;
        }
    }
});

function broadcastPlayerCount() {
    const message = JSON.stringify({
        type: 'playerCount',
        count: Object.keys(players).length
    });
    
    broadcastToAll(message);
}

function broadcastPlayerUpdate() {
    const playersData = {};
    Object.keys(players).forEach(id => {
        playersData[id] = {
            id: id,
            position: players[id].position,
            rotation: players[id].rotation,
            isMonster: players[id].isMonster
        };
    });
    
    const message = JSON.stringify({
        type: 'playerUpdate',
        players: playersData
    });
    
    broadcastToAll(message);
}

function broadcastToAll(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function startMatch() {
    console.log('Starting match with players:', matchmakingQueue);
    
    // İlk 2 oyuncuyu al
    const matchPlayers = matchmakingQueue.splice(0, 2);
    
    // Diğer oyuncuları kuyrukta bırak
    matchmakingQueue = matchmakingQueue.filter(id => !matchPlayers.includes(id));
    
    // Seçilen oyunculara bildir
    matchPlayers.forEach(playerId => {
        const player = players[playerId];
        if (player && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
                type: 'matchFound'
            }));
        }
    });
}

function startGame() {
    gameActive = true;
    
    // Rastgele bir canavar seç
    const playerIds = Object.keys(players);
    const monsterIndex = Math.floor(Math.random() * playerIds.length);
    
    playerIds.forEach((id, index) => {
        players[id].isMonster = index === monsterIndex;
        
        // Oyuncuya rolünü bildir
        if (players[id].ws.readyState === WebSocket.OPEN) {
            players[id].ws.send(JSON.stringify({
                type: 'gameStart',
                players: getPlayersData(),
                isMonster: players[id].isMonster
            }));
        }
    });
    
    console.log('Game started! Monster:', playerIds[monsterIndex]);
}

function getPlayersData() {
    const playersData = {};
    Object.keys(players).forEach(id => {
        playersData[id] = {
            id: id,
            position: players[id].position,
            rotation: players[id].rotation,
            isMonster: players[id].isMonster
        };
    });
    return playersData;
}

function handleAttack(attackerId) {
    if (!players[attackerId] || !players[attackerId].isMonster) return;
    
    const attacker = players[attackerId];
    
    // Saldırı menzili içindeki en yakın insanı bul
    let closestHuman = null;
    let closestDistance = 5; // Saldırı menzili
    
    Object.keys(players).forEach(id => {
        if (!players[id].isMonster && id !== attackerId) {
            const human = players[id];
            const distance = Math.sqrt(
                Math.pow(attacker.position.x - human.position.x, 2) +
                Math.pow(attacker.position.z - human.position.z, 2)
            );
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestHuman = id;
            }
        }
    });
    
    if (closestHuman) {
        // Rolleri değiştir
        players[attackerId].isMonster = false;
        players[closestHuman].isMonster = true;
        
        // Tüm oyunculara bildir
        const message = JSON.stringify({
            type: 'roleChange',
            newRole: 'monster',
            targetPlayerId: closestHuman
        });
        
        broadcastToAll(message);
        
        // Eski canavara insan olduğunu bildir
        if (players[attackerId].ws.readyState === WebSocket.OPEN) {
            players[attackerId].ws.send(JSON.stringify({
                type: 'roleChange',
                newRole: 'human',
                targetPlayerId: attackerId
            }));
        }
        
        console.log(`Role changed: ${closestHuman} is now monster`);
    }
}

function endGame() {
    gameActive = false;
    
    // Kazananı belirle (son kalan canavar)
    let winner = null;
    Object.keys(players).forEach(id => {
        if (players[id].isMonster) {
            winner = id;
        }
    });
    
    const message = JSON.stringify({
        type: 'gameOver',
        winner: winner
    });
    
    broadcastToAll(message);
    console.log('Game ended. Winner:', winner);
}

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Her 30 saniyede bir boş kuyrukları temizle
setInterval(() => {
    if (matchmakingQueue.length > 0 && !gameActive) {
        console.log('Cleaning up matchmaking queue');
        matchmakingQueue = [];
    }
}, 30000);
