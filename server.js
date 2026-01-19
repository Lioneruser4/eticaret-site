const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// SQLite veritabanı
const db = new sqlite3.Database(':memory:');

// Veritabanını başlat
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        photo_url TEXT,
        gender TEXT CHECK(gender IN ('male', 'female', 'any')) DEFAULT 'any',
        country TEXT DEFAULT '',
        city TEXT DEFAULT '',
        socket_id TEXT,
        status TEXT DEFAULT 'waiting',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user1_id INTEGER,
        user2_id INTEGER,
        room_id TEXT UNIQUE,
        user1_revealed INTEGER DEFAULT 0,
        user2_revealed INTEGER DEFAULT 0,
        reveal_requested INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user1_id) REFERENCES users (id),
        FOREIGN KEY (user2_id) REFERENCES users (id)
    )`);
});

// Ülke ve şehir verileri
const countries = {
    'turkiye': ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Gaziantep'],
    'azerbaycan': ['Bakı', 'Sumqayıt', 'Xırdalan', 'Gəncə', 'Mingəçevir', 'Naxçıvan', 'Şəki', 'Şirvan']
};

app.use(express.static(__dirname));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Şehirleri getir
app.get('/api/cities/:country', (req, res) => {
    const country = req.params.country;
    if (countries[country]) {
        res.json({ success: true, cities: countries[country] });
    } else {
        res.json({ success: false, cities: [] });
    }
});

// Telegram kullanıcı bilgilerini al
app.post('/api/telegram-user', async (req, res) => {
    try {
        const { initData } = req.body;
        
        // Telegram WebApp'den gelen veriyi parse et
        const params = new URLSearchParams(initData);
        const userData = JSON.parse(params.get('user') || '{}');
        
        if (!userData.id) {
            return res.json({ success: false, error: 'Geçersiz kullanıcı verisi' });
        }
        
        // Kullanıcıyı veritabanında ara veya oluştur
        db.get('SELECT * FROM users WHERE telegram_id = ?', [userData.id], (err, existingUser) => {
            if (err) {
                return res.json({ success: false, error: 'Veritabanı hatası' });
            }
            
            if (existingUser) {
                // Mevcut kullanıcıyı güncelle
                db.run(`UPDATE users SET 
                    username = ?, first_name = ?, last_name = ?, photo_url = ?
                    WHERE telegram_id = ?`,
                    [
                        userData.username || '',
                        userData.first_name || '',
                        userData.last_name || '',
                        userData.photo_url || '',
                        userData.id
                    ], (updateErr) => {
                        if (updateErr) {
                            console.error('Update error:', updateErr);
                        }
                        res.json({ 
                            success: true, 
                            user: { ...existingUser, ...userData }
                        });
                    });
            } else {
                // Yeni kullanıcı oluştur
                const newUser = {
                    telegram_id: userData.id,
                    username: userData.username || '',
                    first_name: userData.first_name || 'Kullanıcı',
                    last_name: userData.last_name || '',
                    photo_url: userData.photo_url || '',
                    gender: 'any',
                    country: '',
                    city: '',
                    status: 'waiting'
                };
                
                db.run(`INSERT INTO users 
                    (telegram_id, username, first_name, last_name, photo_url, gender, country, city, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        newUser.telegram_id,
                        newUser.username,
                        newUser.first_name,
                        newUser.last_name,
                        newUser.photo_url,
                        newUser.gender,
                        newUser.country,
                        newUser.city,
                        newUser.status
                    ], function(insertErr) {
                        if (insertErr) {
                            console.error('Insert error:', insertErr);
                            return res.json({ success: false, error: 'Kullanıcı oluşturulamadı' });
                        }
                        newUser.id = this.lastID;
                        res.json({ success: true, user: newUser });
                    });
            }
        });
        
    } catch (error) {
        console.error('Telegram user error:', error);
        res.json({ success: false, error: 'Sunucu hatası' });
    }
});

// Kullanıcı tercihlerini güncelle
app.post('/api/update-preferences', (req, res) => {
    const { telegram_id, gender, country, city } = req.body;
    
    if (!telegram_id) {
        return res.json({ success: false, error: 'Telegram ID gerekli' });
    }
    
    db.run(`UPDATE users SET gender = ?, country = ?, city = ? WHERE telegram_id = ?`,
        [gender || 'any', country || '', city || '', telegram_id],
        function(err) {
            if (err) {
                return res.json({ success: false, error: 'Güncelleme hatası' });
            }
            res.json({ success: true });
        });
});

// Socket.io bağlantıları
io.on('connection', (socket) => {
    console.log('Kullanıcı bağlandı:', socket.id);
    
    let currentUser = null;
    let currentRoom = null;
    
    // Kullanıcıyı kaydet
    socket.on('register', (userData) => {
        currentUser = userData;
        currentUser.socket_id = socket.id;
        
        db.run(`UPDATE users SET socket_id = ?, status = 'waiting' WHERE telegram_id = ?`,
            [socket.id, userData.telegram_id], (err) => {
                if (err) console.error('Socket update error:', err);
                
                // Eşleşme bul
                findMatch(socket.id, userData);
            });
    });
    
    // Eşleşme bul
    function findMatch(socketId, user) {
        // Bekleyen kullanıcıları bul
        db.all(`SELECT * FROM users WHERE status = 'waiting' AND socket_id != ? AND gender IN (?, 'any') 
                AND (country = ? OR country = '' OR ? = '')`,
            [socketId, user.gender, user.country, user.country], (err, candidates) => {
                if (err || !candidates.length) {
                    // Eşleşme bulunamadı, bekleme modunda kal
                    setTimeout(() => findMatch(socketId, user), 3000);
                    return;
                }
                
                // Rastgele bir eş seç
                const partner = candidates[Math.floor(Math.random() * candidates.length)];
                const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // Eşleşme oluştur
                db.run(`INSERT INTO matches (user1_id, user2_id, room_id) 
                        VALUES ((SELECT id FROM users WHERE socket_id = ?), 
                                (SELECT id FROM users WHERE socket_id = ?), ?)`,
                    [socketId, partner.socket_id, roomId], function(err) {
                        if (err) {
                            console.error('Match creation error:', err);
                            return;
                        }
                        
                        // Kullanıcı durumlarını güncelle
                        db.run(`UPDATE users SET status = 'chatting' WHERE socket_id IN (?, ?)`,
                            [socketId, partner.socket_id]);
                        
                        // Her iki kullanıcıya da bildir
                        socket.emit('matched', {
                            roomId: roomId,
                            partner: {
                                name: '********',
                                photo: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2NjYyIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQwIiBmaWxsPSIjZmZmIi8+PC9zdmc+',
                                isAnon: true
                            }
                        });
                        
                        const partnerSocket = io.sockets.sockets.get(partner.socket_id);
                        if (partnerSocket) {
                            partnerSocket.emit('matched', {
                                roomId: roomId,
                                partner: {
                                    name: '********',
                                    photo: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2NjYyIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQwIiBmaWxsPSIjZmZmIi8+PC9zdmc+',
                                    isAnon: true
                                }
                            });
                        }
                        
                        console.log(`Eşleşme: ${socketId} - ${partner.socket_id} (Oda: ${roomId})`);
                    });
            });
    }
    
    // Mesaj gönder
    socket.on('send_message', (data) => {
        if (data.roomId) {
            socket.to(data.roomId).emit('receive_message', {
                sender: 'partner',
                message: data.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // Profil açma isteği
    socket.on('reveal_request', (data) => {
        db.get(`SELECT * FROM matches WHERE room_id = ?`, [data.roomId], (err, match) => {
            if (match) {
                // Diğer kullanıcıyı bul
                db.get(`SELECT socket_id FROM users WHERE id = ?`, 
                    [match.user1_id === currentUser.id ? match.user2_id : match.user1_id],
                    (err, partner) => {
                        if (partner && partner.socket_id) {
                            const partnerSocket = io.sockets.sockets.get(partner.socket_id);
                            if (partnerSocket) {
                                partnerSocket.emit('reveal_requested', {
                                    roomId: data.roomId,
                                    timeout: 7000
                                });
                                
                                // 7 saniye sonra zaman aşımı
                                setTimeout(() => {
                                    partnerSocket.emit('reveal_timeout');
                                }, 7000);
                            }
                        }
                    });
            }
        });
    });
    
    // Profil açma onayı
    socket.on('reveal_confirm', (data) => {
        db.get(`SELECT * FROM matches WHERE room_id = ?`, [data.roomId], (err, match) => {
            if (match) {
                const isUser1 = match.user1_id === currentUser.id;
                const column = isUser1 ? 'user1_revealed' : 'user2_revealed';
                
                db.run(`UPDATE matches SET ${column} = 1 WHERE room_id = ?`, [data.roomId], () => {
                    // Her ikisi de onayladı mı?
                    db.get(`SELECT user1_revealed, user2_revealed FROM matches WHERE room_id = ?`,
                        [data.roomId], (err, row) => {
                            if (row.user1_revealed && row.user2_revealed) {
                                // Profilleri aç
                                db.get(`SELECT u1.*, u2.* FROM matches m
                                        JOIN users u1 ON m.user1_id = u1.id
                                        JOIN users u2 ON m.user2_id = u2.id
                                        WHERE m.room_id = ?`, [data.roomId], (err, usersData) => {
                                    if (usersData) {
                                        io.to(data.roomId).emit('profiles_revealed', {
                                            user1: {
                                                name: `${usersData.first_name} ${usersData.last_name}`.trim(),
                                                username: usersData.username,
                                                photo: usersData.photo_url || 'default_avatar.jpg'
                                            },
                                            user2: {
                                                name: `${usersData.first_name1} ${usersData.last_name1}`.trim(),
                                                username: usersData.username1,
                                                photo: usersData.photo_url1 || 'default_avatar.jpg'
                                            }
                                        });
                                    }
                                });
                            }
                        });
                });
            }
        });
    });
    
    // Sohbeti bitir
    socket.on('end_chat', (data) => {
        if (data.roomId) {
            // Diğer kullanıcıya bildir
            socket.to(data.roomId).emit('partner_left');
            
            // Odadan çık
            socket.leave(data.roomId);
            
            // Kullanıcı durumunu güncelle
            if (currentUser) {
                db.run(`UPDATE users SET status = 'waiting' WHERE telegram_id = ?`, [currentUser.telegram_id]);
            }
            
            // Eşleşmeyi sil
            db.run(`DELETE FROM matches WHERE room_id = ?`, [data.roomId]);
            
            socket.emit('chat_ended');
        }
    });
    
    // Bağlantı kesildiğinde
    socket.on('disconnect', () => {
        if (currentUser) {
            db.run(`UPDATE users SET status = 'offline', socket_id = NULL WHERE telegram_id = ?`,
                [currentUser.telegram_id]);
        }
        console.log('Kullanıcı ayrıldı:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
    console.log(`Telegram WebApp için hazır`);
});
