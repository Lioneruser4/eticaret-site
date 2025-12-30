const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

app.post('/osint', async (req, res) => {
    const { phone } = req.body;
    if (!phone || !phone.startsWith('+')) {
        return res.json({ error: 'Invalid phone' });
    }

    try {
        const results = await scrapeAll(phone);
        res.json(results);
    } catch(e) {
        res.json({ names: [], whatsapp: false, carrier: 'Error', error: e.message });
    }
});

async function scrapeAll(phone) {
    const results = { names: [], sources: [], whatsapp: false, carrier: '' };

    // 1. TRUECALLER
    try {
        const tc = await scrape('https://www.truecaller.com/search/tr/' + phone.slice(1), 
            ['.person-name', 'h1', '.name', '[data-testid="person-name"]']);
        results.names.push(...tc);
        results.sources.push(...tc.map(() => 'TrueCaller'));
    } catch(e) {}

    // 2. GETCONTACT
    try {
        const gc = await scrape('https://getcontact.com/search/' + phone.slice(1), 
            ['.contact-name', '.tag-name', 'h3']);
        results.names.push(...gc);
        results.sources.push(...gc.map(() => 'GetContact'));
    } catch(e) {}

    // 3. SYNCME
    try {
        const sm = await scrape('https://sync.me/search?q=' + phone.slice(1), 
            ['.contact-name', '.result-name']);
        results.names.push(...sm);
        results.sources.push(...sm.map(() => 'Sync.ME'));
    } catch(e) {}

    // 4. WHATSAPP
    try {
        await axios.get('https://wa.me/' + phone.slice(1), { timeout: 5000 });
        results.whatsapp = true;
        results.sources.push('WhatsApp');
    } catch(e) {}

    // Unique names
    results.names = [...new Set(results.names.filter(n => n && n.length > 2))];
    results.sources = results.sources.slice(0, results.names.length);

    return results;
}

async function scrape(url, selectors) {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 10000
        });

        const $ = cheerio.load(data);
        const names = [];
        
        selectors.forEach(sel => {
            $(sel).each((i, el) => {
                const name = $(el).text().trim();
                if (name && name.length > 2 && !names.includes(name)) {
                    names.push(name);
                }
            });
        });

        return names.slice(0, 5);
    } catch(e) {
        return [];
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server on port ${port}`));
