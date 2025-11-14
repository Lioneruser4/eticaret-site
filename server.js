const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js'); // Sunucu taraflı doğrulama için

const app = express();
const server = http.createServer(app);

// CORS Ayarları: GitHub Pages adresinize izin verin
const io = new Server(server, {
  cors: {
    origin: "https://kullaniciadiniz.github.io", // Burayı kendi GitHub Pages adresinizle değiştirin
    methods: ["GET", "POST"]
  }
});

let games = {}; // Aktif oyunları ve odaları tutacak

io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  // Lobi Kurma
  socket.on('createRoom', () => {
    const roomId = Math.random().toString(36).substring(2, 7); // Rastgele oda ID'si
    socket.join(roomId);
    
    // Yeni bir oyun mantığı başlat
    games[roomId] = {
      chess: new Chess(),
      players: { 'w': socket.id, 'b': null }, // 'w' (beyaz) kurucudur
      turn: 'w'
    };
    
    socket.emit('roomCreated', { roomId: roomId, color: 'w' });
    console.log(`Oda kuruldu: ${roomId} - Kurucu (Beyaz): ${socket.id}`);
  });

  // Odaya Katılma
  socket.on('joinRoom', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);

    if (!room) {
      socket.emit('error', 'Oda bulunamadı.');
      return;
    }

    if (room.size >= 2) {
      socket.emit('error', 'Oda dolu.');
      return;
    }

    // İkinci oyuncu (Siyah) katılıyor
    socket.join(roomId);
    games[roomId].players['b'] = socket.id;
    
    console.log(`Oyuncu ${socket.id} odaya katıldı (Siyah): ${roomId}`);
    
    // Oyunu başlat ve iki oyuncuya da bildir
    io.to(roomId).emit('gameStart', {
      game: games[roomId],
      startFEN: games[roomId].chess.fen()
    });
  });

  // Hamle Yapma
  socket.on('makeMove', (data) => {
    const { roomId, move } = data;
    const game = games[roomId];

    if (!game) return;

    // Sıranın doğru oyuncuda olduğunu doğrula
    const currentPlayerSocketId = game.players[game.turn];
    if (socket.id !== currentPlayerSocketId) {
      return socket.emit('error', 'Sıra sizde değil.');
    }

    // Hamleyi sunucuda doğrula
    try {
      const chessMove = game.chess.move(move); // chess.js hamleyi dener
      if (chessMove) {
        // Hamle geçerli, herkese bildir
        game.turn = game.chess.turn(); // Sırayı değiştir
        io.to(roomId).emit('moveMade', { 
          move: chessMove, 
          fen: game.chess.fen(),
          turn: game.turn
        });

        // Oyun Bitti mi Kontrolü
        if (game.chess.isGameOver()) {
          let reason = 'Oyun bitti.';
          if (game.chess.isCheckmate()) reason = 'Şah Mat!';
          if (game.chess.isStalemate()) reason = 'Pat!';
          if (game.chess.isThreefoldRepetition()) reason = 'Üç kez tekrar!';
          
          io.to(roomId).emit('gameOver', reason);
        }
      } else {
        socket.emit('error', 'Geçersiz hamle.');
      }
    } catch (e) {
      socket.emit('error', 'Geçersiz hamle formatı.');
    }
  });

  // Bağlantı Kesilmesi
  socket.on('disconnect', () => {
    console.log('Bir kullanıcı ayrıldı:', socket.id);
    // TODO: Kullanıcının olduğu odaları bulup rakibine haber ver (oyun iptal/kazandı).
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
