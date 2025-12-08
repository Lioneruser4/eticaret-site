const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const UserAgent = require('fake-useragent');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Yardımçı funksiya: Təsadüfi User-Agent
const getHeaders = () => ({
    'User-Agent': new UserAgent().random,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
});

// Axtarış Mühərrikləri
const sources = {
    google: async (query) => {
        try {
            const { data } = await axios.get(`https://www.google.com/search?q=${query}`, { headers: getHeaders() });
            const $ = cheerio.load(data);
            const results = [];
            $('.g').each((i, el) => {
                const title = $(el).find('h3').text();
                const link = $(el).find('a').attr('href');
                const snippet = $(el).find('.VwiC3b').text();
                if (title && link) {
                    results.push({ source: 'Google', title, link, description: snippet, image: null });
                }
            });
            return results.slice(0, 3);
        } catch (e) { return []; }
    },
    ebay: async (query) => {
        try {
            const { data } = await axios.get(`https://www.ebay.com/sch/i.html?_nkw=${query}`, { headers: getHeaders() });
            const $ = cheerio.load(data);
            const results = [];
            $('.s-item').each((i, el) => {
                const title = $(el).find('.s-item__title').text();
                const link = $(el).find('.s-item__link').attr('href');
                const price = $(el).find('.s-item__price').text();
                const img = $(el).find('.s-item__image-img').attr('src');
                if (title && link && i > 0) { // i>0 çünki birincisi adətən reklam olur
                    results.push({ source: 'eBay', title, link, description: `Qiymət: ${price}`, image: img });
                }
            });
            return results.slice(0, 3);
        } catch (e) { return []; }
    },
    vinDb: async (query) => {
        // VIN nömrəsi formatına uyğundursa
        if (query.length === 17) {
            return [{
                source: 'VIN Decoder',
                title: `VIN: ${query} Məlumatları`,
                link: `https://www.faxvin.com/vin-decoder/check?vin=${query}`,
                description: 'Avtomobil tarixi və texniki göstəriciləri üçün detallı axtarış.',
                image: 'https://cdn-icons-png.flaticon.com/512/3202/3202926.png'
            }];
        }
        return [];
    }
};

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Kod daxil edilməyib' });

    console.log(`Axtarılır: ${q}`);

    try {
        // Paralel axtarış (Bütün mənbələri eyni anda yoxlayır)
        const promises = [
            sources.google(q),
            sources.ebay(q),
            sources.vinDb(q)
        ];

        const results = await Promise.allSettled(promises);
        
        // Nəticələri birləşdiririk
        let combined = [];
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                combined = [...combined, ...result.value];
            }
        });

        // Əgər heç nə tapılmasa (Scraping bloklansa), ehtiyat nəticələr göstər
        if (combined.length === 0) {
            combined.push({
                source: 'Sistem',
                title: `${q} - Google Axtarışı`,
                link: `https://www.google.com/search?q=${q}`,
                description: 'Birbaşa axtarış üçün klikləyin. Server cavabı bloklanmış ola bilər.',
                image: 'https://cdn-icons-png.flaticon.com/512/281/281764.png'
            });
        }

        res.json({
            query: q,
            count: combined.length,
            results: combined
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server xətası' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
