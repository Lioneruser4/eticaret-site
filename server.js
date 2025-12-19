const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Veritabanı yerine memory storage
const gameRooms = new Map();
const players = new Map();
const quickMatchQueue = [];

// Oda yapısı
class GameRoom {
    constructor(code, name, hostId, hostName, maxPlayers = 10, gameTime = 5) {
        this.code = code;
        this.name = name;
        this.host = hostId;
        this.maxPlayers = maxPlayers;
        this.gameTime = gameTime * 60; // saniye
        this.players = new Map();
        this.settings = {
            private: false,
            map: 'backrooms_level0'
        };
        
        // Oyun state
        this.gameState = {
            active: false,
            startedAt: null,
            monster: null,
            playersAlive: 0,
            timeRemaining: 0
        };
        
        // Timer'lar
        this.timers = {
            game: null,
            update: null
        };
        
        // Host'u ekle
        this.addPlayer(hostId, hostName, true);
        
        console.log(`📦 Oda oluşturuldu: ${code} (${name})`);
    }
    
    addPlayer(playerId, playerName, isHost = false) {
        const player = {
            id: playerId,
            name: playerName,
            isHost: isHost,
            isReady: false,
            isMonster: false,
            isAlive: true,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            stats: {
                kills: 0,
                escapes: 0,
                timeSurvived: 0,
                xp: 0
            },
            joinedAt: Date.now()
        };
        
        this.players.set(playerId, player);
        console.log(`👤 ${playerName} odaya katıldı: ${this.code}`);
        
        return player;
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.players.delete(playerId);
            console.log(`🚪 ${player.name} odadan ayrıldı: ${this.code}`);
            
            // Eğer host ayrıldıysa, yeni host seç
            if (player.isHost && this.players.size > 0) {
                const newHost = Array.from(this.players.values())[0];
                newHost.isHost = true;
                console.log(`👑 Yeni host: ${newHost.name}`);
            }
            
            // Oyun devam ediyorsa ve oyuncu ayrıldıysa
            if (this.gameState.active && player.isAlive) {
                this.gameState.playersAlive--;
                
                // Canavar ayrıldıysa yeni canavar seç
                if (player.isMonster && this.players.size > 0) {
                    this.selectNewMonster();
                }
                
                // Oyun bitirme kontrolü
                if (this.shouldEndGame()) {
                    this.endGame();
                }
            }
        }
        
        return player;
    }
    
    setPlayerReady(playerId, isReady) {
        const player = this.players.get(playerId);
        if (player) {
            player.isReady = isReady;
            return true;
        }
        return false;
    }
    
    canStartGame() {
        if (this.players.size < 2) return false;
        if (this.gameState.active) return false;
        
        // Tüm oyuncular hazır mı?
        return Array.from(this.players.values()).every(p => p.isReady);
    }
    
    startGame() {
        if (!this.canStartGame()) return false;
        
        this.gameState.active = true;
        this.gameState.startedAt = Date.now();
        this.gameState.timeRemaining = this.gameTime;
        this.gameState.playersAlive = this.players.size;
        
        // Rastgele canavar seç
        this.selectInitialMonster();
        
        // Oyunculara başlangıç pozisyonu ver
        this.setInitialPositions();
        
        console.log(`🎮 Oyun başladı: ${this.code}, Canavar: ${this.gameState.monster}`);
        
        // Timer'ları başlat
        this.startTimers();
        
        return true;
    }
    
    selectInitialMonster() {
        const playerIds = Array.from(this.players.keys());
        const monsterId = playerIds[Math.floor(Math.random() * playerIds.length)];
        
        this.players.forEach(player => {
            player.isMonster = player.id === monsterId;
            player.isAlive = true;
            player.stats.kills = 0;
            player.stats.escapes = 0;
            player.stats.timeSurvived = 0;
        });
        
        this.gameState.monster = monsterId;
    }
    
    selectNewMonster() {
        const alivePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
        if (alivePlayers.length === 0) return;
        
        const newMonster = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        newMonster.isMonster = true;
        this.gameState.monster = newMonster.id;
        
        console.log(`👹 Yeni canavar: ${newMonster.name}`);
    }
    
    setInitialPositions() {
        const center = { x: 0, z: 0 };
        const radius = 5;
        
        this.players.forEach((player, index) => {
            const angle = (index / this.players.size) * Math.PI * 2;
            player.position = {
                x: center.x + Math.cos(angle) * radius,
                y: 0,
                z: center.z + Math.sin(angle) * radius
            };
        });
    }
    
    startTimers() {
        // Ana oyun timer'ı
        this.timers.game = setTimeout(() => {
            this.endGame('time');
        }, this.gameTime * 1000);
        
        // Güncelleme timer'ı
        this.timers.update = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.gameState.startedAt) / 1000);
            this.gameState.timeRemaining = Math.max(0, this.gameTime - elapsed);
            
            // Zamanlayıcıyı güncelle
            this.players.forEach(player => {
                if (player.isAlive) {
                    player.stats.timeSurvived++;
                }
            });
            
            // Oyun bitirme kontrolü
            if (this.shouldEndGame()) {
                this.endGame();
            }
        }, 1000);
    }
    
    handleAttack(attackerId) {
        if (!this.gameState.active) return null;
        
        const attacker = this.players.get(attackerId);
        if (!attacker || !attacker.isMonster || !attacker.isAlive) return null;
        
        // Saldırı menzili içindeki en yakın insanı bul
        let closestHuman = null;
        let closestDistance = 3.0; // 3 birim menzil
        
        this.players.forEach(player => {
            if (player.id !== attackerId && !player.isMonster && player.isAlive) {
                const dx = player.position.x - attacker.position.x;
                const dz = player.position.z - attacker.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);
                
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestHuman = player;
                }
            }
        });
        
        if (closestHuman) {
            // Vuruş başarılı
            closestHuman.isAlive = false;
            this.gameState.playersAlive--;
            
            attacker.stats.kills++;
            
            // Rolleri değiştir
            closestHuman.isMonster = true;
            attacker.isMonster = false;
            this.gameState.monster = closestHuman.id;
            
            // XP hesapla
            attacker.stats.xp += 50;
            closestHuman.stats.xp += 25;
            
            console.log(`⚔️ ${attacker.name}, ${closestHuman.name} vurdu!`);
            
            return {
                success: true,
                attacker: attackerId,
                target: closestHuman.id,
                newMonster: closestHuman.id
            };
        }
        
        return { success: false };
    }
    
    updatePlayerPosition(playerId, position, rotation) {
        const player = this.players.get(playerId);
        if (player && player.isAlive) {
            player.position = position;
            player.rotation = rotation;
            return true;
        }
        return false;
    }
    
    shouldEndGame() {
        if (!this.gameState.active) return false;
        
        // Canavar kazandı mı? (sadece canavar hayatta)
        const alivePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
        if (alivePlayers.length === 1 && alivePlayers[0].isMonster) {
            return true;
        }
        
        // Zaman doldu mu?
        if (this.gameState.timeRemaining <= 0) {
            return true;
        }
        
        // Tüm insanlar öldü mü?
        const aliveHumans = alivePlayers.filter(p => !p.isMonster);
        if (aliveHumans.length === 0) {
            return true;
        }
        
        return false;
    }
    
    endGame(reason = 'monster') {
        if (!this.gameState.active) return;
        
        this.gameState.active = false;
        
        // Timer'ları temizle
        if (this.timers.game) clearTimeout(this.timers.game);
        if (this.timers.update) clearInterval(this.timers.update);
        
        // Kazananı belirle
        let winner = null;
        let winnerStats = null;
        
        if (reason === 'monster') {
            // Canavar kazandı
            winner = this.gameState.monster;
        } else if (reason === 'time') {
            // En uzun süre hayatta kalan insan kazandı
            const humans = Array.from(this.players.values())
                .filter(p => !p.isMonster && p.isAlive)
                .sort((a, b) => b.stats.timeSurvived - a.stats.timeSurvived);
            
            if (humans.length > 0) {
                winner = humans[0].id;
            } else {
                // Hiç insan kalmadıysa canavar kazandı
                winner = this.gameState.monster;
            }
        }
        
        // İstatistikleri hesapla
        const gameStats = {
            winner: winner,
            reason: reason,
            players: {}
        };
        
        this.players.forEach(player => {
            // Bonus XP
            if (player.id === winner) {
                player.stats.xp += 100;
            }
            if (player.isAlive && !player.isMonster) {
                player.stats.xp += 50;
                player.stats.escapes++;
            }
            
            gameStats.players[player.id] = {
                kills: player.stats.kills,
                escapes: player.stats.escapes,
                timeSurvived: player.stats.timeSurvived,
                xp: player.stats.xp,
                isWinner: player.id === winner
            };
        });
        
        console.log(`🏁 Oyun bitti: ${this.code}, Kazanan: ${winner}`);
        
        return gameStats;
    }
    
    getRoomData() {
        return {
            code: this.code,
            name: this.name,
            host: this.host,
            maxPlayers: this.maxPlayers,
            playerCount: this.players.size,
            gameTime: this.gameTime / 60,
            gameActive: this.gameState.active,
            settings: this.settings
        };
    }
    
    getPlayersData() {
        const playersData = {};
        this.players.forEach(player => {
            playersData[player.id] = {
                id: player.id,
                name: player.name,
                isHost: player.isHost,
                isReady: player.isReady,
                isMonster: player.isMonster,
                isAlive: player.isAlive,
                position: player.position,
                stats: player.stats
            };
        });
        return playersData;
    }
    
    getGameStateData() {
        return {
            active: this.gameState.active,
            monster: this.gameState.monster,
            playersAlive: this.gameState.playersAlive,
            timeRemaining: this.gameState.timeRemaining,
            startedAt: this.gameState.startedAt
        };
    }
}

// WebSocket bağlantıları
wss.on('connection', (ws, req) => {
    console.log('🔗 Yeni bağlantı:', req.socket.remoteAddress);
    
    let playerId = null;
    let currentRoom = null;
    
    // Mesaj işleme
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Mesaj parse hatası:', error);
            sendError(ws, 'Geçersiz mesaj formatı');
        }
    });
    
    // Bağlantı kesilirse
    ws.on('close', () => {
        console.log('❌ Bağlantı kesildi:', playerId);
        
        // Oyuncuyu odadan çıkar
        if (currentRoom && playerId) {
            const room = gameRooms.get(currentRoom);
            if (room) {
                room.removePlayer(playerId);
                
                // Oda boşsa sil
                if (room.players.size === 0) {
                    gameRooms.delete(currentRoom);
                    console.log(`🗑️ Oda silindi: ${currentRoom}`);
                } else {
                    // Diğer oyunculara bildir
                    broadcastToRoom(currentRoom, {
                        type: 'playerLeft',
                        playerId: playerId,
                        players: room.getPlayersData()
                    });
                }
            }
        }
        
        // Players map'ten sil
        if (playerId) {
            players.delete(playerId);
        }
        
        // Matchmaking kuyruğundan çıkar
        const queueIndex = quickMatchQueue.indexOf(playerId);
        if (queueIndex > -1) {
            quickMatchQueue.splice(queueIndex, 1);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket hatası:', error);
    });
    
    // Mesaj işleyici
    function handleMessage(ws, message) {
        switch (message.type) {
            case 'init':
                handleInit(ws, message);
                break;
                
            case 'createRoom':
                handleCreateRoom(ws, message);
                break;
                
            case 'getRooms':
                handleGetRooms(ws);
                break;
                
            case 'joinRoom':
                handleJoinRoom(ws, message);
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
                
            case 'quickMatch':
                handleQuickMatch(ws, message);
                break;
                
            case 'updatePosition':
                handleUpdatePosition(ws, message);
                break;
                
            case 'attack':
                handleAttack(ws, message);
                break;
                
            case 'leaveGame':
                handleLeaveGame(ws, message);
                break;
                
            default:
                console.log('Bilinmeyen mesaj tipi:', message.type);
                sendError(ws, 'Bilinmeyen mesaj tipi');
        }
    }
    
    // Oyuncu başlatma
    function handleInit(ws, message) {
        playerId = message.playerId || generatePlayerId();
        const playerName = message.playerName || 'Player';
        
        players.set(playerId, {
            id: playerId,
            name: playerName,
            ws: ws,
            connectedAt: Date.now()
        });
        
        console.log(`👤 Oyuncu giriş yaptı: ${playerName} (${playerId})`);
        
        ws.send(JSON.stringify({
            type: 'initSuccess',
            playerId: playerId,
            playerName: playerName
        }));
    }
    
    // Oda oluşturma
    function handleCreateRoom(ws, message) {
        if (!playerId) {
            sendError(ws, 'Önce giriş yapmalısınız');
            return;
        }
        
        const roomName = message.roomName || `${players.get(playerId).name}'s Room`;
        const maxPlayers = Math.min(Math.max(parseInt(message.maxPlayers) || 10, 2), 20);
        const gameTime = Math.min(Math.max(parseInt(message.gameTime) || 5, 1), 30);
        
        // Oda kodu oluştur
        const roomCode = generateRoomCode();
        
        // Oda oluştur
        const room = new GameRoom(
            roomCode,
            roomName,
            playerId,
            players.get(playerId).name,
            maxPlayers,
            gameTime
        );
        
        gameRooms.set(roomCode, room);
        currentRoom = roomCode;
        
        console.log(`🏠 Oda oluşturuldu: ${roomCode} by ${players.get(playerId).name}`);
        
        ws.send(JSON.stringify({
            type: 'roomCreated',
            roomCode: roomCode,
            room: room.getRoomData(),
            players: room.getPlayersData()
        }));
    }
    
    // Oda listesi
    function handleGetRooms(ws) {
        const availableRooms = Array.from(gameRooms.values())
            .filter(room => 
                !room.gameState.active && 
                room.players.size < room.maxPlayers &&
                !room.settings.private
            )
            .map(room => room.getRoomData());
        
        ws.send(JSON.stringify({
            type: 'roomList',
            rooms: availableRooms
        }));
    }
    
    // Odaya katılma
    function handleJoinRoom(ws, message) {
        if (!playerId) {
            sendError(ws, 'Önce giriş yapmalısınız');
            return;
        }
        
        const roomCode = message.roomCode;
        const room = gameRooms.get(roomCode);
        
        if (!room) {
            sendError(ws, 'Oda bulunamadı');
            return;
        }
        
        if (room.gameState.active) {
            sendError(ws, 'Oyun başlamış, katılamazsınız');
            return;
        }
        
        if (room.players.size >= room.maxPlayers) {
            sendError(ws, 'Oda dolu');
            return;
        }
        
        // Oyuncuyu odaya ekle
        const player = players.get(playerId);
        room.addPlayer(playerId, player.name);
        currentRoom = roomCode;
        
        // Tüm odaya bildir
        broadcastToRoom(roomCode, {
            type: 'playerJoined',
            playerId: playerId,
            playerName: player.name,
            players: room.getPlayersData()
        });
        
        // Oyuncuya oda bilgisi gönder
        ws.send(JSON.stringify({
            type: 'roomJoined',
            roomCode: roomCode,
            room: room.getRoomData(),
            players: room.getPlayersData()
        }));
    }
    
    // Odadan ayrılma
    function handleLeaveRoom(ws, message) {
        if (!currentRoom || !playerId) return;
        
        const room = gameRooms.get(currentRoom);
        if (!room) return;
        
        const leftPlayer = room.removePlayer(playerId);
        
        if (leftPlayer) {
            // Diğer oyunculara bildir
            broadcastToRoom(currentRoom, {
                type: 'playerLeft',
                playerId: playerId,
                playerName: leftPlayer.name,
                players: room.getPlayersData()
            });
            
            // Oyuncuya onay gönder
            ws.send(JSON.stringify({
                type: 'leftRoom',
                roomCode: currentRoom
            }));
            
            // Oda boşsa sil
            if (room.players.size === 0) {
                gameRooms.delete(currentRoom);
                console.log(`🗑️ Oda silindi: ${currentRoom}`);
            }
            
            currentRoom = null;
        }
    }
    
    // Hazır olma durumu
    function handleSetReady(ws, message) {
        if (!currentRoom || !playerId) return;
        
        const room = gameRooms.get(currentRoom);
        if (!room) return;
        
        const isReady = message.isReady;
        const success = room.setPlayerReady(playerId, isReady);
        
        if (success) {
            // Tüm odaya bildir
            broadcastToRoom(currentRoom, {
                type: 'playerReady',
                playerId: playerId,
                isReady: isReady,
                players: room.getPlayersData()
            });
        }
    }
    
    // Oyun başlatma
    function handleStartGame(ws, message) {
        if (!currentRoom || !playerId) return;
        
        const room = gameRooms.get(currentRoom);
        if (!room) return;
        
        // Sadece host oyunu başlatabilir
        const player = room.players.get(playerId);
        if (!player || !player.isHost) {
            sendError(ws, 'Sadece host oyunu başlatabilir');
            return;
        }
        
        const started = room.startGame();
        if (started) {
            // Tüm oyunculara oyun başladı mesajı gönder
            broadcastToRoom(currentRoom, {
                type: 'gameStarting',
                players: room.getPlayersData(),
                isMonster: room.gameState.monster,
                gameState: room.getGameStateData()
            });
        } else {
            sendError(ws, 'Oyun başlatılamadı. Tüm oyuncular hazır olmalı.');
        }
    }
    
    // Hızlı eşleşme
    function handleQuickMatch(ws, message) {
        if (!playerId) {
            sendError(ws, 'Önce giriş yapmalısınız');
            return;
        }
        
        const player = players.get(playerId);
        const playerName = player ? player.name : 'Player';
        
        // Kuyruğa ekle
        if (!quickMatchQueue.includes(playerId)) {
            quickMatchQueue.push(playerId);
        }
        
        console.log(`🔍 Hızlı eşleşme: ${playerName} kuyrukta (${quickMatchQueue.length} kişi)`);
        
        // Eğer kuyrukta yeterli oyuncu varsa oda oluştur
        if (quickMatchQueue.length >= 2) {
            createQuickMatchRoom();
        }
        
        ws.send(JSON.stringify({
            type: 'quickMatchQueued',
            position: quickMatchQueue.indexOf(playerId) + 1
        }));
    }
    
    // Pozisyon güncelleme
    function handleUpdatePosition(ws, message) {
        if (!currentRoom || !playerId) return;
        
        const room = gameRooms.get(currentRoom);
        if (!room || !room.gameState.active) return;
        
        const position = message.position;
        const rotation = message.rotation;
        
        const updated = room.updatePlayerPosition(playerId, position, rotation);
        
        if (updated) {
            // Diğer oyunculara pozisyonu yayınla
            broadcastToRoomExcept(currentRoom, playerId, {
                type: 'playerUpdate',
                playerId: playerId,
                position: position,
                rotation: rotation,
                isMonster: room.players.get(playerId)?.isMonster || false
            });
        }
    }
    
    // Saldırı
    function handleAttack(ws, message) {
        if (!currentRoom || !playerId) return;
        
        const room = gameRooms.get(currentRoom);
        if (!room || !room.gameState.active) return;
        
        const result = room.handleAttack(playerId);
        
        if (result && result.success) {
            // Tüm odaya bildir
            broadcastToRoom(currentRoom, {
                type: 'roleChange',
                newRole: 'monster',
                targetId: result.newMonster
            });
            
            broadcastToRoom(currentRoom, {
                type: 'playerAttack',
                attackerId: result.attacker,
                targetId: result.target
            });
            
            // Oyun bitirme kontrolü
            if (room.shouldEndGame()) {
                const stats = room.endGame('monster');
                broadcastToRoom(currentRoom, {
                    type: 'gameEnded',
                    winner: stats.winner,
                    reason: stats.reason,
                    stats: stats.players
                });
            }
        }
    }
    
    // Oyundan ayrılma
    function handleLeaveGame(ws, message) {
        handleLeaveRoom(ws, message);
    }
    
    // Hata gönderme
    function sendError(ws, message) {
        ws.send(JSON.stringify({
            type: 'error',
            message: message
        }));
    }
});

// Hızlı eşleşme oda oluşturma
function createQuickMatchRoom() {
    if (quickMatchQueue.length < 2) return;
    
    // İlk 2-10 oyuncuyu al
    const matchSize = Math.min(quickMatchQueue.length, 10);
    const matchedPlayers = quickMatchQueue.splice(0, matchSize);
    
    // Oda oluştur
    const roomCode = generateRoomCode();
    const hostId = matchedPlayers[0];
    const host = players.get(hostId);
    
    const room = new GameRoom(
        roomCode,
        `Hızlı Maç #${roomCode}`,
        hostId,
        host?.name || 'Player',
        matchSize,
        5 // 5 dakika
    );
    
    gameRooms.set(roomCode, room);
    
    // Diğer oyuncuları odaya ekle
    matchedPlayers.slice(1).forEach(playerId => {
        const player = players.get(playerId);
        if (player) {
            room.addPlayer(playerId, player.name);
            
            // Oyuncunun WebSocket'ini bul ve odaya katıldı mesajı gönder
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify({
                    type: 'roomJoined',
                    roomCode: roomCode,
                    room: room.getRoomData(),
                    players: room.getPlayersData(),
                    isQuickMatch: true
                }));
                
                // Oyuncuyu odaya kaydet
                // (Bu kısım için oyuncunun connection handler'ında currentRoom güncellenmeli)
            }
        }
    });
    
    // Host'a oda bilgisi gönder
    if (host?.ws && host.ws.readyState === WebSocket.OPEN) {
        host.ws.send(JSON.stringify({
            type: 'roomCreated',
            roomCode: roomCode,
            room: room.getRoomData(),
            players: room.getPlayersData(),
            isQuickMatch: true
        }));
    }
    
    console.log(`⚡ Hızlı eşleşme odası oluşturuldu: ${roomCode} (${matchSize} oyuncu)`);
    
    // 10 saniye sonra oyunu otomatik başlat
    setTimeout(() => {
        if (room && !room.gameState.active) {
            // Tüm oyuncuları hazır yap
            room.players.forEach((player, playerId) => {
                room.setPlayerReady(playerId, true);
            });
            
            // Oyunu başlat
            const started = room.startGame();
            if (started) {
                broadcastToRoom(roomCode, {
                    type: 'gameStarting',
                    players: room.getPlayersData(),
                    isMonster: room.gameState.monster,
                    gameState: room.getGameStateData(),
                    isQuickMatch: true
                });
            }
        }
    }, 10000);
}

// Odaya mesaj yayınlama
function broadcastToRoom(roomCode, message) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    
    const messageStr = JSON.stringify(message);
    
    room.players.forEach(player => {
        const playerData = players.get(player.id);
        if (playerData?.ws && playerData.ws.readyState === WebSocket.OPEN) {
            playerData.ws.send(messageStr);
        }
    });
}

// Belirli oyuncu hariç odaya mesaj yayınlama
function broadcastToRoomExcept(roomCode, exceptPlayerId, message) {
    const room = gameRooms.get(roomCode);
    if (!room) return;
    
    const messageStr = JSON.stringify(message);
    
    room.players.forEach(player => {
        if (player.id !== exceptPlayerId) {
            const playerData = players.get(player.id);
            if (playerData?.ws && playerData.ws.readyState === WebSocket.OPEN) {
                playerData.ws.send(messageStr);
            }
        }
    });
}

// Yardımcı fonksiyonlar
function generatePlayerId() {
    return 'player_' + crypto.randomBytes(8).toString('hex');
}

function generateRoomCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Oda temizleme cron job'u
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [code, room] of gameRooms.entries()) {
        // Boş odaları temizle
        if (room.players.size === 0) {
            gameRooms.delete(code);
            cleaned++;
        }
        
        // Uzun süre boş kalan odaları temizle (1 saat)
        const lastActivity = Math.max(
            ...Array.from(room.players.values()).map(p => p.joinedAt)
        );
        
        if (now - lastActivity > 3600000) { // 1 saat
            gameRooms.delete(code);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 ${cleaned} oda temizlendi`);
    }
}, 300000); // 5 dakikada bir

// Sunucu durumu log'u
setInterval(() => {
    console.log(`📊 Sunucu Durumu:`);
    console.log(`   Odalar: ${gameRooms.size}`);
    console.log(`   Aktif Oyuncular: ${players.size}`);
    console.log(`   Hızlı Eşleşme Kuyruğu: ${quickMatchQueue.length}`);
    
    let activeGames = 0;
    gameRooms.forEach(room => {
        if (room.gameState.active) activeGames++;
    });
    console.log(`   Aktif Oyunlar: ${activeGames}`);
}, 60000); // 1 dakikada bir

// Sunucu başlatma
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Backrooms Arena Sunucusu ${PORT} portunda başlatıldı`);
    console.log(`🌐 WebSocket: wss://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Sunucu kapatılıyor...');
    
    // Tüm bağlantıları kapat
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.close();
        }
    });
    
    // Sunucuyu kapat
    server.close(() => {
        console.log('✅ Sunucu başarıyla kapatıldı');
        process.exit(0);
    });
});
