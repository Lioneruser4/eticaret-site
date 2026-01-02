const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('.'));

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Oda yapısı
const rooms = {};
const players = {};

// Oyun durumları
const GameState = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    ENDED: 'ended'
};

class Room {
    constructor(id, hostId, gameTime) {
        this.id = id;
        this.hostId = hostId;
        this.gameTime = gameTime;
        this.state = GameState.WAITING;
        this.players = {};
        this.teams = {
            blue: [],
            red: []
        };
        this.scores = {
            blue: 0,
            red: 0
        };
        this.startTime = null;
        this.ball = {
            x: 0,
            y: 0.5,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0
        };
        this.lastUpdate = Date.now();
    }
    
    addPlayer(playerId, playerName, team) {
        if (this.teams[team].length >= 11) {
            return false; // Takım dolu
        }
        
        const player = {
            id: playerId,
            name: playerName,
            team: team,
            x: team === 'blue' ? -20 : 20,
            y: 1,
            z: 0,
            rotation: 0,
            score: 0
        };
        
        this.players[playerId] = player;
        this.teams[team].push(playerId);
        
        return true;
    }
    
    removePlayer(playerId) {
        const player = this.players[playerId];
        if (!player) return;
        
        // Takımdan çıkar
        const teamIndex = this.teams[player.team].indexOf(playerId);
        if (teamIndex > -1) {
            this.teams[player.team].splice(teamIndex, 1);
        }
        
        // Oyuncuyu sil
        delete this.players[playerId];
        
        // Eğer host çıktıysa yeni host belirle
        if (playerId === this.hostId && Object.keys(this.players).length > 0) {
            this.hostId = Object.keys(this.players)[0];
        }
    }
    
    updatePlayer(playerId, data) {
        const player = this.players[playerId];
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.z = data.z;
            player.rotation = data.rotation;
            this.lastUpdate = Date.now();
        }
    }
    
    updateBall(data) {
        this.ball = data;
        this.lastUpdate = Date.now();
        
        // Gol kontrolü
        this.checkGoals();
    }
    
    checkGoals() {
        const goalZ = 59;
        const goalWidth = 7.32;
        
        // Mavi kale (solda)
        if (this.ball.z < -goalZ && Math.abs(this.ball.x) < goalWidth/2 && this.ball.y < 2.44) {
            this.scores.red++;
            this.resetBall();
            return 'red';
        }
        
        // Kırmızı kale (sağda)
        if (this.ball.z > goalZ && Math.abs(this.ball.x) < goalWidth/2 && this.ball.y < 2.44) {
            this.scores.blue++;
            this.resetBall();
            return 'blue';
        }
        
        return null;
    }
    
    resetBall() {
        this.ball = {
            x: 0,
            y: 0.5,
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0
        };
    }
    
    getGameData() {
        return {
            roomId: this.id,
            state: this.state,
            players: Object.values(this.players),
            teams: this.teams,
            scores: this.scores,
            ball: this.ball,
            gameTime: this.gameTime,
            elapsedTime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0
        };
    }
    
    startGame() {
        this.state = GameState.PLAYING;
        this.startTime = Date.now();
        this.resetBall();
    }
    
    checkGameEnd() {
        if (this.state !== GameState.PLAYING) return false;
        
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const remaining = this.gameTime * 60 - elapsed;
        
        if (remaining <= 0) {
            this.state = GameState.ENDED;
            return true;
        }
        
        return false;
    }
    
    getWinner() {
        if (this.scores.blue > this.scores.red) return 'Mavi';
        if (this.scores.red > this.scores.blue) return 'Kırmızı';
        return 'Berabere';
    }
}

// Oda ID oluşturma
function generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Socket.io bağlantıları
io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);
    
    players[socket.id] = {
        id: socket.id,
        roomId: null,
        name: 'Oyuncu'
    };
    
    // Oda kurma
    socket.on('createRoom', (data) => {
        const roomId = generateRoomId();
        const room = new Room(roomId, socket.id, data.time);
        
        rooms[roomId] = room;
        players[socket.id].roomId = roomId;
        players[socket.id].name = data.playerName;
        
        socket.join(roomId);
        socket.emit('roomCreated', {
            roomId: roomId,
            teams: room.teams
        });
        
        console.log(`Oda oluşturuldu: ${roomId}`);
    });
    
    // Takıma katılma
    socket.on('joinTeam', (data) => {
        const room = rooms[data.roomId];
        if (!room) return;
        
        const playerName = players[socket.id].name;
        const success = room.addPlayer(socket.id, playerName, data.team);
        
        if (success) {
            players[socket.id].roomId = data.roomId;
            socket.join(data.roomId);
            
            // Odaya katılan oyuncuya oyun bilgilerini gönder
            socket.emit('gameStarted', room.getGameData());
            
            // Diğer oyunculara yeni oyuncuyu bildir
            socket.to(data.roomId).emit('playerJoined', {
                playerId: socket.id,
                playerName: playerName,
                team: data.team,
                teams: room.teams
            });
            
            // Oyun başlatma kontrolü
            if (room.teams.blue.length >= 1 && room.teams.red.length >= 1) {
                setTimeout(() => {
                    room.startGame();
                    io.to(data.roomId).emit('gameStarted', room.getGameData());
                }, 3000);
            }
        }
    });
    
    // Hızlı oyun
    socket.on('quickPlay', (data) => {
        // Boş oda bul veya yeni oda oluştur
        let availableRoom = null;
        
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.state === GameState.WAITING && 
                (room.teams.blue.length < 11 || room.teams.red.length < 11)) {
                availableRoom = room;
                break;
            }
        }
        
        if (!availableRoom) {
            const roomId = generateRoomId();
            const room = new Room(roomId, socket.id, 10);
            rooms[roomId] = room;
            availableRoom = room;
        }
        
        players[socket.id].name = data.playerName;
        players[socket.id].roomId = availableRoom.id;
        
        // Rastgele takım seç
        const team = availableRoom.teams.blue.length <= availableRoom.teams.red.length ? 'blue' : 'red';
        availableRoom.addPlayer(socket.id, data.playerName, team);
        
        socket.join(availableRoom.id);
        socket.emit('gameStarted', availableRoom.getGameData());
        
        // Diğer oyunculara bildir
        socket.to(availableRoom.id).emit('playerJoined', {
            playerId: socket.id,
            playerName: data.playerName,
            team: team,
            teams: availableRoom.teams
        });
        
        // Oyun başlatma kontrolü
        if (availableRoom.teams.blue.length >= 1 && availableRoom.teams.red.length >= 1) {
            setTimeout(() => {
                availableRoom.startGame();
                io.to(availableRoom.id).emit('gameStarted', availableRoom.getGameData());
            }, 3000);
        }
    });
    
    // Oyuncu hareketi
    socket.on('playerMove', (data) => {
        const player = players[socket.id];
        if (!player || !player.roomId) return;
        
        const room = rooms[player.roomId];
        if (!room) return;
        
        room.updatePlayer(socket.id, data);
        
        // Diğer oyunculara gönder
        socket.to(player.roomId).emit('playerMoved', {
            id: socket.id,
            ...data
        });
    });
    
    // Şut atma
    socket.on('shoot', (data) => {
        const player = players[socket.id];
        if (!player || !player.roomId) return;
        
        const room = rooms[player.roomId];
        if (!room) return;
        
        const ballData = {
            x: room.ball.x,
            y: room.ball.y,
            z: room.ball.z,
            vx: data.direction.x * data.power,
            vy: data.direction.y * data.power + 5,
            vz: data.direction.z * data.power
        };
        
        room.updateBall(ballData);
        
        // Gol kontrolü
        const goalTeam = room.checkGoals();
        if (goalTeam) {
            io.to(player.roomId).emit('goalScored', {
                team: goalTeam,
                score: room.scores[goalTeam]
            });
        }
        
        // Top hareketini gönder
        io.to(player.roomId).emit('ballMoved', ballData);
    });
    
    // Oyun durumu güncelleme
    setInterval(() => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            
            if (room.state === GameState.PLAYING) {
                // Oyun süresi kontrolü
                if (room.checkGameEnd()) {
                    const winner = room.getWinner();
                    io.to(roomId).emit('gameEnded', { winner: winner });
                }
                
                // Periyodik oyun durumu güncelleme
                io.to(roomId).emit('gameUpdate', room.getGameData());
            }
        }
    }, 1000);
    
    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        const player = players[socket.id];
        if (player && player.roomId) {
            const room = rooms[player.roomId];
            if (room) {
                room.removePlayer(socket.id);
                
                // Odadaki diğer oyunculara bildir
                socket.to(player.roomId).emit('playerLeft', { playerId: socket.id });
                
                // Oda boşsa sil
                if (Object.keys(room.players).length === 0) {
                    delete rooms[player.roomId];
                }
            }
        }
        
        delete players[socket.id];
        console.log('Bağlantı kesildi:', socket.id);
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
