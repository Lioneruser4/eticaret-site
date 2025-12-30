import os
import yt_dlp
import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from telebot import TeleBot

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TOKEN = "2138035413:AAGYaGtgvQ4thyJKW2TXLS5n3wyZ6vVx3I8"
bot = TeleBot(TOKEN)

# BOT TEST KOMUTLARI
@bot.message_handler(commands=['start', 'test'])
def handle_test(message):
    bot.reply_to(message, "✅ Bot şu an aktif ve emirlerini bekliyor!")

def download_audio(query):
    # Eğer isim yazıldıysa YouTube'da ara, linkse direkt al
    search_target = f"ytsearch1:{query}" if not query.startswith('http') else query
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': False, # Hataları görmek için True'dan False'a çektim
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        # YouTube engelini aşmak için en hafif istemci
        'extractor_args': {
            'youtube': {
                'player_client': ['ios'],
                'skip': ['webpage']
            }
        },
        'outtmpl': '%(id)s.%(ext)s',
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(search_target, download=True)
        video_data = info['entries'][0] if 'entries' in info else info
        filename = f"{video_data['id']}.mp3"
        return filename, video_data.get('title', 'Müzik')

@app.get("/indir")
async def indir(chat_id: str, music: str):
    try:
        # 1. Bota anlık bildirim at (Botun çalıştığını buradan anlarız)
        bot.send_message(chat_id, f"🎵 '{music}' aranıyor... Lütfen bekleyin.")
        
        # 2. İndirme işlemini başlat
        file_path, title = download_audio(music)
        
        # 3. Dosyayı gönder
        with open(file_path, 'rb') as f:
            bot.send_audio(chat_id, f, caption=f"✅ {title}\n@Gemini_Partner")
        
        # 4. Temizlik
        if os.path.exists(file_path):
            os.remove(file_path)
            
        return {"status": "ok"}
    except Exception as e:
        error_text = str(e)
        print(f"HATA OLUŞTU: {error_text}")
        bot.send_message(chat_id, f"❌ İndirme Hatası: YouTube bu isteği engelledi veya sunucu kapasitesi yetmedi.\n\nHata: {error_text[:100]}")
        return {"status": "error"}

# Botu arka planda çalıştıran fonksiyon
def start_polling():
    print("Bot dinlemeye başladı...")
    bot.infinity_polling()

# Render uygulaması başlarken botu da başlat
threading.Thread(target=start_polling, daemon=True).start()
