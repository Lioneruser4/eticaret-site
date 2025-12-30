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

# Bilgilerin
TOKEN = "2138035413:AAGYaGtgvQ4thyJKW2TXLS5n3wyZ6vVx3I8"
bot = TeleBot(TOKEN)

def download_audio(query):
    # Eğer link değilse arama yapmak için 'ytsearch1:' ekliyoruz
    if not query.startswith(('http://', 'https://')):
        search_query = f"ytsearch1:{query}"
    else:
        search_query = query

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
        if 'entries' in info:
            video_data = info['entries'][0]
        else:
            video_data = info
            
        video_id = video_data['id']
        filename = f"{video_id}.mp3"
        return filename, video_data.get('title', 'Bilinmeyen Şarkı')

@app.get("/indir")
def indir(chat_id: str, music: str):
    try:
        # Önce bota bilgi ver
        bot.send_message(chat_id, f"🔍 Aranan: {music}\nLütfen bekleyin, indiriliyor...")
        
        file_path, title = download_audio(music)
        
        with open(file_path, 'rb') as f:
            bot.send_audio(chat_id, f, caption=f"✅ {title}\n@Gemini_Partner")
        
        os.remove(file_path)
        return {"status": "success"}
    except Exception as e:
        # Hata olursa bota mesaj at ki nedenini görelim
        bot.send_message(chat_id, f"❌ Hata oluştu: {str(e)}")
        return {"status": "error", "message": str(e)}
