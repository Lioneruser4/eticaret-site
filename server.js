// server.js (Render.com üzərində deploy ediləcək)

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Bot Tokeni Çevre Değişkeninden çekilir
const BOT_TOKEN = process.env.BOT_TOKEN; 
const CHANNEL_ID = '@hidepmed'; // Depolama kanalınız

if (!BOT_TOKEN) {
    console.error("HATA: BOT_TOKEN çevre değişkeni tanımlanmadı!");
    process.exit(1);
}

// Güvenli CORS ayarı (Frontend'iniz için izinler)
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


// [GET] /api/posts: Telegramdan Elanları Çekme Uç Noktası
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
