const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(cors());
app.use(express.json());

// TrueCaller, WhatsApp, Sync.ME için proxy
app.use('/truecaller', createProxyMiddleware({
    target: 'https://www.truecaller.com',
    changeOrigin: true,
    pathRewrite: {'^/truecaller': ''}
}));

app.use('/wa', createProxyMiddleware({
    target: 'https://wa.me',
    changeOrigin: true
}));

app.use('/sync', createProxyMiddleware({
    target: 'https://sync.me',
    changeOrigin: true
}));

// 🚀 GERÇEK NUMARA ARAMA
app.post('/api/search', async (req, res) => {
    const { phone } = req.body;
    console.log(`🔍 ${phone} aranıyor...`);

    try {
        const results = {
            names: [],
            whatsapp: false,
            sources: []
        };

        // 1. TrueCaller GERÇEK scraping
        try {
            const tcResponse = await axios.get(`https://www.truecaller.com/search/tr/${phone.slice(1)}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                timeout: 10000
            });

            const $ = cheerio.load(tcResponse.data);
            
            // TrueCaller isim extraction
            $('.search-result-name, .person-name, h1, .name').each((i, el) => {
                const name = $(el).text().trim();
                if (name && name.length > 2 && !results.names.includes(name)) {
                    results.names.push(name);
                    results.sources.push('TrueCaller');
                }
            });
        } catch(e) {
            console.log('TrueCaller hatası:', e.message);
        }

        // 2. WhatsApp check (wa.me)
        try {
            const waResponse = await axios.get(`https://wa.me/${phone.slice(1)}`, {
                headers: { 'User-Agent': 'Mozilla/5.0...' },
                timeout: 5000
            });
            results.whatsapp = true;
            results.sources.push('WhatsApp');
        } catch(e) {
            // WhatsApp offline
        }

        // 3. Sync.ME check
        try {
            const syncResponse = await axios.get(`https://sync.me/search?q=${phone.slice(1)}`, {
                headers: { 'User-Agent': 'Mozilla/5.0...' },
                timeout: 8000
            });
            const $ = cheerio.load(syncResponse.data);
            $('.contact-name, .result-name').each((i, el) => {
                const name = $(el).text().trim();
                if (name && !results.names.includes(name)) {
                    results.names.push(name);
                    results.sources.push('Sync.ME');
                }
            });
        } catch(e) {
            console.log('Sync.ME hatası');
        }

        // 4. Google dork (hızlı)
        try {
            const googleResponse = await axios.get(
                `https://www.google.com/search?q=%22${phone.slice(3)}%22+site:*.tr`, 
                { headers: { 'User-Agent': 'Mozilla/5.0...' }, timeout: 5000 }
            );
            // Google sonuçlarından isim çıkar
        } catch(e) {}

        console.log(`✅ ${phone}:`, results.names);
        res.json(results);

    } catch(error) {
        console.error('Hata:', error.message);
        res.json({ names: [], sources: ['No public data'], whatsapp: false });
    }
});

app.listen(3000, () => {
    console.log('🚀 HackerAI OSINT Backend: http://localhost:3000');
    console.log('📱 Test: +905551234567, +905321234567');
});
