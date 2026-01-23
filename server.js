const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB Bağlantısı
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/durak_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB Durak veritabanına bağlandı');
}).catch(err => {
  console.error('❌ MongoDB bağlantı hatası:', err);
});

// MongoDB Şemaları
const userSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true, required: true },
  username: String,
  firstName: String,
  lastName: String,
  photoUrl: String,
  balance: { type: Number, default: 100 },
  dailyBonusClaimed: { type: Boolean, default: false },
  lastDailyBonus: Date,
  totalGames: { type: Number, default: 0 },
  gamesWon: { type: Number, default: 0 },
  gamesLost: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'durak_users' });

const roomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, required: true },
  roomCode: String,
  players: [{
    socketId: String,
    telegramId: String,
    username: String,
    photoUrl: String,
    position: Number,
    cards: [Object],
    isReady: { type: Boolean, default: false },
    isAttacker: { type: Boolean, default: false },
    isDefender: { type: Boolean, default: false },
    score: { type: Number, default: 0 }
  }],
  deck: [Object],
  trumpCard: Object,
  gameState: { type: String, default: 'waiting' }, // waiting, playing, ended
  tableCards: [Object],
  currentAttackerIndex: { type: Number, default: 0 },
  maxPlayers: { type: Number, default: 4 },
  betAmount: { type: Number, default: 0 },
  potAmount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'durak_rooms' });

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);

// Oyun Mantığı
class DurakGame {
  static generateDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = [
      { name: '6', value: 6 }, { name: '7', value: 7 },
      { name: '8', value: 8 }, { name: '9', value: 9 },
      { name: '10', value: 10 }, { name: 'J', value: 11 },
      { name: 'Q', value: 12 }, { name: 'K', value: 13 },
      { name: 'A', value: 14 }
    ];
    
    let deck = [];
    suits.forEach(suit => {
      values.forEach(value => {
        deck.push({
          suit,
          name: value.name,
          value: value.value,
          code: `${value.name}${suit}`,
          id: `${value.name}${suit}${Math.random().toString(36).substr(2, 9)}`
        });
      });
    });
    
    // Karıştır
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    return deck;
  }

  static sortCards(cards) {
    return cards.sort((a, b) => {
      // Önce değere göre, sonra suit'e göre sırala
      if (a.value !== b.value) return a.value - b.value;
      const suitOrder = { '♠': 1, '♥': 2, '♦': 3, '♣': 4 };
      return suitOrder[a.suit] - suitOrder[b.suit];
    });
  }

  static canAttack(attackerCard, tableCards, trumpSuit) {
    if (tableCards.length === 0) return true;
    
    // Masada aynı değerde kart var mı?
    return tableCards.some(card => card.value === attackerCard.value);
  }

  static canDefend(defenderCard, attackerCard, trumpSuit) {
    // Aynı suit ve daha yüksek değer
    if (defenderCard.suit === attackerCard.suit && defenderCard.value > attackerCard.value) {
      return true;
    }
    
    // Trump kartı ile savunma (trump'lar her zaman kazanır)
    if (defenderCard.suit === trumpSuit && attackerCard.suit !== trumpSuit) {
      return true;
    }
    
    return false;
  }
}

// Otomatik Günlük Bonus Sistemi
cron.schedule('0 0 */12 * * *', async () => {
  console.log('🔄 Günlük bonus kontrolü başlatılıyor...');
  
  await User.updateMany(
    { dailyBonusClaimed: true },
    { 
      dailyBonusClaimed: false,
      lastDailyBonus: new Date() 
    }
  );
  
  console.log('✅ Günlük bonuslar sıfırlandı');
});

// Aktif odalar
const activeRooms = new Map();
const userConnections = new Map();

// Socket.io Bağlantıları
io.on('connection', (socket) => {
  console.log(`🔄 Yeni bağlantı: ${socket.id}`);
  
  // Telegram Girişi
  socket.on('telegram-login', async (data) => {
    try {
      const { initData } = data;
      const telegramUser = parseTelegramData(initData);
      
      let user = await User.findOne({ telegramId: telegramUser.id });
      
      // Günlük bonus kontrolü
      const now = new Date();
      const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000));
      
      if (user) {
        // 12 saat geçmişse bonusu sıfırla
        if (user.lastDailyBonus && user.lastDailyBonus < twelveHoursAgo) {
          user.dailyBonusClaimed = false;
        }
      } else {
        // Yeni kullanıcı
        user = new User({
          telegramId: telegramUser.id,
          username: telegramUser.username,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          photoUrl: telegramUser.photo_url,
          balance: 100,
          dailyBonusClaimed: false
        });
      }
      
      await user.save();
      
      userConnections.set(socket.id, {
        socketId: socket.id,
        telegramId: user.telegramId,
        userData: user,
        currentRoom: null
      });
      
      socket.emit('login-success', {
        user: {
          id: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          photoUrl: user.photoUrl,
          balance: user.balance,
          dailyBonusAvailable: !user.dailyBonusClaimed,
          totalGames: user.totalGames,
          gamesWon: user.gamesWon,
          gamesLost: user.gamesLost
        }
      });
      
      console.log(`✅ Telegram girişi: ${user.username}`);
    } catch (error) {
      console.error('Giriş hatası:', error);
      socket.emit('login-error', { message: 'Giriş başarısız' });
    }
  });
  
  // Günlük Bonus Al
  socket.on('claim-daily-bonus', async () => {
    const userConn = userConnections.get(socket.id);
    if (!userConn) return;
    
    const user = await User.findOne({ telegramId: userConn.telegramId });
    if (!user || user.dailyBonusClaimed) {
      socket.emit('bonus-error', { message: 'Bonus zaten alındı' });
      return;
    }
    
    // 12 saat kontrolü
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000));
    
    if (user.lastDailyBonus && user.lastDailyBonus > twelveHoursAgo) {
      socket.emit('bonus-error', { message: 'Henüz 12 saat geçmedi' });
      return;
    }
    
    user.balance += 50;
    user.dailyBonusClaimed = true;
    user.lastDailyBonus = now;
    await user.save();
    
    userConn.userData = user;
    
    socket.emit('bonus-claimed', {
      amount: 50,
      newBalance: user.balance,
      nextBonusTime: new Date(now.getTime() + (12 * 60 * 60 * 1000))
    });
    
    console.log(`💰 Günlük bonus: ${user.username} +50$`);
  });
  
  // Oda Oluştur
  socket.on('create-room', async (data) => {
    const userConn = userConnections.get(socket.id);
    if (!userConn) return;
    
    const { maxPlayers = 4, betAmount = 0 } = data;
    
    // Oda ID oluştur
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    
    // Desteyi oluştur
    const deck = DurakGame.generateDeck();
    const trumpCard = deck[0]; // İlk kart koz
    
    const newRoom = {
      roomId,
      roomCode,
      players: [],
      deck,
      trumpCard,
      gameState: 'waiting',
      tableCards: [],
      maxPlayers,
      betAmount,
      potAmount: 0,
      createdAt: new Date()
    };
    
    activeRooms.set(roomId, newRoom);
    
    // MongoDB'ye kaydet
    const roomDoc = new Room({
      roomId,
      roomCode,
      deck,
      trumpCard,
      maxPlayers,
      betAmount
    });
    await roomDoc.save();
    
    // Oyuncuyu odaya ekle
    joinRoom(socket, roomId, userConn);
    
    socket.emit('room-created', {
      roomId,
      roomCode,
      maxPlayers,
      betAmount
    });
    
    console.log(`🎮 Oda oluşturuldu: ${roomId} (${roomCode})`);
  });
  
  // Odaya Katıl (Kod ile)
  socket.on('join-room-by-code', async (data) => {
    const userConn = userConnections.get(socket.id);
    if (!userConn) return;
    
    const { roomCode } = data;
    
    // Odayı bul
    let targetRoom = null;
    for (const [roomId, room] of activeRooms.entries()) {
      if (room.roomCode === roomCode && room.players.length < room.maxPlayers && room.gameState === 'waiting') {
        targetRoom = room;
        break;
      }
    }
    
    if (!targetRoom) {
      socket.emit('room-join-error', { message: 'Oda bulunamadı veya dolu' });
      return;
    }
    
    joinRoom(socket, targetRoom.roomId, userConn);
  });
  
  // Hızlı Oyna (Otomatik Eşleşme)
  socket.on('quick-play', async (data) => {
    const userConn = userConnections.get(socket.id);
    if (!userConn) return;
    
    const { maxPlayers = 4 } = data;
    
    // Uygun oda ara
    let availableRoom = null;
    for (const [roomId, room] of activeRooms.entries()) {
      if (room.players.length < room.maxPlayers && 
          room.gameState === 'waiting' && 
          room.maxPlayers === maxPlayers) {
        availableRoom = room;
        break;
      }
    }
    
    if (!availableRoom) {
      // Yeni oda oluştur
      socket.emit('create-room', { maxPlayers });
      return;
    }
    
    joinRoom(socket, availableRoom.roomId, userConn);
  });
  
  // Oyuncu Hazır
  socket.on('player-ready', (data) => {
    const { roomId } = data;
    const room = activeRooms.get(roomId);
    if (!room) return;
    
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    
    player.isReady = true;
    
    // Odaya bildir
    io.to(roomId).emit('player-ready-update', {
      playerId: player.telegramId,
      username: player.username,
      isReady: true
    });
    
    // Tüm oyuncular hazır mı kontrol et
    const allReady = room.players.length >= 2 && room.players.every(p => p.isReady);
    
    if (allReady && room.gameState === 'waiting') {
      startGame(roomId);
    }
  });
  
  // Kart Atak
  socket.on('attack-card', (data) => {
    const { roomId, cardId } = data;
    const room = activeRooms.get(roomId);
    if (!room || room.gameState !== 'playing') return;
    
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isAttacker) return;
    
    const cardIndex = player.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;
    
    const card = player.cards[cardIndex];
    
    // Atak yapılabilir mi?
    if (!DurakGame.canAttack(card, room.tableCards, room.trumpCard.suit)) {
      socket.emit('invalid-move', { message: 'Bu kart ile atak yapamazsınız' });
      return;
    }
    
    // Kartı masaya koy
    player.cards.splice(cardIndex, 1);
    room.tableCards.push({
      ...card,
      attackerId: player.telegramId,
      defenderId: null,
      isDefended: false
    });
    
    // Güncellemeleri gönder
    io.to(roomId).emit('card-attacked', {
      player: player.username,
      card,
      tableCards: room.tableCards
    });
    
    // Oyuncu kartlarını güncelle
    io.to(player.socketId).emit('update-hand', {
      cards: player.cards
    });
    
    // Savunma sırası
    const defender = room.players.find(p => p.isDefender);
    if (defender) {
      io.to(roomId).emit('defender-turn', {
        player: defender.username,
        time: 30
      });
    }
  });
  
  // Kart Savunma
  socket.on('defend-card', (data) => {
    const { roomId, attackerCardId, defenderCardId } = data;
    const room = activeRooms.get(roomId);
    if (!room || room.gameState !== 'playing') return;
    
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isDefender) return;
    
    const attackerCard = room.tableCards.find(c => c.id === attackerCardId);
    const defenderCardIndex = player.cards.findIndex(c => c.id === defenderCardId);
    
    if (!attackerCard || defenderCardIndex === -1) return;
    
    const defenderCard = player.cards[defenderCardIndex];
    
    // Savunma geçerli mi?
    if (!DurakGame.canDefend(defenderCard, attackerCard, room.trumpCard.suit)) {
      socket.emit('invalid-move', { message: 'Bu kart ile savunamazsınız' });
      return;
    }
    
    // Kartı savun
    player.cards.splice(defenderCardIndex, 1);
    attackerCard.defenderId = player.telegramId;
    attackerCard.isDefended = true;
    
    // Güncellemeleri gönder
    io.to(roomId).emit('card-defended', {
      player: player.username,
      attackerCard,
      defenderCard,
      tableCards: room.tableCards
    });
    
    // Oyuncu kartlarını güncelle
    io.to(player.socketId).emit('update-hand', {
      cards: player.cards
    });
    
    // Tüm kartlar savunuldu mu?
    const allDefended = room.tableCards.every(c => c.isDefended);
    
    if (allDefended) {
      // Tur bitti, masayı temizle
      room.tableCards = [];
      
      // Yeni tur
      nextTurn(roomId);
    }
  });
  
  // Kart Alma (Savunamama)
  socket.on('take-cards', (data) => {
    const { roomId } = data;
    const room = activeRooms.get(roomId);
    if (!room || room.gameState !== 'playing') return;
    
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isDefender) return;
    
    // Tüm masadaki kartları al
    player.cards = [...player.cards, ...room.tableCards];
    player.cards = DurakGame.sortCards(player.cards);
    
    room.tableCards = [];
    
    // Güncellemeleri gönder
    io.to(roomId).emit('cards-taken', {
      player: player.username,
      cardCount: room.tableCards.length
    });
    
    io.to(player.socketId).emit('update-hand', {
      cards: player.cards
    });
    
    // Sonraki atakçı
    nextAttacker(roomId);
  });
  
  // Bağlantı Kesildiğinde
  socket.on('disconnect', () => {
    console.log(`❌ Bağlantı kesildi: ${socket.id}`);
    
    const userConn = userConnections.get(socket.id);
    if (!userConn) return;
    
    // Oyuncuyu odadan çıkar
    if (userConn.currentRoom) {
      leaveRoom(socket.id, userConn.currentRoom);
    }
    
    userConnections.delete(socket.id);
  });
});

// Yardımcı Fonksiyonlar
function parseTelegramData(initData) {
  // Telegram verilerini parse et
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    
    if (userStr) {
      const user = JSON.parse(decodeURIComponent(userStr));
      return {
        id: user.id.toString(),
        username: user.username || `user_${user.id}`,
        first_name: user.first_name || 'Oyuncu',
        last_name: user.last_name || '',
        photo_url: user.photo_url || `https://ui-avatars.com/api/?name=${user.first_name}&background=random`
      };
    }
  } catch (error) {
    console.error('Telegram parse hatası:', error);
  }
  
  // Fallback
  return {
    id: `anon_${Date.now()}`,
    username: 'AnonPlayer',
    first_name: 'Anon',
    photo_url: 'https://ui-avatars.com/api/?name=Anon&background=random'
  };
}

async function joinRoom(socket, roomId, userConn) {
  const room = activeRooms.get(roomId);
  if (!room || room.players.length >= room.maxPlayers) return;
  
  // Oyuncuyu ekle
  const player = {
    socketId: socket.id,
    telegramId: userConn.telegramId,
    username: userConn.userData.username,
    photoUrl: userConn.userData.photoUrl,
    position: room.players.length,
    cards: [],
    isReady: false,
    isAttacker: false,
    isDefender: false,
    score: 0
  };
  
  room.players.push(player);
  socket.join(roomId);
  
  userConn.currentRoom = roomId;
  
  // Odaya katıldı bildirimi
  io.to(roomId).emit('player-joined', {
    player: {
      username: player.username,
      photoUrl: player.photoUrl,
      position: player.position,
      isReady: false
    },
    roomInfo: {
      roomId: room.roomId,
      roomCode: room.roomCode,
      players: room.players.map(p => ({
        username: p.username,
        photoUrl: p.photoUrl,
        isReady: p.isReady
      })),
      maxPlayers: room.maxPlayers,
      gameState: room.gameState
    }
  });
  
  // Oyuncuya oda bilgilerini gönder
  socket.emit('room-joined', {
    roomId: room.roomId,
    roomCode: room.roomCode,
    players: room.players,
    maxPlayers: room.maxPlayers,
    yourPosition: player.position
  });
}

function leaveRoom(socketId, roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return;
  
  const playerIndex = room.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return;
  
  const player = room.players[playerIndex];
  
  // Oyuncuyu çıkar
  room.players.splice(playerIndex, 1);
  
  // Odadaki diğer oyunculara bildir
  io.to(roomId).emit('player-left', {
    playerId: player.telegramId,
    username: player.username
  });
  
  // Oda boşsa temizle
  if (room.players.length === 0) {
    activeRooms.delete(roomId);
    Room.deleteOne({ roomId }).catch(console.error);
  }
}

async function startGame(roomId) {
  const room = activeRooms.get(roomId);
  if (!room || room.players.length < 2) return;
  
  room.gameState = 'playing';
  
  // Kartları dağıt
  const cardsPerPlayer = room.players.length <= 3 ? 6 : 5;
  
  room.players.forEach(player => {
    player.cards = room.deck.splice(0, cardsPerPlayer);
    player.cards = DurakGame.sortCards(player.cards);
    player.isReady = false;
  });
  
  // İlk atakçıyı belirle (en düşük koz)
  let lowestTrumpPlayer = null;
  let lowestTrumpValue = 15;
  
  room.players.forEach((player, index) => {
    const trumpCard = player.cards.find(c => c.suit === room.trumpCard.suit);
    if (trumpCard && trumpCard.value < lowestTrumpValue) {
      lowestTrumpValue = trumpCard.value;
      lowestTrumpPlayer = index;
    }
  });
  
  // Koz yoksa rastgele
  if (lowestTrumpPlayer === null) {
    lowestTrumpPlayer = Math.floor(Math.random() * room.players.length);
  }
  
  room.players[lowestTrumpPlayer].isAttacker = true;
  room.players[(lowestTrumpPlayer + 1) % room.players.length].isDefender = true;
  room.currentAttackerIndex = lowestTrumpPlayer;
  
  // Her oyuncuya kartlarını gönder
  room.players.forEach(player => {
    io.to(player.socketId).emit('game-started', {
      yourCards: player.cards,
      trumpCard: room.trumpCard,
      isAttacker: player.isAttacker,
      isDefender: player.isDefender,
      players: room.players.map(p => ({
        username: p.username,
        photoUrl: p.photoUrl,
        cardCount: p.cards.length,
        isAttacker: p.isAttacker,
        isDefender: p.isDefender
      }))
    });
  });
  
  // İlk atakçının sırası
  const firstAttacker = room.players[lowestTrumpPlayer];
  io.to(roomId).emit('attacker-turn', {
    player: firstAttacker.username,
    time: 30
  });
  
  console.log(`🎮 Oyun başladı: ${roomId}`);
}

function nextTurn(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return;
  
  // Rolleri değiştir
  room.players.forEach(player => {
    player.isAttacker = false;
    player.isDefender = false;
  });
  
  // Yeni atakçı ve savunmacı
  room.currentAttackerIndex = (room.currentAttackerIndex + 1) % room.players.length;
  room.players[room.currentAttackerIndex].isAttacker = true;
  room.players[(room.currentAttackerIndex + 1) % room.players.length].isDefender = true;
  
  // Kartları dağıt (eğer destede kart varsa)
  room.players.forEach(player => {
    const neededCards = 6 - player.cards.length;
    if (neededCards > 0 && room.deck.length > 0) {
      const newCards = room.deck.splice(0, Math.min(neededCards, room.deck.length));
      player.cards = [...player.cards, ...newCards];
      player.cards = DurakGame.sortCards(player.cards);
      
      io.to(player.socketId).emit('update-hand', {
        cards: player.cards
      });
    }
  });
  
  // Yeni atakçının sırası
  const attacker = room.players[room.currentAttackerIndex];
  io.to(roomId).emit('attacker-turn', {
    player: attacker.username,
    time: 30
  });
}

function nextAttacker(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return;
  
  // Sadece atakçı değişir, savunmacı aynı kalır
  room.players.forEach(player => {
    player.isAttacker = false;
  });
  
  room.currentAttackerIndex = (room.currentAttackerIndex + 1) % room.players.length;
  room.players[room.currentAttackerIndex].isAttacker = true;
  
  const attacker = room.players[room.currentAttackerIndex];
  io.to(roomId).emit('attacker-turn', {
    player: attacker.username,
    time: 30
  });
}

// Statik Dosyalar
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// API Endpoints
app.get('/api/rooms/active', (req, res) => {
  const rooms = Array.from(activeRooms.values()).map(room => ({
    roomId: room.roomId,
    roomCode: room.roomCode,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    gameState: room.gameState
  }));
  res.json(rooms);
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Durak Sunucusu ${PORT} portunda çalışıyor`);
  console.log(`🎮 Oyun Linki: http://localhost:${PORT}`);
});
