const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Kullanıcı ve sohbet verileri (geçici - bellek içi)
const users = new Map(); // userId -> {ws, userName, ...}
const chats = new Map(); // chatId -> {user1Id, user2Id, messages: []}

// WebSocket bağlantıları
wss.on('connection', (ws) => {
    console.log('Yeni bağlantı');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Mesaj işlenirken hata:', error);
        }
    });
    
    ws.on('close', () => {
        // Bağlantı kapandığında kullanıcıyı kaldır
        for (const [userId, userData] of users.entries()) {
            if (userData.ws === ws) {
                console.log(`Kullanıcı çıkış yaptı: ${userId}`);
                users.delete(userId);
                break;
            }
        }
    });
});

// Mesaj işleme
function handleMessage(ws, data) {
    switch (data.type) {
        case 'register':
            handleRegister(ws, data);
            break;
            
        case 'search_user':
            handleSearchUser(data);
            break;
            
        case 'start_chat':
            handleStartChat(data);
            break;
            
        case 'message':
            handleChatMessage(data);
            break;
            
        default:
            console.log('Bilinmeyen mesaj türü:', data.type);
    }
}

// Kullanıcı kaydı
function handleRegister(ws, data) {
    const { userId, userName } = data;
    
    // Kullanıcıyı kaydet
    users.set(userId, {
        ws,
        userId,
        userName: userName || `Anonim_${userId.substring(0, 4)}`,
        online: true,
        registeredAt: new Date()
    });
    
    console.log(`Kullanıcı kaydedildi: ${userId}`);
    
    // Onay mesajı gönder
    ws.send(JSON.stringify({
        type: 'registered',
        userId,
        message: 'Kayıt başarılı'
    }));
}

// Kullanıcı arama
function handleSearchUser(data) {
    const { userId, searchId } = data;
    
    const user = users.get(userId);
    if (!user) return;
    
    const searchedUser = users.get(searchId);
    
    if (searchedUser && searchedUser.userId !== userId) {
        // Kullanıcı bulundu
        user.ws.send(JSON.stringify({
            type: 'user_found',
            user: {
                userId: searchedUser.userId,
                userName: searchedUser.userName
            }
        }));
    } else {
        // Kullanıcı bulunamadı
        user.ws.send(JSON.stringify({
            type: 'user_not_found',
            message: 'Kullanıcı bulunamadı'
        }));
    }
}

// Sohbet başlatma
function handleStartChat(data) {
    const { userId, otherUserId } = data;
    
    const user1 = users.get(userId);
    const user2 = users.get(otherUserId);
    
    if (!user1 || !user2) {
        // Kullanıcılardan biri çevrimdışı
        if (user1) {
            user1.ws.send(JSON.stringify({
                type: 'error',
                message: 'Kullanıcı çevrimdışı'
            }));
        }
        return;
    }
    
    // Mevcut bir sohbet var mı kontrol et
    let existingChatId = null;
    for (const [chatId, chat] of chats.entries()) {
        if ((chat.user1Id === userId && chat.user2Id === otherUserId) ||
            (chat.user1Id === otherUserId && chat.user2Id === userId)) {
            existingChatId = chatId;
            break;
        }
    }
    
    let chatId;
    if (existingChatId) {
        // Mevcut sohbeti kullan
        chatId = existingChatId;
    } else {
        // Yeni sohbet oluştur
        chatId = uuidv4();
        chats.set(chatId, {
            user1Id: userId,
            user2Id: otherUserId,
            messages: [],
            createdAt: new Date()
        });
    }
    
    // Her iki kullanıcıya da sohbet başladı mesajı gönder
    const chatData = {
        type: 'chat_started',
        chatId: chatId,
        otherUserId: otherUserId,
        otherUserName: user2.userName
    };
    
    user1.ws.send(JSON.stringify(chatData));
    
    const chatData2 = {
        type: 'chat_started',
        chatId: chatId,
        otherUserId: userId,
        otherUserName: user1.userName
    };
    
    user2.ws.send(JSON.stringify(chatData2));
    
    console.log(`Sohbet başlatıldı: ${chatId} (${userId} - ${otherUserId})`);
}

// Mesaj işleme
function handleChatMessage(data) {
    const { chatId, senderId, content, timestamp } = data;
    
    const chat = chats.get(chatId);
    if (!chat) return;
    
    // Mesajı sohbete ekle
    const message = {
        senderId,
        content,
        timestamp,
        messageId: uuidv4()
    };
    
    chat.messages.push(message);
    
    // Sohbeti temizle (eski mesajları kaldır)
    if (chat.messages.length > 100) {
        chat.messages = chat.messages.slice(-50);
    }
    
    // Alıcıyı bul
    const receiverId = chat.user1Id === senderId ? chat.user2Id : chat.user1Id;
    const receiver = users.get(receiverId);
    
    // Alıcıya mesajı gönder
    if (receiver) {
        receiver.ws.send(JSON.stringify({
            type: 'message',
            chatId,
            senderId,
            senderName: users.get(senderId)?.userName || 'Anonim',
            content,
            timestamp
        }));
    }
    
    console.log(`Mesaj gönderildi: ${chatId} (${senderId} -> ${receiverId})`);
}

// Statik dosya sunumu
app.use(express.static('.'));

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        users: users.size,
        chats: chats.size
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
    
    // Düzenli temizlik
    setInterval(() => {
        cleanOldChats();
    }, 60000); // Her dakika
});

// Eski sohbetleri temizle
function cleanOldChats() {
    const now = new Date();
    const ONE_HOUR = 60 * 60 * 1000; // 1 saat
    
    for (const [chatId, chat] of chats.entries()) {
        const chatAge = now - new Date(chat.createdAt);
        
        // 1 saatten eski sohbetleri kaldır
        if (chatAge > ONE_HOUR) {
            chats.delete(chatId);
            console.log(`Eski sohbet temizlendi: ${chatId}`);
        }
    }
    
    // Çevrimdışı kullanıcıları temizle
    for (const [userId, user] of users.entries()) {
        // WebSocket bağlantısı kapalıysa kaldır
        if (user.ws.readyState === WebSocket.CLOSED) {
            users.delete(userId);
            console.log(`Çevrimdışı kullanıcı temizlendi: ${userId}`);
        }
    }
}
