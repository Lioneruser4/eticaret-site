const express = require('express');
const ytdl = require('ytdl-core');
const cors = require('cors');
const { HttpsProxyAgent } = require('https-proxy-agent'); 
const axios = require('axios'); // Telegram API çağırışı üçün
const yts = require('youtube-search-without-api-key'); // Axtarış üçün

const app = express();
const PORT = process.env.PORT || 3000; 

// --- DƏYİŞƏNLƏRİNİZ VƏ KONFİQURASİYALAR ---
const BOT_TOKEN = "2138035413:AAGYaGtgvQ4thyJKW2TXLS5n3wyZ6vVx3I8";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const PROXY_URL = process.env.PROXY_URL; // Render Environment Variables-dan oxunur

let proxyAgent = null;

if (PROXY_URL) {
    try {
        proxyAgent = new HttpsProxyAgent(PROXY_URL);
        console.log("[PROXY] Proxy aktivdir. Yeni IP-lər istifadə olunacaq.");
    } catch (e) {
        console.error("[PROXY ERROR] Proxy URL səhvdir:", e.message);
    }
}
// ----------------------------------------------------

app.use(cors());
app.use(express.json()); // POST sorğularından JSON oxumaq üçün

// Yükləməni birbaşa Telegram-a göndərən funksiya
async function sendAudioToTelegram(chatId, title, audioBuffer) {
    const url = `${TELEGRAM_API_URL}/sendAudio`;
    console.log(`[TELEGRAM] ${chatId}-ə səs göndərilir.`);

    try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('audio', new Blob([audioBuffer], { type: 'audio/mpeg' }), `${title}.mp3`);
        formData.append('caption', `✅ Uğurla yükləndi: ${title}`);

        await axios.post(url, formData, {
            headers: {
                'Content-Type': `multipart/form-data; boundary=${formData._boundary}`
            },
            timeout: 720000 // 12 dəqiqə
        });
        console.log(`[TELEGRAM] Audio ${chatId}-ə uğurla çatdırıldı.`);
        return true;
    } catch (error) {
        console.error("[TELEGRAM ERROR] Audio göndərilmədi:", error.response?.data || error.message);
        return false;
    }
}

// --- Veb Saytdan Gələn Sorğuları İdarə Edən Yeni Endpoint ---
app.post('/process-request', async (req, res) => {
    const { chat_id, query } = req.body;
    let videoUrl = query;
    let videoTitle = query;

    if (!chat_id || !query) {
        return res.status(400).json({ status: 'error', message: 'Chat ID və ya sorğu çatışmır.' });
    }

    try {
        // 1. Axtarış (Əgər link deyilsə)
        if (!ytdl.validateURL(query)) {
            const results = await yts.search(query);
            if (results && results.length > 0) {
                videoUrl = results[0].url;
                videoTitle = results[0].title;
                console.log(`[SEARCH] Tapıldı: ${videoTitle}`);
            } else {
                return res.status(404).json({ status: 'error', message: 'Mahnı tapılmadı.' });
            }
        }
        
        // 2. Yükləməni başlatmaq
        console.log(`[YTDL] Yüklənmə başladı: ${videoUrl}`);
        
        const audioStream = ytdl(videoUrl, {
            filter: 'audioonly',
            quality: 'highestaudio',
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.youtube.com/'
                },
                agent: proxyAgent // Proxy istifadə etmək üçün
            }
        });

        const chunks = [];
        audioStream.on('data', chunk => chunks.push(chunk));
        
        audioStream.on('error', (err) => {
            console.error('[YTDL ERROR]', err.message);
            res.status(500).json({ status: 'error', message: 'Yükləmə zamanı xəta: IP bloklanması.' });
        });

        // 3. Yükləmə tamamlandıqdan sonra Telegram-a göndərmək
        audioStream.on('end', async () => {
            const audioBuffer = Buffer.concat(chunks);
            console.log(`[YTDL] Yükləmə tamamlandı. Fayl ölçüsü: ${audioBuffer.length} bytes`);
            
            const success = await sendAudioToTelegram(chat_id, videoTitle, audioBuffer);
            
            if (success) {
                res.json({ status: 'success', message: 'Musiqi uğurla bota göndərildi.' });
            } else {
                res.status(500).json({ status: 'error', message: 'Telegram-a göndərilmədi.' });
            }
        });

    } catch (error) {
        console.error("[GLOBAL ERROR]", error.message);
        res.status(500).json({ status: 'error', message: `Server xətası: ${error.message}` });
    }
});
// ----------------------------------------------------

// Köhnə API endpoint-i ləğv edilir, bütün iş /process-request-də görülür.
/*
app.get('/download', async (req, res) => { ... }); 
*/

app.listen(PORT, () => {
    console.log(`Node.js API Server ${PORT}-də aktivdir.`);
});
