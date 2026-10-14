from __future__ import annotations

import base64
import os
import threading
from urllib.parse import urlparse

import cv2
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

APP_NAME = "NEXUS Vision Camera Assistant"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
GROQ_VISION_MODEL = os.environ.get("GROQ_VISION_MODEL", "qwen/qwen3.6-27b").strip()

app = FastAPI(title=APP_NAME, version="0.2.0")
# Explicit frontend origins: comma-separated HTTPS website URLs in FRONTEND_ORIGINS, plus local Vite development.
FRONTEND_ORIGINS = [origin.strip().rstrip("/") for origin in os.environ.get("FRONTEND_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(["http://localhost:5173", "http://127.0.0.1:5173", *FRONTEND_ORIGINS])),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

_lock = threading.Lock()
_camera: dict = {"name": "CP Plus camera", "rtsp_url": "", "configured": False}


class CameraInput(BaseModel):
    name: str = Field(default="CP Plus camera", min_length=1, max_length=80)
    rtsp_url: str = Field(min_length=8, max_length=2048)


class AskInput(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


def _validate_rtsp(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"rtsp", "rtsps"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Enter a valid RTSP/RTSPS URL for a compatible camera or NVR.")
    if any(ch in url for ch in "\r\n"):
        raise HTTPException(status_code=400, detail="Invalid URL")


def _capture_snapshot(url: str) -> bytes:
    # Credentials remain in the local connector. OpenCV needs FFmpeg/RTSP support.
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            raise HTTPException(status_code=502, detail="Could not open camera stream. Check RTSP URL, credentials, network, and camera stream settings.")
        ok, frame = cap.read()
        if not ok or frame is None:
            raise HTTPException(status_code=502, detail="Stream opened but no frame was received. Check channel/path and camera availability.")
        height, width = frame.shape[:2]
        max_width = 1280
        if width > max_width:
            scale = max_width / width
            frame = cv2.resize(frame, (max_width, int(height * scale)))
        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ok:
            raise HTTPException(status_code=500, detail="Could not encode the camera snapshot.")
        return encoded.tobytes()
    finally:
        cap.release()


def _groq_headers() -> dict[str, str]:
    if not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="Groq API key is not configured. Add GROQ_API_KEY to connector/.env and restart the connector.")
    return {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}


@app.get("/api/health")
def health():
    with _lock:
        configured = bool(_camera.get("configured"))
        name = _camera.get("name", "CP Plus camera")
    return {
        "ok": True,
        "service": APP_NAME,
        "camera_configured": configured,
        "camera_name": name if configured else None,
        "groq_configured": bool(GROQ_API_KEY),
        "provider": "Groq API",
        "model": GROQ_VISION_MODEL,
    }


@app.post("/api/camera")
def configure_camera(data: CameraInput):
    _validate_rtsp(data.rtsp_url)
    # Keep camera credentials only in local process memory; never return or log the URL.
    with _lock:
        _camera.update({"name": data.name.strip(), "rtsp_url": data.rtsp_url, "configured": True})
    return {"ok": True, "name": data.name.strip(), "message": "Camera URL stored in local connector memory. Use Test Camera to verify it."}


@app.delete("/api/camera")
def forget_camera():
    with _lock:
        _camera.update({"name": "CP Plus camera", "rtsp_url": "", "configured": False})
    return {"ok": True, "message": "Camera configuration cleared from memory."}


@app.get("/api/camera/status")
def camera_status():
    with _lock:
        return {"configured": bool(_camera["configured"]), "name": _camera["name"] if _camera["configured"] else None}


@app.get("/api/camera/snapshot")
def camera_snapshot():
    with _lock:
        url = _camera["rtsp_url"]
        configured = _camera["configured"]
    if not configured or not url:
        raise HTTPException(status_code=409, detail="Add your camera first.")
    jpg = _capture_snapshot(url)
    return {"mime_type": "image/jpeg", "image_base64": base64.b64encode(jpg).decode("ascii")}


@app.post("/api/ask")
def ask_camera(data: AskInput):
    with _lock:
        url = _camera["rtsp_url"]
        name = _camera["name"]
        configured = _camera["configured"]
    if not configured or not url:
        raise HTTPException(status_code=409, detail="Add and test a camera before asking questions.")

    headers = _groq_headers()
    snapshot = _capture_snapshot(url)
    image_data_url = "data:image/jpeg;base64," + base64.b64encode(snapshot).decode("ascii")
    prompt = (
        "You are NEXUS Vision, a careful CCTV scene assistant. Answer the user's question using only the supplied current camera frame. "
        "Be clear about uncertainty. Do not identify a person's identity, infer sensitive personal traits, or invent details or events outside this frame. "
        "If asked about history or what happened over time, explain that a single snapshot cannot establish it. "
        "Describe observable facts plainly and distinguish guesses from what is clearly visible. "
        f"Camera name: {name}. User question: {data.question}"
    )
    payload = {
        "model": GROQ_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            }
        ],
        "temperature": 0.2,
        "max_completion_tokens": 900,
        "stream": False,
    }
    try:
        response = requests.post(
            f"{GROQ_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
            timeout=90,
        )
        if response.status_code == 401:
            raise HTTPException(status_code=503, detail="Groq rejected the API key. Check GROQ_API_KEY in connector/.env.")
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Groq rate limit or usage quota reached. Wait and try again, or check your Groq Console limits.")
        if response.status_code in (400, 404):
            raise HTTPException(status_code=502, detail=f"Groq rejected model/request. Verify GROQ_VISION_MODEL ('{GROQ_VISION_MODEL}') is currently available for vision in your Groq account.")
        response.raise_for_status()
        payload_out = response.json()
        choices = payload_out.get("choices") or []
        answer = ((choices[0].get("message") or {}).get("content") or "").strip() if choices else ""
        if not answer:
            raise HTTPException(status_code=502, detail="Groq returned an empty answer.")
        return {
            "answer": answer,
            "camera": name,
            "source": "Groq vision API",
            "model": GROQ_VISION_MODEL,
            "snapshot_mime_type": "image/jpeg",
        }
    except HTTPException:
        raise
    except requests.Timeout:
        raise HTTPException(status_code=504, detail="Groq took too long to respond. Try again with a simpler question.")
    except requests.RequestException as exc:
        # Do not include request URLs, headers, or secrets in client-facing errors.
        raise HTTPException(status_code=502, detail=f"Could not reach Groq API ({type(exc).__name__}). Check your internet connection and Groq service status.")


@app.get("/")
def root():
    return {"name": APP_NAME, "docs": "/docs", "health": "/api/health", "provider": "Groq API"}
