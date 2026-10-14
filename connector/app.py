from __future__ import annotations

import base64
import os
import threading
from typing import Optional
from urllib.parse import urlparse

import cv2
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_NAME = "NEXUS Vision Local Connector"
SETTINGS_PATH = os.environ.get("NEXUS_SETTINGS_PATH", "camera-settings.json")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "qwen3-vl:4b")

app = FastAPI(title=APP_NAME, version="0.1.0")
# Development convenience only. Restrict this to your UI origin before production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    # Credentials stay server-side. OpenCV/FFmpeg RTSP support must be available in this build.
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


@app.get("/api/health")
def health():
    ollama_ok = False
    try:
        response = requests.get(f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags", timeout=2)
        ollama_ok = response.ok
    except requests.RequestException:
        pass
    with _lock:
        configured = bool(_camera.get("configured"))
        name = _camera.get("name", "CP Plus camera")
    return {"ok": True, "service": APP_NAME, "camera_configured": configured, "camera_name": name if configured else None, "ollama_available": ollama_ok, "model": OLLAMA_MODEL}


@app.post("/api/camera")
def configure_camera(data: CameraInput):
    _validate_rtsp(data.rtsp_url)
    # Store credentials only in local process memory. Do not log or return the URL.
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
    try:
        snapshot = _capture_snapshot(url)
    except HTTPException:
        raise
    image_b64 = base64.b64encode(snapshot).decode("ascii")
    prompt = (
        "You are NEXUS Vision, a careful CCTV scene assistant. Answer only from the supplied current camera image. "
        "Be clear about uncertainty, do not identify a person's identity, and do not invent details or events outside this frame. "
        "If the question asks what happened over time, explain that one snapshot cannot establish history. "
        f"Camera name: {name}. User question: {data.question}"
    )
    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
            json={"model": OLLAMA_MODEL, "stream": False, "messages": [{"role": "user", "content": prompt, "images": [image_b64]}]},
            timeout=120,
        )
        if response.status_code == 404:
            raise HTTPException(status_code=503, detail=f"Ollama model '{OLLAMA_MODEL}' is not available. Install it with: ollama pull {OLLAMA_MODEL}")
        response.raise_for_status()
        payload = response.json()
        answer = (payload.get("message") or {}).get("content", "").strip()
        if not answer:
            raise HTTPException(status_code=502, detail="The local model returned an empty answer.")
        return {"answer": answer, "camera": name, "source": "local-vision-model", "snapshot_mime_type": "image/jpeg"}
    except HTTPException:
        raise
    except requests.ConnectionError:
        raise HTTPException(status_code=503, detail="Cannot reach Ollama. Start Ollama and install the configured vision model.")
    except requests.Timeout:
        raise HTTPException(status_code=504, detail="Local vision model took too long. Try a smaller model or a smaller snapshot.")
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Local AI request failed: {type(exc).__name__}")


@app.get("/")
def root():
    return {"name": APP_NAME, "docs": "/docs", "health": "/api/health"}
