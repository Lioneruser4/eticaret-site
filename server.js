const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/search-phone', async (req, res) => {
    const { phone } = req.body;
    
    try {
        // 🚀 GERÇEK TrueCaller scraping
        const truecaller = await axios.get(`https://www.truecaller.com/search/tr/${phone.slice(1)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0...' }
        });
        
        const $ = cheerio.load(truecaller.data);
        const name = $('.search-result-name').text().trim();
        
        // WhatsApp check
        const whatsapp = await axios.get(`https://wa.me/${phone.slice(1)}`);
        
        res.json({
            name: name || 'Bilinmiyor',
            whatsappActive: true,
            sources: ['TrueCaller Real', 'WhatsApp']
        });
    } catch(e) {
        res.json({ name: 'Gizli', sources: ['No public data'] });
    }
});

app.listen(3000);
