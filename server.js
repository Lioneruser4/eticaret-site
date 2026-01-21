const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Veritabanı (production'da Redis/MongoDB kullanın)
const nfcDatabase = {
    // NFC ID -> {userId, registeredAt, lastUsed}
    cards: new Map(),
    
    // Kullanıcı verileri
    users: new Map(),
    
    // Aktif sohbetler
    chats: new Map(),
    
    // Oturumlar
    sessions: new Map()
};

// Middleware
app.use(express.json());
app.use(express.static('.'));

// API Endpoint'leri
app.post('/api/nfc/register', (req, res) => {
    const { userId, nfcId, telegramData } = req.body;
    
    if (!userId || !nfcId) {
        return res.status(400).json({ error: 'Eksik parametreler' });
    }
    
    // NFC kartını kaydet
    nfcDatabase.cards.set(nfcId, {
        userId,
        telegramData,
        registeredAt: new Date(),
        lastUsed: new Date()
    });
    
    // Kullanıcıyı kaydet
    if (!nfcDatabase.users.has(userId)) {
        nfcDatabase.users.set(userId, {
            userId,
            nfcId,
            createdAt: new Date(),
            lastActive: new Date(),
            chats: []
        });
    }
    
    res.json({ 
        success: true, 
        message: 'NFC kartı kaydedildi',
        nfcId 
    });
});

app.post('/api/nfc/auth', (req, res) => {
    const { nfcId } = req.body;
    
    if (!nfcId) {
        return res.status(400).json({ error: 'NFC ID gerekiyor' });
    }
    
    const cardData = nfcDatabase.cards.get(nfcId);
    
    if (!cardData) {
        return res.status(404).json({ 
            success: false, 
            message: 'NFC kartı kayıtlı değil' 
        });
    }
    
    // Son kullanım zamanını güncelle
    cardData.lastUsed = new Date();
    
    // Oturum oluştur
    const sessionId = crypto.randomBytes(16).toString('hex');
    nfcDatabase.sessions.set(sessionId, {
        userId: cardData.userId,
        nfcId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 saat
    });
    
    res.json({
        success: true,
        sessionId,
        userId: cardData.userId,
        message: 'NFC doğrulama başarılı'
    });
});

app.get('/api/user/:userId', (req, res) => {
    const { userId } = req.params;
    const user = nfcDatabase.users.get(userId);
    
    if (!user) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    res.json({
        userId: user.userId,
        createdAt: user.createdAt,
        lastActive: user.lastActive,
        chatCount: user.chats.length
    });
});

// WebSocket bağlantıları
wss.on('connection', (ws, req) => {
    console.log('Yeni WebSocket bağlantısı');
    
    ws.id = uuidv4();
    ws.userId = null;
    ws.sessionId = null;
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            await handleWebSocketMessage(ws, message);
        } catch (error) {
            console.error('Mesaj işleme hatası:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Geçersiz mesaj formatı'
            }));
        }
    });
    
    ws.on('close', () => {
        console.log(`Bağlantı kapandı: ${ws.id}`);
        // Kullanıcı durumunu güncelle
        if (ws.userId) {
            const user = nfcDatabase.users.get(ws.userId);
            if (user) {
                user.lastActive = new Date();
                user.online = false;
            }
        }
    });
});

// WebSocket mesaj işleme
async function handleWebSocketMessage(ws, message) {
    switch (message.type) {
        case 'register':
            await handleRegister(ws, message);
            break;
            
        case 'nfc_auth':
            await handleNFCAuth(ws, message);
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
            
        default:
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Bilinmeyen mesaj türü'
            }));
    }
}

async function handleRegister(ws, data) {
    const { userId, userName, telegramData } = data;
    
    if (!userId) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Kullanıcı ID\'si gerekli'
        }));
        return;
    }
    
    // Kullanıcıyı kaydet
    nfcDatabase.users.set(userId, {
        userId,
        userName: userName || `Anonim_${userId.substring(0, 6)}`,
        telegramData,
        online: true,
        createdAt: new Date(),
        lastActive: new Date(),
        ws: ws
    });
    
    ws.userId = userId;
    
    ws.send(JSON.stringify({
        type: 'registered',
        userId,
        userName: nfcDatabase.users.get(userId).userName,
        message: 'Kayıt başarılı'
    }));
    
    console.log(`Kullanıcı kaydedildi: ${userId}`);
}

async function handleNFCAuth(ws, data) {
    const { nfcId } = data;
    
    const cardData = nfcDatabase.cards.get(nfcId);
    if (!cardData) {
        ws.send(JSON.stringify({
            type: 'nfc_auth_failed',
            message: 'NFC kartı kayıtlı değil'
        }));
        return;
    }
    
    // Oturum oluştur
    const sessionId = crypto.randomBytes(16).toString('hex');
    nfcDatabase.sessions.set(sessionId, {
        userId: cardData.userId,
        nfcId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    
    // Kullanıcıyı çevrimiçi yap
    const user = nfcDatabase.users.get(cardData.userId);
    if (user) {
        user.online = true;
        user.lastActive = new Date();
        user.ws = ws;
    }
    
    ws.userId = cardData.userId;
    ws.sessionId = sessionId;
    
    ws.send(JSON.stringify({
        type: 'nfc_auth_success',
        sessionId,
        userId: cardData.userId,
        userName: user ? user.userName : 'Anonim',
        message: 'NFC doğrulama başarılı'
    }));
    
    console.log(`NFC doğrulandı: ${nfcId} -> ${cardData.userId}`);
}

async function handleSearchUser(ws, data) {
    const { userId, searchId } = data;
    
    const user = nfcDatabase.users.get(userId);
    if (!user) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Kimlik doğrulama gerekli'
        }));
        return;
    }
    
    const searchedUser = nfcDatabase.users.get(searchId);
    
    if (searchedUser && searchedUser.userId !== userId) {
        ws.send(JSON.stringify({
            type: 'user_found',
            user: {
                userId: searchedUser.userId,
                userName: searchedUser.userName,
                online: searchedUser.online,
                lastActive: searchedUser.lastActive
            }
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'user_not_found',
            message: 'Kullanıcı bulunamadı'
        }));
    }
}

async function handleStartChat(ws, data) {
    const { userId, otherUserId } = data;
    
    const user1 = nfcDatabase.users.get(userId);
    const user2 = nfcDatabase.users.get(otherUserId);
    
    if (!user1 || !user2) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Kullanıcı bulunamadı veya çevrimdışı'
        }));
        return;
    }
    
    // Sohbet ID'si oluştur
    const chatId = uuidv4();
    const chat = {
        id: chatId,
        participants: [userId, otherUserId],
        messages: [],
        createdAt: new Date(),
        lastMessageAt: new Date()
    };
    
    nfcDatabase.chats.set(chatId, chat);
    
    // Kullanıcılara sohbeti ekle
    user1.chats.push(chatId);
    user2.chats.push(chatId);
    
    // Her iki kullanıcıya da bildirim gönder
    [user1, user2].forEach(user => {
        if (user.ws && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify({
                type: 'chat_started',
                chatId,
                otherUserId: user === user1 ? otherUserId : userId,
                otherUserName: user === user1 ? user2.userName : user1.userName
            }));
        }
    });
    
    console.log(`Sohbet başlatıldı: ${chatId} (${userId} - ${otherUserId})`);
}

async function handleChatMessage(ws, data) {
    const { userId, chatId, content } = data;
    
    const chat = nfcDatabase.chats.get(chatId);
    if (!chat || !chat.participants.includes(userId)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Sohbet bulunamadı veya erişim izniniz yok'
        }));
        return;
    }
    
    // Mesajı oluştur
    const message = {
        id: uuidv4(),
        senderId: userId,
        content,
        timestamp: new Date(),
        delivered: true
    };
    
    // Sohbete mesajı ekle
    chat.messages.push(message);
    chat.lastMessageAt = new Date();
    
    // Mesajı tüm katılımcılara gönder
    chat.participants.forEach(participantId => {
        const participant = nfcDatabase.users.get(participantId);
        if (participant && participant.ws && participant.ws.readyState === WebSocket.OPEN) {
            participant.ws.send(JSON.stringify({
                type: 'message',
                chatId,
                senderId: userId,
                senderName: nfcDatabase.users.get(userId).userName,
                content,
                timestamp: message.timestamp,
                messageId: message.id
            }));
        }
    });
    
    console.log(`Mesaj gönderildi: ${chatId} - ${userId}`);
}

// Zaman aşımı ile temizlik
setInterval(() => {
    const now = new Date();
    
    // Eski oturumları temizle (24 saatten eski)
    for (const [sessionId, session] of nfcDatabase.sessions.entries()) {
        if (session.expiresAt < now) {
            nfcDatabase.sessions.delete(sessionId);
        }
    }
    
    // Eski mesajları temizle (1 saatten eski mesajlar)
    for (const [chatId, chat] of nfcDatabase.chats.entries()) {
        if (chat.lastMessageAt < new Date(now - 60 * 60 * 1000)) {
            // Sohbeti temizle
            chat.messages = chat.messages.filter(msg => 
                new Date(msg.timestamp) > new Date(now - 60 * 60 * 1000)
            );
            
            // Eğer hiç mesaj kalmadıysa sohbeti sil
            if (chat.messages.length === 0) {
                nfcDatabase.chats.delete(chatId);
            }
        }
    }
    
    // Çevrimdışı kullanıcıları işaretle
    for (const [userId, user] of nfcDatabase.users.entries()) {
        if (user.lastActive < new Date(now - 5 * 60 * 1000)) { // 5 dakika
            user.online = false;
        }
    }
    
    console.log(`Temizlik yapıldı: ${nfcDatabase.sessions.size} oturum, ${nfcDatabase.chats.size} sohbet`);
}, 5 * 60 * 1000); // 5 dakikada bir

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        users: nfcDatabase.users.size,
        chats: nfcDatabase.chats.size,
        nfcCards: nfcDatabase.cards.size,
        uptime: process.uptime()
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Sunucu ${PORT} portunda çalışıyor`);
    console.log(`🌐 WebSocket sunucusu hazır`);
    console.log(`🔒 HTTPS: https://saskioyunu.onrender.com`);
});

// Hata yönetimi
process.on('uncaughtException', (error) => {
    console.error('Beklenmeyen hata:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('İşlenmemiş promise:', reason);
});
