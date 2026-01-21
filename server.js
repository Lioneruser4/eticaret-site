const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const CryptoJS = require('crypto-js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Veritabanı (geçici - production'da Redis/MongoDB kullanın)
const usersDB = new Map(); // userId -> userData
const chatsDB = new Map(); // chatId -> chatData
const onlineUsers = new Map(); // userId -> {ws, lastSeen}
const userSessions = new Map(); // sessionId -> userId

// Middleware
app.use(express.json());
app.use(express.static('.'));

// API Endpoints
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        users: usersDB.size,
        online: onlineUsers.size,
        chats: chatsDB.size,
        uptime: process.uptime()
    });
});

app.post('/api/register', (req, res) => {
    try {
        const { userId, userName, telegramData, gameCompleted, colorPassword } = req.body;
        
        if (!userId || !userName) {
            return res.status(400).json({ error: 'Geçersiz kullanıcı verileri' });
        }
        
        // Kullanıcıyı kaydet
        const userData = {
            id: userId,
            name: userName,
            telegramData: telegramData || null,
            gameCompleted: gameCompleted || false,
            colorPassword: colorPassword || null,
            createdAt: new Date(),
            lastSeen: new Date(),
            isActive: true,
            avatar: userName.charAt(0).toUpperCase(),
            status: 'online'
        };
        
        usersDB.set(userId, userData);
        
        // Session oluştur
        const sessionId = CryptoJS.SHA256(userId + Date.now()).toString();
        userSessions.set(sessionId, userId);
        
        res.json({
            success: true,
            sessionId,
            user: userData,
            message: 'Kullanıcı başarıyla kaydedildi'
        });
        
    } catch (error) {
        console.error('Kayıt hatası:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    const user = usersDB.get(userId);
    
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    // Hassas verileri çıkar
    const publicData = {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        status: onlineUsers.has(userId) ? 'online' : 'offline',
        lastSeen: user.lastSeen,
        isActive: user.isActive
    };
    
    res.json(publicData);
});

app.get('/api/users/search', (req, res) => {
    const { query, limit = 20 } = req.query;
    
    if (!query || query.length < 2) {
        return res.json([]);
    }
    
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [userId, user] of usersDB.entries()) {
        if (results.length >= limit) break;
        
        if (user.name.toLowerCase().includes(queryLower) ||
            userId.toLowerCase().includes(queryLower) ||
            (user.telegramData && user.telegramData.username && 
             user.telegramData.username.toLowerCase().includes(queryLower))) {
            
            results.push({
                id: user.id,
                name: user.name,
                avatar: user.avatar,
                status: onlineUsers.has(userId) ? 'online' : 'offline',
                lastSeen: user.lastSeen
            });
        }
    }
    
    res.json(results);
});

// WebSocket Bağlantıları
wss.on('connection', (ws, req) => {
    console.log('Yeni WebSocket bağlantısı');
    
    ws.id = uuidv4();
    ws.userId = null;
    ws.isAlive = true;
    
    // Heartbeat
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            await handleWebSocketMessage(ws, message);
        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
            sendError(ws, 'Geçersiz mesaj formatı');
        }
    });
    
    ws.on('close', () => {
        console.log(`Bağlantı kapandı: ${ws.id}`);
        
        // Kullanıcıyı çevrimdışı yap
        if (ws.userId) {
            onlineUsers.delete(ws.userId);
            updateUserStatus(ws.userId, 'offline');
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket hatası:', error);
    });
});

// Heartbeat kontrolü
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// WebSocket Mesaj İşleme
async function handleWebSocketMessage(ws, message) {
    console.log('Gelen mesaj:', message.type);
    
    switch (message.type) {
        case 'register':
            await handleRegister(ws, message);
            break;
            
        case 'get_users':
            await handleGetUsers(ws, message);
            break;
            
        case 'search_user':
            await handleSearchUser(ws, message);
            break;
            
        case 'start_chat':
            await handleStartChat(ws, message);
            break;
            
        case 'message':
            await handleChatMessage(ws, message);
            break;
            
        case 'read_receipt':
            await handleReadReceipt(ws, message);
            break;
            
        case 'typing':
            await handleTyping(ws, message);
            break;
            
        default:
            sendError(ws, 'Bilinmeyen mesaj türü');
    }
}

async function handleRegister(ws, data) {
    const { userId, userName, action } = data;
    
    if (!userId) {
        sendError(ws, 'Kullanıcı ID\'si gerekli');
        return;
    }
    
    // Kullanıcıyı kontrol et veya oluştur
    let user = usersDB.get(userId);
    if (!user) {
        user = {
            id: userId,
            name: userName || `Anonim_${userId.substring(0, 6)}`,
            avatar: (userName || 'A').charAt(0).toUpperCase(),
            createdAt: new Date(),
            lastSeen: new Date(),
            status: 'online'
        };
        usersDB.set(userId, user);
    }
    
    // Son görülme zamanını güncelle
    user.lastSeen = new Date();
    user.status = 'online';
    
    // Online kullanıcılara ekle
    ws.userId = userId;
    onlineUsers.set(userId, {
        ws,
        lastSeen: new Date()
    });
    
    // Başarılı yanıt
    ws.send(JSON.stringify({
        type: 'registered',
        user: {
            id: user.id,
            name: user.name,
            avatar: user.avatar,
            status: 'online'
        },
        timestamp: Date.now()
    }));
    
    // Tüm kullanıcılara durum güncellemesini bildir
    broadcastUserStatus(userId, 'online');
    
    console.log(`Kullanıcı giriş yaptı: ${userId}`);
}

async function handleGetUsers(ws, data) {
    const { userId } = data;
    
    if (!userId || !onlineUsers.has(userId)) {
        sendError(ws, 'Kimlik doğrulama gerekli');
        return;
    }
    
    // Tüm aktif kullanıcıları getir (kendisi hariç)
    const usersList = [];
    
    for (const [uid, user] of usersDB.entries()) {
        if (uid === userId) continue; // Kendisini listeleme
        
        usersList.push({
            id: user.id,
            name: user.name,
            avatar: user.avatar,
            status: onlineUsers.has(uid) ? 'online' : 'offline',
            lastSeen: user.lastSeen
        });
    }
    
    ws.send(JSON.stringify({
        type: 'user_list',
        users: usersList,
        timestamp: Date.now()
    }));
}

async function handleSearchUser(ws, data) {
    const { userId, query, searchType } = data;
    
    if (!userId || !onlineUsers.has(userId)) {
        sendError(ws, 'Kimlik doğrulama gerekli');
        return;
    }
    
    if (!query || query.length < 2) {
        ws.send(JSON.stringify({
            type: 'user_found',
            user: null,
            message: 'En az 2 karakter girin'
        }));
        return;
    }
    
    const queryLower = query.toLowerCase();
    let results = [];
    
    // Arama yap
    for (const [uid, user] of usersDB.entries()) {
        if (uid === userId) continue; // Kendisini listeleme
        
        const isMatch = user.name.toLowerCase().includes(queryLower) ||
                       uid.toLowerCase().includes(queryLower) ||
                       (user.telegramData && user.telegramData.username && 
                        user.telegramData.username.toLowerCase().includes(queryLower));
        
        if (isMatch) {
            // Filtreleme
            if (searchType === 'online' && !onlineUsers.has(uid)) continue;
            
            results.push({
                id: user.id,
                name: user.name,
                avatar: user.avatar,
                status: onlineUsers.has(uid) ? 'online' : 'offline',
                lastSeen: user.lastSeen,
                telegramData: user.telegramData
            });
        }
    }
    
    // Sonuçları gönder
    if (results.length > 0) {
        // İlk sonucu göster (ilk eşleşen)
        ws.send(JSON.stringify({
            type: 'user_found',
            user: results[0],
            timestamp: Date.now()
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'user_found',
            user: null,
            message: 'Kullanıcı bulunamadı'
        }));
    }
}

async function handleStartChat(ws, data) {
    const { userId, otherUserId } = data;
    
    if (!userId || !onlineUsers.has(userId)) {
        sendError(ws, 'Kimlik doğrulama gerekli');
        return;
    }
    
    const otherUser = usersDB.get(otherUserId);
    if (!otherUser) {
        sendError(ws, 'Kullanıcı bulunamadı');
        return;
    }
    
    // Chat ID oluştur (her iki kullanıcı için aynı)
    const chatId = generateChatId(userId, otherUserId);
    
    // Chat'i kontrol et veya oluştur
    let chat = chatsDB.get(chatId);
    if (!chat) {
        chat = {
            id: chatId,
            participants: [userId, otherUserId],
            messages: [],
            createdAt: new Date(),
            lastActivity: new Date()
        };
        chatsDB.set(chatId, chat);
    }
    
    // Her iki kullanıcıya da bildirim gönder
    const user1 = onlineUsers.get(userId);
    const user2 = onlineUsers.get(otherUserId);
    
    if (user1 && user1.ws) {
        user1.ws.send(JSON.stringify({
            type: 'chat_started',
            chatId,
            otherUserId,
            otherUserName: otherUser.name,
            timestamp: Date.now()
        }));
    }
    
    if (user2 && user2.ws) {
        user2.ws.send(JSON.stringify({
            type: 'chat_started',
            chatId,
            otherUserId: userId,
            otherUserName: usersDB.get(userId).name,
            timestamp: Date.now()
        }));
    }
    
    console.log(`Sohbet başlatıldı: ${chatId} (${userId} - ${otherUserId})`);
}

async function handleChatMessage(ws, data) {
    const { chatId, senderId, content, timestamp, messageId } = data;
    
    if (!senderId || !onlineUsers.has(senderId)) {
        sendError(ws, 'Kimlik doğrulama gerekli');
        return;
    }
    
    const chat = chatsDB.get(chatId);
    if (!chat || !chat.participants.includes(senderId)) {
        sendError(ws, 'Sohbet bulunamadı veya erişim izniniz yok');
        return;
    }
    
    // Mesajı oluştur
    const message = {
        id: messageId || uuidv4(),
        chatId,
        senderId,
        content,
        timestamp: timestamp || Date.now(),
        delivered: false,
        read: false
    };
    
    // Sohbete mesajı ekle
    chat.messages.push(message);
    chat.lastActivity = new Date();
    
    // Mesaj sayısını sınırla (performans için)
    if (chat.messages.length > 1000) {
        chat.messages = chat.messages.slice(-500);
    }
    
    // Alıcıyı bul
    const receiverId = chat.participants.find(id => id !== senderId);
    
    // Mesajı alıcıya gönder
    const receiver = onlineUsers.get(receiverId);
    if (receiver && receiver.ws) {
        receiver.ws.send(JSON.stringify({
            type: 'message',
            ...message,
            delivered: true
        }));
        
        // Teslim edildi olarak işaretle
        message.delivered = true;
    }
    
    // Gönderene de onay gönder
    ws.send(JSON.stringify({
        type: 'message_sent',
        messageId: message.id,
        timestamp: Date.now()
    }));
    
    console.log(`Mesaj gönderildi: ${chatId} - ${senderId} -> ${receiverId}`);
}

async function handleReadReceipt(ws, data) {
    const { chatId, userId } = data;
    
    const chat = chatsDB.get(chatId);
    if (!chat) return;
    
    // Son mesajları okundu olarak işaretle
    chat.messages.forEach(msg => {
        if (msg.senderId !== userId && !msg.read) {
            msg.read = true;
        }
    });
    
    // Diğer kullanıcıya bildir
    const otherUserId = chat.participants.find(id => id !== userId);
    const otherUser = onlineUsers.get(otherUserId);
    
    if (otherUser && otherUser.ws) {
        otherUser.ws.send(JSON.stringify({
            type: 'messages_read',
            chatId,
            userId,
            timestamp: Date.now()
        }));
    }
}

async function handleTyping(ws, data) {
    const { chatId, userId, isTyping } = data;
    
    const chat = chatsDB.get(chatId);
    if (!chat) return;
    
    // Diğer kullanıcıya bildir
    const otherUserId = chat.participants.find(id => id !== userId);
    const otherUser = onlineUsers.get(otherUserId);
    
    if (otherUser && otherUser.ws) {
        otherUser.ws.send(JSON.stringify({
            type: 'typing',
            chatId,
            userId,
            isTyping,
            timestamp: Date.now()
        }));
    }
}

// Yardımcı Fonksiyonlar
function generateChatId(userId1, userId2) {
    // Her iki sıralama için aynı ID'yi üret
    const sortedIds = [userId1, userId2].sort();
    return CryptoJS.SHA256(sortedIds.join('_')).toString();
}

function broadcastUserStatus(userId, status) {
    const statusUpdate = {
        type: 'user_status',
        userId,
        status,
        timestamp: Date.now()
    };
    
    // Tüm online kullanıcılara gönder
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userId !== userId) {
            client.send(JSON.stringify(statusUpdate));
        }
    });
}

function updateUserStatus(userId, status) {
    const user = usersDB.get(userId);
    if (user) {
        user.status = status;
        user.lastSeen = new Date();
    }
}

function sendError(ws, message) {
    ws.send(JSON.stringify({
        type: 'error',
        message,
        timestamp: Date.now()
    }));
}

// Zaman aşımı ile temizlik
setInterval(() => {
    const now = new Date();
    const FIVE_MINUTES = 5 * 60 * 1000;
    
    // Çevrimdışı kullanıcıları temizle
    for (const [userId, userData] of onlineUsers.entries()) {
        if (now - userData.lastSeen > FIVE_MINUTES) {
            onlineUsers.delete(userId);
            updateUserStatus(userId, 'offline');
            broadcastUserStatus(userId, 'offline');
        }
    }
    
    // Eski oturumları temizle
    for (const [sessionId, userId] of userSessions.entries()) {
        // 24 saatten eski oturumları temizle
        if (now - new Date(usersDB.get(userId)?.lastSeen || 0) > 24 * 60 * 60 * 1000) {
            userSessions.delete(sessionId);
        }
    }
    
    // Eski mesajları temizle (1 günden eski sohbetler)
    for (const [chatId, chat] of chatsDB.entries()) {
        if (now - chat.lastActivity > 24 * 60 * 60 * 1000) {
            // Sadece mesajları temizle, sohbeti değil
            chat.messages = [];
        }
    }
    
    console.log(`Temizlik yapıldı: ${onlineUsers.size} online, ${chatsDB.size} sohbet`);
}, 5 * 60 * 1000); // 5 dakikada bir

// Statik dosyalar
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/chat.html', (req, res) => {
    res.sendFile(__dirname + '/chat.html');
});

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile(__dirname + '/index.html');
});

// Hata yönetimi
process.on('uncaughtException', (error) => {
    console.error('Beklenmeyen hata:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('İşlenmemiş promise:', reason);
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
    console.log(`📱 Ana sayfa: http://localhost:${PORT}`);
    console.log(`💬 Sohbet: http://localhost:${PORT}/chat.html`);
    console.log(`🔒 Sistem aktif, WebSocket hazır`);
});
