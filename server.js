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

// Dünya verisi
const worlds = {};
const players = {};

// Blok tipleri (client ile aynı)
const BlockType = {
    1: 'GRASS',
    2: 'DIRT',
    3: 'STONE',
    4: 'WOOD',
    5: 'LEAVES',
    6: 'SAND',
    7: 'WATER',
    8: 'GLASS',
    9: 'BRICK',
    10: 'COBBLESTONE',
    11: 'GOLD',
    12: 'DIAMOND',
    13: 'BEDROCK'
};

class World {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.blocks = {};
        this.players = {};
        this.time = 6000; // Gün zamanı (0-24000)
        this.weather = 'clear';
    }
    
    addBlock(x, y, z, type) {
        const key = `${x},${y},${z}`;
        this.blocks[key] = { x, y, z, type };
        return key;
    }
    
    removeBlock(x, y, z) {
        const key = `${x},${y},${z}`;
        delete this.blocks[key];
        return key;
    }
    
    getBlock(x, y, z) {
        return this.blocks[`${x},${y},${z}`];
    }
    
    getPlayer(playerId) {
        return this.players[playerId];
    }
    
    addPlayer(playerId, playerData) {
        this.players[playerId] = playerData;
    }
    
    removePlayer(playerId) {
        delete this.players[playerId];
    }
    
    updatePlayer(playerId, data) {
        if (this.players[playerId]) {
            this.players[playerId] = { ...this.players[playerId], ...data };
        }
    }
    
    getWorldData() {
        return {
            id: this.id,
            name: this.name,
            blocks: this.blocks,
            players: this.players,
            time: this.time,
            weather: this.weather
        };
    }
}

// Varsayılan dünyalar
function createDefaultWorlds() {
    const world1 = new World('default', 'Default World');
    const world2 = new World('flat', 'Flat World');
    const world3 = new World('survival', 'Survival World');
    
    worlds['default'] = world1;
    worlds['flat'] = world2;
    worlds['survival'] = world3;
    
    // Örnek bloklar
    for (let x = -10; x < 10; x++) {
        for (let z = -10; z < 10; z++) {
            world1.addBlock(x, 0, z, 1); // Çim
            if (x % 2 === 0 && z % 2 === 0) {
                world1.addBlock(x, 1, z, 4); // Odun
            }
        }
    }
}

createDefaultWorlds();

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);
    
    players[socket.id] = {
        id: socket.id,
        worldId: null,
        position: { x: 0, y: 20, z: 0 },
        rotation: { x: 0, y: 0 }
    };
    
    // Dünya listesi
    socket.on('getWorlds', () => {
        const worldList = Object.values(worlds).map(w => ({
            id: w.id,
            name: w.name,
            playerCount: Object.keys(w.players).length
        }));
        socket.emit('worldList', worldList);
    });
    
    // Dünyaya katıl
    socket.on('joinWorld', (data) => {
        const world = worlds[data.worldId];
        if (!world) {
            socket.emit('error', 'Dünya bulunamadı');
            return;
        }
        
        // Eski dünyadan çıkar
        const oldWorldId = players[socket.id].worldId;
        if (oldWorldId && worlds[oldWorldId]) {
            worlds[oldWorldId].removePlayer(socket.id);
            socket.leave(oldWorldId);
            io.to(oldWorldId).emit('playerLeft', { playerId: socket.id });
        }
        
        // Yeni dünyaya katıl
        players[socket.id].worldId = data.worldId;
        world.addPlayer(socket.id, {
            id: socket.id,
            name: data.playerName || 'Oyuncu',
            position: data.position || { x: 0, y: 20, z: 0 },
            rotation: data.rotation || { x: 0, y: 0 },
            health: 100,
            inventory: {}
        });
        
        socket.join(data.worldId);
        
        // Dünya verisini gönder
        socket.emit('worldData', world.getWorldData());
        
        // Diğer oyunculara bildir
        socket.to(data.worldId).emit('playerJoined', {
            playerId: socket.id,
            playerName: data.playerName || 'Oyuncu',
            position: data.position || { x: 0, y: 20, z: 0 }
        });
        
        console.log(`${socket.id} ${world.name} dünyasına katıldı`);
    });
    
    // Oyuncu hareketi
    socket.on('playerMove', (data) => {
        const player = players[socket.id];
        if (!player || !player.worldId) return;
        
        const world = worlds[player.worldId];
        if (!world) return;
        
        world.updatePlayer(socket.id, {
            position: data.position,
            rotation: data.rotation
        });
        
        // Diğer oyunculara gönder
        socket.to(player.worldId).emit('playerMoved', {
            playerId: socket.id,
            position: data.position,
            rotation: data.rotation
        });
    });
    
    // Blok ekleme/kaldırma
    socket.on('blockUpdate', (data) => {
        const player = players[socket.id];
        if (!player || !player.worldId) return;
        
        const world = worlds[player.worldId];
        if (!world) return;
        
        if (data.action === 'add') {
            const key = world.addBlock(data.x, data.y, data.z, data.type);
            io.to(player.worldId).emit('blockAdded', {
                x: data.x,
                y: data.y,
                z: data.z,
                type: data.type,
                playerId: socket.id
            });
        } else if (data.action === 'remove') {
            const key = world.removeBlock(data.x, data.y, data.z);
            io.to(player.worldId).emit('blockRemoved', {
                x: data.x,
                y: data.y,
                z: data.z,
                playerId: socket.id
            });
        }
    });
    
    // Sohbet mesajı
    socket.on('chatMessage', (data) => {
        const player = players[socket.id];
        if (!player || !player.worldId) return;
        
        io.to(player.worldId).emit('chatMessage', {
            playerId: socket.id,
            playerName: data.playerName,
            message: data.message,
            timestamp: Date.now()
        });
    });
    
    // Envanter güncelleme
    socket.on('inventoryUpdate', (data) => {
        const player = players[socket.id];
        if (!player || !player.worldId) return;
        
        const world = worlds[player.worldId];
        if (world && world.players[socket.id]) {
            world.players[socket.id].inventory = data.inventory;
        }
    });
    
    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        const player = players[socket.id];
        if (player && player.worldId) {
            const world = worlds[player.worldId];
            if (world) {
                world.removePlayer(socket.id);
                io.to(player.worldId).emit('playerLeft', { playerId: socket.id });
                
                console.log(`${socket.id} ${world.name} dünyasından ayrıldı`);
            }
        }
        
        delete players[socket.id];
        console.log('Bağlantı kesildi:', socket.id);
    });
});

// Dünya zamanı güncelleme
setInterval(() => {
    Object.values(worlds).forEach(world => {
        world.time = (world.time + 10) % 24000;
        
        // Hava durumu değişikliği
        if (Math.random() < 0.001) {
            world.weather = ['clear', 'rain', 'storm'][Math.floor(Math.random() * 3)];
            io.to(world.id).emit('weatherChange', { weather: world.weather });
        }
        
        io.to(world.id).emit('timeUpdate', { time: world.time });
    });
}, 1000);

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`BlockCraft sunucusu ${PORT} portunda çalışıyor`);
});
