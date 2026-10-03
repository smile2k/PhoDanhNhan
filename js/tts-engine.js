const TTSEngine = (() => {
  let isSpeaking = false;
  let isPaused = false;
  let rate = 1.0;
  let onStateChange = null;
  let currentLabel = null;
  let currentAudio = null;
  let chunks = [];
  let chunkIndex = 0;
  let voice = 'vi-VN-HoaiMyNeural';

  function init(stateCallback) {
    onStateChange = stateCallback;
  }

  function splitText(text, maxLen) {
    const result = [];
    const sentences = text.replace(/([.!?;:])\s+/g, '$1\n').split('\n');
    let current = '';

    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;

      if (current.length + trimmed.length + 1 > maxLen && current) {
        result.push(current.trim());
        current = '';
      }

      if (trimmed.length > maxLen) {
        if (current) { result.push(current.trim()); current = ''; }
        const words = trimmed.split(/\s+/);
        let part = '';
        for (const w of words) {
          if (part.length + w.length + 1 > maxLen && part) {
            result.push(part.trim());
            part = '';
          }
          part += (part ? ' ' : '') + w;
        }
        if (part) current = part;
      } else {
        current += (current ? ' ' : '') + trimmed;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }

  function ttsUrl(text) {
    return '/api/tts?voice=' + encodeURIComponent(voice)
      + '&text=' + encodeURIComponent(text);
  }

  function speak(text, label) {
    stop();

    const cleaned = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return;

    currentLabel = label;
    chunks = splitText(cleaned, 2000);
    chunkIndex = 0;

    if (chunks.length === 0) return;

    isSpeaking = true;
    isPaused = false;
    notify('speaking', label);
    playNextChunk();
  }

  function playNextChunk() {
    if (chunkIndex >= chunks.length) {
      isSpeaking = false;
      isPaused = false;
      currentAudio = null;
      chunks = [];
      chunkIndex = 0;
      currentLabel = null;
      notify('idle', null);
      return;
    }

    const audio = new Audio(ttsUrl(chunks[chunkIndex]));
    audio.playbackRate = rate;
    currentAudio = audio;

    audio.onended = () => {
      chunkIndex++;
      playNextChunk();
    };

    audio.onerror = () => {
      isSpeaking = false;
      isPaused = false;
      currentAudio = null;
      chunks = [];
      chunkIndex = 0;
      currentLabel = null;
      notify('idle', null);
    };

    audio.play().catch(() => {
      isSpeaking = false;
      isPaused = false;
      currentAudio = null;
      notify('idle', null);
    });
  }

  function pause() {
    if (!isSpeaking || isPaused) return;
    if (currentAudio) currentAudio.pause();
    isPaused = true;
    notify('paused', null);
  }

  function resume() {
    if (!isPaused) return;
    if (currentAudio) currentAudio.play().catch(() => {});
    isPaused = false;
    notify('speaking', currentLabel);
  }

  function stop() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    chunks = [];
    chunkIndex = 0;
    isSpeaking = false;
    isPaused = false;
    currentLabel = null;
    notify('idle', null);
  }

  function togglePlayPause(text, label) {
    if (isSpeaking && !isPaused) {
      pause();
    } else if (isPaused) {
      resume();
    } else {
      speak(text, label);
    }
  }

  function setRate(newRate) {
    rate = Math.max(0.5, Math.min(2.0, newRate));
    if (currentAudio) currentAudio.playbackRate = rate;
  }

  function setVoice(v) {
    voice = v;
  }

  function getState() {
    if (isSpeaking && !isPaused) return 'speaking';
    if (isPaused) return 'paused';
    return 'idle';
  }

  function notify(state, label) {
    if (onStateChange) onStateChange(state, label);
  }

  return { init, speak, pause, resume, stop, togglePlayPause, setRate, setVoice, getState };
})();
