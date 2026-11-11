"""Loopback-only Mac recognition. PCM and transcripts never written to disk."""
import hmac
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
import mlx_whisper
import numpy as np

config = json.load(open(sys.argv[1]))
model = sys.argv[2]  # A downloaded local MLX model directory, never a request value.
expected = 'Bearer ' + config['token']

def transcribe(pcm):
    audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
    try:
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=model, language='en',
            initial_prompt='Luna.', condition_on_previous_text=False, temperature=0,
            verbose=None, no_speech_threshold=0.6)
        return ' '.join(result['text'].split())[:1000]
    finally:
        audio.fill(0)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), expected):
            self.send_error(401); return
        if self.path != '/recognize' or self.headers.get('Content-Type') != 'application/octet-stream':
            self.send_error(400); return
        try: length = int(self.headers.get('Content-Length', '0'))
        except ValueError: length = 0
        if length < 3200 or length > 800000 or length % 2:
            self.send_error(400); return
        pcm = bytearray(length)
        self.connection.settimeout(10)
        try:
            view = memoryview(pcm); offset = 0
            while offset < length:
                count = self.rfile.readinto(view[offset:])
                if not count: raise ValueError()
                offset += count
            body = json.dumps({'text': transcribe(pcm)}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
        except Exception:
            self.send_error(503)
        finally:
            pcm[:] = b'\0' * length

# Load and warm the model before accepting microphone requests.
transcribe(bytearray(32000))
print('Mac speech recognition ready on loopback.', flush=True)
HTTPServer(('127.0.0.1', 18744), Handler).serve_forever()
