planeDracoLoader.setDecoderPath('./draco/');
planeModelLoader.setDRACOLoader(planeDracoLoader);
addEventListener('resize', resize);
for (const b of document.querySelectorAll('[data-key]')) {
  const k = b.dataset.key;
  const down = e => {
      if (!session.playing || session.gameMode === 'airspace' && session.airspaceSpectating && k !== 'look' || e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      inputState.keys[k] = true;
      b.classList.add('on');
      try {
        b.setPointerCapture(e.pointerId);
      } catch {}
    },
    up = e => {
      e.preventDefault();
      inputState.keys[k] = false;
      b.classList.remove('on');
    };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
}
window.addEventListener('keydown', e => {
  if (session.playing && session.gameMode === 'airspace' && session.airspaceSpectating && ['q', 'e'].includes(e.key.toLowerCase())) {
    cycleAirspaceSpectator(e.key.toLowerCase() === 'q' ? -1 : 1);
    e.preventDefault();
    return;
  }
  if (session.playing && e.key.toLowerCase() === 'x') {
    cycleWeaponMode();
    e.preventDefault();
    return;
  }
  setKey(e, true);
});
window.addEventListener('keyup', e => setKey(e, false));
document.querySelectorAll('[data-preview-plane]').forEach(b => b.addEventListener('click', () => setCatalogSpecs(b.dataset.previewPlane)));
$('#weaponSelect').addEventListener('click', cycleWeaponMode);
$('#engineToggle').addEventListener('click', togglePlayerEngine);
$('#openHangar').addEventListener('click', () => showMenuScreen('hangar'));
$('#openResearch').addEventListener('click', () => showMenuScreen('research'));
$('#hangarHome').addEventListener('click', () => showMenuScreen('menu'));
$('#researchHome').addEventListener('click', () => showMenuScreen('menu'));
$('#hangarSortie').addEventListener('click', () => showMenuScreen('modeSelect'));
$('#openEncyclopedia').addEventListener('click', openCatalog);
$('#closeEncyclopedia').addEventListener('click', closeCatalog);
$('#useCatalogPlane').addEventListener('click', () => {
  setSelectedAircraft(viewState.previewType);
  showMenuScreen('menu');
});
document.querySelectorAll('[data-nation-filter]').forEach(b => b.addEventListener('click', () => {
  profileState.researchNation = b.dataset.nationFilter;
  renderResearch();
}));
$('#start').addEventListener('click', () => showMenuScreen('modeSelect'));
$('#modeHome').addEventListener('click', () => showMenuScreen('menu'));
$('#chooseAIBattle').addEventListener('click', prepareAirspaceBattle);
$('#spectatePrevious').addEventListener('click', () => cycleAirspaceSpectator(-1));
$('#spectateNext').addEventListener('click', () => cycleAirspaceSpectator(1));
$('#chooseCampaign').addEventListener('click', () => showMenuScreen('campaignBriefing'));
$('#campaignBack').addEventListener('click', () => showMenuScreen('modeSelect'));
$('#beginCampaign').addEventListener('click', prepareCampaignBattle);
$('#again').addEventListener('click', () => session.battlePaused && !session.ended ? resumeBattle() : session.gameMode === 'campaign' ? prepareCampaignBattle() : session.gameMode === 'airspace' ? prepareAirspaceBattle() : reset());
$('#returnHome').addEventListener('click', () => showMenuScreen('menu'));
window.showPause = () => {
  if (!$('#settings').classList.contains('hidden')) {
    showMenuScreen('menu');
    return;
  }
  if (session.playing) {
    session.battlePaused = true;
    session.pausedEngineRunning = session.player.userData.engineRunning !== false;
    session.playing = false;
    clearFlightInputs();
    session.player.userData.engineRunning = false;
    stopGunSounds();
    stopEngineSound();
    $('#again').textContent = '继续战斗　→';
    $('#end').classList.remove('hidden');
    $('#resultTitle').textContent = '任务暂停';
    $('#resultCopy').textContent = '点击继续战斗返回当前空战。';
  } else if (session.ended) reset();
  syncMenuMusic();
};
$('#openSettings').addEventListener('click', () => showMenuScreen('settings'));
$('#settingsHome').addEventListener('click', () => showMenuScreen('menu'));
$('#importProfile').addEventListener('click', () => $('#profileFile').click());
$('#profileFile').addEventListener('change', async event => {
  const file = event.target.files?.[0], status = $('#profileImportStatus');
  if (!file) return;
  if (file.size > 128 * 1024) {
    status.textContent = '存档文件过大，请选择 1.0 版 JSON 存档。';
    event.target.value = '';
    return;
  }
  try {
    const result = importProgressionProfile(await file.text());
    status.textContent = result.ok ? '导入成功 · ' + result.count + ' 架飞机已入库' :
      result.reason === 'storage' ? '保存失败，原有进度已保留。' :
      result.reason === 'battle' ? '请先退出当前对局，再导入存档。' : '存档格式或版本不匹配，仅支持 1.0 版存档。';
  } catch { status.textContent = '无法读取存档文件，原有进度已保留。'; }
  event.target.value = '';
});
document.querySelectorAll('[name="flightControlMode"]').forEach(input => input.addEventListener('change', () => {
  if (input.checked) changeControlMode(input.value);
}));
$('#cursorSensitivity').addEventListener('input', event => {
  inputState.controlSettings.sensitivity = THREE.MathUtils.clamp(Number(event.target.value) || 1, .5, 1.8);
  saveControlSettings();
  renderControlSettings();
});
window.addEventListener('blur', clearFlightInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session.playing) window.showPause();else clearFlightInputs();
  syncMenuMusic();
});
window.addEventListener('resize', clearFlightInputs);
renderControlSettings();
prepareGameAudio();
window.addEventListener('pointerdown', resumeGameAudio, {
  passive: true
});
window.addEventListener('keydown', resumeGameAudio, {
  passive: true
});
window.addEventListener('pointerup', stopPendingGunSounds, {
  passive: true
});
window.addEventListener('pointercancel', stopPendingGunSounds, {
  passive: true
});
window.addEventListener('keyup', stopPendingGunSounds, {
  passive: true
});
loadProgressionProfile();
init();
renderHangar();
showMenuScreen('menu');
window.onNativePause=()=>{soundState.nativeSuspended=true;stopMenuMusic();if(session.playing)window.showPause();stopGunSounds();stopEngineSound()};
window.onNativeResume=()=>{soundState.nativeSuspended=false;syncMenuMusic();resumeGameAudio()};
