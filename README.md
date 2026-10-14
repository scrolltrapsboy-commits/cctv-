# NEXUS Vision — CCTV Talk Assistant

A local-first CCTV viewer and conversational vision assistant designed for compatible CP Plus IP cameras.

## Important compatibility notes

- Works with IP cameras/NVRs only when they expose a supported stream/protocol (typically RTSP and/or ONVIF). CP Plus models and firmware differ; confirm the exact model and enable streaming in its configuration.
- Most browsers cannot play RTSP directly. The local connector uses MediaMTX to bridge supported RTSP streams to browser-friendly WebRTC/HLS.
- Vision answers require a vision-language model. This project uses Ollama locally by default, so no paid AI API key is needed. If Ollama is unavailable, the app must clearly report that AI analysis is unavailable rather than inventing an answer.
- Keep this service on a trusted local network initially. Do not expose camera streams or credentials to the public internet.

## Architecture

- `web/` — React/Vite dashboard with live-view, camera setup, and natural-language chat.
- `connector/` — FastAPI local connector that stores camera settings locally, captures snapshots from configured streams, and calls local Ollama.
- `mediamtx/` — example MediaMTX configuration for a camera stream bridge.

## Requirements

- Windows 10/11, macOS, or Linux computer on the same LAN as the camera/NVR.
- Python 3.11+ and Node.js 20+.
- MediaMTX (optional for live browser playback): https://mediamtx.org/
- Ollama (for local vision AI): https://ollama.com/download

## Quick start

1. Install Ollama and pull a vision model supported by your hardware, e.g. `ollama pull qwen3-vl:4b`.
2. Start the connector: `cd connector`, create a virtual environment, install `requirements.txt`, then run `uvicorn app:app --host 127.0.0.1 --port 8765`.
3. Start the UI: `cd web`, run `npm install` and `npm run dev`.
4. In the dashboard, add your camera's RTSP URL. Prefer a dedicated read-only camera account. Never commit credentials or share RTSP URLs publicly.

## CP Plus setup

Find the exact camera or NVR model and firmware. On the local network, verify RTSP/ONVIF support and enable it using the manufacturer's UI/manual. The RTSP URL format varies by model/NVR/channel; use the exact format for your device and channel. Do not assume one URL works for all CP Plus devices. Test the stream in VLC before entering it in NEXUS Vision.

## Security

This is a local development starter, not an internet-facing hardened service. Use strong unique credentials, keep ports LAN-only, and add HTTPS/authentication before remote access. The browser never receives the stored RTSP URL; it communicates with the local connector.
