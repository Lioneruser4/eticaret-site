import os
import yt_dlp
import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from telebot import TeleBot

app = FastAPI()

# GitHub Pages bağlantısı için
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TOKEN = "2138035413:AAGYaGtgvQ4thyJKW2TXLS5n3wyZ6vVx3I8"
bot = TeleBot(TOKEN)

# BOT TEST: Botun çalıştığını anlamak için bota /test yazın
@bot.message_handler(commands=['start', 'test'])
def send_welcome(message):
    bot.reply_to(message, f"✅ Selam {message.from_user.first_name}! Bot aktif ve Render üzerinde çalışıyor.")

def download_audio(query):
    # Eğer link değilse YouTube'da ara (ilk sonucu al)
    search_query = f"ytsearch1:{query}" if not query.startswith('http') else query
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'extractor_args': {
            'youtube': {
                'player_client': ['android', 'ios'],
                'skip': ['webpage']
            }
        },
        'outtmpl': '%(id)s.%(ext)s',
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(search_query, download=True)
        video_data = info['entries'][0] if 'entries' in info else info
        filename = f"{video_data['id']}.mp3"
        return filename, video_data.get('title', 'Müzik')

@app.get("/indir")
async def indir(chat_id: str, music: str):
    try:
        # Bota bilgi mesajı gönder
        bot.send_message(chat_id, f"🔍 '{music}' aranıyor... Lütfen bekleyin.")
        
        file_path, title = download_audio(music)
        
        # Dosyayı gönder
        with open(file_path, 'rb') as f:
            bot.send_audio(chat_id, f, caption=f"✅ {title}\nSistem: Render + Docker")
        
        os.remove(file_path) # Sunucuyu temizle
        return {"status": "success"}
    except Exception as e:
        bot.send_message(chat_id, f"❌ Hata: {str(e)[:100]}")
        return {"status": "error"}

# Botu arka planda başlatan fonksiyon
def run_bot():
    print("Bot dinlemeye basladi...")
    bot.infinity_polling()

threading.Thread(target=run_bot, daemon=True).start()
