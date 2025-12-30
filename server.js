const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();
const players = new Map();

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        handleDisconnect(ws);
    });
});

function handleMessage(ws, data) {
    switch (data.type) {
        case 'join':
            handleJoin(ws, data);
            break;
        case 'createRoom':
            handleCreateRoom(ws, data);
            break;
        case 'joinRoom':
            handleJoinRoom(ws, data);
            break;
        case 'switchTeam':
            handleSwitchTeam(ws, data);
            break;
        case 'startGame':
            handleStartGame(ws, data);
            break;
        case 'playerMove':
            handlePlayerMove(ws, data);
            break;
        case 'shoot':
            handleShoot(ws, data);
            break;
        case 'jump':
            handleJump(ws, data);
            break;
    }
}

function handleJoin(ws, data) {
    const player = {
        id: data.userId,
        username: data.username,
        photo: data.photo,
        ws: ws,
        team: null,
        room: null,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 }
    };
    
    players.set(ws, player);
    
    ws.send(JSON.stringify({
        type: 'joined',
        playerId: player.id
    }));
}

function handleCreateRoom(ws, data) {
    const player = players.get(ws);
    if (!player) return;
    
    const roomId = generateRoomId();
    const room = {
        id: roomId,
        host: player.id,
        players: [player],
        maxPlayers: data.maxPlayers || 22,
        duration: data.duration || 10,
        blueTeam: [],
        redTeam: [],
        gameState: {
            ball: { x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0 },
            blueScore: 0,
            redScore: 0,
            startTime: null,
            isPlaying: false
        }
    };
    
    player.room = roomId;
    player.team = 'blue';
    room.blueTeam.push(player);
    
    rooms.set(roomId, room);
    
    ws.send(JSON.stringify({
        type: 'roomCreated',
        room: serializeRoom(room)
    }));
}

function handleJoinRoom(ws, data) {
    const player = players.get(ws);
    const room = rooms.get(data.roomId);
    
    if (!player || !room) return;
    
    if (room.players.length >= room.maxPlayers) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Oda dolu'
        }));
        return;
    }
    
    player.room = data.roomId;
    player.team = room.blueTeam.length <= room.redTeam.length ? 'blue' : 'red';
    
    if (player.team === 'blue') {
        room.blueTeam.push(player);
        player.position = { x: -5, y: 0, z: -10 - room.blueTeam.length * 2 };
    } else {
        room.redTeam.push(player);
        player.position = { x: 5, y: 0, z: 10 + room.redTeam.length * 2 };
    }
    
    room.players.push(player);
    
    broadcastToRoom(room, {
        type: 'playerJoined',
        player: serializePlayer(player)
    });
}

function handleSwitchTeam(ws, data) {
    const player = players.get(ws);
    if (!player || !player.room) return;
    
    const room = rooms.get(player.room);
    if (!room || room.gameState.isPlaying) return;
    
    if (player.team === 'blue') {
        const index = room.blueTeam.indexOf(player);
        if (index > -1) {
            room.blueTeam.splice(index, 1);
            room.redTeam.push(player);
            player.team = 'red';
            player.position = { x: 5, y: 0, z: 10 + room.redTeam.length * 2 };
        }
    } else {
        const index = room.redTeam.indexOf(player);
        if (index > -1) {
            room.redTeam.splice(index, 1);
            room.blueTeam.push(player);
            player.team = 'blue';
            player.position = { x: -5, y: 0, z: -10 - room.blueTeam.length * 2 };
        }
    }
    
    broadcastToRoom(room, {
        type: 'teamSwitched',
        playerId: player.id,
        newTeam: player.team,
        position: player.position
    });
}

function handleStartGame(ws, data) {
    const player = players.get(ws);
    if (!player || !player.room) return;
    
    const room = rooms.get(player.room);
    if (!room || player.id !== room.host) return;
    
    room.gameState.isPlaying = true;
    room.gameState.startTime = Date.now();
    room.gameState.blueScore = 0;
    room.gameState.redScore = 0;
    room.gameState.ball = { x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0 };
    
    broadcastToRoom(room, {
        type: 'gameStarted',
        gameState: room.gameState
    });
    
    startGameLoop(room);
}

function handlePlayerMove(ws, data) {
    const player = players.get(ws);
    if (!player || !player.room) return;
    
    const room = rooms.get(player.room);
    if (!room || !room.gameState.isPlaying) return;
    
    player.position.x = Math.max(-19, Math.min(19, data.x));
    player.position.y = Math.max(0, data.y);
    player.position.z = Math.max(-29, Math.min(29, data.z));
    player.velocity = data.velocity || { x: 0, y: 0, z: 0 };
    
    broadcastToRoom(room, {
        type: 'playerMoved',
        playerId: player.id,
        position: player.position,
        velocity: player.velocity
    }, ws);
}

function handleShoot(ws, data) {
    const player = players.get(ws);
    if (!player || !player.room) return;
    
    const room = rooms.get(player.room);
    if (!room || !room.gameState.isPlaying) return;
    
    const ball = room.gameState.ball;
    const dx = ball.x - player.position.x;
    const dy = ball.y - player.position.y;
    const dz = ball.z - player.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (dist < 2) {
        const power = data.power || 1.5;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0) {
            ball.vx = (dx / len) * power;
            ball.vz = (dz / len) * power;
            ball.vy = 0.3;
        }
        
        broadcastToRoom(room, {
            type: 'ballKicked',
            playerId: player.id,
            ball: ball
        });
    }
}

function handleJump(ws, data) {
    const player = players.get(ws);
    if (!player || !player.room) return;
    
    const room = rooms.get(player.room);
    if (!room || !room.gameState.isPlaying) return;
    
    if (player.position.y === 0) {
        player.velocity.y = 0.4;
        
        broadcastToRoom(room, {
            type: 'playerJumped',
            playerId: player.id
        });
    }
}

function handleDisconnect(ws) {
    const player = players.get(ws);
    if (!player) return;
    
    if (player.room) {
        const room = rooms.get(player.room);
        if (room) {
            const index = room.players.indexOf(player);
            if (index > -1) {
                room.players.splice(index, 1);
            }
            
            if (player.team === 'blue') {
                const idx = room.blueTeam.indexOf(player);
                if (idx > -1) room.blueTeam.splice(idx, 1);
            } else {
                const idx = room.redTeam.indexOf(player);
                if (idx > -1) room.redTeam.splice(idx, 1);
            }
            
            broadcastToRoom(room, {
                type: 'playerLeft',
                playerId: player.id
            });
            
            if (room.players.length === 0) {
                rooms.delete(player.room);
            }
        }
    }
    
    players.delete(ws);
}

function startGameLoop(room) {
    const gameInterval = setInterval(() => {
        if (!room.gameState.isPlaying) {
            clearInterval(gameInterval);
            return;
        }
        
        const elapsed = Date.now() - room.gameState.startTime;
        const duration = room.duration * 60 * 1000;
        
        if (elapsed >= duration) {
            room.gameState.isPlaying = false;
            broadcastToRoom(room, {
                type: 'gameEnded',
                blueScore: room.gameState.blueScore,
                redScore: room.gameState.redScore
            });
            clearInterval(gameInterval);
            return;
        }
        
        updateBallPhysics(room);
        checkGoals(room);
        
        broadcastToRoom(room, {
            type: 'gameState',
            ball: room.gameState.ball,
            players: room.players.map(p => ({
                id: p.id,
                position: p.position,
                velocity: p.velocity,
                team: p.team
            }))
        });
    }, 1000 / 30);
}

function updateBallPhysics(room) {
    const ball = room.gameState.ball;
    
    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.z += ball.vz;
    
    ball.vx *= 0.98;
    ball.vz *= 0.98;
    ball.vy -= 0.02;
    
    if (ball.y <= 0.5) {
        ball.y = 0.5;
        ball.vy *= -0.6;
    }
    
    if (Math.abs(ball.x) > 19) {
        ball.vx *= -0.8;
        ball.x = Math.sign(ball.x) * 19;
    }
    
    if (Math.abs(ball.z) > 29) {
        ball.vz *= -0.8;
        ball.z = Math.sign(ball.z) * 29;
    }
    
    room.players.forEach(player => {
        const dx = ball.x - player.position.x;
        const dy = ball.y - player.position.y;
        const dz = ball.z - player.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist < 1) {
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0) {
                ball.vx = (dx / len) * 0.3;
                ball.vz = (dz / len) * 0.3;
            }
        }
    });
}

function checkGoals(room) {
    const ball = room.gameState.ball;
    
    if (ball.z < -29 && Math.abs(ball.x) < 4 && ball.y < 3) {
        room.gameState.redScore++;
        resetBall(room);
        
        broadcastToRoom(room, {
            type: 'goal',
            team: 'red',
            blueScore: room.gameState.blueScore,
            redScore: room.gameState.redScore
        });
    }
    
    if (ball.z > 29 && Math.abs(ball.x) < 4 && ball.y < 3) {
        room.gameState.blueScore++;
        resetBall(room);
        
        broadcastToRoom(room, {
            type: 'goal',
            team: 'blue',
            blueScore: room.gameState.blueScore,
            redScore: room.gameState.redScore
        });
    }
}

function resetBall(room) {
    room.gameState.ball = {
        x: 0,
        y: 0.5,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0
    };
}

function broadcastToRoom(room, message, excludeWs = null) {
    room.players.forEach(player => {
        if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(message));
        }
    });
}

function serializeRoom(room) {
    return {
        id: room.id,
        host: room.host,
        maxPlayers: room.maxPlayers,
        duration: room.duration,
        playerCount: room.players.length,
        blueTeam: room.blueTeam.map(p => serializePlayer(p)),
        redTeam: room.redTeam.map(p => serializePlayer(p)),
        gameState: room.gameState
    };
}

function serializePlayer(player) {
    return {
        id: player.id,
        username: player.username,
        photo: player.photo,
        team: player.team,
        position: player.position,
        velocity: player.velocity
    };
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
