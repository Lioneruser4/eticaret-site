const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Game State
const rooms = new Map();
const players = new Map();
const quickMatchQueue = [];
const activeGames = new Set();

// Player Class
class Player {
    constructor(id, name, ws) {
        this.id = id;
        this.name = name;
        this.ws = ws;
        this.room = null;
        this.isReady = false;
        this.isHost = false;
        this.isHunter = false;
        this.isAlive = true;
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
        this.stats = {
            photos: 0,
            hunts: 0,
            timeSurvived: 0,
            xp: 0
        };
        this.joinedAt = Date.now();
    }
}

// Room Class
class Room {
    constructor(code, name, hostId, hostName, maxPlayers = 10, gameTime = 5) {
        this.code = code;
        this.name = name;
        this.hostId = hostId;
        this.maxPlayers = maxPlayers;
        this.gameTime = gameTime * 60; // Convert to seconds
        this.players = new Map();
        this.gameState = {
            active: false,
            startedAt: null,
            timeRemaining: 0,
            hunter: null,
            photos: []
        };
        this.timers = {
            game: null,
            update: null
        };
        
        console.log(`Room created: ${code} (${name}) by ${hostName}`);
    }
    
    addPlayer(player) {
        if (this.players.size >= this.maxPlayers) return false;
        
        player.room = this.code;
        player.isHost = this.players.size === 0;
        this.players.set(player.id, player);
        
        return true;
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (!player) return null;
        
        player.room = null;
        this.players.delete(playerId);
        
        // If host left, assign new host
        if (player.isHost && this.players.size > 0) {
            const newHost = Array.from(this.players.values())[0];
            newHost.isHost = true;
        }
        
        return player;
    }
    
    broadcast(message, excludePlayerId = null) {
        const messageStr = JSON.stringify(message);
        
        this.players.forEach(player => {
            if (player.id !== excludePlayerId && 
                player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(messageStr);
            }
        });
    }
    
    canStartGame() {
        if (this.players.size < 2) return false;
        if (this.gameState.active) return false;
        
        const allReady = Array.from(this.players.values()).every(p => p.isReady);
        return allReady;
    }
    
    startGame() {
        if (!this.canStartGame()) return false;
        
        this.gameState.active = true;
        this.gameState.startedAt = Date.now();
        this.gameState.timeRemaining = this.gameTime;
        this.gameState.photos = [];
        
        // Select random hunter
        const playerIds = Array.from(this.players.keys());
        const hunterId = playerIds[Math.floor(Math.random() * playerIds.length)];
        
        // Set player roles and reset stats
        this.players.forEach(player => {
            player.isHunter = player.id === hunterId;
            player.isAlive = true;
            player.stats.photos = 0;
            player.stats.hunts = 0;
            player.stats.timeSurvived = 0;
            player.stats.xp = 0;
            
            // Random starting position
            player.position = {
                x: (Math.random() - 0.5) * 40,
                y: 0,
                z: (Math.random() - 0.5) * 40
            };
        });
        
        this.gameState.hunter = hunterId;
        activeGames.add(this.code);
        
        console.log(`Game started in room ${this.code}, Hunter: ${hunterId}`);
        
        // Start timers
        this.startTimers();
        
        return true;
    }
    
    startTimers() {
        // Game timer
        this.timers.game = setTimeout(() => {
            this.endGame('time');
        }, this.gameTime * 1000);
        
        // Update timer
        this.timers.update = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.gameState.startedAt) / 1000);
            this.gameState.timeRemaining = Math.max(0, this.gameTime - elapsed);
            
            // Update player survival time
            this.players.forEach(player => {
                if (player.isAlive) {
                    player.stats.timeSurvived++;
                }
            });
            
            // Send game update
            this.broadcast({
                type: 'gameUpdate',
                timeRemaining: this.gameState.timeRemaining,
                gameState: this.getGameState()
            });
            
            // Check game end conditions
            if (this.shouldEndGame()) {
                this.endGame();
            }
        }, 1000);
    }
    
    handleCapture(hunterId, targetId) {
        const hunter = this.players.get(hunterId);
        const target = this.players.get(targetId);
        
        if (!hunter || !target || !hunter.isHunter || !target.isAlive) return false;
        
        // Calculate distance (simplified - in real game use actual positions)
        const distance = Math.random(); // Replace with actual distance calculation
        
        if (distance < 2) { // Capture range
            target.isAlive = false;
            hunter.stats.hunts++;
            hunter.stats.xp += 50;
            
            // Check if game should end
            if (this.shouldEndGame()) {
                this.endGame('capture');
                return true;
            }
            
            // Broadcast capture
            this.broadcast({
                type: 'playerCaptured',
                hunterId: hunterId,
                runnerId: targetId
            });
            
            console.log(`Capture: ${hunter.name} captured ${target.name}`);
            
            return true;
        }
        
        return false;
    }
    
    handlePhoto(playerId, position) {
        const player = this.players.get(playerId);
        if (!player) return false;
        
        const photoId = crypto.randomBytes(8).toString('hex');
        const photo = {
            id: photoId,
            playerId: playerId,
            playerName: player.name,
            position: position,
            timestamp: Date.now()
        };
        
        this.gameState.photos.push(photo);
        player.stats.photos++;
        player.stats.xp += 10;
        
        // Broadcast photo
        this.broadcast({
            type: 'photoTaken',
            photoId: photoId,
            playerId: playerId,
            playerName: player.name,
            position: position
        });
        
        console.log(`Photo taken by ${player.name} at ${JSON.stringify(position)}`);
        
        return true;
    }
    
    shouldEndGame() {
        if (!this.gameState.active) return false;
        
        // Check if all runners are captured
        const aliveRunners = Array.from(this.players.values())
            .filter(p => !p.isHunter && p.isAlive);
        
        if (aliveRunners.length === 0) {
            return true;
        }
        
        // Check game time
        if (this.gameState.timeRemaining <= 0) {
            return true;
        }
        
        return false;
    }
    
    endGame(reason = 'time') {
        if (!this.gameState.active) return;
        
        this.gameState.active = false;
        activeGames.delete(this.code);
        
        // Clear timers
        if (this.timers.game) clearTimeout(this.timers.game);
        if (this.timers.update) clearInterval(this.timers.update);
        
        // Determine winner
        let winner = null;
        
        if (reason === 'capture') {
            winner = this.gameState.hunter;
        } else if (reason === 'time') {
            // Runner with most survival time wins
            const runners = Array.from(this.players.values())
                .filter(p => !p.isHunter && p.isAlive)
                .sort((a, b) => b.stats.timeSurvived - a.stats.timeSurvived);
            
            if (runners.length > 0) {
                winner = runners[0].id;
            } else {
                winner = this.gameState.hunter;
            }
        }
        
        // Calculate final stats and XP
        const gameStats = {
            winner: winner,
            reason: reason,
            players: {}
        };
        
        this.players.forEach(player => {
            // Bonus XP for winner
            if (player.id === winner) {
                player.stats.xp += 100;
            }
            
            // Bonus XP for surviving runners
            if (!player.isHunter && player.isAlive) {
                player.stats.xp += 50;
            }
            
            gameStats.players[player.id] = {
                photos: player.stats.photos,
                hunts: player.stats.hunts,
                timeSurvived: player.stats.timeSurvived,
                xp: player.stats.xp,
                isWinner: player.id === winner
            };
        });
        
        // Broadcast game end
        this.broadcast({
            type: 'gameEnded',
            winner: winner,
            reason: reason,
            stats: gameStats.players
        });
        
        console.log(`Game ended in room ${this.code}, Winner: ${winner}, Reason: ${reason}`);
        
        // Reset player states but keep in room
        this.players.forEach(player => {
            player.isReady = false;
            player.isHunter = false;
            player.isAlive = true;
        });
        
        this.gameState.active = false;
        this.gameState.hunter = null;
        this.gameState.photos = [];
    }
    
    getGameState() {
        const playersData = {};
        this.players.forEach(player => {
            playersData[player.id] = {
                id: player.id,
                name: player.name,
                isHost: player.isHost,
                isReady: player.isReady,
                isHunter: player.isHunter,
                isAlive: player.isAlive,
                position: player.position,
                stats: player.stats
            };
        });
        
        return {
            active: this.gameState.active,
            hunter: this.gameState.hunter,
            timeRemaining: this.gameState.timeRemaining,
            photos: this.gameState.photos,
            players: playersData
        };
    }
    
    getRoomInfo() {
        return {
            code: this.code,
            name: this.name,
            hostId: this.hostId,
            maxPlayers: this.maxPlayers,
            playerCount: this.players.size,
            gameTime: this.gameTime / 60,
            gameActive: this.gameState.active
        };
    }
}

// WebSocket Server
wss.on('connection', (ws, req) => {
    console.log('New connection:', req.socket.remoteAddress);
    
    let player = null;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Message parse error:', error);
            sendError(ws, 'Invalid message format');
        }
    });
    
    ws.on('close', () => {
        if (player) {
            console.log(`Player disconnected: ${player.name} (${player.id})`);
            
            // Remove from room
            if (player.room) {
                const room = rooms.get(player.room);
                if (room) {
                    const removedPlayer = room.removePlayer(player.id);
                    
                    if (removedPlayer) {
                        // Notify other players
                        room.broadcast({
                            type: 'playerLeft',
                            playerId: player.id,
                            playerName: player.name,
                            players: room.getGameState().players
                        });
                        
                        // Clean up empty room
                        if (room.players.size === 0) {
                            rooms.delete(room.code);
                            console.log(`Room deleted: ${room.code}`);
                        }
                    }
                }
            }
            
            // Remove from players map
            players.delete(player.id);
            
            // Remove from quick match queue
            const queueIndex = quickMatchQueue.indexOf(player.id);
            if (queueIndex > -1) {
                quickMatchQueue.splice(queueIndex, 1);
            }
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
                
            case 'playAgain':
                handlePlayAgain(ws, message);
                break;
                
            case 'leaveGame':
                handleLeaveGame(ws, message);
                break;
                
            default:
                console.log('Unknown message type:', message.type);
                sendError(ws, 'Unknown message type');
        }
    }
    
    function handleInit(ws, message) {
        const playerId = message.playerId || generatePlayerId();
        const playerName = message.playerName || 'Player';
        
        player = new Player(playerId, playerName, ws);
        players.set(playerId, player);
        
        console.log(`Player initialized: ${playerName} (${playerId})`);
        
        ws.send(JSON.stringify({
            type: 'initSuccess',
            playerId: playerId,
            playerName: playerName
        }));
    }
    
    function handleCreateRoom(ws, message) {
        if (!player) {
            sendError(ws, 'Player not initialized');
            return;
        }
        
        const roomName = message.roomName || `${player.name}'s Hunt`;
        const maxPlayers = Math.min(Math.max(parseInt(message.maxPlayers) || 10, 2), 20);
        const gameTime = Math.min(Math.max(parseInt(message.gameTime) || 5, 1), 30);
        
        // Generate unique room code
        let roomCode;
        do {
            roomCode = generateRoomCode();
        } while (rooms.has(roomCode));
        
        // Create room
        const room = new Room(
            roomCode,
            roomName,
            player.id,
            player.name,
            maxPlayers,
            gameTime
        );
        
        room.addPlayer(player);
        rooms.set(roomCode, room);
        
        console.log(`Room created: ${roomCode} by ${player.name}`);
        
        ws.send(JSON.stringify({
            type: 'roomCreated',
            roomCode: roomCode,
            room: room.getRoomInfo(),
            players: room.getGameState().players,
            isHunter: player.isHunter
        }));
    }
    
    function handleJoinRoom(ws, message) {
        if (!player) {
            sendError(ws, 'Player not initialized');
            return;
        }
        
        const roomCode = message.roomCode?.toUpperCase();
        if (!roomCode || roomCode.length !== 6) {
            sendError(ws, 'Invalid room code');
            return;
        }
        
        const room = rooms.get(roomCode);
        if (!room) {
            sendError(ws, 'Room not found');
            return;
        }
        
        if (room.gameState.active) {
            sendError(ws, 'Game already started');
            return;
        }
        
        if (!room.addPlayer(player)) {
            sendError(ws, 'Room is full');
            return;
        }
        
        console.log(`${player.name} joined room ${roomCode}`);
        
        // Notify room
        room.broadcast({
            type: 'playerJoined',
            playerId: player.id,
            playerName: player.name,
            players: room.getGameState().players
        });
        
        // Send response to joining player
        ws.send(JSON.stringify({
            type: 'roomJoined',
            roomCode: roomCode,
            room: room.getRoomInfo(),
            players: room.getGameState().players,
            isHunter: player.isHunter
        }));
    }
    
    function handleQuickMatch(ws, message) {
        if (!player) {
            sendError(ws, 'Player not initialized');
            return;
        }
        
        // Add to queue
        if (!quickMatchQueue.includes(player.id)) {
            quickMatchQueue.push(player.id);
        }
        
        console.log(`Quick match queue: ${player.name} added (${quickMatchQueue.length} players)`);
        
        // Send queue position
        ws.send(JSON.stringify({
            type: 'quickMatchQueued',
            position: quickMatchQueue.indexOf(player.id) + 1
        }));
        
        // Check if we can create a match
        if (quickMatchQueue.length >= 2) {
            createQuickMatch();
        }
    }
    
    function handleLeaveRoom(ws, message) {
        if (!player || !player.room) return;
        
        const room = rooms.get(player.room);
        if (!room) return;
        
        const removedPlayer = room.removePlayer(player.id);
        
        if (removedPlayer) {
            // Notify room
            room.broadcast({
                type: 'playerLeft',
                playerId: player.id,
                playerName: player.name,
                players: room.getGameState().players
            });
            
            // Send confirmation
            ws.send(JSON.stringify({
                type: 'leftRoom',
                roomCode: player.room
            }));
            
            player.room = null;
            
            // Clean up empty room
            if (room.players.size === 0) {
                rooms.delete(room.code);
                console.log(`Room deleted: ${room.code}`);
            }
        }
    }
    
    function handleSetReady(ws, message) {
        if (!player || !player.room) return;
        
        const room = rooms.get(player.room);
        if (!room || room.gameState.active) return;
        
        player.isReady = message.isReady;
        
        // Broadcast to room
        room.broadcast({
            type: 'playerReady',
            playerId: player.id,
            isReady: player.isReady,
            players: room.getGameState().players
        });
    }
    
    function handleStartGame(ws, message) {
        if (!player || !player.room) return;
        
        const room = rooms.get(player.room);
        if (!room) return;
        
        // Check if player is host
        if (!player.isHost) {
            sendError(ws, 'Only host can start the game');
            return;
        }
        
        const started = room.startGame();
        if (started) {
            // Broadcast game start to all players
            room.broadcast({
                type: 'gameStarting',
                players: room.getGameState().players,
                isHunter: player.isHunter,
                gameTime: room.gameTime,
                gameState: room.getGameState()
            });
        } else {
            sendError(ws, 'Cannot start game. All players must be ready.');
        }
    }
    
    function handleUpdatePosition(ws, message) {
        if (!player || !player.room || !player.isAlive) return;
        
        const room = rooms.get(player.room);
        if (!room || !room.gameState.active) return;
        
        player.position = message.position;
        player.rotation = message.rotation;
        
        // Broadcast to other players
        room.broadcast({
            type: 'playerPosition',
            playerId: player.id,
            position: player.position,
            rotation: player.rotation
        }, player.id);
    }
    
    function handleCapturePlayer(ws, message) {
        if (!player || !player.room) return;
        
        const room = rooms.get(player.room);
        if (!room || !room.gameState.active) return;
        
        const targetId = message.targetId;
        room.handleCapture(player.id, targetId);
    }
    
    function handleTakePhoto(ws, message) {
        if (!player || !player.room) return;
        
        const room = rooms.get(player.room);
        if (!room || !room.gameState.active) return;
        
        const position = message.position;
        room.handlePhoto(player.id, position);
    }
    
    function handlePlayAgain(ws, message) {
        if (!player || !player.room) return;
        
        const room = rooms.get(player.room);
        if (!room) return;
        
        // Reset player ready state
        player.isReady = false;
        
        // Send player back to lobby
        ws.send(JSON.stringify({
            type: 'roomJoined',
            roomCode: room.code,
            room: room.getRoomInfo(),
            players: room.getGameState().players
        }));
    }
    
    function handleLeaveGame(ws, message) {
        handleLeaveRoom(ws, message);
    }
    
    function sendError(ws, message) {
        ws.send(JSON.stringify({
            type: 'error',
            message: message
        }));
    }
});

// Quick Match System
function createQuickMatch() {
    if (quickMatchQueue.length < 2) return;
    
    // Get players for match (2-10 players)
    const matchSize = Math.min(quickMatchQueue.length, 10);
    const matchedPlayerIds = quickMatchQueue.splice(0, matchSize);
    const matchedPlayers = matchedPlayerIds.map(id => players.get(id)).filter(p => p);
    
    if (matchedPlayers.length < 2) return;
    
    // Create room
    const roomCode = generateRoomCode();
    const host = matchedPlayers[0];
    
    const room = new Room(
        roomCode,
        `Quick Match ${roomCode}`,
        host.id,
        host.name,
        matchedPlayers.length,
        5 // 5 minutes for quick match
    );
    
    // Add all players to room
    matchedPlayers.forEach(p => {
        room.addPlayer(p);
    });
    
    rooms.set(roomCode, room);
    
    console.log(`Quick match room created: ${roomCode} with ${matchedPlayers.length} players`);
    
    // Notify all players
    matchedPlayers.forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({
                type: 'roomJoined',
                roomCode: roomCode,
                room: room.getRoomInfo(),
                players: room.getGameState().players,
                isQuickMatch: true
            }));
        }
    });
    
    // Auto-start game after 10 seconds
    setTimeout(() => {
        if (room && !room.gameState.active && room.players.size >= 2) {
            // Set all players as ready
            room.players.forEach(player => {
                player.isReady = true;
            });
            
            room.startGame();
            
            room.broadcast({
                type: 'gameStarting',
                players: room.getGameState().players,
                gameTime: room.gameTime,
                gameState: room.getGameState(),
                isQuickMatch: true
            });
        }
    }, 10000);
}

// Helper Functions
function generatePlayerId() {
    return 'player_' + crypto.randomBytes(8).toString('hex');
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing characters
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Cleanup Inactive Rooms
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [code, room] of rooms.entries()) {
        // Remove empty rooms
        if (room.players.size === 0) {
            rooms.delete(code);
            cleaned++;
            continue;
        }
        
        // Remove inactive rooms (no activity for 1 hour)
        let lastActivity = now;
        room.players.forEach(player => {
            if (player.joinedAt < lastActivity) {
                lastActivity = player.joinedAt;
            }
        });
        
        if (now - lastActivity > 3600000) { // 1 hour
            rooms.delete(code);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} inactive rooms`);
    }
}, 300000); // Every 5 minutes

// Server Status Log
setInterval(() => {
    console.log('=== SERVER STATUS ===');
    console.log(`Rooms: ${rooms.size}`);
    console.log(`Players: ${players.size}`);
    console.log(`Active Games: ${activeGames.size}`);
    console.log(`Quick Match Queue: ${quickMatchQueue.length}`);
    console.log(`Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log('=====================');
}, 60000); // Every minute

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Backrooms Hunt Server running on port ${PORT}`);
    console.log(`🌐 WebSocket: wss://localhost:${PORT}`);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    
    // Close all WebSocket connections
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.close();
        }
    });
    
    // Close server
    server.close(() => {
        console.log('Server shutdown complete');
        process.exit(0);
    });
});
