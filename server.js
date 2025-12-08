// server.js - Render backend
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
    // Google axtarış nümunəsi
    const url = `https://www.google.com/search?q=${encodeURIComponent(code)}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(data);
    const results = [];
    $('a').each((i, el)=>{
      const link = $(el).attr('href');
      if(link && link.startsWith('http')) results.push(link);
    });

    res.json({ results: results.slice(0, 15) }); // İlk 15 nəticə
  } catch(e){
    res.json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`XSCAN Backend running on port ${PORT}`);
});
