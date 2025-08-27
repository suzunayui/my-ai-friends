// js/chat.js
// Ollama とストリーミングで会話し、viewer の口パクと VOICEVOX 読み上げに連動
// ・設定パネルに VOICEVOX の要素（vvEnable, vvEndpoint, vvRefresh, vvSpeaker, vvSpeed, vvVolume）があれば利用
// ・（任意）性格付けUI（systemPrompt, personaPreset, savePersona, resetPersona）があれば利用
// ・存在しない要素は自動的に無視して安全に動作

// ====== ユーティリティ ======
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, obj) { localStorage.setItem(key, JSON.stringify(obj || {})); }
};

function splitForTTS(text) {
  const parts = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (/[。．\.!\?！？\n]/.test(ch)) {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

// ====== メイン ======
export function initChat(viewer) {
  // --- Ollama 設定（必要なら変更） ---
  const OLLAMA_ENDPOINT = 'http://localhost:11434/api/chat';
  const OLLAMA_MODEL = 'gpt-oss:20b';

  // --- 既定の性格プロンプト（任意UIが無い場合はこれが使われる） ---
  const DEFAULT_SYSTEM_PROMPT =
    'フレンドリーに、簡潔に答えてください。絵文字は控えめに。';

  // --- 既存UIの取得 ---
  const ui = {
    container:  document.getElementById('chat'),
    title:      document.getElementById('modelName'),
    log:        document.getElementById('chat-log'),
    form:       document.getElementById('chat-form'),
    input:      document.getElementById('chat-input'),
    sendBtn:    document.getElementById('chat-send'),
    stopBtn:    document.getElementById('chat-stop'),
    toggleBtn:  document.getElementById('toggleSize'),
    // VOICEVOX（存在すれば利用）
    vvEnable:   document.getElementById('vvEnable'),
    vvEndpoint: document.getElementById('vvEndpoint'),
    vvRefresh:  document.getElementById('vvRefresh'),
    vvSpeaker:  document.getElementById('vvSpeaker'),
    vvSpeed:    document.getElementById('vvSpeed'),
    vvVolume:   document.getElementById('vvVolume'),
    // 性格付け（存在すれば利用）
    systemPrompt:  document.getElementById('systemPrompt'),
    personaPreset: document.getElementById('personaPreset'),
    savePersona:   document.getElementById('savePersona'),
    resetPersona:  document.getElementById('resetPersona'),
  };
  if (ui.title) ui.title.textContent = OLLAMA_MODEL;

  // --- 性格プロンプトの読み込み ---
  const chatPrefs = store.get('chat_prefs', {});
  let systemPrompt = chatPrefs.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  // UIに値があれば初期反映
  if (ui.systemPrompt) ui.systemPrompt.value = systemPrompt;
  if (ui.personaPreset && chatPrefs.personaPreset) ui.personaPreset.value = chatPrefs.personaPreset;

  function presetToPrompt(key) {
    switch (key) {
      case 'friendly':
        return 'フレンドリーに、簡潔に答えてください。絵文字は控えめに。';
      case 'cute':
        return 'やわらかい口調で、励ましを多めに。絵文字は少なめに。';
      case 'serious':
        return '落ち着いた丁寧語で要点を簡潔に。絵文字は不要。';
      default:
        return '';
    }
  }
  function applySystemPrompt(next) {
    systemPrompt = (next && next.trim()) || DEFAULT_SYSTEM_PROMPT;
  }
  if (ui.personaPreset) {
    ui.personaPreset.addEventListener('change', () => {
      const text = presetToPrompt(ui.personaPreset.value);
      if (text && ui.systemPrompt) ui.systemPrompt.value = text;
    });
  }
  if (ui.savePersona) {
    ui.savePersona.addEventListener('click', () => {
      const preset = ui.personaPreset ? ui.personaPreset.value : '';
      const text = (ui.systemPrompt?.value?.trim()) || presetToPrompt(preset) || DEFAULT_SYSTEM_PROMPT;
      applySystemPrompt(text);
      store.set('chat_prefs', { ...chatPrefs, systemPrompt: text, personaPreset: preset });
    });
  }
  if (ui.resetPersona) {
    ui.resetPersona.addEventListener('click', () => {
      applySystemPrompt(DEFAULT_SYSTEM_PROMPT);
      if (ui.systemPrompt) ui.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
      if (ui.personaPreset) ui.personaPreset.value = '';
      store.set('chat_prefs', { ...chatPrefs, systemPrompt: DEFAULT_SYSTEM_PROMPT, personaPreset: '' });
    });
  }

  // --- VOICEVOX 設定の読み込み ---
  const vvPrefs = store.get('vv_prefs', {});
  if (ui.vvEnable)  ui.vvEnable.checked = vvPrefs.enabled ?? true;
  if (ui.vvEndpoint) ui.vvEndpoint.value = vvPrefs.endpoint || 'http://127.0.0.1:50021';
  if (ui.vvSpeed)   ui.vvSpeed.value = vvPrefs.speed ?? 1.0;
  if (ui.vvVolume)  ui.vvVolume.value = vvPrefs.volume ?? 1.0;

  function saveVVPrefs() {
    store.set('vv_prefs', {
      enabled: ui.vvEnable?.checked ?? true,
      endpoint: ui.vvEndpoint?.value?.trim() || 'http://127.0.0.1:50021',
      speakerId: ui.vvSpeaker?.value ? Number(ui.vvSpeaker.value) : undefined,
      speed: ui.vvSpeed ? Number(ui.vvSpeed.value) : 1.0,
      volume: ui.vvVolume ? Number(ui.vvVolume.value) : 1.0
    });
  }
  ui.vvEnable?.addEventListener('change', saveVVPrefs);
  ui.vvEndpoint?.addEventListener('change', () => { saveVVPrefs(); loadSpeakers(); });
  ui.vvSpeaker?.addEventListener('change', saveVVPrefs);
  ui.vvSpeed?.addEventListener('change', saveVVPrefs);
  ui.vvVolume?.addEventListener('change', saveVVPrefs);

  // --- VOICEVOX 話者取得 ---
  async function loadSpeakers() {
    if (!ui.vvSpeaker || !ui.vvEndpoint) return;
    const ep = ui.vvEndpoint.value.trim().replace(/\/+$/,'');
    if (!ep) return;
    ui.vvSpeaker.innerHTML = '<option value="">取得中…</option>';
    try {
      const res = await fetch(`${ep}/speakers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json(); // [{name, styles:[{id,name}], ...}]
      const opts = [];
      for (const sp of arr) {
        for (const st of (sp.styles || [])) {
          const label = `${sp.name}（${st.name}） [${st.id}]`;
          opts.push(`<option value="${st.id}">${label}</option>`);
        }
      }
      ui.vvSpeaker.innerHTML = opts.join('') || '<option value="">話者なし</option>';
      if (vvPrefs.speakerId) ui.vvSpeaker.value = String(vvPrefs.speakerId);
    } catch (e) {
      console.warn('VOICEVOX /speakers 取得失敗:', e);
      ui.vvSpeaker.innerHTML = '<option value="">取得失敗</option>';
    }
  }
  if (ui.vvRefresh) ui.vvRefresh.addEventListener('click', loadSpeakers);
  // 初回も自動取得（UIがある場合のみ）
  if (ui.vvSpeaker) loadSpeakers();

  // --- TTS（VOICEVOX）キュー ---
  const ttsState = {
    queue: [],
    playing: false,
    abort: false,
    current: null,   // HTMLAudioElement
    currentURL: null // ObjectURL
  };

  async function synthesizeToBlob(text, speakerId, opts) {
    const ep = (ui.vvEndpoint?.value?.trim() || 'http://127.0.0.1:50021').replace(/\/+$/,'');
    // 1) audio_query
    const qRes = await fetch(`${ep}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`, { method: 'POST' });
    if (!qRes.ok) throw new Error(`audio_query HTTP ${qRes.status}`);
    const query = await qRes.json();
    // 2) オプション反映
    query.speedScale  = Number(opts.speed ?? 1.0);
    query.volumeScale = Number(opts.volume ?? 1.0);
    // 3) synthesis
    const sRes = await fetch(`${ep}/synthesis?speaker=${speakerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    if (!sRes.ok) throw new Error(`synthesis HTTP ${sRes.status}`);
    return await sRes.blob(); // audio/wav
  }

  function stopCurrentAudio() {
    if (ttsState.current) {
      try { ttsState.current.pause(); } catch {}
      ttsState.current = null;
    }
    if (ttsState.currentURL) {
      try { URL.revokeObjectURL(ttsState.currentURL); } catch {}
      ttsState.currentURL = null;
    }
  }

  async function playBlob(blob) {
    return new Promise((resolve, reject) => {
      stopCurrentAudio();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      ttsState.current = audio;
      ttsState.currentURL = url;
      audio.onended = () => { stopCurrentAudio(); resolve(); };
      audio.onerror = (e) => { stopCurrentAudio(); reject(e); };
      audio.play();
    });
  }

  function ttsEnqueue(text) {
    const enabled = ui.vvEnable?.checked;
    const spk = ui.vvSpeaker?.value;
    if (!enabled || !spk || !text?.trim()) return;
    const parts = splitForTTS(text);
    for (const p of parts) ttsState.queue.push(p);
    if (!ttsState.playing) ttsDequeue();
  }

  async function ttsDequeue() {
    if (ttsState.playing) return;
    ttsState.playing = true;
    viewer?.setTalking?.(true);
    try {
      while (ttsState.queue.length && !ttsState.abort) {
        const chunk = ttsState.queue.shift();
        try {
          const blob = await synthesizeToBlob(chunk, ui.vvSpeaker.value, {
            speed: ui.vvSpeed ? Number(ui.vvSpeed.value) : 1.0,
            volume: ui.vvVolume ? Number(ui.vvVolume.value) : 1.0
          });
          await playBlob(blob);
        } catch (e) {
          console.warn('VOICEVOX 合成/再生失敗:', e);
          // 失敗しても次へ
        }
      }
    } finally {
      ttsState.playing = false;
      ttsState.abort = false;
      viewer?.setTalking?.(false);
    }
  }

  // --- チャット状態 ---
  const chatState = {
    messages: [{ role: 'system', content: systemPrompt }],
    controller: null
  };

  // --- UIログ出力 ---
  function append(role, text, extra = '') {
    const div = document.createElement('div');
    div.className = `msg ${role}${extra ? (' ' + extra) : ''}`;
    div.textContent = text;
    ui.log.appendChild(div);
    ui.log.scrollTop = ui.log.scrollHeight;
    return div;
  }

  // --- 送信処理 ---
  async function sendToOllama(userText) {
    // UIロック
    chatState.controller = new AbortController();
    if (ui.stopBtn) ui.stopBtn.disabled = false;
    if (ui.sendBtn) ui.sendBtn.disabled = true;
    if (ui.input)   ui.input.disabled = true;

    append('user', userText);
    const pending = append('assistant', '…', 'pending');

    chatState.messages.push({ role: 'user', content: userText });

    try {
      const res = await fetch(OLLAMA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: chatState.messages,
          stream: true
        }),
        signal: chatState.controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', assistantText = '';
      let started = false;
      let ttsBuf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const s = line.trim(); if (!s) continue;
          let obj; try { obj = JSON.parse(s); } catch { continue; }
          const piece = obj?.message?.content || obj?.response || '';
          if (!piece) continue;

 if (!started) {
   // VOICEVOXが有効なときは、口パクはTTS側で制御
   if (!ui.vvEnable?.checked) viewer?.setTalking?.(true);
   started = true;
 }
          assistantText += piece;
          pending.textContent = assistantText;
          ui.log.scrollTop = ui.log.scrollHeight;

          // 口パクエネルギー
          viewer?.onAssistantChunk?.(piece.length);

          // TTS（句点ごとに送る。最後の断片は保留）
          if (ui.vvEnable?.checked) {
            ttsBuf += piece;
            const chunks = splitForTTS(ttsBuf);
            ttsBuf = chunks.length ? chunks.pop() : '';
            for (const c of chunks) ttsEnqueue(c);
          }
        }
      }

      // ストリーム終了時に残りを送る
      if (ttsBuf && ui.vvEnable?.checked) ttsEnqueue(ttsBuf.trim());

      pending.classList.remove('pending');
      chatState.messages.push({ role: 'assistant', content: pending.textContent || '(空)' });

    } catch (err) {
      if (err.name === 'AbortError') {
        pending.textContent += ' [停止]';
      } else {
        pending.textContent = 'エラー: ' + (err.message || err);
      }
      pending.classList.remove('pending');
    } finally {
      chatState.controller = null;
      if (ui.stopBtn) ui.stopBtn.disabled = true;
      if (ui.sendBtn) ui.sendBtn.disabled = false;
      if (ui.input)   { ui.input.disabled = false; ui.input.focus(); }
    }
  }

  // --- イベント ---
  ui.form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ui.input?.value?.trim();
    if (!text) return;
    ui.input.value = '';
    sendToOllama(text);
  });

  ui.stopBtn?.addEventListener('click', () => {
    // ストリーム停止
    chatState.controller?.abort();
    // TTS 停止
    ttsState.abort = true;
    ttsState.queue.length = 0;
    stopCurrentAudio();
    viewer?.setTalking?.(false);
  });

  // 初期サイズとトグル
  if (ui.container) ui.container.style.height = '50dvh';
  if (ui.toggleBtn) {
    ui.toggleBtn.textContent = '小さくする';
    let compact = false;
    ui.toggleBtn.addEventListener('click', () => {
      compact = !compact;
      if (ui.container) ui.container.style.height = compact ? '32dvh' : '50dvh';
      ui.toggleBtn.textContent = compact ? '半分に戻す' : '小さくする';
    });
  }

  // 初期メッセージ
  append('assistant', 'こんにちは！何かお話しますか？');
}
