import os
import yt_dlp
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from telebot import TeleBot

app = FastAPI()

# GitHub Pages'den gelen istekleri kabul etmek için CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Senin Bilgilerin
TOKEN = "2138035413:AAGYaGtgvQ4thyJKW2TXLS5n3wyZ6vVx3I8"
bot = TeleBot(TOKEN)

def download_audio(query):
    ydl_opts = {
        'format': 'bestaudio/best',
        'default_search': 'ytsearch1',
        'noplaylist': True,
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
        info = ydl.extract_info(query, download=True)
        video_data = info['entries'][0] if 'entries' in info else info
        filename = f"{video_data['id']}.mp3"
        return filename, video_data.get('title', 'Müzik')

@app.get("/indir")
def indir(chat_id: str, music: str):
    try:
        file_path, title = download_audio(music)
        with open(file_path, 'rb') as f:
            bot.send_audio(chat_id, f, caption=f"🎵 {title} Hazır!\n\n@Gemini_Partner")
        os.remove(file_path) # İşlem bitince siler
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10000)
