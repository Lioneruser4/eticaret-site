// server.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Test endpoint
app.get('/', (req, res) => {
  res.send('XSCAN Backend Ready');
});

// Search endpoint
app.get('/search', async (req, res) => {
  const { code } = req.query;
  if(!code) return res.json({ error: "Kod boş ola bilməz" });

  try {
    const results = [];

    // Google search
    const googleURL = `https://www.google.com/search?q=${encodeURIComponent(code)}`;
    const { data: googleData } = await axios.get(googleURL, { headers: { 'User-Agent':'Mozilla/5.0' } });
    const $ = cheerio.load(googleData);
    $('a').each((i, el) => {
      const link = $(el).attr('href');
      if(link && link.startsWith('http')) results.push({ source:'Google', link });
    });

    // Bing search
    const bingURL = `https://www.bing.com/search?q=${encodeURIComponent(code)}`;
    const { data: bingData } = await axios.get(bingURL, { headers: { 'User-Agent':'Mozilla/5.0' } });
    const $$ = cheerio.load(bingData);
    $$('a').each((i, el) => {
      const link = $$(el).attr('href');
      if(link && link.startsWith('http')) results.push({ source:'Bing', link });
    });

    // Yandex search
    const yandexURL = `https://yandex.com/search/?text=${encodeURIComponent(code)}`;
    const { data: yandexData } = await axios.get(yandexURL, { headers: { 'User-Agent':'Mozilla/5.0' } });
    const $$$ = cheerio.load(yandexData);
    $$$('a').each((i, el) => {
      const link = $$$(el).attr('href');
      if(link && link.startsWith('http')) results.push({ source:'Yandex', link });
    });

    res.json({ code, results: results.slice(0, 25) }); // İlk 25 nəticə
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.listen(PORT, ()=>console.log(`XSCAN Backend running on port ${PORT}`));
