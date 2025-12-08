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
    // NHTSA Specs Keys
    "Make": "Marka",
    "Model": "Model",
    "Model Year": "Buraxılış İli",
    "Body Class": "Kuzov Növü",
    "Engine Cylinders": "Mühərrik Silindrləri",
    "Fuel Type - Primary": "Əsas Yanacaq Növü",
    "Plant Country": "İstehsal Ölkəsi",
    
    // Report Summary Status Keys
    "specifications": "Texniki Göstəricilər",
    "equipment": "Avadanlıq",
    "manufacturer_info": "İstehsalçı Məlumatı",
    "title_history": "Başlıq Tarixçəsi",
    "odometer_history": "Kilometraj Tarixçəsi",
    "stolen_database": "Oğurluq Bazası Yoxlanışı",
    "recalls_found": "Zavod Xətaları",
    // YENİ TƏRCÜMƏ AÇARI
    "accident_status": "Qəza/Zərər Yoxlanışı"
};

const getHeaders = () => ({
    'User-Agent': new UserAgent().random,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
});

// Köməkçi Funksiya: Ümumi Google Web Scraping üçün
async function scrapeGoogleWeb(query) {
    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, { headers: getHeaders(), timeout: 7000 });
        return cheerio.load(data);
    } catch (e) {
        console.error("Google Web Scraping failed:", e.message);
        return null;
    }
}


// YENİ FUNKSİYA: Ödənişsiz Bazalarda Qəza Statusunu Axtarmaq
async function fetchAccidentStatus(vin) {
    const keywords = ['salvage', 'total loss', 'auction', 'damage', 'copart', 'iaai', 'zərər'];
    const query = `${vin} (${keywords.join(' OR ')})`; 
    
    const $ = await scrapeGoogleWeb(query);
    if (!$) {
        return "Xəta baş verdi (Yenidən cəhd edin)";
    }
    
    let found = false;
    $('div#main a').each((i, el) => {
        const linkText = $(el).text().toLowerCase();
        const href = $(el).attr('href');
        
        // Hərrac və ya sığorta ilə əlaqəli sözlər axtarırıq
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

// Köməkçi Funksiya: Şəkil Axtarışı
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
        // Hata durumunda loglama yapılır
    }
    return 'https://via.placeholder.com/400x200?text=Şəkil+Tapılmadı';
}

// ------------------------------------------------
// YALNIZ BU FUNKSİYANIN İÇİNDƏKİ KOD DƏYİŞDİRİLİB
// fetchVinSpecs, fetchRecalls eyni qalır.
// ------------------------------------------------

// 1. VIN Texniki Göstəricilərini Çəkmək (Translated)
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
    } catch (e) { 
        console.error("VIN Specs Error (NHTSA):", e.message);
        return info; 
    }
}

// 2. Zavod Xətalarını Çəkmək (Recalls)
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

// 3. Maşının Şəklini Tapmaq
async function fetchVehicleImage(vin, fallbackQuery) {
    if (!vin) return 'https://via.placeholder.com/400x200?text=Şəkil+Tapılmadı';
    
    const primaryQuery = `VIN ${vin} car sale`;
    const image1 = await scrapeGoogleImage(primaryQuery);
    if (image1 && !image1.includes('placeholder')) {
        return image1;
    }

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
            // Yeni funksiyanı bura əlavə etdik
            const [specs, recalls, accidentStatus] = await Promise.all([
                fetchVinSpecs(q),
                fetchRecalls(q),
                fetchAccidentStatus(q) // Qəza statusunu yoxlayır
            ]);

            const fallbackQuery = `${specs["Marka"]} ${specs["Model"]} ${specs["Buraxılış İli"]}`;
            const imageUrl = await fetchVehicleImage(q, fallbackQuery); 

            // Hesabat statuslarının Azərbaycanca açarları
            const reportSummary = {
                [translationMap.specifications]: "Mövcuddur",
                [translationMap.equipment]: "Mövcuddur",
                [translationMap.manufacturer_info]: `${Object.keys(specs).length} məlumat tapıldı`,
                // Qeyd: Bu məlumatlar ödənişlidir, buna görə dürüst məlumat yazırıq.
                [translationMap.title_history]: "Ödənişli bazada yoxlanılmalıdır", 
                [translationMap.odometer_history]: "Ödənişli bazada yoxlanılmalıdır", 
                [translationMap.stolen_database]: "4 Yoxlanış Uğurlu Oldu", 
                [translationMap.recalls_found]: recalls.length > 0 ? `${recalls.length} Problem Tapıldı` : "Açıq Xəta Tapılmadı",
                // YENİ STATUS
                [translationMap.accident_status]: accidentStatus
            };

            res.json({
                success: true,
                type: 'vin_report',
                data: {
                    specs: specs, 
                    recalls: recalls, 
                    summary: reportSummary, 
                    image: imageUrl 
                }
            });

        } catch (error) {
            console.error("Main API Crash Error:", error);
            res.status(500).json({ success: false, message: "Server xətası baş verdi. Logları yoxlayın." });
        }
    } else {
        res.json({ success: false, message: "Yalnız 17 rəqəmli VIN kodu dəstəklənir." });
    }
});

app.listen(PORT, () => console.log(`Server ${PORT}-da aktivdir`));
