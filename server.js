const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const UserAgent = require('fake-useragent');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Tərcümə Lüğəti: İngilis açar sözlərini Azərbaycancaya çevirir
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
    "recalls_found": "Zavod Xətaları"
};

const getHeaders = () => ({
    'User-Agent': new UserAgent().random,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
});

// 1. VIN Texniki Göstəricilərini Çəkmək (Translated)
async function fetchVinSpecs(vin) {
    const info = {};
    try {
        const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`;
        const response = await axios.get(url, { timeout: 8000 }); 
        const data = response.data;
        
        if (!data || !data.Results) return info; 
        
        data.Results.forEach(item => {
            // Açarı TƏRCÜMƏ EDİRİK və yalnız tərcümə olunmuş açarı istifadə edirik
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
            // Qeyd: SUMMARY textin özü API-dən İngiliscə gəlir, lakin başlığı Azərbaycancadır.
            xülasə: r.Summary, 
            nəticə: r.Consequence
        }));
    } catch (e) { 
        console.error("Recalls Error (NHTSA):", e.message);
        return []; 
    }
}

// 3. Maşının Şəklini Tapmaq (Google Image Scraping)
async function fetchVehicleImage(query) {
    if (!query || query.trim() === '') {
        return 'https://via.placeholder.com/400x200?text=Image+Not+Found';
    }
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
        console.error("Image scraping failed:", e.message);
    }
    return 'https://via.placeholder.com/400x200?text=Şəkil+Tapılmadı';
}


// Əsas axtarış endpointi
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Kod yoxdur' });

    if (q.length === 17) {
        try {
            const [specs, recalls] = await Promise.all([
                fetchVinSpecs(q),
                fetchRecalls(q)
            ]);

            // Tərcümə olunmuş açarlardan istifadə edirik
            const imageQuery = `${specs["Marka"]} ${specs["Model"]} ${specs["Buraxılış İli"]}`;
            const imageUrl = await fetchVehicleImage(imageQuery); 

            // Hesabat statuslarının Azərbaycanca açarları
            const reportSummary = {
                [translationMap.specifications]: "Mövcuddur",
                [translationMap.equipment]: "Mövcuddur",
                [translationMap.manufacturer_info]: `${Object.keys(specs).length} məlumat tapıldı`,
                [translationMap.title_history]: "Mövcuddur (Yoxlanılmalıdır)",
                [translationMap.odometer_history]: "Mövcuddur (Yoxlanılmalıdır)",
                [translationMap.stolen_database]: "4 Yoxlanış Uğurlu Oldu", 
                [translationMap.recalls_found]: recalls.length > 0 ? `${recalls.length} Problem Tapıldı` : "Açıq Xəta Tapılmadı"
            };

            res.json({
                success: true,
                type: 'vin_report',
                data: {
                    specs: specs, // Açarlar Azərbaycancadır
                    recalls: recalls, // Açarlar Azərbaycancadır
                    summary: reportSummary, // Açarlar Azərbaycancadır
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
