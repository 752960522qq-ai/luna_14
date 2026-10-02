function prepareGameAudio() {
  if (soundState.audioPrepared) return;
  soundState.audioPrepared = true;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (Context) try {
    soundState.audioContext = new Context();
    soundState.audioMaster = soundState.audioContext.createDynamicsCompressor();
    soundState.audioMaster.threshold.value = -6;
    soundState.audioMaster.knee.value = 8;
    soundState.audioMaster.ratio.value = 8;
    soundState.audioMaster.attack.value = .003;
    soundState.audioMaster.release.value = .1;
    soundState.audioMaster.connect(soundState.audioContext.destination);
  } catch (error) {
    soundState.audioContext = null;
    console.warn('使用短片段音频备用播放', error);
  }
  for (const [name, path] of Object.entries(AUDIO_FILES)) {
    if (name === 'bombDrop' || name === 'kill' || !soundState.audioContext) {
      const clip = new Audio(path);
      clip.preload = 'auto';
      clip.load();
      soundState.audioPools[name] = [clip];
    }
    if (soundState.audioContext && name !== 'bombDrop' && name !== 'kill') loadAudioBuffer(name);
  }
}
function loadAudioBuffer(name) {
  if (soundState.audioBuffers.has(name)) return Promise.resolve(soundState.audioBuffers.get(name));
  if (soundState.audioLoads.has(name)) return soundState.audioLoads.get(name);
  const promise = fetch(AUDIO_FILES[name]).then(response => {
    if (!response.ok) throw new Error('音频无法读取：' + name);
    return response.arrayBuffer();
  }).then(raw => soundState.audioContext.decodeAudioData(raw)).then(buffer => {
    soundState.audioBuffers.set(name, buffer);
    return buffer;
  }).catch(error => {
    console.warn('音频解码失败：' + name, error);
    return null;
  });
  soundState.audioLoads.set(name, promise);
  return promise;
}
function resumeGameAudio() {
  syncMenuMusic();
  prepareGameAudio();
  if (soundState.audioContext && soundState.audioContext.state === 'suspended') soundState.audioContext.resume().catch(() => {});
}
function playSfx(name, minGap = .2) {
  prepareGameAudio();
  const now = performance.now(),
    prior = soundState.audioLastPlayed[name];
  if (prior !== undefined && now - prior < minGap * 1000) return;
  soundState.audioLastPlayed[name] = now;
  const pool = soundState.audioPools[name] || (soundState.audioPools[name] = []);
  let voice = pool.find(item => item.paused || item.ended);
  if (!voice && pool.length < 6) {
    voice = new Audio(AUDIO_FILES[name]);
    voice.preload = 'auto';
    pool.push(voice);
  }
  if (!voice) voice = pool.reduce((old, item) => item.currentTime > old.currentTime ? item : old, pool[0]);
  voice.pause();
  voice.currentTime = 0;
  voice.loop = false;
  voice.volume = AUDIO_VOLUMES[name] ?? .5;
  const promise = voice.play();
  if (promise?.catch) promise.catch(() => {});
}
function releaseGunVoice(voice) {
  soundState.gunVoices.delete(voice);
  if (voice.source) try {
    voice.source.disconnect();
    voice.gain.disconnect();
  } catch {}
}
function playGunShot(name, root, isEnemy, interval, automatic = false) {
  if (!session.playing) return;
  prepareGameAudio();
  const volume = (AUDIO_VOLUMES[name] ?? .42) * (isEnemy ? .35 : 1),
    buffer = soundState.audioBuffers.get(name);
  // Unloaded/suspended Web Audio never queues stale shots for later replay.
  if (soundState.audioContext) {
    if (soundState.audioContext.state !== 'running' || !buffer) return;
    const now = soundState.audioContext.currentTime,
      perRoot = soundState.nextGunStart.get(root) || new Map();
    soundState.nextGunStart.set(root, perRoot);
    const start = Math.min(Math.max(now, perRoot.get(name) || now), now + .10);
    perRoot.set(name, start + interval);
    const source = soundState.audioContext.createBufferSource(),
      gain = soundState.audioContext.createGain();
    source.buffer = buffer;
    source.loop = false;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(soundState.audioMaster);
    const voice = {
      source,
      gain,
      start,
      isEnemy,
      automatic
    };
    soundState.gunVoices.add(voice);
    source.onended = () => releaseGunVoice(voice);
    source.start(start);
  } else {
    // Older WebViews still play a single short WAV, never the original burst.
    const clip = new Audio(AUDIO_FILES[name]);
    clip.volume = volume;
    clip.loop = false;
    const voice = {
      element: clip,
      start: 0,
      isEnemy,
      automatic
    };
    soundState.gunVoices.add(voice);
    clip.onended = () => releaseGunVoice(voice);
    clip.play().catch(() => releaseGunVoice(voice));
  }
  if (soundState.gunVoices.size > 48) {
    const oldest = soundState.gunVoices.values().next().value;
    if (oldest.source) {
      try {
        oldest.source.stop();
      } catch {}
    } else oldest.element.pause();
    releaseGunVoice(oldest);
  }
}
function stopPendingGunSounds() {
  if (inputState.keys.fire) return;
  const now = soundState.audioContext?.currentTime || 0;
  for (const voice of [...soundState.gunVoices]) if (!voice.isEnemy && !voice.automatic && voice.source && voice.start > now + .001) {
    try {
      voice.source.stop();
    } catch {}
    ;
    releaseGunVoice(voice);
  }
  if (session.player) soundState.nextGunStart.delete(session.player);
}
function stopGunSounds() {
  for (const voice of [...soundState.gunVoices]) {
    if (voice.source) {
      const now = soundState.audioContext.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, .004);
      try {
        voice.source.stop(now + .016);
      } catch {}
    } else {
      voice.element.pause();
      releaseGunVoice(voice);
    }
    soundState.gunVoices.delete(voice);
  }
  soundState.nextGunStart = new WeakMap();
}
function stopEngineSound() {
  soundState.engineGeneration++;
  soundState.engineStartPending = false;
  if (soundState.engineAudio) {
    const voice = soundState.engineAudio;
    if (voice.source) {
      const now = soundState.audioContext.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, .012);
      try {
        voice.source.stop(now + .06);
      } catch {}
    } else {
      voice.element.pause();
      voice.element.currentTime = 0;
    }
  }
  soundState.engineAudio = null;
  soundState.engineAudioType = null;
}
function startEngineSound(type) {
  resumeGameAudio();
  const kind = type === 'b29' ? 'b29' : PROPELLER_SPECS[type] ? 'prop' : 'jet';
  if (soundState.engineAudioType === kind && (soundState.engineAudio || soundState.engineStartPending)) return;
  stopEngineSound();
  soundState.engineAudioType = kind;
  const generation = soundState.engineGeneration,
    name = kind === 'b29' ? 'b29Engine' : kind === 'prop' ? 'i15Engine' : 'jetEngine';
  soundState.engineStartPending = true;
  const begin = buffer => {
    if (generation !== soundState.engineGeneration) return;
    if (!session.playing || !session.player || session.player.userData.engineRunning === false && (kind !== 'prop' || (session.player.userData.propRpm || 0) === 0)) {
      soundState.engineStartPending = false;
      soundState.engineAudioType = null;
      return;
    }
    soundState.engineStartPending = false;
    if (soundState.audioContext && buffer) {
      const source = soundState.audioContext.createBufferSource(),
        gain = soundState.audioContext.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(soundState.audioMaster);
      const voice = {
        source,
        gain
      };
      soundState.engineAudio = voice;
      source.onended = () => {
        try {
          source.disconnect();
          gain.disconnect();
        } catch {}
      };
      source.start();
      updateEngineAudio();
    } else {
      const element = new Audio(AUDIO_FILES[name]);
      element.loop = true;
      element.preload = 'auto';
      element.volume = 0;
      soundState.engineAudio = {
        element
      };
      updateEngineAudio();
      element.play().catch(() => {});
    }
  };
  if (soundState.audioContext) {
    const buffer = soundState.audioBuffers.get(name);
    if (buffer) begin(buffer);else loadAudioBuffer(name).then(begin);
  } else begin(null);
}
function updateEngineAudio() {
  if (!soundState.engineAudio || !session.player) return;
  const data = session.player.userData,
    throttle = THREE.MathUtils.clamp(data.throttle ?? inputState.throttleValue, 0, 1);
  let volume, rate;
  if (soundState.engineAudioType === 'prop') {
    const fraction = THREE.MathUtils.clamp((data.propRpm || 0) / PROPELLER_SPECS[session.playerPlane].maxRpm, 0, 1);
    volume = (.10 + fraction * .24) * THREE.MathUtils.smoothstep(fraction, 0, .15);
    rate = .65 + fraction * .52;
    if (!data.engineRunning && (data.propRpm || 0) === 0) {
      stopEngineSound();
      return;
    }
  } else {
    if (!data.engineRunning) {
      stopEngineSound();
      return;
    }
    volume = soundState.engineAudioType === 'b29' ? .27 + throttle * .17 : .13 + throttle * .13;
    rate = .84 + .30 * throttle;
  }
  if (soundState.engineAudio.source) {
    const now = soundState.audioContext.currentTime;
    soundState.engineAudio.gain.gain.setTargetAtTime(volume, now, .06);
    soundState.engineAudio.source.playbackRate.setTargetAtTime(rate, now, .1);
  } else {
    soundState.engineAudio.element.volume = volume;
    soundState.engineAudio.element.playbackRate = rate;
  }
}
function gunSoundFor(type, id) {
  return AIRCRAFT_DATA[type].sounds[id] || AIRCRAFT_DATA[type].sounds.default;
}
function syncMenuMusic() {
  const allowed = !document.hidden && !soundState.nativeSuspended && ($('#hud').classList.contains('hidden') || session.ended) && !session.battlePaused;
  if (!soundState.menuMusic) {
    soundState.menuMusic = new Audio('./audio/menu-bgm-1.mp3');
    soundState.menuMusic.loop = true;
    soundState.menuMusic.preload = 'auto';
    soundState.menuMusic.volume = .30;
  }
  if (!allowed) {
    soundState.menuMusic.pause();
    return;
  }
  if (soundState.menuMusic.paused) {
    const attempt = soundState.menuMusic.play();
    if (attempt?.catch) attempt.catch(() => {});
  }
}
function stopMenuMusic() {
  soundState.menuMusic?.pause();
}
