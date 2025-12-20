const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    // Health check endpoint for Render
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            rooms: rooms.size,
            players: players.size,
            timestamp: Date.now()
        }));
        return;
    }
    
    // CORS headers
    res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    
    if (req.method === 'OPTIONS') {
        res.end();
        return;
    }
    
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Backrooms Hunt WebSocket Server');
});

const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: {
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
        },
        zlibInflateOptions: {
            chunkSize: 10 * 1024
        },
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        serverMaxWindowBits: 10,
        concurrencyLimit: 10,
        threshold: 1024
    }
});

// Simple in-memory storage
const rooms = new Map();
const players = new Map();
const quickMatchQueue = [];

// Generate room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Generate player ID
function generatePlayerId() {
    return 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection from:', req.socket.remoteAddress);
    
    let playerId = null;
    let roomCode = null;
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to Backrooms Hunt Server',
        timestamp: Date.now()
    }));
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Parse error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid JSON format'
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected:', playerId);
        
        if (playerId && players.has(playerId)) {
            const player = players.get(playerId);
            
            // Remove from room
            if (player.room && rooms.has(player.room)) {
                const room = rooms.get(player.room);
                room.players = room.players.filter(p => p.id !== playerId);
                
                // Broadcast player left
                broadcastToRoom(room.code, {
                    type: 'playerLeft',
                    playerId: playerId,
                    playerName: player.name,
                    players: room.players
                });
                
                // Remove empty room
                if (room.players.length === 0) {
                    rooms.delete(room.code);
                    console.log('Room deleted:', room.code);
                }
            }
            
            // Remove from players
            players.delete(playerId);
        }
        
        // Remove from queue
        const queueIndex = quickMatchQueue.indexOf(playerId);
        if (queueIndex > -1) {
            quickMatchQueue.splice(queueIndex, 1);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    
    function handleMessage(ws, message) {
        switch (message.type) {
            case 'init':
                handleInit(ws, message);
                break;
                
            case 'createRoom':
                handleCreateRoom(ws, message);
                break;
                
            case 'joinRoom':
                handleJoinRoom(ws, message);
                break;
                
            case 'quickMatch':
                handleQuickMatch(ws, message);
                break;
                
            case 'leaveRoom':
                handleLeaveRoom(ws, message);
                break;
                
            case 'setReady':
                handleSetReady(ws, message);
                break;
                
            case 'startGame':
                handleStartGame(ws, message);
                break;
                
            case 'updatePosition':
                handleUpdatePosition(ws, message);
                break;
                
            case 'capturePlayer':
                handleCapturePlayer(ws, message);
                break;
                
            case 'takePhoto':
                handleTakePhoto(ws, message);
                break;
                
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                break;
                
            default:
                console.log('Unknown message type:', message.type);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Unknown message type: ' + message.type
                }));
        }
    }
    
    function handleInit(ws, message) {
        playerId = message.playerId || generatePlayerId();
        const playerName = message.playerName || 'Player';
        
        players.set(playerId, {
            id: playerId,
            name: playerName,
            ws: ws,
            room: null,
            isReady: false,
            isHost: false,
            isHunter: false,
            isAlive: true,
            position: { x: 0, y: 0, z: 0 },
            stats: {
                photos: 0,
                hunts: 0,
                timeSurvived: 0,
                xp: 0
            }
        });
        
        console.log('Player initialized:', playerName, playerId);
        
        ws.send(JSON.stringify({
            type: 'initSuccess',
            playerId: playerId,
            playerName: playerName
        }));
    }
    
    function handleCreateRoom(ws, message) {
        if (!playerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Player not initialized' }));
            return;
        }
        
        const player = players.get(playerId);
        if (!player) {
            ws.send(JSON.stringify({ type: 'error', message: 'Player not found' }));
            return;
        }
        
        const roomName = message.roomName || `${player.name}'s Room`;
        const maxPlayers = Math.min(Math.max(parseInt(message.maxPlayers) || 10, 2), 20);
        const gameTime = Math.min(Math.max(parseInt(message.gameTime) || 5, 1), 30);
        
        // Generate unique room code
        let roomCode;
        do {
            roomCode = generateRoomCode();
        } while (rooms.has(roomCode));
        
        const room = {
            code: roomCode,
            name: roomName,
            host: playerId,
            maxPlayers: maxPlayers,
            gameTime: gameTime,
            players: [player],
            gameState: {
                active: false,
                startedAt: null,
                timeRemaining: 0,
                hunter: null,
                photos: []
            }
        };
        
        player.room = roomCode;
        player.isHost = true;
        
        rooms.set(roomCode, room);
        roomCode = roomCode;
        
        console.log('Room created:', roomCode, 'by', player.name);
        
        ws.send(JSON.stringify({
            type: 'roomCreated',
            roomCode: roomCode,
            room: {
                code: roomCode,
                name: roomName,
                maxPlayers: maxPlayers,
                gameTime: gameTime,
                playerCount: 1,
                gameActive: false
            },
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                isReady: p.isReady,
                isHunter: p.isHunter,
                isAlive: p.isAlive
            })),
            isHunter: player.isHunter
        }));
    }
    
    function handleJoinRoom(ws, message) {
        if (!playerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Player not initialized' }));
            return;
        }
        
        const player = players.get(playerId);
        if (!player) {
            ws.send(JSON.stringify({ type: 'error', message: 'Player not found' }));
            return;
        }
        
        const joinCode = message.roomCode?.toUpperCase();
        if (!joinCode || joinCode.length !== 6) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code' }));
            return;
        }
        
        const room = rooms.get(joinCode);
        if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
            return;
        }
        
        if (room.gameState.active) {
            ws.send(JSON.stringify({ type: 'error', message: 'Game already started' }));
            return;
        }
        
        if (room.players.length >= room.maxPlayers) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
            return;
        }
        
        // Leave current room if any
        if (player.room && rooms.has(player.room)) {
            const oldRoom = rooms.get(player.room);
            oldRoom.players = oldRoom.players.filter(p => p.id !== playerId);
            broadcastToRoom(oldRoom.code, {
                type: 'playerLeft',
                playerId: playerId,
                playerName: player.name,
                players: oldRoom.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost,
                    isReady: p.isReady,
                    isHunter: p.isHunter,
                    isAlive: p.isAlive
                }))
            });
            
            if (oldRoom.players.length === 0) {
                rooms.delete(oldRoom.code);
            }
        }
        
        // Join new room
        player.room = joinCode;
        player.isHost = false;
        player.isReady = false;
        room.players.push(player);
        roomCode = joinCode;
        
        console.log('Player joined:', player.name, '->', joinCode);
        
        // Notify all players in room
        broadcastToRoom(joinCode, {
            type: 'playerJoined',
            playerId: playerId,
            playerName: player.name,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                isReady: p.isReady,
                isHunter: p.isHunter,
                isAlive: p.isAlive
            }))
        });
        
        // Send success to joining player
        ws.send(JSON.stringify({
            type: 'roomJoined',
            roomCode: joinCode,
            room: {
                code: joinCode,
                name: room.name,
                maxPlayers: room.maxPlayers,
                gameTime: room.gameTime,
                playerCount: room.players.length,
                gameActive: false
            },
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                isReady: p.isReady,
                isHunter: p.isHunter,
                isAlive: p.isAlive
            })),
            isHunter: player.isHunter
        }));
    }
    
    function handleQuickMatch(ws, message) {
        if (!playerId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Player not initialized' }));
            return;
        }
        
        const player = players.get(playerId);
        if (!player) {
            ws.send(JSON.stringify({ type: 'error', message: 'Player not found' }));
            return;
        }
        
        // Add to queue
        if (!quickMatchQueue.includes(playerId)) {
            quickMatchQueue.push(playerId);
        }
        
        console.log('Quick match queue:', quickMatchQueue.length, 'players');
        
        ws.send(JSON.stringify({
            type: 'quickMatchQueued',
            position: quickMatchQueue.indexOf(playerId) + 1,
            total: quickMatchQueue.length
        }));
        
        // Try to create match
        if (quickMatchQueue.length >= 2) {
            createQuickMatch();
        }
    }
    
    function createQuickMatch() {
        if (quickMatchQueue.length < 2) return;
        
        // Take first 2-10 players
        const matchSize = Math.min(quickMatchQueue.length, 10);
        const matchPlayers = quickMatchQueue.splice(0, matchSize)
            .map(id => players.get(id))
            .filter(p => p);
        
        if (matchPlayers.length < 2) return;
        
        // Create room
        const roomCode = generateRoomCode();
        const host = matchPlayers[0];
        
        const room = {
            code: roomCode,
            name: `Quick Match ${roomCode}`,
            host: host.id,
            maxPlayers: matchSize,
            gameTime: 5, // 5 minutes for quick match
            players: matchPlayers,
            gameState: {
                active: false,
                startedAt: null,
                timeRemaining: 0,
                hunter: null,
                photos: []
            }
        };
        
        // Set room for all players
        matchPlayers.forEach((p, index) => {
            p.room = roomCode;
            p.isHost = index === 0;
            p.isReady = false;
        });
        
        rooms.set(roomCode, room);
        
        console.log('Quick match created:', roomCode, 'with', matchPlayers.length, 'players');
        
        // Notify all players
        matchPlayers.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(JSON.stringify({
                    type: 'roomJoined',
                    roomCode: roomCode,
                    room: {
                        code: roomCode,
                        name: room.name,
                        maxPlayers: room.maxPlayers,
                        gameTime: room.gameTime,
                        playerCount: room.players.length,
                        gameActive: false
                    },
                    players: room.players.map(player => ({
                        id: player.id,
                        name: player.name,
                        isHost: player.isHost,
                        isReady: player.isReady,
                        isHunter: player.isHunter,
                        isAlive: player.isAlive
                    })),
                    isHunter: p.isHunter,
                    isQuickMatch: true
                }));
            }
        }));
        
        // Auto-start after 5 seconds
        setTimeout(() => {
            if (rooms.has(roomCode) && !rooms.get(roomCode).gameState.active) {
                startQuickMatchGame(roomCode);
            }
        }, 5000);
    }
    
    function startQuickMatchGame(roomCode) {
        const room = rooms.get(roomCode);
        if (!room || room.gameState.active || room.players.length < 2) return;
        
        // Set all players ready
        room.players.forEach(p => {
            p.isReady = true;
        });
        
        startGameInRoom(room);
    }
    
    function handleLeaveRoom(ws, message) {
        if (!playerId || !roomCode) return;
        
        const player = players.get(playerId);
        const room = rooms.get(roomCode);
        
        if (!player || !room) return;
        
        // Remove player from room
        room.players = room.players.filter(p => p.id !== playerId);
        player.room = null;
        
        // Broadcast leave
        broadcastToRoom(roomCode, {
            type: 'playerLeft',
            playerId: playerId,
            playerName: player.name,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                isReady: p.isReady,
                isHunter: p.isHunter,
                isAlive: p.isAlive
            }))
        });
        
        // Delete empty room
        if (room.players.length === 0) {
            rooms.delete(roomCode);
            console.log('Room deleted (empty):', roomCode);
        } else if (player.isHost) {
            // Assign new host
            room.players[0].isHost = true;
            room.host = room.players[0].id;
            
            broadcastToRoom(roomCode, {
                type: 'newHost',
                hostId: room.players[0].id,
                players: room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost,
                    isReady: p.isReady,
                    isHunter: p.isHunter,
                    isAlive: p.isAlive
                }))
            });
        }
        
        roomCode = null;
        
        ws.send(JSON.stringify({
            type: 'leftRoom',
            roomCode: roomCode
        }));
    }
    
    function handleSetReady(ws, message) {
        if (!playerId || !roomCode) return;
        
        const player = players.get(playerId);
        const room = rooms.get(roomCode);
        
        if (!player || !room || room.gameState.active) return;
        
        player.isReady = message.isReady !== undefined ? message.isReady : !player.isReady;
        
        broadcastToRoom(roomCode, {
            type: 'playerReady',
            playerId: playerId,
            isReady: player.isReady,
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                isReady: p.isReady,
                isHunter: p.isHunter,
                isAlive: p.isAlive
            }))
        });
    }
    
    function handleStartGame(ws, message) {
        if (!playerId || !roomCode) return;
        
        const player = players.get(playerId);
        const room = rooms.get(roomCode);
        
        if (!player || !room || room.gameState.active) return;
        
        // Check if player is host
        if (!player.isHost) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only host can start game' }));
            return;
        }
        
        // Check if all players are ready
        if (!room.players.every(p => p.isReady)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not all players are ready' }));
            return;
        }
        
        if (room.players.length < 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'Need at least 2 players' }));
            return;
        }
        
        startGameInRoom(room);
    }
    
    function startGameInRoom(room) {
        room.gameState.active = true;
        room.gameState.startedAt = Date.now();
        room.gameState.timeRemaining = room.gameTime * 60;
        room.gameState.photos = [];
        
        // Select random hunter
        const hunterIndex = Math.floor(Math.random() * room.players.length);
        room.gameState.hunter = room.players[hunterIndex].id;
        
        // Set roles
        room.players.forEach((p, index) => {
            p.isHunter = p.id === room.gameState.hunter;
            p.isAlive = true;
            p.stats.photos = 0;
            p.stats.hunts = 0;
            p.stats.timeSurvived = 0;
            p.stats.xp = 0;
            
            // Random starting position
            p.position = {
                x: (Math.random() - 0.5) * 40,
                y: 0,
                z: (Math.random() - 0.5) * 40
            };
        });
        
        console.log('Game started in room:', room.code, 'Hunter:', room.gameState.hunter);
        
        // Broadcast game start
        broadcastToRoom(room.code, {
            type: 'gameStarting',
            players: room.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                isReady: p.isReady,
                isHunter: p.isHunter,
                isAlive: p.isAlive,
                position: p.position,
                stats: p.stats
            })),
            isHunter: room.players.find(p => p.id === playerId)?.isHunter || false,
            gameTime: room.gameState.timeRemaining,
            gameState: {
                active: true,
                hunter: room.gameState.hunter,
                timeRemaining: room.gameState.timeRemaining,
                photos: []
            }
        });
        
        // Start game timer
        room.gameTimer = setInterval(() => {
            if (!room.gameState.active) {
                clearInterval(room.gameTimer);
                return;
            }
            
            room.gameState.timeRemaining--;
            
            if (room.gameState.timeRemaining <= 0) {
                endGame(room.code, 'time');
                clearInterval(room.gameTimer);
                return;
            }
            
            // Update survival time
            room.players.forEach(p => {
                if (p.isAlive) {
                    p.stats.timeSurvived++;
                }
            });
            
            // Broadcast update
            broadcastToRoom(room.code, {
                type: 'gameUpdate',
                timeRemaining: room.gameState.timeRemaining,
                gameState: {
                    active: room.gameState.active,
                    hunter: room.gameState.hunter,
                    timeRemaining: room.gameState.timeRemaining,
                    photos: room.gameState.photos
                }
            });
            
            // Check win conditions
            const aliveRunners = room.players.filter(p => !p.isHunter && p.isAlive);
            if (aliveRunners.length === 0) {
                endGame(room.code, 'capture');
                clearInterval(room.gameTimer);
            }
        }, 1000);
    }
    
    function handleUpdatePosition(ws, message) {
        if (!playerId || !roomCode) return;
        
        const player = players.get(playerId);
        const room = rooms.get(roomCode);
        
        if (!player || !room || !room.gameState.active || !player.isAlive) return;
        
        player.position = message.position;
        player.rotation = message.rotation;
        
        // Broadcast to other players
        broadcastToRoomExcept(room.code, playerId, {
            type: 'playerPosition',
            playerId: playerId,
            position: player.position,
            rotation: player.rotation,
            isHunter: player.isHunter
        });
    }
    
    function handleCapturePlayer(ws, message) {
        if (!playerId || !roomCode) return;
        
        const hunter = players.get(playerId);
        const room = rooms.get(roomCode);
        
        if (!hunter || !room || !room.gameState.active || !hunter.isHunter || !hunter.isAlive) return;
        
        const targetId = message.targetId;
        const target = players.get(targetId);
        
        if (!target || target.isHunter || !target.isAlive) return;
        
        // Simple distance check (in real game, use actual positions)
        const dx = hunter.position.x - target.position.x;
        const dz = hunter.position.z - target.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < 2.5) { // Capture range
            target.isAlive = false;
            hunter.stats.hunts++;
            hunter.stats.xp += 50;
            
            broadcastToRoom(room.code, {
                type: 'playerCaptured',
                hunterId: hunter.id,
                runnerId: target.id,
                hunterName: hunter.name,
                runnerName: target.name
            });
            
            console.log('Player captured:', target.name, 'by', hunter.name);
            
            // Check if game should end
            const aliveRunners = room.players.filter(p => !p.isHunter && p.isAlive);
            if (aliveRunners.length === 0) {
                endGame(room.code, 'capture');
            }
        }
    }
    
    function handleTakePhoto(ws, message) {
        if (!playerId || !roomCode) return;
        
        const player = players.get(playerId);
        const room = rooms.get(roomCode);
        
        if (!player || !room || !room.gameState.active || !player.isAlive) return;
        
        const photoId = 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const photo = {
            id: photoId,
            playerId: playerId,
            playerName: player.name,
            position: message.position,
            timestamp: Date.now()
        };
        
        room.gameState.photos.push(photo);
        player.stats.photos++;
        player.stats.xp += 10;
        
        broadcastToRoom(room.code, {
            type: 'photoTaken',
            photoId: photoId,
            playerId: playerId,
            playerName: player.name,
            position: message.position,
            timestamp: Date.now()
        });
        
        console.log('Photo taken by:', player.name);
    }
    
    function endGame(roomCode, reason) {
        const room = rooms.get(roomCode);
        if (!room || !room.gameState.active) return;
        
        room.gameState.active = false;
        
        if (room.gameTimer) {
            clearInterval(room.gameTimer);
        }
        
        // Determine winner
        let winner = null;
        
        if (reason === 'capture') {
            winner = room.gameState.hunter;
        } else if (reason === 'time') {
            // Find runner with most survival time
            const runners = room.players.filter(p => !p.isHunter && p.isAlive);
            if (runners.length > 0) {
                runners.sort((a, b) => b.stats.timeSurvived - a.stats.timeSurvived);
                winner = runners[0].id;
            } else {
                winner = room.gameState.hunter;
            }
        }
        
        // Calculate XP
        room.players.forEach(p => {
            if (p.id === winner) {
                p.stats.xp += 100;
            }
            if (!p.isHunter && p.isAlive) {
                p.stats.xp += 50;
            }
        });
        
        // Prepare stats
        const stats = {};
        room.players.forEach(p => {
            stats[p.id] = {
                photos: p.stats.photos,
                hunts: p.stats.hunts,
                timeSurvived: p.stats.timeSurvived,
                xp: p.stats.xp,
                isWinner: p.id === winner
            };
        });
        
        // Reset player states (keep in room)
        room.players.forEach(p => {
            p.isReady = false;
            p.isHunter = false;
            p.isAlive = true;
        });
        
        room.gameState.hunter = null;
        room.gameState.photos = [];
        
        broadcastToRoom(roomCode, {
            type: 'gameEnded',
            winner: winner,
            reason: reason,
            stats: stats
        });
        
        console.log('Game ended in room:', roomCode, 'Winner:', winner, 'Reason:', reason);
    }
});

// Helper functions
function broadcastToRoom(roomCode, message) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const messageStr = JSON.stringify(message);
    
    room.players.forEach(player => {
        if (player.ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(messageStr);
        }
    });
}

function broadcastToRoomExcept(roomCode, exceptPlayerId, message) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const messageStr = JSON.stringify(message);
    
    room.players.forEach(player => {
        if (player.id !== exceptPlayerId && 
            player.ws && 
            player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(messageStr);
        }
    });
}

// Cleanup inactive rooms every 5 minutes
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [code, room] of rooms.entries()) {
        // Check if room is empty
        if (room.players.length === 0) {
            rooms.delete(code);
            cleaned++;
            continue;
        }
        
        // Check if room is inactive (no activity for 30 minutes)
        let lastActivity = now;
        room.players.forEach(p => {
            // Simple activity check based on connection time
            if (p.ws && p.ws.readyState === WebSocket.OPEN) {
                // Connection is alive
            } else {
                // Connection is dead, room should be cleaned
                lastActivity = Math.min(lastActivity, now - 3600000);
            }
        });
        
        if (now - lastActivity > 1800000) { // 30 minutes
            rooms.delete(code);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log('Cleaned', cleaned, 'inactive rooms');
    }
}, 300000); // 5 minutes

// Heartbeat to keep connections alive
setInterval(() => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.ping();
        }
    });
}, 30000); // 30 seconds

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Backrooms Hunt Server started on port ${PORT}`);
    console.log(`📡 WebSocket URL: ws://localhost:${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    // Close all WebSocket connections
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1000, 'Server shutdown');
        }
    });
    
    // Close server
    server.close(() => {
        console.log('Server shut down successfully');
        process.exit(0);
    });
});
