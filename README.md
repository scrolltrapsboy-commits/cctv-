# NEXUS Vision — Groq-powered CCTV Talk Assistant

A local-first CCTV viewer and conversational vision assistant. The local connector captures a frame from a compatible camera, then sends that snapshot and your question to Groq's vision API. The browser never receives your RTSP URL or Groq API key.

## What it does

- Ask natural-language questions about the current camera frame.
- Read visible signs/text, describe scenes, and ask about visible objects.
- Use browser speech input and spoken responses where supported.
- Connect a compatible CP Plus IP camera/NVR using RTSP.
- Keep camera credentials and the Groq API key in the local connector, not in frontend JavaScript.

## Important privacy and compatibility notes

- **This uses Groq's cloud API, not a local AI model.** A camera snapshot is sent to Groq whenever you ask a question. Do not use it with cameras or locations whose footage you are not authorized to share.
- Groq usage limits, model availability, and any free tier can change. Check your Groq Console before relying on it for continuous use.
- The default vision model is `qwen/qwen3.8-27b`; verify the model is currently available to your Groq account. Change `GROQ_VISION_MODEL` in `connector/.env` if needed.
- CP Plus models and firmware differ. This works only if your camera/NVR exposes a compatible RTSP stream. Some setups may need RTSP/ONVIF enabled in the device configuration.
- Most browsers cannot play RTSP directly. MediaMTX can bridge compatible streams to WebRTC/HLS for a continuous browser live view. The current dashboard captures snapshots through the connector for AI questions.
- One snapshot can answer questions about what is visible now; it cannot reliably establish events over time without recording and temporal analysis.
- Keep the connector on a trusted local network. Do not expose its ports or camera streams publicly without authentication, HTTPS, and a security review.

## Deploy everything in one Render Web Service (cloud-only UI/API)

Deploy the React website and FastAPI API together as one Render **Web Service**.

- Root Directory: leave blank (repository root)
- Build Command: `npm install --prefix web && npm run build --prefix web && pip install -r connector/requirements.txt`
- Start Command: `uvicorn connector.app:app --host 0.0.0.0 --port $PORT`

Set these environment variables in that same Render service:

- `GROQ_API_KEY` = your secret Groq key
- `GROQ_BASE_URL` = `https://api.groq.com/openai/v1`
- `GROQ_VISION_MODEL` = a vision model currently available to your Groq account

The production website calls the API on the same Render origin; it does not call localhost or require a local connector. The `/` route serves the built website and `/api/health` reports API configuration.

**Important camera-network limitation:** Render cannot directly reach a private home-LAN IP such as `192.168.31.26`. VLC working on your laptop proves the stream works on your LAN, not from Render. In cloud-only mode, the RTSP stream must be reachable from Render through a secure, authenticated relay or VPN gateway. Do not expose RTSP or camera credentials directly to the public internet. If the camera only exposes a private LAN stream and cannot publish to a supported cloud service, live camera analysis cannot work from Render alone without some network bridge.

The browser's “Hey James” listener uses browser speech recognition while the page is open; responses play through the browser, not the camera speaker. This deployment does not provide continuous background listening or camera-speaker output.

## Architecture

- `web/` — React/Vite dashboard, chat, voice controls, camera setup.
- `connector/` — FastAPI local service, RTSP snapshot capture, Groq API calls.
- `mediamtx/` — example configuration for optional camera stream bridging.

## Requirements

- Windows 10/11, macOS, or Linux computer on the same LAN as the camera/NVR.
- Python 3.11+ and Node.js 20+.
- A Groq API key: https://console.groq.com/keys
- Optional MediaMTX for continuous browser playback: https://mediamtx.org/

## Windows quick start

1. Clone the repository and open a terminal in its folder.
2. Create the connector environment file:
   ```powershell
   cd connector
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   Copy-Item .env.example .env
   notepad .env
   ```
3. Paste your key into `GROQ_API_KEY=` in `connector/.env`. Do not share or commit this key.
4. Start the connector from the `connector` folder:
   ```powershell
   uvicorn app:app --host 127.0.0.1 --port 8765
   ```
5. In a second terminal:
   ```powershell
   cd web
   npm install
   npm run dev
   ```
6. To use the deployed Render UI, open `https://cctv-l0ca.onrender.com` in Chrome or Edge on the Windows PC connected to the camera's Wi-Fi. Click **Add camera** to trigger the local-connector permission request. If Chrome/Edge asks whether the site can connect to localhost or your local network, choose **Allow**. Add the RTSP URL and choose **Save & test stream**. Keep the local connector running while using the site. For local Vite development, use the URL shown by `npm run dev` instead.

If PowerShell blocks activation, use `.venv\Scripts\python.exe -m pip install -r requirements.txt` and `.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8765` instead.

## CP Plus camera setup

1. Find the exact model number from the camera label, NVR menu, or CP Plus app/device information.
2. Ensure the camera/NVR and computer are on the same network.
3. Check the model manual/settings for RTSP support and enable it if required.
4. Create a dedicated read-only camera account if the device supports it.
5. Test the exact RTSP URL in VLC before entering it into NEXUS Vision. RTSP paths differ by camera, firmware, NVR, and channel; do not assume a generic path works.
6. Enter the URL only in the local dashboard. The connector stores it in process memory and does not return it to the browser.

## Troubleshooting

- **Groq key not configured:** verify `connector/.env` contains `GROQ_API_KEY=...` and restart the connector.
- **401:** the key is invalid or revoked.
- **429:** rate limit or account quota reached; check Groq Console.
- **Model/request rejected:** verify `GROQ_VISION_MODEL` is an active vision model available to your account.
- **Camera snapshot failed:** check the exact RTSP path, credentials, network, and stream settings in VLC.
- **Signal timed out:** open the Render site on the Windows PC connected to the camera's Wi-Fi and start the local FastAPI connector on `127.0.0.1:8765`. Render cannot route directly to a private camera IP. If the connector is online but the stream still times out, verify the current camera IP, use the exact ONVIF media-profile RTSP URI, and try a lower-resolution H.264 profile.
- **Connector offline:** ensure the FastAPI process is running on port 8765 and the browser allows the page to contact localhost.

## Security

Never commit a real API key, publish an RTSP URL containing credentials, or expose the local connector to the public internet. The connector is a local development starter, not a hardened remote-access service.
