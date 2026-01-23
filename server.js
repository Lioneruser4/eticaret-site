const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB Bağlantısı (AYRI KOLEKSİYON)
const MONGODB_URI = 'mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/blackjack_game?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB Blackjack veritabanına bağlandı');
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
  balance: { type: Number, default: 1000 },
  totalWins: { type: Number, default: 0 },
  totalGames: { type: Number, default: 0 },
  creditScore: { type: Number, default: 100 },
  lastLogin: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'blackjack_users' });

const gameSchema = new mongoose.Schema({
  tableId: { type: String, unique: true, required: true },
  players: [{
    socketId: String,
    telegramId: String,
    username: String,
    photoUrl: String,
    betAmount: { type: Number, default: 0 },
    cards: [Object],
    score: { type: Number, default: 0 },
    status: { type: String, default: 'waiting' }, // waiting, playing, stood, busted, blackjack
    isDealer: { type: Boolean, default: false }
  }],
  deck: [Object],
  currentPlayerIndex: { type: Number, default: 0 },
  gameState: { type: String, default: 'waiting' }, // waiting, betting, playing, ended
  potAmount: { type: Number, default: 0 },
  round: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'blackjack_games' });

const User = mongoose.model('User', userSchema);
const Game = mongoose.model('Game', gameSchema);

// Oyun Yapay Zeka Sistemi
class BlackjackAI {
  static decideAction(playerScore, dealerCard) {
    if (playerScore >= 17) return 'stand';
    if (playerScore <= 11) return 'hit';
    
    const dealerValue = dealerCard.value;
    if (playerScore >= 13 && playerScore <= 16) {
      if (dealerValue >= 2 && dealerValue <= 6) return 'stand';
      return 'hit';
    }
    return 'hit';
  }

  static generateDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = [
      { name: 'A', value: 11, altValue: 1 },
      { name: '2', value: 2 }, { name: '3', value: 3 },
      { name: '4', value: 4 }, { name: '5', value: 5 },
      { name: '6', value: 6 }, { name: '7', value: 7 },
      { name: '8', value: 8 }, { name: '9', value: 9 },
      { name: '10', value: 10 }, { name: 'J', value: 10 },
      { name: 'Q', value: 10 }, { name: 'K', value: 10 }
    ];
    
    let deck = [];
    suits.forEach(suit => {
      values.forEach(value => {
        deck.push({
          suit,
          name: value.name,
          value: value.value,
          altValue: value.altValue || value.value,
          code: `${value.name}${suit}`
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

  static calculateScore(cards) {
    let score = 0;
    let aces = 0;
    
    cards.forEach(card => {
      score += card.value;
      if (card.name === 'A') aces++;
    });
    
    while (score > 21 && aces > 0) {
      score -= 10;
      aces--;
    }
    
    return score;
  }
}

// Socket.io Bağlantıları
const activeTables = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log(`🔄 Yeni bağlantı: ${socket.id}`);
  
  // Telegram Girişi
  socket.on('telegram-login', async (data) => {
    try {
      const { initData } = data;
      const telegramUser = parseTelegramData(initData);
      
      let user = await User.findOne({ telegramId: telegramUser.id });
      
      if (!user) {
        user = new User({
          telegramId: telegramUser.id,
          username: telegramUser.username,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          photoUrl: telegramUser.photo_url,
          balance: 1000
        });
        await user.save();
      } else {
        user.lastLogin = new Date();
        await user.save();
      }
      
      userSockets.set(socket.id, {
        socketId: socket.id,
        telegramId: user.telegramId,
        userData: user
      });
      
      socket.emit('login-success', {
        user: {
          id: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          photoUrl: user.photoUrl,
          balance: user.balance,
          totalWins: user.totalWins,
          totalGames: user.totalGames,
          creditScore: user.creditScore
        }
      });
      
      console.log(`✅ Telegram girişi: ${user.username}`);
    } catch (error) {
      console.error('Giriş hatası:', error);
      socket.emit('login-error', { message: 'Giriş başarısız' });
    }
  });
  
  // Masa Bul/ Oluştur
  socket.on('find-table', async (data) => {
    const userSocket = userSockets.get(socket.id);
    if (!userSocket) return;
    
    let availableTable = null;
    
    // Boş yeri olan masa ara
    for (const [tableId, table] of activeTables.entries()) {
      if (table.players.length < 3 && table.gameState === 'waiting') {
        availableTable = table;
        break;
      }
    }
    
    if (!availableTable) {
      // Yeni masa oluştur
      const tableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newTable = {
        tableId,
        players: [],
        deck: BlackjackAI.generateDeck(),
        gameState: 'waiting',
        potAmount: 0,
        round: 1,
        createdAt: new Date()
      };
      
      activeTables.set(tableId, newTable);
      availableTable = newTable;
      
      // MongoDB'ye kaydet
      const gameDoc = new Game({
        tableId,
        players: [],
        deck: newTable.deck,
        gameState: 'waiting'
      });
      await gameDoc.save();
    }
    
    // Oyuncuyu masaya ekle
    const player = {
      socketId: socket.id,
      telegramId: userSocket.telegramId,
      username: userSocket.userData.username,
      photoUrl: userSocket.userData.photoUrl,
      betAmount: 0,
      cards: [],
      score: 0,
      status: 'waiting',
      isDealer: availableTable.players.length === 0 // İlk gelen dealer
    };
    
    availableTable.players.push(player);
    socket.join(availableTable.tableId);
    
    // Oyuncuya masa bilgilerini gönder
    socket.emit('table-joined', {
      tableId: availableTable.tableId,
      players: availableTable.players.map(p => ({
        username: p.username,
        photoUrl: p.photoUrl,
        isDealer: p.isDealer,
        status: p.status
      })),
      isDealer: player.isDealer
    });
    
    // Masadaki herkese güncelleme gönder
    io.to(availableTable.tableId).emit('table-update', {
      players: availableTable.players,
      gameState: availableTable.gameState
    });
    
    // Masa dolduysa oyunu başlat
    if (availableTable.players.length === 3) {
      startGame(availableTable.tableId);
    }
  });
  
  // Bahis Yap
  socket.on('place-bet', async (data) => {
    const { tableId, amount } = data;
    const table = activeTables.get(tableId);
    const userSocket = userSockets.get(socket.id);
    
    if (!table || !userSocket) return;
    
    const player = table.players.find(p => p.socketId === socket.id);
    const user = await User.findOne({ telegramId: userSocket.telegramId });
    
    if (!player || !user || user.balance < amount) {
      socket.emit('bet-error', { message: 'Yetersiz bakiye' });
      return;
    }
    
    // Bakiyeden düş
    user.balance -= amount;
    await user.save();
    
    player.betAmount = amount;
    table.potAmount += amount;
    
    // Tüm bahisler tamam mı kontrol et
    const allBetted = table.players.every(p => p.betAmount > 0);
    
    io.to(tableId).emit('bet-placed', {
      player: player.username,
      amount,
      potAmount: table.potAmount
    });
    
    socket.emit('balance-update', {
      balance: user.balance
    });
    
    if (allBetted) {
      table.gameState = 'playing';
      dealInitialCards(tableId);
    }
  });
  
  // Kart İste (Hit)
  socket.on('player-hit', (data) => {
    const { tableId } = data;
    const table = activeTables.get(tableId);
    
    if (!table || table.gameState !== 'playing') return;
    
    const player = table.players.find(p => p.socketId === socket.id);
    if (!player || player.status !== 'playing') return;
    
    // Oyuncuya kart dağıt
    const card = table.deck.pop();
    player.cards.push(card);
    player.score = BlackjackAI.calculateScore(player.cards);
    
    // Skor kontrolü
    if (player.score > 21) {
      player.status = 'busted';
      io.to(tableId).emit('player-busted', {
        player: player.username
      });
    } else if (player.score === 21) {
      player.status = 'blackjack';
      io.to(tableId).emit('player-blackjack', {
        player: player.username
      });
    }
    
    // Güncellemeyi gönder
    io.to(tableId).emit('card-dealt', {
      player: player.username,
      card,
      score: player.score,
      status: player.status
    });
    
    // Sıradaki oyuncuya geç
    setTimeout(() => nextPlayer(tableId), 1000);
  });
  
  // Dur (Stand)
  socket.on('player-stand', (data) => {
    const { tableId } = data;
    const table = activeTables.get(tableId);
    
    if (!table || table.gameState !== 'playing') return;
    
    const player = table.players.find(p => p.socketId === socket.id);
    if (!player) return;
    
    player.status = 'stood';
    
    io.to(tableId).emit('player-stand', {
      player: player.username
    });
    
    // Sıradaki oyuncuya geç
    setTimeout(() => nextPlayer(tableId), 1000);
  });
  
  // Kredi İste
  socket.on('request-credit', async (data) => {
    const userSocket = userSockets.get(socket.id);
    if (!userSocket) return;
    
    const user = await User.findOne({ telegramId: userSocket.telegramId });
    if (!user) return;
    
    // Kredi skoruna göre kredi ver
    let creditAmount = 0;
    if (user.creditScore >= 80) creditAmount = 500;
    else if (user.creditScore >= 60) creditAmount = 300;
    else creditAmount = 100;
    
    user.balance += creditAmount;
    user.creditScore -= 10; // Kredi kullandıkça skor düşer
    await user.save();
    
    socket.emit('credit-approved', {
      amount: creditAmount,
      newBalance: user.balance,
      newCreditScore: user.creditScore
    });
  });
  
  // Bağlantı kesildiğinde
  socket.on('disconnect', () => {
    console.log(`❌ Bağlantı kesildi: ${socket.id}`);
    
    // Oyuncuyu masalardan çıkar
    activeTables.forEach((table, tableId) => {
      const playerIndex = table.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex !== -1) {
        table.players.splice(playerIndex, 1);
        
        // Masayı güncelle
        io.to(tableId).emit('player-left', {
          playerId: socket.id
        });
        
        // Masa boşsa temizle
        if (table.players.length === 0) {
          activeTables.delete(tableId);
        }
      }
    });
    
    userSockets.delete(socket.id);
  });
});

// Oyun Fonksiyonları
async function startGame(tableId) {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  table.gameState = 'betting';
  table.round = 1;
  
  // MongoDB'yi güncelle
  await Game.findOneAndUpdate(
    { tableId },
    { 
      gameState: 'betting',
      players: table.players,
      updatedAt: new Date()
    }
  );
  
  io.to(tableId).emit('game-starting', {
    message: 'Bahislerinizi yapın!',
    bettingTime: 30
  });
  
  // 30 saniye bahis süresi
  setTimeout(() => {
    if (table.gameState === 'betting') {
      autoPlaceBets(tableId);
    }
  }, 30000);
}

async function dealInitialCards(tableId) {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  // Her oyuncuya 2 kart dağıt
  table.players.forEach(player => {
    if (player.betAmount > 0) {
      player.cards = [table.deck.pop(), table.deck.pop()];
      player.score = BlackjackAI.calculateScore(player.cards);
      player.status = 'playing';
      
      // Blackjack kontrolü
      if (player.score === 21) {
        player.status = 'blackjack';
      }
    }
  });
  
  // Güncellemeleri gönder
  table.players.forEach(player => {
    io.to(player.socketId).emit('initial-cards', {
      cards: player.cards,
      score: player.score,
      status: player.status
    });
  });
  
  // İlk oyuncuyu belirle
  table.currentPlayerIndex = 0;
  const currentPlayer = table.players[table.currentPlayerIndex];
  
  io.to(tableId).emit('player-turn', {
    player: currentPlayer.username,
    time: 25
  });
}

function nextPlayer(tableId) {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  // Bir sonraki aktif oyuncuyu bul
  let nextIndex = (table.currentPlayerIndex + 1) % table.players.length;
  let loops = 0;
  
  while (loops < table.players.length) {
    const player = table.players[nextIndex];
    
    if (player.status === 'playing') {
      table.currentPlayerIndex = nextIndex;
      
      io.to(tableId).emit('player-turn', {
        player: player.username,
        time: 25
      });
      
      // Yapay zeka oyuncusuysa otomatik karar ver
      if (player.isDealer) {
        setTimeout(() => aiPlayerAction(tableId, player), 1500);
      }
      
      return;
    }
    
    nextIndex = (nextIndex + 1) % table.players.length;
    loops++;
  }
  
  // Tüm oyuncular tamamladıysa sonuçları hesapla
  calculateResults(tableId);
}

async function aiPlayerAction(tableId, player) {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  const dealer = table.players.find(p => p.isDealer);
  const action = BlackjackAI.decideAction(player.score, dealer?.cards[0]);
  
  if (action === 'hit') {
    const card = table.deck.pop();
    player.cards.push(card);
    player.score = BlackjackAI.calculateScore(player.cards);
    
    if (player.score > 21) {
      player.status = 'busted';
    }
    
    io.to(tableId).emit('card-dealt', {
      player: player.username,
      card,
      score: player.score,
      status: player.status
    });
    
    if (player.status === 'playing') {
      setTimeout(() => aiPlayerAction(tableId, player), 1000);
    } else {
      setTimeout(() => nextPlayer(tableId), 1000);
    }
  } else {
    player.status = 'stood';
    io.to(tableId).emit('player-stand', {
      player: player.username
    });
    setTimeout(() => nextPlayer(tableId), 1000);
  }
}

async function calculateResults(tableId) {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  const results = [];
  const dealer = table.players.find(p => p.isDealer);
  const dealerScore = dealer?.score || 0;
  
  // Dealer'ın kartlarını aç
  if (dealer) {
    while (dealerScore < 17 && dealer.status !== 'busted') {
      const card = table.deck.pop();
      dealer.cards.push(card);
      dealer.score = BlackjackAI.calculateScore(dealer.cards);
    }
    
    if (dealer.score > 21) {
      dealer.status = 'busted';
    }
  }
  
  // Sonuçları hesapla
  for (const player of table.players) {
    if (player.isDealer) continue;
    
    let result = 'lost';
    let multiplier = 0;
    
    if (player.status === 'blackjack') {
      result = 'blackjack';
      multiplier = 2.5;
    } else if (player.status === 'busted') {
      result = 'busted';
      multiplier = 0;
    } else if (dealer.status === 'busted') {
      result = 'won';
      multiplier = 2;
    } else if (player.score > dealer.score) {
      result = 'won';
      multiplier = 2;
    } else if (player.score === dealer.score) {
      result = 'push';
      multiplier = 1;
    } else {
      result = 'lost';
      multiplier = 0;
    }
    
    // Bakiyeyi güncelle
    const user = await User.findOne({ telegramId: player.telegramId });
    if (user) {
      const winAmount = Math.floor(player.betAmount * multiplier);
      
      if (result === 'won' || result === 'blackjack') {
        user.balance += winAmount;
        user.totalWins += 1;
      } else if (result === 'push') {
        user.balance += player.betAmount;
      }
      
      user.totalGames += 1;
      await user.save();
      
      // Oyuncuya bildirim gönder
      io.to(player.socketId).emit('game-result', {
        result,
        winAmount: result === 'lost' ? 0 : winAmount,
        newBalance: user.balance,
        cards: player.cards,
        dealerCards: dealer?.cards,
        dealerScore: dealer?.score
      });
    }
    
    results.push({
      player: player.username,
      result,
      winAmount: Math.floor(player.betAmount * multiplier)
    });
  }
  
  // Sonuçları masaya bildir
  io.to(tableId).emit('round-results', {
    results,
    dealerCards: dealer?.cards,
    dealerScore: dealer?.score
  });
  
  // Oyunu sıfırla
  table.gameState = 'waiting';
  table.potAmount = 0;
  table.players.forEach(p => {
    p.betAmount = 0;
    p.cards = [];
    p.score = 0;
    p.status = 'waiting';
  });
  table.deck = BlackjackAI.generateDeck();
  
  // 10 saniye sonra yeni oyun
  setTimeout(() => {
    if (table.players.length > 0) {
      startGame(tableId);
    }
  }, 10000);
}

function autoPlaceBets(tableId) {
  const table = activeTables.get(tableId);
  if (!table) return;
  
  table.players.forEach(player => {
    if (player.betAmount === 0) {
      player.betAmount = 50; // Varsayılan bahis
      table.potAmount += 50;
    }
  });
  
  table.gameState = 'playing';
  dealInitialCards(tableId);
}

// Telegram Veri Ayrıştırma
function parseTelegramData(initData) {
  const params = new URLSearchParams(initData);
  const userStr = params.get('user');
  
  if (userStr) {
    const user = JSON.parse(decodeURIComponent(userStr));
    return {
      id: user.id.toString(),
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      photo_url: user.photo_url || `https://ui-avatars.com/api/?name=${user.first_name}&background=random`
    };
  }
  
  return {
    id: `anon_${Date.now()}`,
    username: 'AnonPlayer',
    first_name: 'Anon',
    photo_url: 'https://ui-avatars.com/api/?name=Anon&background=random'
  };
}

// Statik Dosyalar
app.use(express.static('public'));
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// API Endpoint'leri
app.get('/api/leaderboard', async (req, res) => {
  try {
    const topPlayers = await User.find()
      .sort({ balance: -1 })
      .limit(10)
      .select('username balance totalWins totalGames');
    
    res.json(topPlayers);
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Blackjack Sunucusu ${PORT} portunda çalışıyor`);
  console.log(`🎮 Oyun Linki: http://localhost:${PORT}`);
});
