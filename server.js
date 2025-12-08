const express = require('express');
const ytdl = require('ytdl-core');
const cors = require('cors');
const { HttpsProxyAgent } = require('https-proxy-agent'); 
const axios = require('axios');
const yts = require('youtube-search-without-api-key');
const FormData = require('form-data'); // Yükləmə üçün

const app = express();
const PORT = process.env.PORT || 3000; 

// --- DƏYİŞƏNLƏRİNİZ ---
const BOT_TOKEN = "2138035413:AAGYaGtgvQ4thyJKW2TXLS5n3wyZ6vVx3I8"; 
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
// Render Environment Variables-dan oxunur. Əgər boşdursa, proxy istifadə edilməyəcək.
const PROXY_URL = process.env.PROXY_URL; 

let proxyAgent = null;

if (PROXY_URL) {
    try {
        proxyAgent = new HttpsProxyAgent(PROXY_URL);
        console.log(`[PROXY] Proxy aktivdir: ${PROXY_URL.substring(0, 15)}...`);
    } catch (e) {
        console.error("[PROXY ERROR] Proxy URL formatı səhvdir:", e.message);
    }
}
// ----------------------------------------------------

app.use(cors());
app.use(express.json());

// Serverin aktiv olduğunu yoxlamaq üçün sadə bir endpoint
app.get('/', (req, res) => {
    res.status(200).send('FullSong API aktivdir. Yükləmə endpoint-i: /process-request');
});

// Yükləməni birbaşa Telegram-a göndərən funksiya
async function sendAudioToTelegram(chatId, title, audioBuffer) {
    const url = `${TELEGRAM_API_URL}/sendAudio`;
    console.log(`[TELEGRAM] ${chatId}-ə səs göndərilir...`);

    try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        // Buffer-i birbaşa Node.js mühitində göndəririk
        formData.append('audio', audioBuffer, { filename: `${title}.mp3`, contentType: 'audio/mpeg' }); 
        formData.append('caption', `✅ Uğurla yükləndi: ${title}`);

        await axios.post(url, formData, {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 720000 
        });
        console.log(`[TELEGRAM] Audio ${chatId}-ə uğurla çatdırıldı.`);
        return true;
    } catch (error) {
        console.error("[TELEGRAM ERROR] Audio göndərilmədi:", error.response?.data?.description || error.message);
        // İstifadəçiyə xəta göndərmək üçün xətanı yuxarıya atırıq
        throw new Error("Telegram-a göndərilmə uğursuz oldu.");
    }
}

// --- Veb Saytdan Gələn Sorğuları İdarə Edən Endpoint ---
app.post('/process-request', async (req, res) => {
    const { chat_id, query } = req.body;
    let videoUrl = query;
    let videoTitle = query;

    if (!chat_id || !query) {
        return res.status(400).json({ status: 'error', message: 'Chat ID və ya sorğu çatışmır.' });
    }

    try {
        // 1. Axtarış və ya URL yoxlanılması
        if (!ytdl.validateURL(query)) {
            console.log(`[SEARCH] Mahnı axtarılır: ${query}`);
            const results = await yts.search(query);
            if (results && results.length > 0) {
                videoUrl = results[0].url;
                videoTitle = results[0].title;
                console.log(`[SEARCH] Tapıldı: ${videoTitle}`);
            } else {
                return res.status(404).json({ status: 'error', message: 'Mahnı tapılmadı.' });
            }
        } else {
             const info = await ytdl.getInfo(videoUrl);
             videoTitle = info.videoDetails.title;
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
                agent: proxyAgent // Proxy istifadə etmək
            }
        });

        const chunks = [];
        audioStream.on('data', chunk => chunks.push(chunk));
        
        // Yükləmə zamanı YouTube bağlantısı kəsilsə (IP bloklanması)
        audioStream.on('error', (err) => {
            console.error('[YTDL CRITICAL ERROR] IP Bloklanması ehtimalı:', err.message);
            if (!res.headersSent) {
                res.status(503).json({ status: 'error', message: 'Yükləmə zamanı YouTube əlaqəni kəsdi (IP xətası). Proxy-i yoxlayın.' });
            }
        });

        // 3. Yükləmə tamamlandıqdan sonra Telegram-a göndərmək
        audioStream.on('end', async () => {
            const audioBuffer = Buffer.concat(chunks);
            console.log(`[YTDL] Yükləmə tamamlandı. Fayl ölçüsü: ${audioBuffer.length} bytes`);
            
            await sendAudioToTelegram(chat_id, videoTitle, audioBuffer);
            
            if (!res.headersSent) {
                res.json({ status: 'success', message: 'Musiqi uğurla bota göndərildi.' });
            }
        });

    } catch (error) {
        console.error("[GLOBAL CATCH ERROR]", error.message);
        if (!res.headersSent) {
             // İstifadəçiyə geri göndərilən xəta
            res.status(500).json({ status: 'error', message: error.message.includes('Telegram') ? error.message : `Daxili server xətası: ${error.message}` });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Node.js API Server ${PORT}-də aktivdir.`);
});
