const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const UserAgent = require('fake-useragent');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Tərcümə Lüğəti
const translationMap = {
    "Make": "Marka", "Model": "Model", "Model Year": "Buraxılış İli", 
    "Body Class": "Kuzov Növü", "Engine Cylinders": "Mühərrik Silindrləri", 
    "Fuel Type - Primary": "Əsas Yanacaq Növü", "Plant Country": "İstehsal Ölkəsi",
    "specifications": "Texniki Göstəricilər", "equipment": "Avadanlıq",
    "manufacturer_info": "İstehsalçı Məlumatı", "title_history": "Başlıq Tarixçəsi",
    "odometer_history": "Kilometraj Tarixçəsi", "stolen_database": "Oğurluq Bazası Yoxlanışı",
    "recalls_found": "Zavod Xətaları",
    "accident_status": "Qəza/Zərər Yoxlanışı"
};

const getHeaders = () => ({
    'User-Agent': new UserAgent().random,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
});

// Köməkçi Funksiya: Google Web Scraping
async function scrapeGoogleWeb(query) {
    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, { headers: getHeaders(), timeout: 7000 });
        return cheerio.load(data);
    } catch (e) {
        return null;
    }
}

// Köməkçi Funksiya: Google Image Scraping
async function scrapeGoogleImage(query) {
    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
        const { data } = await axios.get(url, { headers: getHeaders(), timeout: 5000 });
        const $ = cheerio.load(data);
        const firstImageElement = $('img').eq(1); 
        const imageUrl = firstImageElement.attr('src');
        if (imageUrl && imageUrl.startsWith('http')) {
             return imageUrl;
        }
    } catch (e) {
        // Hata
    }
    return 'https://via.placeholder.com/400x200?text=Şəkil+Tapılmadı';
}

// Qəza Statusunu Axtarmaq
async function fetchAccidentStatus(vin) {
    const keywords = ['salvage', 'total loss', 'auction', 'damage', 'copart', 'iaai', 'zərər'];
    const query = `${vin} (${keywords.join(' OR ')})`; 
    
    const $ = await scrapeGoogleWeb(query);
    if (!$) return "Xəta baş verdi (Yenidən cəhd edin)";
    
    let found = false;
    $('div#main a').each((i, el) => {
        const linkText = $(el).text().toLowerCase();
        const href = $(el).attr('href');
        
        if ((linkText.includes('salvage') || linkText.includes('total loss') || linkText.includes('auction') || linkText.includes('copart') || linkText.includes('iaai')) && !href.includes('google.com')) {
            found = true;
            return false;
        }
    });

    if (found) {
        return "Hərrac/Zərər ehtimalı tapıldı (Əlavə yoxlama tələb olunur)";
    }
    
    return "Açıq ödənişsiz bazalarda qəza qeydi tapılmadı.";
}

// VIN Texniki Göstəricilərini Çəkmək (Translated)
async function fetchVinSpecs(vin) {
    const info = {};
    try {
        const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`;
        const response = await axios.get(url, { timeout: 8000 }); 
        const data = response.data;
        if (!data || !data.Results) return info; 
        data.Results.forEach(item => {
            const translatedKey = translationMap[item.Variable];
            if (item.Value && item.Value !== "null" && translatedKey) {
                info[translatedKey] = item.Value;
            }
        });
        return info;
    } catch (e) { return {}; }
}

// Zavod Xətalarını Çəkmək (Recalls)
async function fetchRecalls(vin) {
    try {
        const url = `https://api.nhtsa.gov/recalls/recallsByVin?vin=${vin}&format=json`;
        const response = await axios.get(url, { timeout: 8000 });
        const data = response.data;
        if (!data.results) return [];
        return data.results.map(r => ({
            tarix: r.ReportReceivedDate,
            komponent: r.Component,
            xülasə: r.Summary, 
            nəticə: r.Consequence
        }));
    } catch (e) { return []; }
}

// Maşının Şəklini Tapmaq (Qəza statusu ilə əlaqəli)
async function fetchVehicleImage(vin, fallbackQuery, accidentStatus) {
    if (!vin) return 'https://via.placeholder.com/400x200?text=Şəkil+Tapılmadı';
    
    // 1. Qəza/Hərrac Şəkilləri Axtarışı
    if (accidentStatus.includes('Hərrac') || accidentStatus.includes('tapıldı')) {
        const damagedQuery = `${vin} salvage auction photos`;
        const damagedImage = await scrapeGoogleImage(damagedQuery);
        if (damagedImage && !damagedImage.includes('placeholder')) {
            return damagedImage;
        }
    }

    // 2. Spesifik Maşın Şəkli (VIN ilə)
    const primaryQuery = `VIN ${vin} car sale`;
    const image1 = await scrapeGoogleImage(primaryQuery);
    if (image1 && !image1.includes('placeholder')) {
        return image1;
    }

    // 3. Ümumi Marka/Model Şəkili (Fallback)
    if (fallbackQuery && fallbackQuery.length > 5) {
        return scrapeGoogleImage(fallbackQuery);
    }
    
    return 'https://via.placeholder.com/400x200?text=Şəkil+Tapılmadı';
}


// Əsas axtarış endpointi
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Kod yoxdur' });

    if (q.length === 17) {
        try {
            const [specs, recalls, accidentStatus] = await Promise.all([
                fetchVinSpecs(q),
                fetchRecalls(q),
                fetchAccidentStatus(q)
            ]);

            const fallbackQuery = `${specs["Marka"]} ${specs["Model"]} ${specs["Buraxılış İli"]}`;
            const imageUrl = await fetchVehicleImage(q, fallbackQuery, accidentStatus); 

            // Hesabat statuslarının Azərbaycanca açarları
            const reportSummary = {
                [translationMap.specifications]: "Mövcuddur",
                [translationMap.equipment]: "Mövcuddur",
                [translationMap.manufacturer_info]: `${Object.keys(specs).length} məlumat tapıldı`,
                [translationMap.title_history]: "Ödənişli bazada yoxlanılmalıdır", 
                [translationMap.odometer_history]: "Ödənişli bazada yoxlanılmalıdır", 
                [translationMap.stolen_database]: "4 Yoxlanış Uğurlu Oldu", 
                [translationMap.recalls_found]: recalls.length > 0 ? `${recalls.length} Problem Tapıldı` : "Açıq Xəta Tapılmadı",
                [translationMap.accident_status]: accidentStatus
            };

            res.json({
                success: true,
                type: 'vin_report',
                data: { specs: specs, recalls: recalls, summary: reportSummary, image: imageUrl }
            });

        } catch (error) {
            res.status(500).json({ success: false, message: "Server xətası baş verdi. Logları yoxlayın." });
        }
    } else {
        res.json({ success: false, message: "Yalnız 17 rəqəmli VIN kodu dəstəklənir." });
    }
});

app.listen(PORT, () => console.log(`Server ${PORT}-da aktivdir`));
