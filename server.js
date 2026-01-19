const express = require('express');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB bağlantısı - SADECE MONGO_URI kullan
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/telegram_askfm?retryWrites=true&w=majority";

let db = null;
let usersCollection = null;
let questionsCollection = null;
let messagesCollection = null;
let notificationsCollection = null;
let isDbConnected = false;

// MongoDB'ye bağlan
async function connectDB() {
  try {
    console.log('⏳ MongoDB bağlantısı kuruluyor...');
    
    const client = new MongoClient(MONGO_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });
    
    await client.connect();
    console.log('✅ MongoDB bağlantısı başarılı!');
    
    db = client.db();
    
    // Koleksiyonları oluştur
    usersCollection = db.collection('users');
    questionsCollection = db.collection('questions');
    messagesCollection = db.collection('messages');
    notificationsCollection = db.collection('notifications');
    
    // Index'ler oluştur
    await usersCollection.createIndex({ telegramId: 1 }, { unique: true });
    await questionsCollection.createIndex({ toUserId: 1, createdAt: -1 });
    await messagesCollection.createIndex({ participants: 1, createdAt: -1 });
    await notificationsCollection.createIndex({ userId: 1, createdAt: -1 });
    
    isDbConnected = true;
    console.log('📊 Koleksiyonlar hazır!');
    
  } catch (err) {
    console.error('❌ MongoDB bağlantı hatası:', err.message);
    isDbConnected = false;
    
    // 10 saniye sonra tekrar dene
    setTimeout(connectDB, 10000);
  }
}

// Bağlantıyı başlat
connectDB();

// Sunucu durumunu kontrol et
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbConnected: isDbConnected,
    timestamp: new Date().toISOString()
  });
});

// Veritabanı bağlantı kontrol middleware
app.use((req, res, next) => {
  if (!isDbConnected && req.path !== '/api/health') {
    return res.status(503).json({ 
      error: 'Veritabanı bağlantısı kuruluyor. Lütfen bekleyin...',
      retryAfter: 10
    });
  }
  next();
});

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Telegram WebApp veri doğrulama
function validateTelegramData(initData) {
  try {
    // Basit doğrulama - production'da daha güvenli doğrulama yapmalısınız
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    
    if (!userStr) return null;
    
    const user = JSON.parse(userStr);
    if (!user.id || !user.first_name) return null;
    
    return user;
  } catch (error) {
    console.error('Telegram data validation error:', error);
    return null;
  }
}

// Telegram kullanıcı işleme (BASİT VERSİYON)
app.post('/api/auth/telegram', async (req, res) => {
  try {
    console.log('📱 Telegram auth isteği geldi');
    
    const { initData, user: userData } = req.body;
    
    // Test modu için kontrol
    let telegramUser;
    if (initData && initData !== 'test') {
      telegramUser = validateTelegramData(initData);
    } else {
      // Test modu - demo kullanıcı
      telegramUser = userData || {
        id: Date.now(),
        first_name: 'Test',
        last_name: 'Kullanıcı',
        username: 'testuser',
        photo_url: 'https://ui-avatars.com/api/?name=Test+Kullanıcı&background=667eea&color=fff&size=150'
      };
    }
    
    if (!telegramUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'Geçersiz Telegram verisi',
        debug: req.body
      });
    }
    
    console.log('🔍 Kullanıcı bulunuyor:', telegramUser.id);
    
    // Kullanıcı adını oluştur
    const displayName = `${telegramUser.first_name}${telegramUser.last_name ? ' ' + telegramUser.last_name : ''}`;
    
    // Avatar URL'sini hazırla
    let photoUrl = telegramUser.photo_url;
    if (!photoUrl || photoUrl === '') {
      const initials = telegramUser.first_name.charAt(0) + (telegramUser.last_name ? telegramUser.last_name.charAt(0) : '');
      photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=667eea&color=fff&size=150`;
    }
    
    // Kullanıcı verileri
    const userToSave = {
      telegramId: String(telegramUser.id),
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name || '',
      username: telegramUser.username || `user_${telegramUser.id}`,
      photoUrl: photoUrl,
      displayName: displayName,
      bio: '',
      stats: {
        questionsReceived: 0,
        questionsAnswered: 0,
        messagesSent: 0
      },
      settings: {
        allowAnonymousQuestions: true,
        allowAnonymousMessages: true,
        showOnlineStatus: true
      },
      isOnline: true,
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('💾 Kullanıcı kaydediliyor:', userToSave.telegramId);
    
    // Kullanıcıyı bul veya oluştur
    let user;
    try {
      const result = await usersCollection.findOneAndUpdate(
        { telegramId: String(telegramUser.id) },
        { 
          $setOnInsert: userToSave,
          $set: { 
            lastSeen: new Date(),
            updatedAt: new Date(),
            photoUrl: photoUrl,
            username: telegramUser.username || userToSave.username
          }
        },
        { 
          upsert: true,
          returnDocument: 'after'
        }
      );
      
      user = result.value;
      console.log('✅ Kullanıcı işlendi:', user._id);
      
    } catch (dbError) {
      console.error('❌ DB hatası:', dbError);
      
      // Fallback: basit insert
      const insertResult = await usersCollection.insertOne(userToSave);
      user = { ...userToSave, _id: insertResult.insertedId };
    }
    
    // Yanıtı hazırla
    const responseUser = {
      _id: user._id,
      telegramId: user.telegramId,
      displayName: user.displayName,
      username: user.username,
      photoUrl: user.photoUrl,
      bio: user.bio || '',
      stats: user.stats,
      settings: user.settings,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen
    };
    
    res.json({ 
      success: true, 
      user: responseUser,
      message: 'Giriş başarılı!'
    });
    
  } catch (error) {
    console.error('🔥 Telegram auth hatası:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Sunucu hatası',
      details: error.message 
    });
  }
});

// Tüm kullanıcıları getir
app.get('/api/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    let query = {};
    if (search) {
      query = {
        $or: [
          { displayName: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
          { firstName: { $regex: search, $options: 'i' } }
        ]
      };
    }
    
    const users = await usersCollection.find(query, {
      projection: {
        _id: 1,
        telegramId: 1,
        displayName: 1,
        username: 1,
        photoUrl: 1,
        bio: 1,
        stats: 1,
        isOnline: 1,
        lastSeen: 1,
        'settings.allowAnonymousQuestions': 1
      }
    })
    .sort({ 'stats.questionsAnswered': -1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .toArray();
    
    const total = await usersCollection.countDocuments(query);
    
    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
    
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: 'Kullanıcılar yüklenemedi' });
  }
});

// Soru gönder
app.post('/api/questions', async (req, res) => {
  try {
    const { toUserId, text, isAnonymous, fromUserId } = req.body;
    
    if (!text || !text.trim() || !toUserId) {
      return res.status(400).json({ success: false, error: 'Soru metni ve alıcı gereklidir' });
    }
    
    // Alıcıyı kontrol et
    const toUser = await usersCollection.findOne({ 
      _id: new ObjectId(toUserId) 
    });
    
    if (!toUser) {
      return res.status(404).json({ success: false, error: 'Alıcı bulunamadı' });
    }
    
    const questionData = {
      toUserId: new ObjectId(toUserId),
      text: text.trim(),
      isAnonymous: Boolean(isAnonymous),
      fromUserId: isAnonymous ? null : (fromUserId ? new ObjectId(fromUserId) : null),
      anonymousName: isAnonymous ? `Anonim${Math.floor(1000 + Math.random() * 9000)}` : null,
      createdAt: new Date(),
      answered: false,
      answerText: null,
      answeredAt: null,
      likes: 0
    };
    
    const result = await questionsCollection.insertOne(questionData);
    
    // Bildirim oluştur
    const notification = {
      userId: new ObjectId(toUserId),
      type: 'new_question',
      questionId: result.insertedId,
      fromUserId: isAnonymous ? null : (fromUserId ? new ObjectId(fromUserId) : null),
      fromUsername: isAnonymous ? questionData.anonymousName : null,
      text: `Yeni bir ${isAnonymous ? 'anonim' : ''} soru aldın: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
      isRead: false,
      createdAt: new Date()
    };
    
    await notificationsCollection.insertOne(notification);
    
    // Gerçek zamanlı bildirim
    io.to(`user_${toUserId}`).emit('new_question', {
      ...questionData,
      _id: result.insertedId,
      notification: notification
    });
    
    // İstatistikleri güncelle
    await usersCollection.updateOne(
      { _id: new ObjectId(toUserId) },
      { $inc: { 'stats.questionsReceived': 1 } }
    );
    
    res.json({ 
      success: true, 
      questionId: result.insertedId,
      anonymousName: questionData.anonymousName
    });
    
  } catch (error) {
    console.error('Send question error:', error);
    res.status(500).json({ success: false, error: 'Soru gönderilemedi' });
  }
});

// Kullanıcının sorularını getir
app.get('/api/users/:id/questions', async (req, res) => {
  try {
    const userId = req.params.id;
    const { type = 'unanswered' } = req.query;
    
    let query = { toUserId: new ObjectId(userId) };
    
    if (type === 'unanswered') {
      query.answered = false;
    } else if (type === 'answered') {
      query.answered = true;
    }
    
    const questions = await questionsCollection.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    
    res.json({ success: true, questions });
    
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ success: false, error: 'Sorular yüklenemedi' });
  }
});

// Soruyu yanıtla
app.post('/api/questions/:id/answer', async (req, res) => {
  try {
    const questionId = req.params.id;
    const { answerText, userId } = req.body;
    
    if (!answerText || !answerText.trim()) {
      return res.status(400).json({ success: false, error: 'Yanıt metni gereklidir' });
    }
    
    // Soruyu güncelle
    const result = await questionsCollection.updateOne(
      { _id: new ObjectId(questionId), toUserId: new ObjectId(userId) },
      { 
        $set: { 
          answered: true,
          answerText: answerText.trim(),
          answeredAt: new Date()
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Soru bulunamadı' });
    }
    
    // İstatistikleri güncelle
    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $inc: { 'stats.questionsAnswered': 1 } }
    );
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Answer question error:', error);
    res.status(500).json({ success: false, error: 'Yanıt kaydedilemedi' });
  }
});

// Mesaj gönder
app.post('/api/messages', async (req, res) => {
  try {
    const { toUserId, text, isAnonymous, fromUserId } = req.body;
    
    if (!text || !text.trim() || !toUserId) {
      return res.status(400).json({ success: false, error: 'Mesaj metni ve alıcı gereklidir' });
    }
    
    // Konuşma ID'sini oluştur
    const participants = [
      new ObjectId(fromUserId).toString(),
      new ObjectId(toUserId).toString()
    ].sort();
    
    const conversationId = participants.join('_');
    
    const messageData = {
      conversationId,
      participants: participants.map(id => new ObjectId(id)),
      fromUserId: isAnonymous ? null : new ObjectId(fromUserId),
      toUserId: new ObjectId(toUserId),
      text: text.trim(),
      isAnonymous: Boolean(isAnonymous),
      anonymousName: isAnonymous ? `Anonim${Math.floor(1000 + Math.random() * 9000)}` : null,
      isRead: false,
      createdAt: new Date()
    };
    
    const result = await messagesCollection.insertOne(messageData);
    
    res.json({ 
      success: true, 
      messageId: result.insertedId,
      conversationId,
      anonymousName: messageData.anonymousName
    });
    
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, error: 'Mesaj gönderilemedi' });
  }
});

// Konuşmaları getir
app.get('/api/conversations/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    const conversations = await messagesCollection.aggregate([
      {
        $match: {
          participants: new ObjectId(userId)
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: "$conversationId",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $eq: ["$toUserId", new ObjectId(userId)] },
                    { $eq: ["$isRead", false] }
                  ]
                }, 
                1, 
                0
              ]
            }
          }
        }
      },
      {
        $sort: { "lastMessage.createdAt": -1 }
      },
      {
        $limit: 50
      }
    ]).toArray();
    
    res.json({ success: true, conversations });
    
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, error: 'Konuşmalar yüklenemedi' });
  }
});

// Bildirimleri getir
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    const notifications = await notificationsCollection.find({
      userId: new ObjectId(userId)
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
    
    res.json({ success: true, notifications });
    
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, error: 'Bildirimler yüklenemedi' });
  }
});

// Test endpoint - MongoDB bağlantısını kontrol et
app.get('/api/test/db', async (req, res) => {
  try {
    if (!isDbConnected) {
      return res.json({ 
        success: false, 
        message: 'MongoDB bağlı değil',
        connected: false 
      });
    }
    
    // Basit bir test sorgusu
    const usersCount = await usersCollection.countDocuments();
    const questionsCount = await questionsCollection.countDocuments();
    
    res.json({
      success: true,
      connected: true,
      stats: {
        users: usersCount,
        questions: questionsCount,
        messages: await messagesCollection.countDocuments(),
        notifications: await notificationsCollection.countDocuments()
      },
      collections: {
        users: usersCollection.collectionName,
        questions: questionsCollection.collectionName,
        messages: messagesCollection.collectionName,
        notifications: notificationsCollection.collectionName
      }
    });
    
  } catch (error) {
    res.json({
      success: false,
      connected: false,
      error: error.message
    });
  }
});

// Test kullanıcı oluştur
app.post('/api/test/create-user', async (req, res) => {
  try {
    const { name = 'Test User' } = req.body;
    
    const testUser = {
      telegramId: `test_${Date.now()}`,
      firstName: name.split(' ')[0],
      lastName: name.split(' ')[1] || '',
      username: `test_${Date.now()}`,
      photoUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=667eea&color=fff&size=150`,
      displayName: name,
      bio: 'Test kullanıcısı',
      stats: {
        questionsReceived: Math.floor(Math.random() * 10),
        questionsAnswered: Math.floor(Math.random() * 8),
        messagesSent: Math.floor(Math.random() * 20)
      },
      settings: {
        allowAnonymousQuestions: true,
        allowAnonymousMessages: true,
        showOnlineStatus: true
      },
      isOnline: true,
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await usersCollection.insertOne(testUser);
    
    res.json({
      success: true,
      user: {
        ...testUser,
        _id: result.insertedId
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ana sayfa
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Socket.io bağlantıları
io.on('connection', (socket) => {
  console.log('🔌 Yeni socket bağlantısı:', socket.id);
  
  socket.on('user_online', async (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      
      await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { isOnline: true, lastSeen: new Date() } }
      );
      
      socket.broadcast.emit('user_status_changed', {
        userId,
        isOnline: true
      });
    }
  });
  
  socket.on('send_private_message', async (data) => {
    try {
      const { conversationId, fromUserId, toUserId, text, isAnonymous } = data;
      
      const messageData = {
        conversationId,
        participants: [new ObjectId(fromUserId), new ObjectId(toUserId)].sort(),
        fromUserId: isAnonymous ? null : new ObjectId(fromUserId),
        toUserId: new ObjectId(toUserId),
        text: text.trim(),
        isAnonymous: Boolean(isAnonymous),
        anonymousName: isAnonymous ? `Anonim${Math.floor(1000 + Math.random() * 9000)}` : null,
        isRead: false,
        createdAt: new Date()
      };
      
      const result = await messagesCollection.insertOne(messageData);
      messageData._id = result.insertedId;
      
      // Alıcıya gönder
      io.to(`user_${toUserId}`).emit('new_private_message', messageData);
      
      // Gönderene onay
      socket.emit('message_sent', { 
        success: true, 
        messageId: result.insertedId,
        message: messageData
      });
      
    } catch (error) {
      console.error('Socket message error:', error);
      socket.emit('message_error', { error: 'Mesaj gönderilemedi' });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Socket bağlantısı kesildi:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`📊 MongoDB durumu: ${isDbConnected ? '✅ Bağlı' : '❌ Bağlantı bekleniyor'}`);
  
  // Periyodik olarak bağlantıyı kontrol et
  setInterval(() => {
    if (!isDbConnected) {
      console.log('🔄 MongoDB bağlantısı yeniden deneniyor...');
      connectDB();
    }
  }, 30000);
});
