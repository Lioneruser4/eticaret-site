import os
import yt_dlp
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

# --- BOT START KOMUTU ---
@bot.message_handler(commands=['start'])
def send_welcome(message):
    bot.reply_to(message, f"Selam {message.from_user.first_name}! Bot aktif. Siteden müzik aratabilirsin.")

def download_audio(query):
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
def indir(chat_id: str, music: str):
    try:
        # Test mesajı
        bot.send_message(chat_id, f"📥 '{music}' aranıyor ve indiriliyor...")
        
        file_path, title = download_audio(music)
        
        with open(file_path, 'rb') as f:
            bot.send_audio(chat_id, f, caption=f"✅ {title}\n@Gemini_Partner")
        
        os.remove(file_path)
        return {"status": "ok"}
    except Exception as e:
        error_msg = str(e)
        bot.send_message(chat_id, f"❌ Hata: {error_msg[:100]}")
        return {"status": "error", "message": error_msg}

# Botu arka planda sürekli dinlemede tutmak için (Webhook yerine basit çözüm)
import threading
def run_bot():
    bot.infinity_polling()

threading.Thread(target=run_bot, daemon=True).start()
