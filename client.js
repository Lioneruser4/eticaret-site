
$(document).ready(function() {
  // !! Render sunucunuzun adresini buraya girin !!
  const socket = io('https://sizin-sunucu-adresiniz.onrender.com'); 
  
  let board = null;
  let game = new Chess();
  let playerColor = null;
  let currentRoomId = null;

  const $status = $('#game-status');
  const $roomIdDisplay = $('#room-id-display');
  const $whitePlayer = $('#white-player');
  const $blackPlayer = $('#black-player');

  // --- Yardımcı Fonksiyonlar ---

  // Sırası gelen oyuncuyu vurgulama (İSTEK)
  function updateTurnHighlight() {
    $whitePlayer.removeClass('active-turn');
    $blackPlayer.removeClass('active-turn');

    const turn = game.turn(); // 'w' veya 'b'
    if (turn === 'w') {
      $whitePlayer.addClass('active-turn');
      $status.text("Sıra Beyazda");
    } else {
      $blackPlayer.addClass('active-turn');
      $status.text("Sıra Siyahta");
    }
  }

  // Geçerli hamleleri vurgulamayı kaldır
  function removeValidMoveHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight-valid');
  }

  // Geçerli hamleleri göster (İSTEK)
  function highlightValidMoves(square) {
    removeValidMoveHighlights();
    
    // chess.js'den geçerli hamleleri al
    let moves = game.moves({
      square: square,
      verbose: true
    });

    if (moves.length === 0) return;

    // Her geçerli hedef kareyi vurgula
    moves.forEach(move => {
      $(`#myBoard .square-${move.to}`).addClass('highlight-valid');
    });
  }

  // --- Satranç Tahtası Olayları (chessboard.js) ---

  // Bir parça kaldırıldığında
  function onDragStart(square, piece) {
    // Oyun bitmişse veya sıra o oyuncuda değilse taşı kaldıramaz
    if (game.isGameOver() === true ||
        (game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1) ||
        (game.turn() !== playerColor)) { // Sadece kendi sırasıysa
      return false;
    }

    // Taşı kaldırdığında geçerli hamleleri göster (İSTEK)
    highlightValidMoves(square);
  }

  // Bir parça bırakıldığında (hamle denemesi)
  function onDrop(source, target) {
    removeValidMoveHighlights();
    
    // İstemci tarafında hızlı bir kontrol (sunucu da doğrulayacak)
    let move = game.move({
      from: source,
      to: target,
      promotion: 'q' // Şimdilik hep vezir çıksın (geliştirilebilir)
    });

    // Geçersiz hamle ise taşı geri yerine koy
    if (move === null) return 'snapback';

    // Hamle geçerliyse, oyunu eski haline getir (sunucu onayı beklenecek)
    game.undo(); 

    // Hamleyi sunucuya gönder
    socket.emit('makeMove', { roomId: currentRoomId, move: { from: source, to: target, promotion: 'q' } });
  }

  // Hamle bittikten sonra (sunucudan onay gelince)
  function onSnapEnd() {
    board.position(game.fen()); // Tahtayı FEN durumuna göre güncelle
  }

  // --- Socket.IO Olayları (Sunucudan Gelen Mesajlar) ---

  socket.on('roomCreated', (data) => {
    currentRoomId = data.roomId;
    playerColor = data.color;
    $roomIdDisplay.text(`Oda Kodu: ${currentRoomId} (Rakip bekleniyor...)`);
    $status.text("Rakip bekleniyor.");
    // Tahtayı kur, oyuncu Beyaz (aşağıda)
    board.orientation('white');
  });

  socket.on('gameStart', (data) => {
    $roomIdDisplay.text(`Oda Kodu: ${currentRoomId}`);
    
    if (!playerColor) { // Odaya katılan oyuncu (Siyah)
      playerColor = 'b';
      board.orientation('black');
    }
    
    game.load(data.startFEN); // Sunucudan gelen FEN ile oyunu başlat
    board.position(data.startFEN);
    updateTurnHighlight();
  });

  socket.on('moveMade', (data) => {
    // Sunucudan gelen hamleyi oyuna işle
    game.move(data.move);
    board.position(game.fen()); // Tahtayı güncelle
    updateTurnHighlight();
  });

  socket.on('gameOver', (reason) => {
    $status.text(`Oyun Bitti! ${reason}`);
    $whitePlayer.removeClass('active-turn');
    $blackPlayer.removeClass('active-turn');
  });

  socket.on('error', (msg) => {
    $status.text(`Hata: ${msg}`).addClass('error');
    setTimeout(() => $status.removeClass('error'), 3000);
  });

  // --- UI Olayları (Butonlar) ---

  $('#createRoomBtn').on('click', () => {
    socket.emit('createRoom');
  });

  $('#joinRoomBtn').on('click', () => {
    const roomId = $('#roomIdInput').val();
    if (roomId) {
      socket.emit('joinRoom', roomId);
    }
  });

  // --- Başlangıç ---
  const boardConfig = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
  };
  board = Chessboard('myBoard', boardConfig);
  
});
