const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// SQLite veritabanı
const db = new sqlite3.Database(':memory:');

// Veritabanı tablolarını oluştur
db.serialize(() => {
    db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE,
        name TEXT,
        photo TEXT,
        gender TEXT,
        country TEXT,
        city TEXT,
        socket_id TEXT,
        status TEXT DEFAULT 'waiting'
    )`);
    
    db.run(`CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user1_id INTEGER,
        user2_id INTEGER,
        room_id TEXT,
        user1_revealed BOOLEAN DEFAULT 0,
        user2_revealed BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'chatting',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Kullanıcı yönetimi
const users = new Map();
const waitingUsers = new Map();
const countries = {
    'turkiye': ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya'],
    'azerbaycan': ['Bakı', 'Sumqayıt', 'Xırdalan', 'Gəncə', 'Mingəçevir']
};

app.use(express.static(__dirname));
app.use(express.json());

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Şehirleri getir
app.get('/cities/:country', (req, res) => {
    res.json(countries[req.params.country] || []);
});

// Socket.io bağlantıları
io.on('connection', (socket) => {
    console.log('Kullanıcı bağlandı:', socket.id);

    // Kullanıcı kaydı (simüle Telegram)
    socket.on('register', (userData) => {
        const user = {
            id: socket.id,
            telegram_id: `tg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: userData.name || `Kullanıcı_${socket.id.substr(0, 5)}`,
            photo: userData.photo || 'default_avatar.jpg',
            gender: userData.gender,
            country: userData.country,
            city: userData.city,
            socket_id: socket.id,
            status: 'waiting'
        };

        users.set(socket.id, user);
        waitingUsers.set(socket.id, user);

        // Veritabanına kaydet
        db.run(`INSERT INTO users (telegram_id, name, photo, gender, country, city, socket_id, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.telegram_id, user.name, user.photo, user.gender, user.country, user.city, socket.id, 'waiting']);

        socket.emit('registered', user);
        findMatch(socket.id);
    });

    // Eşleşme bul
    function findMatch(userId) {
        const user = users.get(userId);
        if (!user || user.status !== 'waiting') return;

        // Uygun eş bul
        let matchId = null;
        for (const [id, candidate] of waitingUsers) {
            if (id !== userId && candidate.status === 'waiting') {
                // Cinsiyet filtresi (isteğe bağlı)
                if (user.gender && candidate.gender) {
                    if (user.gender === candidate.gender) continue;
                }
                
                // Şehir filtresi
                if (user.city && candidate.city) {
                    if (user.city !== candidate.city) continue;
                }
                
                matchId = id;
                break;
            }
        }

        if (matchId) {
            const partner = users.get(matchId);
            const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Eşleşme oluştur
            db.run(`INSERT INTO matches (user1_id, user2_id, room_id) 
                    VALUES ((SELECT id FROM users WHERE socket_id = ?), 
                            (SELECT id FROM users WHERE socket_id = ?), ?)`,
                [userId, matchId, roomId]);

            // Durumları güncelle
            user.status = 'chatting';
            partner.status = 'chatting';
            waitingUsers.delete(userId);
            waitingUsers.delete(matchId);

            // Kullanıcıları odaya ekle
            const userSocket = io.sockets.sockets.get(userId);
            const partnerSocket = io.sockets.sockets.get(matchId);
            
            if (userSocket && partnerSocket) {
                userSocket.join(roomId);
                partnerSocket.join(roomId);

                // Anonim bilgileri gönder
                userSocket.emit('matched', {
                    roomId,
                    partner: {
                        name: '********',
                        photo: 'blurred.jpg',
                        isAnon: true
                    }
                });

                partnerSocket.emit('matched', {
                    roomId,
                    partner: {
                        name: '********',
                        photo: 'blurred.jpg',
                        isAnon: true
                    }
                });

                console.log(`Eşleşme: ${userId} - ${matchId} (Oda: ${roomId})`);
            }
        }
    }

    // Mesaj gönder
    socket.on('send_message', (data) => {
        io.to(data.roomId).emit('receive_message', {
            sender: socket.id,
            message: data.message,
            timestamp: new Date().toISOString()
        });
    });

    // Profil açma isteği
    socket.on('reveal_request', (data) => {
        const user = users.get(socket.id);
        db.get(`SELECT * FROM matches WHERE room_id = ?`, [data.roomId], (err, match) => {
            if (match) {
                // Diğer kullanıcıyı bul
                const otherUserId = match.user1_id === user.id ? match.user2_id : match.user1_id;
                const otherUserSocket = Array.from(io.sockets.sockets.values())
                    .find(s => users.get(s.id)?.id === otherUserId);

                if (otherUserSocket) {
                    otherUserSocket.emit('reveal_requested', {
                        roomId: data.roomId,
                        timeout: 7000
                    });
                }
            }
        });
    });

    // Profil açma onayı
    socket.on('reveal_confirm', (data) => {
        db.get(`SELECT * FROM matches WHERE room_id = ?`, [data.roomId], (err, match) => {
            if (match) {
                const isUser1 = match.user1_id === socket.id;
                
                if (isUser1) {
                    db.run(`UPDATE matches SET user1_revealed = 1 WHERE room_id = ?`, [data.roomId]);
                } else {
                    db.run(`UPDATE matches SET user2_revealed = 1 WHERE room_id = ?`, [data.roomId]);
                }

                // Her ikisi de onayladı mı?
                db.get(`SELECT user1_revealed, user2_revealed FROM matches WHERE room_id = ?`, 
                    [data.roomId], (err, row) => {
                        if (row.user1_revealed && row.user2_revealed) {
                            // Profilleri aç
                            db.get(`SELECT u1.*, u2.* FROM matches m
                                    JOIN users u1 ON m.user1_id = u1.id
                                    JOIN users u2 ON m.user2_id = u2.id
                                    WHERE m.room_id = ?`, [data.roomId], (err, usersData) => {
                                io.to(data.roomId).emit('profiles_revealed', {
                                    user1: {
                                        name: usersData.name,
                                        photo: usersData.photo,
                                        telegram_id: usersData.telegram_id
                                    },
                                    user2: {
                                        name: usersData.name1,
                                        photo: usersData.photo1,
                                        telegram_id: usersData.telegram_id1
                                    }
                                });
                            });
                        }
                    });
            }
        });
    });

    // Sohbeti bitir
    socket.on('end_chat', (data) => {
        const user = users.get(socket.id);
        if (user) {
            user.status = 'waiting';
            waitingUsers.set(socket.id, user);
        }
        
        socket.leave(data.roomId);
        socket.emit('chat_ended');
        
        // Diğer kullanıcıya bildir
        io.to(data.roomId).emit('partner_left');
        
        // Tüm kullanıcıları odadan çıkar
        io.in(data.roomId).socketsLeave(data.roomId);
        
        // Eşleşmeyi sil
        db.run(`DELETE FROM matches WHERE room_id = ?`, [data.roomId]);
    });

    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        if (user) {
            user.status = 'offline';
            waitingUsers.delete(socket.id);
            users.delete(socket.id);
        }
        console.log('Kullanıcı ayrıldı:', socket.id);
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
    console.log(`Telegram widget entegrasyonu için: https://core.telegram.org/widgets/login`);
});
