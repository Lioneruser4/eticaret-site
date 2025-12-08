const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const UserAgent = require('fake-useragent');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const getHeaders = () => ({
    'User-Agent': new UserAgent().random,
    'Accept': 'text/html,application/json,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9'
});

// 1. VIN Kodu üçün Xüsusi Scraper (Məlumatı birbaşa çıxarır)
async function fetchVinDetails(vin) {
    try {
        // Rəsmi qlobal bazadan məlumatı çəkirik (Stabil işləyir)
        const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`;
        const { data } = await axios.get(url);
        
        const results = data.Results;
        const info = {};

        // Lazımsız məlumatları təmizləyib vacibləri seçirik
        results.forEach(item => {
            if (item.Value && item.Value !== "null") {
                if (item.Variable === "Make") info.Marka = item.Value;
                if (item.Variable === "Model") info.Model = item.Value;
                if (item.Variable === "Model Year") info.BuraxilisIli = item.Value;
                if (item.Variable === "Body Class") info.Kuzov = item.Value;
                if (item.Variable === "Engine Cylinders") info.Silindr = item.Value;
                if (item.Variable === "Fuel Type - Primary") info.Yanacaq = item.Value;
                if (item.Variable === "Plant Country") info.Olke = item.Value;
            }
        });

        if (Object.keys(info).length > 0) {
            return {
                type: 'vin_data',
                title: `${info.Marka} ${info.Model} (${info.BuraxilisIli})`,
                details: info,
                image: `https://www.google.com/search?tbm=isch&q=${info.Marka}+${info.Model}+${info.BuraxilisIli}` // Şəkil üçün link (Front-end bunu həll edəcək)
            };
        }
        return null;
    } catch (error) {
        console.error("VIN Error:", error);
        return null;
    }
}

// 2. Ümumi Məhsul/Barkod Axtarışı (Google & eBay Scraper)
async function scrapeGeneral(query) {
    try {
        // eBay-dan real qiymət və şəkil çəkirik
        const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=0`;
        const { data } = await axios.get(ebayUrl, { headers: getHeaders() });
        const $ = cheerio.load(data);
        
        const item = $('.s-item').eq(1); // İlk nəticəni götürürük
        const title = item.find('.s-item__title').text();
        const price = item.find('.s-item__price').text();
        const image = item.find('.s-item__image-img').attr('src');
        const link = item.find('.s-item__link').attr('href');

        if (title) {
            return {
                type: 'product_data',
                title: title,
                price: price,
                image: image,
                source: 'eBay Global',
                link: link
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Kod yoxdur' });

    console.log(`Sorğu gəldi: ${q}`);

    let responseData = null;

    // Əgər 17 simvoldursa, VIN kimi yoxla
    if (q.length === 17) {
        responseData = await fetchVinDetails(q);
    }

    // Əgər VIN deyilsə və ya VIN-dən nəticə çıxmadısa, Barkod kimi axtar
    if (!responseData) {
        responseData = await scrapeGeneral(q);
    }

    if (responseData) {
        res.json({
            success: true,
            data: responseData
        });
    } else {
        res.json({
            success: false,
            message: "Məlumat tapılmadı, amma kod düzgündür."
        });
    }
});

app.listen(PORT, () => console.log(`Server ${PORT}-da işləyir`));
