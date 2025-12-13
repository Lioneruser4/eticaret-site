// server.js (Render.com üzərində deploy ediləcək)

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto'); // Telegram doğrulama için

const app = express();
const port = process.env.PORT || 3000;

// Middleware'lar
app.use(express.json()); // JSON formatında gelen body'leri parse etmek için

// Bot Tokeni Çevre Değişkeninden çekilir (Render'da tanımlanmalıdır!)
const BOT_TOKEN = process.env.BOT_TOKEN; // 5731759386:AAEJVgFaBgXIAD6FynuiAVp5emtH_yU_R2s
const CHANNEL_ID = '@hidepmed'; 

if (!BOT_TOKEN) {
    console.error("HATA: BOT_TOKEN çevre değişkeni tanımlanmadı!");
    process.exit(1);
}

// Güvenli CORS ayarı 
const allowedOrigins = [
    'https://saskioyunu.onrender.com', // Kendini de ekleyelim
    'http://localhost:8080', 
    // BURAYA GITHUB PAGES ADRESİNİZİ EKLEYİN: 'https://YOUR_GITHUB_USERNAME.github.io'
]; 

app.use(cors({
    origin: (origin, callback) => {
        if (allowedOrigins.includes(origin) || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Bu domaine izin verilmedi.'));
        }
    }
}));


// ----------------------------------------------------
// TELEGRAM GİRİŞ DOĞRULAMA (HESAP AÇMA)
// ----------------------------------------------------
// Yardımcı Fonksiyon: Telegram InitData'yı Doğrular
function validateInitData(initData) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    params.sort();

    const dataCheckString = Array.from(params.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    // Bot Token (API Key) ile SHA256 HMAC oluştur
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    
    // Veri kontrol stringi ile HMAC-SHA256 oluştur ve karşılaştır
    const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    return hmac === hash;
}

app.post('/api/login', async (req, res) => {
    const { initData } = req.body;
    
    if (!initData) {
        return res.status(400).json({ success: false, message: 'InitData eksik.' });
    }

    if (!validateInitData(initData)) {
        console.warn("Doğrulama Hatası: Hash eşleşmedi.");
        return res.status(401).json({ success: false, message: 'Doğrulama uğursuz oldu.' });
    }

    // Doğrulama başarılı! Kullanıcının bilgilerini çıkar.
    const userParams = new URLSearchParams(initData).get('user');
    const user = JSON.parse(userParams);

    // Başarıyla giriş yapıldı (Hesap açma işlemi burada tamamlanmış olur)
    res.status(200).json({ 
        success: true, 
        message: 'Giriş uğurludur.', 
        userId: user.id,
        name: user.first_name 
    });
});

// ----------------------------------------------------
// [GET] /api/posts: ELANLARI ÇEKME UÇ NOKTASI (Önceki Cevaptan)
// ----------------------------------------------------
app.get('/api/posts', async (req, res) => {
    const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory?chat_id=${CHANNEL_ID}&limit=100`;

    try {
        const response = await axios.get(telegramApiUrl);
        const messages = response.data.result || [];

        const filteredPosts = messages
            .filter(msg => msg.text)
            .map(msg => {
                const date = msg.date * 1000; 
                const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
                const expirationTime = date + thirtyDaysInMs;
                const isExpired = Date.now() > expirationTime;
                
                const parsedData = parsePostData(msg.text, msg.date); 

                return {
                    ...parsedData,
                    message_id: msg.message_id,
                    is_expired: isExpired,
                };
            })
            .filter(post => !post.is_expired); 

        res.json(filteredPosts);

    } catch (error) {
        console.error("Telegram API hatası:", error.message);
        res.status(500).json({ error: 'Telegramdan veri çekilemedi. Kanal adını veya Bot Tokenini kontrol edin.' });
    }
});

// [YARDIMCI FONKSİYON] Mesaj Mətndən Veriləri Çıxarır
function parsePostData(text, date) {
    const lines = text.split('\n');
    const data = {
        title: lines[0].trim(),
        content: lines.slice(1).join(' ').trim().substring(0, 100) + '...',
        category: 'başqa',
        price: 0,
        subs: 0,
        days_remaining: Math.max(0, 30 - ((Date.now() / 1000 - date) / (60 * 60 * 24))).toFixed(0) 
    };
    
    lines.forEach(line => {
        if (line.includes('#Kateqoriya:')) data.category = line.split(':')[1].trim().toLowerCase();
        if (line.includes('#Qiymət:')) data.price = parseFloat(line.split(':')[1].replace('AZN', '').trim()) || 0;
        if (line.includes('#Abunəçi:')) data.subs = parseInt(line.split(':')[1].trim().replace(/\D/g, '')) || 0;
    });

    return data;
}

app.listen(port, () => {
    console.log(`Render Serveri ${port} portunda çalışır.`);
});
