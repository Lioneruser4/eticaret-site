FROM python:3.10-slim

# FFmpeg kur (Müzik indirmek için şart)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Kütüphaneleri kur
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Uygulamayı başlat (Port 10000 Render için standarttır)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10000"]
