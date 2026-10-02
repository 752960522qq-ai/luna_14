function aircraftCatalogueSpecs(r) {
  const p = r.performance;
  const rows = [['系别', r.tree.nationName], ['等级', r.tree.rank], ['战机权重', r.tree.rating.toFixed(1)], ['机体耐久', String(p.health)], ['最大航速', p.maxSpeedKmh + ' km/h'], ['最小航速', p.minLevelFlightKmh + ' km/h'], ['最佳爬升率', p.bestClimbMps + ' m/s'], ['水平转弯性能', (Number.isInteger(p.turnTimeS) ? p.turnTimeS.toFixed(1) : p.turnTimeS) + '秒'], ['垂直转弯性能', (p.verticalTurnTimeS ?? Number((360 / p.verticalTurnRateDps).toFixed(2))) + '秒']];
  for (const [id, w] of Object.entries(r.weapons)) rows.push([w.label, w.count + '挺 · 合计备弹' + r.ammo[id] + '发 · 单管' + w.rpm + '发/分钟 · 伤害' + w.damage + ' · 弹速' + w.speed + ' m/s']);
  if (r.ammo.b29mg) rows.push(['炮塔武器', '5座炮塔 · 12挺机枪 · 备弹' + r.ammo.b29mg + '发'], ['炸弹挂载', '可在机库选择挂载']);
  return rows;
}
function updateThrottleUI() {
  $('#throttlePercent').textContent = Math.round(inputState.throttleValue * 100) + '%';
  const info = planeInfo[session.playerPlane],
    max = info.maxSpeedKmh,
    min = info.minLevelFlightKmh;
  $('#throttleMax').textContent = '最大 ' + max + ' km/h';
  $('#throttleMin').textContent = '平飞 ' + min + ' km/h';
  $('#throttleMinMark').style.bottom = min / max * 100 + '%';
  $('#throttleFill').style.height = inputState.throttleValue * 100 + '%';
  $('#throttleThumb').style.bottom = inputState.throttleValue * 100 + '%';
}
function updateAmmoUI() {
  const type = session.playerPlane,
    capacity = freshAmmo(type),
    record = AIRCRAFT_DATA[type];
  if (type === 'b29') {
    $('#ammo').textContent = '炮塔 ' + Math.floor(session.playerAmmo.b29mg) + ' / ' + capacity.b29mg + ' · 炸弹 ' + Math.floor(session.playerAmmo.bombs);
    $('#ammoBar').style.width = session.playerAmmo.b29mg / capacity.b29mg * 100 + '%';
    return;
  }
  const ids = Object.keys(weaponInfo[type]),
    current = ids.reduce((n, id) => n + (session.playerAmmo[id] || 0), 0),
    total = ids.reduce((n, id) => n + (capacity[id] || 0), 0);
  $('#ammo').textContent = ids.map(id => {
    const shortName = record.weapons[id].label.match(/mm\s+([A-Za-z0-9-]+)/)?.[1] || id.toUpperCase();
    return shortName + ' ' + Math.floor(session.playerAmmo[id] || 0) + (ids.length === 1 ? ' / ' + capacity[id] : '');
  }).join(' · ');
  $('#ammoBar').style.width = (total ? current / total * 100 : 0) + '%';
}
function updateHealthUI() {
  if (session.gameMode === 'airspace') {
    updateAirspaceHealthUI();
    return;
  }
  const playerMax = planeInfo[session.playerPlane].health;
  $('#playerHealth').style.width = session.hp / playerMax * 100 + '%';
  $('#hpText').textContent = Math.round(session.hp / playerMax * 100) + '%';
  if (session.gameMode === 'campaign') {
    const target = nearestCampaignTarget(),
      targetMax = target?.maxHealth || 2000,
      targetHealth = target?.health || 0;
    $('#enemyHealth').style.width = targetHealth / targetMax * 100 + '%';
    $('#targetName').textContent = target ? target.isBomber ? '目标 · B-29 轰炸机' : '护航 · F-86F-2' : '目标 · 编队已全歼';
    $('#enemyMarker .marker-label').textContent = target ? target.isBomber ? 'B-29' : 'F-86' : '目标完成';
    return;
  }
  const enemyMax = planeInfo[session.enemyPlaneType].health;
  $('#enemyHealth').style.width = session.eHp / enemyMax * 100 + '%';
  $('#targetName').textContent = '敌机 · ' + planeInfo[session.enemyPlaneType].name;
  $('#enemyMarker .marker-label').textContent = planeInfo[session.enemyPlaneType].name;
}
function cycleWeaponMode() {
  if (session.gameMode === 'airspace' && !airspacePlayerAlive()) return;
  if (session.playerPlane !== 'mig15') return;
  session.weaponMode = session.weaponMode === 'n37' ? 'ns23' : session.weaponMode === 'ns23' ? 'both' : 'n37';
  if (session.gameMode === 'airspace') {
    const unit = airspaceUnitFor(session.player);
    if (unit) unit.weaponMode = session.weaponMode;
  }
  updateAmmoUI();
  toast(session.weaponMode === 'n37' ? '武器切换：N-37单炮' : session.weaponMode === 'ns23' ? '武器切换：NS-23双炮' : '武器切换：三炮齐射');
}
function resizePreview() {
  if (!viewState.previewRenderer) return;
  const canvas = $('#previewCanvas'),
    w = Math.max(1, canvas.clientWidth),
    h = Math.max(1, canvas.clientHeight);
  viewState.previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  viewState.previewRenderer.setSize(w, h, false);
  viewState.previewCamera.aspect = w / h;
  viewState.previewCamera.updateProjectionMatrix();
}
function ensureCatalogPreview() {
  if (viewState.previewRenderer) return;
  const canvas = $('#previewCanvas');
  viewState.previewRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false
  });
  viewState.previewScene = new THREE.Scene();
  viewState.previewScene.background = new THREE.Color(0x142536);
  viewState.previewCamera = new THREE.PerspectiveCamera(45, 1, .1, 150);
  viewState.previewScene.add(new THREE.HemisphereLight(0xd8f1ff, 0x36424a, 2.2));
  const light = new THREE.DirectionalLight(0xffedcf, 2.4);
  light.position.set(5, 9, 7);
  viewState.previewScene.add(light);
}
function setCatalogSpecs(type) {
  const info = planeInfo[type];
  if (!info) return;
  viewState.previewType = type;
  document.querySelectorAll('[data-preview-plane]').forEach(button => button.classList.toggle('active', button.dataset.previewPlane === type));
  $('#catalogName').textContent = info.name;
  $('#catalogIntro').textContent = info.intro;
  $('#catalogSpecs').innerHTML = info.specs.map(([label, value]) => '<div class="spec-item"><b>' + label + '</b><span>' + value + '</span></div>').join('');
  ensureCatalogPreview();
  disposeAircraft(viewState.previewPlane);
  viewState.previewPlane = aircraft(false, type, {
    preview: true
  });
  viewState.previewScene.add(viewState.previewPlane);
  const bounds = AIRCRAFT_SPECS[type].collisionMeters,
    span = Math.max(bounds.x, bounds.y, bounds.z) / METERS_PER_UNIT,
    distance = Math.max(2.0, span * .95);
  viewState.previewCamera.position.set(distance * .88, distance * .48, -distance * .9);
  viewState.previewCamera.lookAt(0, 0, 0);
  updateEconomyDisplay();
}
function openCatalog() {
  showMenuScreen('encyclopedia');
  ensureCatalogPreview();
  resizePreview();
  setCatalogSpecs(viewState.previewType);
  resizePreview();
  viewState.previewCamera.lookAt(0, 0, 0);
  viewState.previewRenderer.render(viewState.previewScene, viewState.previewCamera);
}
function closeCatalog() {
  if (viewState.previewRenderer) viewState.previewRenderer.render(viewState.previewScene, viewState.previewCamera);
  showMenuScreen('menu');
}
function toast(t) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 1300);
}
function triggerDamageFlash() {
  const now = performance.now();
  if (viewState.damageFlashTimer !== null || now < viewState.damageFlashNextAt) return;
  viewState.damageFlashNextAt = now + 200;
  const hud = $('#hud');
  hud.classList.add('damage');
  viewState.damageFlashTimer = setTimeout(() => {
    hud.classList.remove('damage');
    viewState.damageFlashTimer = null;
  }, 180);
}
function updateEngineUI() {
  const button = $('#engineToggle'),
    display = $('#propRpm'),
    spec = PROPELLER_SPECS[session.playerPlane];
  button.classList.toggle('hidden', !spec);
  display.classList.toggle('hidden', !spec);
  if (!spec || !session.player) return;
  button.textContent = session.player.userData.engineRunning ? '关闭发动机' : '启动发动机';
  button.setAttribute('aria-pressed', String(session.player.userData.engineRunning));
  display.textContent = '螺旋桨 ' + Math.round(session.player.userData.propRpm) + ' RPM';
}
function togglePlayerEngine() {
  if (!session.playing || !session.player || !PROPELLER_SPECS[session.playerPlane] || session.player.userData.destroyed) return;
  session.player.userData.engineRunning = !session.player.userData.engineRunning;
  if (session.player.userData.engineRunning) startEngineSound(session.playerPlane);
  updateEngineUI();
  toast(session.player.userData.engineRunning ? '发动机启动' : '发动机关闭');
}
function updateEconomyDisplay() {
  document.querySelectorAll('[data-wallet-rp]').forEach(node => node.textContent = profileState.economy.rp.toLocaleString('zh-CN'));
  document.querySelectorAll('[data-wallet-gp]').forEach(node => node.textContent = profileState.economy.gp.toLocaleString('zh-CN'));
  const campaignOwned = profileState.unlockedPlanes.includes('mig15'),
    choose = $('#chooseCampaign'),
    begin = $('#beginCampaign'),
    use = $('#useCatalogPlane');
  if (choose) {
    choose.disabled = !campaignOwned;
    const label = choose.querySelector('span');
    if (label) label.textContent = campaignOwned ? '米格之舞 · 1951·朝鲜 · 6×6公里' : '本版本暂未开放 · 需要 MiG-15';
  }
  if (begin && $('#battleLoading')?.classList.contains('hidden')) begin.disabled = !campaignOwned;
  if (use) {
    use.disabled = !profileState.unlockedPlanes.includes(viewState.previewType);
    use.textContent = use.disabled ? isAircraftResearchOpen(viewState.previewType) ? '请先在研发中解锁' : '本版本暂未开放' : '设为出战机';
  }
  const mode = $('#currentSaveMode');
  if (mode) mode.textContent = profileState.profileMode === 'all-aircraft' ? '全解锁测试存档 · 全部飞机已入库' : '普通存档 · 中、德、美、苏四系 Rank I—II';
}
function handleResearchAircraft(type) {
  const state = aircraftResearchState(type);
  if (state.status === 'unavailable' || state.status === 'invalid') {
    toast('本版本暂未开放此飞机的研发');
    return;
  }
  if (state.status === 'owned') {
    setSelectedAircraft(type);
    renderResearch();
    return;
  }
  if (state.status === 'blocked') {
    toast('先解锁一架 BR ' + state.prerequisite.rating.toFixed(1) + ' 飞机');
    return;
  }
  if (state.status === 'research') {
    const result = investAircraftResearch(type);
    if (result.reason !== 'storage') toast(result.ok ? result.complete ? '研发完成，使用 GP 购买入库' : '已投入 ' + result.amount + ' 研发点' : '研发点不足，请完成对局获得研发点');
  } else if (state.status === 'ready') {
    const result = purchaseResearchedAircraft(type);
    if (result.ok) {
      setSelectedAircraft(type);
      toast(planeInfo[type].name + ' 已入库');
    } else if (result.reason !== 'storage') toast('GP 不足，请完成对局获得 GP');
  }
  updateEconomyDisplay();
  renderHangar();
  renderResearch();
}
function treeVehicleCard(type) {
  const tree = AIRCRAFT_TREE[type],
    selected = profileState.selectedAircraft === type,
    state = aircraftResearchState(type),
    blocked = state.status === 'blocked';
  let status, action;
  if (state.owned) {
    status = selected ? '当前出战' : '已入库';
    action = '选择出战';
  } else if (blocked) {
    status = '需先入库任一 BR ' + state.prerequisite.rating.toFixed(1) + ' 飞机';
    action = '前置未解锁';
  } else if (state.status === 'ready') {
    status = '研发完成 · ' + state.cost.gp.toLocaleString('zh-CN') + ' GP';
    action = profileState.economy.gp >= state.cost.gp ? '购买入库' : 'GP 不足';
  } else {
    status = state.progress + ' / ' + state.cost.rp + ' 研发点 · ' + state.cost.gp.toLocaleString('zh-CN') + ' GP';
    action = profileState.economy.rp > 0 ? '投入研发点' : '等待研发点';
  }
  return '<button class="tech-node' + (selected ? ' selected' : '') + (blocked ? ' research-blocked' : '') + '" data-tree-plane="' + type + '" aria-pressed="' + selected + '"' + (blocked ? ' disabled' : '') + '><span class="node-art">' + aircraftGlyph(type) + '</span><span class="node-copy"><small>BR ' + tree.rating.toFixed(1) + ' · ' + AIRCRAFT_SPECS[type].lengthMeters.toFixed(2) + ' m</small><strong>' + nationFlag(tree.nation) + planeInfo[type].name + '</strong><em>' + status + '</em><span class="research-progress"><i style="width:' + (state.cost.rp ? state.progress / state.cost.rp * 100 : 100) + '%"></i></span><span class="research-action">' + action + '</span></span><span class="node-state">' + tree.rank + ' 阶</span></button>';
}
function renderHangar() {
  const host = $('#hangarList');
  if (!host) return;
  host.innerHTML = profileState.unlockedPlanes.map(type => {
    const info = planeInfo[type],
      tree = AIRCRAFT_TREE[type],
      active = profileState.selectedAircraft === type,
      payloadEditor = type === 'b29' ? '<label class="payload-control">炸弹挂载<select data-bomber-loadout>' + Object.entries(BOMBER_LOADOUTS).map(([id, p]) => '<option value="' + id + '"' + (id === profileState.selectedBombPayload ? ' selected' : '') + '>' + p.count + ' × ' + p.eachLb + ' 磅</option>').join('') + '</select></label><p class="payload-note">默认18×1000磅；5座炮塔共12挺机枪，备弹12000发。</p>' : '';
    return '<article class="hangar-card' + (active ? ' selected' : '') + '"><h3>' + info.name + '</h3><p>' + tree.nationName + ' · BR ' + tree.rating.toFixed(1) + ' · ' + AIRCRAFT_SPECS[type].lengthMeters.toFixed(2) + ' m · ' + info.maxSpeedKmh + ' km/h</p>' + payloadEditor + '<button data-hangar-select="' + type + '">' + (active ? '当前出战机' : '设为出战机') + '</button></article>';
  }).join('');
  host.querySelectorAll('[data-hangar-select]').forEach(b => b.addEventListener('click', () => setSelectedAircraft(b.dataset.hangarSelect)));
  host.querySelector('[data-bomber-loadout]')?.addEventListener('change', event => {
    const before = profileState.selectedBombPayload;
    profileState.selectedBombPayload = event.target.value;
    if (!saveHangar()) {
      profileState.selectedBombPayload = before;
      event.target.value = before;
      reportSaveFailure();
      return;
    }
    if (session.playerPlane === 'b29' && session.playerAmmo?.b29mg !== undefined) {
      session.playerAmmo.bombs = BOMBER_LOADOUTS[profileState.selectedBombPayload].count;
      session.playerAmmo.bombWeightLb = BOMBER_LOADOUTS[profileState.selectedBombPayload].eachLb;
      updateAmmoUI();
    }
  });
  $('#homeSelectedPlane').textContent = planeInfo[profileState.selectedAircraft].name;
}
function aircraftGlyph(type) {
  const bomber = type === 'b29',
    outline = bomber ? 'M60 4 67 19 116 31 116 39 68 34 65 52 82 62 82 66 60 62 38 66 38 62 55 52 52 34 4 39 4 31 53 19Z' : 'M60 6 66 23 113 36 113 42 67 37 65 55 77 64 77 68 60 64 43 68 43 64 55 55 53 37 7 42 7 36 54 23Z';
  return '<svg viewBox="0 0 120 72" role="img" aria-label="' + (bomber ? '轰炸机' : '战斗机') + '轮廓"><defs><linearGradient id="metal-' + type + '" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e0e4d1"/><stop offset=".52" stop-color="#7e958d"/><stop offset="1" stop-color="#3d5559"/></linearGradient></defs><path d="' + outline + '" fill="url(#metal-' + type + ')" stroke="#e6ede0" stroke-opacity=".58" stroke-width="1"/><path d="M60 8v51M55 27h10M57 46h6" fill="none" stroke="#31464a" stroke-width="1.5"/><circle cx="60" cy="27" r="2.3" fill="#d4c17b"/></svg>';
}
function nationFlag(id) {
  return '<svg class="nation-flag" viewBox="0 0 24 16" role="img" aria-label="' + NATIONAL_NAMES[id] + '国旗">' + NATIONAL_FLAGS[id] + '</svg>';
}
function renderResearch() {
  updateEconomyDisplay();
  const host = $('#researchTree'),
    owned = $('#researchOwned');
  if (!host || !owned) return;
  const allNations = [{
    id: 'cn',
    code: 'CHN',
    name: '中系 · 中国',
    types: ['i15bis']
  }, {
    id: 'us',
    code: 'USA',
    name: '美系 · 美国',
    types: ['f3f2', 'p36a']
  }, {
    id: 'ussr',
    code: 'USSR',
    name: '苏系 · 苏联',
    types: ['i15', 'i16', 'mig3']
  }, {
    id: 'de',
    code: 'GER',
    name: '德系 · 德国',
    types: ['bf109b1', 'bf109c1']
  }];
  const nations = allNations.filter(n => profileState.researchNation === 'all' || n.id === profileState.researchNation);
  host.innerHTML = nations.map(n => {
    const ranks = [...new Set(n.types.map(type => AIRCRAFT_TREE[type].rank))].sort((a, b) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].indexOf(a) - ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].indexOf(b));
    const bands = ranks.map(rank => {
      const types = n.types.filter(type => AIRCRAFT_TREE[type].rank === rank),
        branches = [...new Set(types.map(type => AIRCRAFT_TREE[type].branch))];
      const lanes = branches.map(branch => '<div class="branch-row"><span class="branch-label">' + branch + '</span><div class="branch-vehicles">' + types.filter(type => AIRCRAFT_TREE[type].branch === branch).map(treeVehicleCard).join('') + '</div></div>').join('');
      return '<div class="rank-band"><div class="rank-stamp"><b>' + rank + '</b><span>RANK</span></div><div class="rank-lanes">' + lanes + '</div></div>';
    }).join('');
    return '<section class="nation-map"><header class="nation-map-head"><strong>' + nationFlag(n.id) + n.code + '　' + n.name + '</strong><span>' + n.types.length + ' 架可用机型</span></header>' + bands + '</section>';
  }).join('');
  const types = nations.flatMap(n => n.types).filter(type => profileState.unlockedPlanes.includes(type));
  $('#ownedCount').textContent = String(types.length).padStart(2, '0');
  owned.innerHTML = '<div class="owned-list">' + types.map(type => {
    const tree = AIRCRAFT_TREE[type],
      selected = profileState.selectedAircraft === type;
    return '<button class="owned-node' + (selected ? ' selected' : '') + '" data-tree-plane="' + type + '" aria-pressed="' + selected + '"><span class="node-art">' + aircraftGlyph(type) + '</span><span><strong>' + nationFlag(tree.nation) + planeInfo[type].name + '</strong><small>BR ' + tree.rating.toFixed(1) + ' · ' + tree.rank + ' 阶</small></span></button>';
  }).join('') + '</div>';
  document.querySelectorAll('[data-tree-plane]').forEach(button => button.addEventListener('click', () => {
    handleResearchAircraft(button.dataset.treePlane);
  }));
  document.querySelectorAll('[data-nation-filter]').forEach(button => {
    const id = button.dataset.nationFilter;
    button.classList.toggle('active', id === profileState.researchNation);
    button.innerHTML = id === 'all' ? '全部国家' : nationFlag(id) + allNations.find(n => n.id === id).name.split(' · ')[0];
  });
}
function showMenuScreen(id) {
  clearCombatFeedback();
  if (session.combatStats) session.combatStats.active = false;
  $('#playerProfile').classList.add('hidden');
  renderPlayerProfile();
  clearProjectileSmoke();
  session.airspacePrepareToken++;
  setBattleLoading(false);
  $('#beginCampaign').disabled = false;
  $('#chooseAIBattle').disabled = false;
  $('#airspaceLoadStatus').textContent = '';
  stopEngineSound();
  clearFlightInputs();
  session.battlePaused = false;
  session.playing = false;
  stopGunSounds();
  ['menu', 'settings', 'modeSelect', 'campaignBriefing', 'hangar', 'research', 'encyclopedia', 'end'].forEach(n => $('#' + n).classList.toggle('hidden', n !== id));
  $('#hud').classList.add('hidden');
  $('#campaignHud').classList.add('hidden');
  updateEconomyDisplay();
  if (id === 'hangar') renderHangar();
  if (id === 'research') renderResearch();
  if (id === 'settings') renderControlSettings();
  retryPendingRewards();
  syncMenuMusic();
}
function renderSortieUI() {
  $('#battleResults').classList.add('hidden');
  updateAmmoUI();
  updateThrottleUI();
  updateHealthUI();
  updateEngineUI();
  for (const id of ['menu', 'settings', 'modeSelect', 'campaignBriefing', 'hangar', 'research', 'encyclopedia', 'end']) $('#' + id).classList.add('hidden');
  $('#hud').classList.remove('hidden');
  updateCampaignHud();
  toast(session.gameMode === 'airspace' ? '空域争夺 · 5 V 5 · 抢占 A 点' : session.gameMode === 'campaign' ? '米格之舞：1951·朝鲜' : '进入战区 · ' + MAP_LIBRARY[mapState.activeMapId].name);
}
