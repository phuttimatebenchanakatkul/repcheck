FROM python:3.12-slim

# System packages the Python side alone can't provide:
# - ffmpeg: trim_video.py shells out to it to trim uploaded workout clips
# - libzbar0: pyzbar's barcode decoder needs the native zbar library
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libzbar0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets $PORT at runtime; default to 5000 for local `docker run`.
ENV PORT=5000
EXPOSE 5000

CMD gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120 app:app
