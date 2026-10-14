import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AudioLines, Camera, Check, ChevronDown, CircleHelp, Eye, EyeOff, Gauge, Menu, MessageSquare, Mic, MicOff, Monitor, Plus, Radio, ScanEye, Send, Settings2, ShieldCheck, Sparkles, Volume2, VolumeX, Wifi, X, Zap } from 'lucide-react';
import './styles.css';

const API = 'http://127.0.0.1:8765';

function App() {
  const [health, setHealth] = useState({ ok: false, camera_configured: false, groq_configured: false, provider: 'Groq API', model: 'qwen/qwen3.6-27b' });
  const [camName, setCamName] = useState('CP Plus camera');
  const [rtsp, setRtsp] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Hello. I’m NEXUS Vision. Connect your camera and I’ll help you understand what is visible in its current frame.', time: new Date() }]);
  const [snapshot, setSnapshot] = useState('');
  const [cameraStatus, setCameraStatus] = useState('Not connected');
  const [toast, setToast] = useState('');
  const [speaking, setSpeaking] = useState(true);
  const [listening, setListening] = useState(false);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const chatEndRef = useRef(null);

  async function refreshHealth() {
    try {
      const r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) throw new Error('Connector unavailable');
      const data = await r.json(); setHealth(data);
      if (data.camera_configured) setCamName(data.camera_name || 'CP Plus camera');
      setCameraStatus(data.camera_configured ? 'Configured' : 'Not connected');
    } catch { setHealth(h => ({ ...h, ok: false })); }
  }
  useEffect(() => { refreshHealth(); const id = setInterval(refreshHealth, 8000); return () => clearInterval(id); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => () => { try { recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); } catch {} }, []);

  function notify(text) { setToast(text); window.setTimeout(() => setToast(''), 3600); }
  function speak(text) {
    if (!speaking || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text); utterance.rate = 1.02; utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }
  async function connectCamera(e) {
    e?.preventDefault(); if (!rtsp.trim()) return notify('Enter your camera RTSP URL first.');
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/camera`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: camName.trim() || 'CP Plus camera', rtsp_url: rtsp.trim() }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'Unable to save camera');
      const test = await fetch(`${API}/api/camera/snapshot`, { signal: AbortSignal.timeout(15000) }); const frame = await test.json();
      if (!test.ok) throw new Error(frame.detail || 'Camera stream test failed');
      setSnapshot(`data:image/jpeg;base64,${frame.image_base64}`); setCameraStatus('Live snapshot received'); setShowSetup(false); setRtsp(''); setHealth(h => ({ ...h, camera_configured: true, camera_name: camName }));
      notify('Camera connected. Snapshot received successfully.');
      setMessages(m => [...m, { role: 'assistant', text: `I received a frame from ${camName}. Ask me about what is visible in this image.`, time: new Date() }]);
    } catch (err) { setCameraStatus('Connection issue'); notify(err.message || 'Could not connect. Check the local connector and camera URL.'); }
    finally { setBusy(false); refreshHealth(); }
  }
  async function takeSnapshot() {
    try { const r = await fetch(`${API}/api/camera/snapshot`, { signal: AbortSignal.timeout(15000) }); const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'Snapshot failed'); setSnapshot(`data:image/jpeg;base64,${d.image_base64}`); setCameraStatus('Snapshot refreshed'); }
    catch (e) { notify(e.message); }
  }
  async function ask(q = question) {
    const text = q.trim(); if (!text || busy) return;
    setQuestion(''); setMessages(m => [...m, { role: 'user', text, time: new Date() }]); setBusy(true);
    try {
      const r = await fetch(`${API}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text }), signal: AbortSignal.timeout(130000) });
      const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'Unable to get answer');
      setMessages(m => [...m, { role: 'assistant', text: d.answer, time: new Date(), source: 'Groq vision API' }]);
      if (d.snapshot_mime_type && !snapshot) takeSnapshot(); speak(d.answer);
    } catch (e) { setMessages(m => [...m, { role: 'error', text: `I couldn't answer that: ${e.message}. Check the local connector, camera stream, Groq API key, and available model quota.`, time: new Date() }]); }
    finally { setBusy(false); }
  }
  function toggleMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return notify('Speech recognition is not supported by this browser. You can type questions, or configure offline speech recognition later.');
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const recognition = new SpeechRecognition(); recognition.lang = 'en-IN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
    recognition.onresult = e => { const heard = e.results?.[0]?.[0]?.transcript || ''; setQuestion(heard); setListening(false); setTimeout(() => ask(heard), 250); };
    recognition.onerror = () => { setListening(false); notify('Microphone recognition failed. Check browser microphone permission.'); };
    recognition.onend = () => setListening(false); recognitionRef.current = recognition;
    try { recognition.start(); setListening(true); } catch { setListening(false); notify('Could not start microphone.'); }
  }
  async function disconnect() {
    try { await fetch(`${API}/api/camera`, { method: 'DELETE' }); setSnapshot(''); setCameraStatus('Not connected'); setHealth(h => ({ ...h, camera_configured: false })); notify('Camera configuration cleared from connector memory.'); }
    catch { notify('Connector is not reachable.'); }
  }
  const time = d => d?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><ScanEye size={23}/></div><div><strong>NEXUS<span>VISION</span></strong><small>CAMERA INTELLIGENCE</small></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <button className="nav-item active"><Activity size={17}/> <span>Vision console</span><span className="nav-dot"/></button>
      <button className="nav-item" onClick={() => setShowSetup(true)}><Camera size={17}/> <span>Camera sources</span><Plus size={15} className="nav-trailing"/></button>
      <button className="nav-item" onClick={() => notify('Event history is planned for the next build.')}><Radio size={17}/> <span>Event timeline</span><span className="soon">SOON</span></button>
      <div className="sidebar-bottom"><div className="local-card"><div className="local-icon"><ShieldCheck size={19}/></div><strong>Private by design</strong><p>Camera credentials stay inside this local connector. When you ask a question, a camera snapshot is sent to Groq for vision analysis.</p><div className="local-status"><i/> LOCAL PROCESSING</div></div><button className="nav-item" onClick={() => setShowSetup(true)}><Settings2 size={17}/> <span>Connection settings</span></button><div className="profile"><div className="avatar">NV</div><div><strong>Local workspace</strong><small>Personal instance</small></div><span className="online-dot"/></div></div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div className="mobile-brand"><ScanEye size={21}/><strong>NEXUS VISION</strong></div><div className="breadcrumbs">Workspace <span>/</span> <b>Vision console</b></div><div className="topbar-right"><div className={`connector-pill ${health.ok ? 'good' : 'bad'}`}><i/>{health.ok ? 'Connector online' : 'Connector offline'}</div><button className="icon-btn" title="Help" onClick={() => notify('Install and start the local connector to begin. See the README for setup steps.')}><CircleHelp size={18}/></button></div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><div className="eyebrow"><Sparkles size={13}/> YOUR CAMERA, CONVERSATIONAL</div><h1>See beyond the <span>frame.</span></h1><p>Ask your camera a question. Get answers grounded in what it can actually see.</p></div><button className="secondary-btn" onClick={() => setShowSetup(true)}><Plus size={16}/> Add camera</button></div>
        <div className="metric-row">
          <div className="metric"><span className="metric-icon cyan"><Camera size={17}/></span><div><small>CAMERA SOURCE</small><strong>{health.camera_configured ? camName : 'No camera added'}</strong><em>{health.camera_configured ? 'Configured' : 'Ready to connect'}</em></div></div>
          <div className="metric"><span className="metric-icon purple"><Zap size={17}/></span><div><small>VISION ENGINE</small><strong>{health.groq_configured ? health.model : 'Groq key not configured'}</strong><em>{health.groq_configured ? 'Vision API configured' : 'Add your Groq API key'}</em></div></div>
          <div className="metric"><span className="metric-icon green"><ShieldCheck size={17}/></span><div><small>DATA ROUTING</small><strong>Connector protected</strong><em>Groq vision API · usage limits apply</em></div></div>
        </div>
        <div className="dashboard-grid">
          <section className="panel camera-panel"><div className="panel-header"><div><div className="panel-title"><span className="live-symbol"/> LIVE CAMERA</div><div className="panel-subtitle">{health.camera_configured ? camName : 'Connect your CP Plus device'}</div></div><button className="small-icon-btn" title="Camera settings" onClick={() => setShowSetup(true)}><Settings2 size={17}/></button></div>
            <div className={`camera-viewport ${snapshot ? 'has-image' : ''}`}>
              {snapshot ? <img className="snapshot" src={snapshot} alt="Latest camera snapshot"/> : <div className="camera-placeholder"><div className="radar"><div className="radar-ring ring-a"/><div className="radar-ring ring-b"/><div className="radar-cross"/><div className="radar-center"><ScanEye size={31}/></div></div><strong>Your view starts here</strong><p>Connect a compatible IP camera to capture a live snapshot.</p><button className="primary-btn" onClick={() => setShowSetup(true)}><Wifi size={16}/> Connect a camera</button></div>}
              <div className="viewport-overlay"><span className="record-label"><i/> {snapshot ? 'SNAPSHOT' : 'STANDBY'}</span><span className="viewport-time">{new Date().toLocaleTimeString()}</span></div>
              <div className="viewport-coordinates">NEXUS VISION <span>•</span> LOCAL FEED</div>
            </div>
            <div className="camera-footer"><div className="camera-connection"><span className={`status-led ${health.camera_configured ? 'on' : ''}`}/><div><strong>{cameraStatus}</strong><small>{health.camera_configured ? 'RTSP source configured' : 'Awaiting camera configuration'}</small></div></div><div className="camera-actions"><button className="round-action" title="Refresh snapshot" onClick={takeSnapshot}><Activity size={16}/></button><button className="round-action" title="Disconnect camera" onClick={disconnect}><X size={16}/></button></div></div>
            <div className="camera-hint"><ShieldCheck size={15}/><span>For privacy, your stream is accessed by the local connector. The dashboard shows snapshots on demand. Asking a question sends the current snapshot to Groq for analysis.</span></div>
          </section>

          <section className="panel chat-panel"><div className="panel-header chat-heading"><div className="assistant-heading"><div className="assistant-avatar"><ScanEye size={20}/><span/></div><div><div className="panel-title">Talk to your camera</div><div className="panel-subtitle">Ask naturally. Get a visual answer.</div></div></div><button className={`small-icon-btn ${speaking ? 'selected' : ''}`} title={speaking ? 'Mute spoken answers' : 'Enable spoken answers'} onClick={() => { setSpeaking(!speaking); if (speaking) window.speechSynthesis?.cancel(); }} aria-label="Toggle spoken answers">{speaking ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button></div>
            <div className="chat-context"><span className="context-pulse"/><span>{health.camera_configured ? `Context: ${camName}` : 'No camera context yet'}</span><span className="context-separator">/</span><span>Frame-based analysis</span></div>
            <div className="messages">
              <div className="date-divider"><span/> SESSION STARTED <span/></div>
              {messages.map((m, i) => <div key={i} className={`message-row ${m.role}`}><div className={`message-avatar ${m.role}`}>{m.role === 'assistant' ? <ScanEye size={16}/> : m.role === 'user' ? 'YOU' : <CircleHelp size={15}/>}</div><div className="message-main"><div className="message-meta"><strong>{m.role === 'assistant' ? 'NEXUS' : m.role === 'user' ? 'YOU' : 'NOTICE'}</strong><time>{time(m.time)}</time></div><div className="bubble">{m.text}</div>{m.source && <div className="answer-source"><Check size={12}/> {m.source}</div>}</div></div>)}
              {busy && <div className="message-row assistant"><div className="message-avatar assistant"><ScanEye size={16}/></div><div className="message-main"><div className="message-meta"><strong>NEXUS</strong><time>Thinking…</time></div><div className="bubble thinking"><span/><span/><span/><em>Examining current camera frame</em></div></div></div>}
              <div ref={chatEndRef}/>
            </div>
            <div className="suggestion-area"><div className="suggestions-label">TRY ASKING</div><div className="suggestions"><button onClick={() => ask('Describe what is visible in the current camera frame.')}> <Eye size={13}/> Describe the scene</button><button onClick={() => ask('Read any visible text or signs in the image.')}> <ScanEye size={13}/> Read visible text</button><button onClick={() => ask('How many people are visible? Explain any uncertainty.')}> <Activity size={13}/> Count people</button></div></div>
            <form className="composer" onSubmit={e => { e.preventDefault(); ask(); }}><button type="button" className={`mic-btn ${listening ? 'listening' : ''}`} title="Speak a question" onClick={toggleMic}>{listening ? <MicOff size={18}/> : <Mic size={18}/>}</button><input ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask anything about what the camera sees…" disabled={busy}/><button type="submit" className="send-btn" disabled={busy || !question.trim()} aria-label="Send question"><Send size={17}/></button></form>
            <div className="composer-note"><span><ShieldCheck size={12}/> Snapshot sent to Groq for analysis</span><span>AI can make mistakes · Verify important events</span></div>
          </section>
        </div>
        <footer className="page-footer"><span>© 2026 NEXUS VISION <i/> LOCAL CAMERA INTELLIGENCE</span><span><span className="footer-led"/> {health.ok ? 'LOCAL CONNECTOR REACHABLE' : 'CONNECTOR NOT REACHABLE'}</span></footer>
      </div>
    </main>

    {showSetup && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowSetup(false); }}><div className="setup-modal"><div className="modal-heading"><div><div className="eyebrow"><Settings2 size={13}/> CONNECTION SETUP</div><h2>Add a camera</h2><p>Connect a compatible CP Plus IP camera or NVR on your local network.</p></div><button className="icon-btn" onClick={() => setShowSetup(false)}><X size={19}/></button></div>
      <div className="connector-warning"><ShieldCheck size={18}/><div><strong>Credentials stay in the local connector</strong><p>The RTSP URL is sent to localhost only and is kept in memory until you disconnect or restart the connector. Never use this form on a public computer.</p></div></div>
      <form className="setup-form" onSubmit={connectCamera}><label>CAMERA NAME<input value={camName} onChange={e => setCamName(e.target.value)} placeholder="e.g. Front gate" maxLength={80}/></label><label>RTSP STREAM URL<div className="password-field"><input type={showUrl ? 'text' : 'password'} value={rtsp} onChange={e => setRtsp(e.target.value)} placeholder="rtsp://user:password@camera-ip:554/..." autoComplete="off" required/><button type="button" onClick={() => setShowUrl(!showUrl)}>{showUrl ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label><div className="hint-box"><CircleHelp size={15}/><p>CP Plus stream paths vary by model, NVR, and channel. Find the correct RTSP URL in your device manual/configuration, and test it in VLC first. Do not assume a generic path will work.</p></div><div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setShowSetup(false)}>Cancel</button><button type="submit" className="primary-btn" disabled={busy || !health.ok}>{busy ? <><span className="button-spinner"/> Testing…</> : <><Wifi size={16}/> Save & test stream</>}</button></div>{!health.ok && <div className="inline-error">Local connector isn't reachable. Start it using the setup instructions in README.md.</div>}</form></div></div>}
    {toast && <div className="toast"><Activity size={15}/>{toast}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
