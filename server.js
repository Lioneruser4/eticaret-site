const express = require('express');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB bağlantısı - Render Environment Variables kullan
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://xaliqmustafayev7313_db_user:R4Cno5z1Enhtr09u@sayt.1oqunne.mongodb.net/telegram_askfm?retryWrites=true&w=majority";
const client = new MongoClient(MONGO_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, usersCollection, questionsCollection, messagesCollection, notificationsCollection;

async function connectDB() {
  try {
    await client.connect();
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
    
    console.log('✅ MongoDB bağlantısı başarılı.');
  } catch (err) {
    console.error('❌ MongoDB bağlantı hatası:', err);
    process.exit(1);
  }
}
connectDB();

app.use(cors());
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Telegram kullanıcı işleme
app.post('/api/auth/telegram', async (req, res) => {
  try {
    const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.body;
    
    // Telegram WebApp data validation (basit versiyon)
    if (!id || !first_name) {
      return res.status(400).json({ error: 'Geçersiz Telegram verisi' });
    }
    
    // Kullanıcı adını oluştur
    const displayName = `${first_name}${last_name ? ' ' + last_name : ''}`;
    
    // Varsayılan avatar
    const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(first_name)}&background=667eea&color=fff&size=150`;
    
    const userData = {
      telegramId: String(id),
      firstName: first_name,
      lastName: last_name || '',
      username: username || '',
      photoUrl: photo_url || defaultAvatar,
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
      isOnline: false,
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Kullanıcıyı bul veya oluştur
    const result = await usersCollection.updateOne(
      { telegramId: String(id) },
      { 
        $setOnInsert: userData,
        $set: { 
          lastSeen: new Date(),
          updatedAt: new Date(),
          photoUrl: photo_url || userData.photoUrl
        }
      },
      { upsert: true }
    );
    
    // Kullanıcıyı getir
    const user = await usersCollection.findOne({ telegramId: String(id) });
    
    res.json({ 
      success: true, 
      user: {
        _id: user._id,
        telegramId: user.telegramId,
        displayName: user.displayName,
        username: user.username,
        photoUrl: user.photoUrl,
        bio: user.bio || '',
        stats: user.stats
      }
    });
    
  } catch (error) {
    console.error('Telegram auth error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Tüm kullanıcıları getir (keşfet sayfası için)
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
    res.status(500).json({ error: 'Kullanıcılar yüklenemedi' });
  }
});

// Belirli bir kullanıcıyı getir
app.get('/api/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    let query;
    
    if (ObjectId.isValid(userId)) {
      query = { _id: new ObjectId(userId) };
    } else {
      query = { username: userId };
    }
    
    const user = await usersCollection.findOne(query, {
      projection: {
        telegramId: 0 // Güvenlik için telegramId'yi gizle
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    // Kullanıcının sorularını getir (cevaplanmış olanlar)
    const questions = await questionsCollection.find({
      toUserId: user._id,
      answered: true
    })
    .sort({ answeredAt: -1 })
    .limit(50)
    .toArray();
    
    // Soruları düzenle
    const formattedQuestions = await Promise.all(questions.map(async (question) => {
      let fromUser = null;
      if (question.fromUserId && !question.isAnonymous) {
        fromUser = await usersCollection.findOne(
          { _id: new ObjectId(question.fromUserId) },
          { projection: { displayName: 1, username: 1, photoUrl: 1 } }
        );
      }
      
      return {
        _id: question._id,
        text: question.text,
        answerText: question.answerText,
        isAnonymous: question.isAnonymous,
        anonymousName: question.anonymousName,
        fromUser: fromUser ? {
          displayName: fromUser.displayName,
          username: fromUser.username,
          photoUrl: fromUser.photoUrl
        } : null,
        createdAt: question.createdAt,
        answeredAt: question.answeredAt,
        likes: question.likes || 0
      };
    }));
    
    res.json({
      success: true,
      user: {
        ...user,
        questions: formattedQuestions
      }
    });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Kullanıcı bilgileri yüklenemedi' });
  }
});

// Soru gönder
app.post('/api/questions', async (req, res) => {
  try {
    const { toUserId, text, isAnonymous, fromUserId } = req.body;
    
    if (!text || !text.trim() || !toUserId) {
      return res.status(400).json({ error: 'Soru metni ve alıcı gereklidir' });
    }
    
    // Alıcıyı kontrol et
    const toUser = await usersCollection.findOne({ 
      _id: new ObjectId(toUserId) 
    });
    
    if (!toUser) {
      return res.status(404).json({ error: 'Alıcı bulunamadı' });
    }
    
    // Anonim soru izni kontrolü
    if (isAnonymous && !toUser.settings.allowAnonymousQuestions) {
      return res.status(403).json({ error: 'Bu kullanıcı anonim soru kabul etmiyor' });
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
      text: `Yeni bir ${isAnonymous ? 'anonim' : ''} soru aldın`,
      isRead: false,
      createdAt: new Date()
    };
    
    await notificationsCollection.insertOne(notification);
    
    // Alıcı online ise bildirim gönder
    io.to(`user_${toUserId}`).emit('new_notification', notification);
    
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
    res.status(500).json({ error: 'Soru gönderilemedi' });
  }
});

// Kullanıcının aldığı soruları getir (cevaplanmamış)
app.get('/api/users/:id/questions', async (req, res) => {
  try {
    const userId = req.params.id;
    const { type = 'unanswered' } = req.query; // unanswered, answered, all
    
    let query = { toUserId: new ObjectId(userId) };
    
    if (type === 'unanswered') {
      query.answered = false;
    } else if (type === 'answered') {
      query.answered = true;
    }
    
    const questions = await questionsCollection.find(query)
      .sort({ createdAt: -1 })
      .toArray();
    
    // Soruları zenginleştir
    const enrichedQuestions = await Promise.all(questions.map(async (question) => {
      let fromUser = null;
      if (question.fromUserId && !question.isAnonymous) {
        fromUser = await usersCollection.findOne(
          { _id: new ObjectId(question.fromUserId) },
          { projection: { displayName: 1, username: 1, photoUrl: 1 } }
        );
      }
      
      return {
        ...question,
        fromUser: fromUser ? {
          displayName: fromUser.displayName,
          username: fromUser.username,
          photoUrl: fromUser.photoUrl
        } : null
      };
    }));
    
    res.json({ success: true, questions: enrichedQuestions });
    
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ error: 'Sorular yüklenemedi' });
  }
});

// Soruyu yanıtla
app.post('/api/questions/:id/answer', async (req, res) => {
  try {
    const questionId = req.params.id;
    const { answerText, userId } = req.body;
    
    if (!answerText || !answerText.trim()) {
      return res.status(400).json({ error: 'Yanıt metni gereklidir' });
    }
    
    // Soruyu bul ve yetki kontrolü
    const question = await questionsCollection.findOne({
      _id: new ObjectId(questionId),
      toUserId: new ObjectId(userId)
    });
    
    if (!question) {
      return res.status(404).json({ error: 'Soru bulunamadı veya yanıtlama yetkiniz yok' });
    }
    
    if (question.answered) {
      return res.status(400).json({ error: 'Bu soru zaten yanıtlandı' });
    }
    
    // Soruyu güncelle
    await questionsCollection.updateOne(
      { _id: new ObjectId(questionId) },
      { 
        $set: { 
          answered: true,
          answerText: answerText.trim(),
          answeredAt: new Date()
        }
      }
    );
    
    // İstatistikleri güncelle
    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $inc: { 'stats.questionsAnswered': 1 } }
    );
    
    // Soruyu soran kişi anonim değilse bildirim gönder
    if (question.fromUserId && !question.isAnonymous) {
      const notification = {
        userId: question.fromUserId,
        type: 'question_answered',
        questionId: new ObjectId(questionId),
        fromUserId: new ObjectId(userId),
        text: 'Soruunu yanıtladı',
        isRead: false,
        createdAt: new Date()
      };
      
      await notificationsCollection.insertOne(notification);
      io.to(`user_${question.fromUserId.toString()}`).emit('new_notification', notification);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Answer question error:', error);
    res.status(500).json({ error: 'Yanıt kaydedilemedi' });
  }
});

// Direkt mesaj gönder
app.post('/api/messages', async (req, res) => {
  try {
    const { toUserId, text, isAnonymous, fromUserId } = req.body;
    
    if (!text || !text.trim() || !toUserId) {
      return res.status(400).json({ error: 'Mesaj metni ve alıcı gereklidir' });
    }
    
    // Alıcıyı kontrol et
    const toUser = await usersCollection.findOne({ 
      _id: new ObjectId(toUserId) 
    });
    
    if (!toUser) {
      return res.status(404).json({ error: 'Alıcı bulunamadı' });
    }
    
    // Anonim mesaj izni kontrolü
    if (isAnonymous && !toUser.settings.allowAnonymousMessages) {
      return res.status(403).json({ error: 'Bu kullanıcı anonim mesaj kabul etmiyor' });
    }
    
    // Konuşma ID'sini oluştur (sıralı)
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
    
    // Bildirim oluştur
    const notification = {
      userId: new ObjectId(toUserId),
      type: 'new_message',
      messageId: result.insertedId,
      fromUserId: isAnonymous ? null : new ObjectId(fromUserId),
      fromUsername: isAnonymous ? messageData.anonymousName : null,
      text: `Yeni bir ${isAnonymous ? 'anonim' : ''} mesajın var`,
      isRead: false,
      createdAt: new Date()
    };
    
    await notificationsCollection.insertOne(notification);
    
    // Gerçek zamanlı mesaj gönder
    io.to(`user_${toUserId}`).emit('new_message', {
      ...messageData,
      _id: result.insertedId
    });
    
    // İstatistikleri güncelle
    if (!isAnonymous) {
      await usersCollection.updateOne(
        { _id: new ObjectId(fromUserId) },
        { $inc: { 'stats.messagesSent': 1 } }
      );
    }
    
    res.json({ 
      success: true, 
      messageId: result.insertedId,
      conversationId,
      anonymousName: messageData.anonymousName
    });
    
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Mesaj gönderilemedi' });
  }
});

// Kullanıcının konuşmalarını getir
app.get('/api/conversations/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Son mesajlaşma yapılan kişileri bul
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
              $cond: [{ $eq: ["$isRead", false] }, 1, 0]
            }
          }
        }
      },
      {
        $sort: { "lastMessage.createdAt": -1 }
      }
    ]).toArray();
    
    // Konuşmaları zenginleştir
    const enrichedConversations = await Promise.all(conversations.map(async (conv) => {
      const otherParticipantId = conv.lastMessage.participants.find(
        id => id.toString() !== userId
      );
      
      const otherUser = await usersCollection.findOne(
        { _id: otherParticipantId },
        { projection: { displayName: 1, username: 1, photoUrl: 1, isOnline: 1 } }
      );
      
      return {
        conversationId: conv._id,
        otherUser: otherUser ? {
          _id: otherUser._id,
          displayName: otherUser.displayName,
          username: otherUser.username,
          photoUrl: otherUser.photoUrl,
          isOnline: otherUser.isOnline
        } : null,
        lastMessage: {
          text: conv.lastMessage.text,
          isAnonymous: conv.lastMessage.isAnonymous,
          anonymousName: conv.lastMessage.anonymousName,
          createdAt: conv.lastMessage.createdAt,
          isRead: conv.lastMessage.isRead
        },
        unreadCount: conv.unreadCount
      };
    }));
    
    res.json({ success: true, conversations: enrichedConversations });
    
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Konuşmalar yüklenemedi' });
  }
});

// Bir konuşmanın mesajlarını getir
app.get('/api/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const messages = await messagesCollection.find({ conversationId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();
    
    // Mesajları ters çevir (eskiden yeniye)
    messages.reverse();
    
    // Gönderen bilgilerini ekle (anonim olmayanlar için)
    const enrichedMessages = await Promise.all(messages.map(async (msg) => {
      let fromUser = null;
      if (msg.fromUserId && !msg.isAnonymous) {
        fromUser = await usersCollection.findOne(
          { _id: msg.fromUserId },
          { projection: { displayName: 1, username: 1, photoUrl: 1 } }
        );
      }
      
      return {
        ...msg,
        fromUser: fromUser ? {
          displayName: fromUser.displayName,
          username: fromUser.username,
          photoUrl: fromUser.photoUrl
        } : null
      };
    }));
    
    res.json({ success: true, messages: enrichedMessages });
    
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Mesajlar yüklenemedi' });
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
    
    // Bildirimleri zenginleştir
    const enrichedNotifications = await Promise.all(notifications.map(async (notif) => {
      let fromUser = null;
      if (notif.fromUserId) {
        fromUser = await usersCollection.findOne(
          { _id: notif.fromUserId },
          { projection: { displayName: 1, username: 1, photoUrl: 1 } }
        );
      }
      
      return {
        ...notif,
        fromUser: fromUser ? {
          displayName: fromUser.displayName,
          username: fromUser.username,
          photoUrl: fromUser.photoUrl
        } : null
      };
    }));
    
    res.json({ success: true, notifications: enrichedNotifications });
    
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Bildirimler yüklenemedi' });
  }
});

// Bildirimi okundu olarak işaretle
app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const notificationId = req.params.id;
    
    await notificationsCollection.updateOne(
      { _id: new ObjectId(notificationId) },
      { $set: { isRead: true } }
    );
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Bildirim güncellenemedi' });
  }
});

// Ana sayfa
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Socket.io bağlantıları
io.on('connection', (socket) => {
  console.log('Yeni socket bağlantısı:', socket.id);
  
  // Kullanıcı giriş yaptığında
  socket.on('user_online', async (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      
      // Online durumunu güncelle
      await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { isOnline: true, lastSeen: new Date() } }
      );
      
      // Diğer kullanıcılara bildir
      socket.broadcast.emit('user_status_changed', {
        userId,
        isOnline: true
      });
    }
  });
  
  // Mesaj okundu işaretleme
  socket.on('mark_message_read', async (data) => {
    const { messageId, userId } = data;
    
    await messagesCollection.updateOne(
      { _id: new ObjectId(messageId), toUserId: new ObjectId(userId) },
      { $set: { isRead: true } }
    );
    
    // Karşı tarafa bildir
    socket.broadcast.emit('message_read', { messageId });
  });
  
  // Canlı mesajlaşma
  socket.on('send_private_message', async (data) => {
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
    
    // Gönderene onay gönder
    socket.emit('message_sent', { success: true, messageId: result.insertedId });
  });
  
  // Bağlantı kesildiğinde
  socket.on('disconnect', async () => {
    console.log('Socket bağlantısı kesildi:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
  console.log(`🌐 Telegram WebApp hazır`);
});
