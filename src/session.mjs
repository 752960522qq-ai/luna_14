function spawnEnemy(position = null, orientation = null) {
  session.enemyPlaneType = chooseDuelOpponent(session.playerPlane);
  session.enemy = aircraft(false, session.enemyPlaneType);
  session.enemy.userData.engineRunning = true;
  viewState.scene.add(session.enemy);
  session.enemy.position.copy(position || session.player.position.clone().add(new THREE.Vector3((Math.random() - .5) * 35, Math.random() * 12 - 6, -105)));
  session.enemy.quaternion.copy(orientation || session.player.quaternion);
  session.enemy.userData.velocity.set(0, 0, -1).applyQuaternion(session.enemy.quaternion).multiplyScalar(session.enemy.userData.airspeed / METERS_PER_UNIT);
  session.eHp = planeInfo[session.enemyPlaneType].health;
  session.enemyAmmo = freshAmmo(session.enemyPlaneType);
  session.enemyWeaponMode = session.enemyPlaneType === 'mig15' ? ['n37', 'ns23', 'both'][Math.floor(Math.random() * 3)] : session.enemyPlaneType === 'meteor' ? 'hispano' : 'mg';
  session.enemyWeaponCooldowns = {
    mg: 0,
    m2: 0,
    mg762: 0,
    n37: 0,
    ns23: 0,
    hispano: 0
  };
  if (session.enemyPlaneType === 'b29') session.enemy.userData.patrolPhase = 0;else initializeFighterAI(session.enemy, 'duel', 0);
  updateHealthUI();
}
function init() {
  viewState.scene = new THREE.Scene();
  viewState.scene.background = new THREE.Color(0x83b9d1);
  viewState.scene.fog = new THREE.Fog(0x9bbfce, 170, 620);
  viewState.camera = new THREE.PerspectiveCamera(63, innerWidth / innerHeight, .02, 1400);
  viewState.renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false
  });
  viewState.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  viewState.renderer.setSize(innerWidth, innerHeight);
  viewState.renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewState.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  sceneRoot.replaceChildren(viewState.renderer.domElement);
  mapState.mapHemisphere = new THREE.HemisphereLight(0xdaf5ff, 0x596c74, 2.3);
  viewState.scene.add(mapState.mapHemisphere);
  mapState.mapSun = new THREE.DirectionalLight(0xffedcf, 2.5);
  mapState.mapSun.position.set(90, 150, -70);
  viewState.scene.add(mapState.mapSun);
  bindFlightControls();
  mapState.groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200, 1, 1), mat(0x286379, .86, .12));
  mapState.groundPlane.rotation.x = -Math.PI / 2;
  mapState.groundPlane.position.y = -90.15;
  viewState.scene.add(mapState.groundPlane);
  for (let i = 0; i < 36; i++) {
    const cloud = new THREE.Group(),
      material = new THREE.MeshLambertMaterial({
        color: 0xf1f5f0,
        transparent: true,
        opacity: .81,
        depthWrite: false
      });
    for (let j = 0; j < 5; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), material);
      puff.position.set((Math.random() - .5) * 22, (Math.random() - .5) * 2, (Math.random() - .5) * 17);
      puff.scale.set(6 + Math.random() * 6, 1.3 + Math.random() * 1.8, 4 + Math.random() * 4);
      cloud.add(puff);
    }
    cloud.position.set((Math.random() - .5) * 860, 50 + Math.random() * 125, (Math.random() - .5) * 900);
    cloud.userData.range = 430;
    cloud.userData.drift = 3 + Math.random() * 8;
    viewState.scene.add(cloud);
    mapState.clouds.push(cloud);
  }
  session.player = aircraft(true, session.playerPlane);
  viewState.scene.add(session.player);
  session.player.position.copy(blueSpawn);
  spawnEnemy(redSpawn.clone(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  viewState.clock = new THREE.Clock();
  resize();
  animate();
}
function resize() {
  if (!viewState.renderer) return;
  viewState.camera.aspect = innerWidth / innerHeight;
  viewState.camera.updateProjectionMatrix();
  viewState.renderer.setSize(innerWidth, innerHeight);
  resizePreview();
}
function reset(options = {}) {
  stopMenuMusic();
  retryPendingRewards();
  beginSortieEconomy();
  session.battleSimulationAccumulator = 0;
  session.battleHudElapsed = Infinity;
  inputState.throttleValue = 1;
  resetDuelBoundary();
  session.battlePaused = false;
  clearFlightInputs();
  $('#again').textContent = '再次升空　→';
  stopGunSounds();
  stopEngineSound();
  session.playerPlane = session.gameMode === 'campaign' ? 'mig15' : profileState.selectedAircraft;
  resetCameraTracking();
  if (!viewState.scene) init();
  clearBattleWorld();
  setBattleMap(session.gameMode === 'campaign' || session.gameMode === 'airspace' ? 'korea1951' : Math.random() < .5 ? 'openSea' : 'korea1951');
  mapState.groundPlane.scale.setScalar(session.gameMode === 'airspace' ? 600 / 2200 : 1);
  inputState.keys.bomb = false;
  inputState.bombKeyWasDown = false;
  initializeSortiePlayer();
  session.ended = false;
  session.playing = !options.preparing;
  if (session.playing) startEngineSound(session.playerPlane);
  session.campaignTimeRemaining = CAMPAIGN_DURATION;
  session.campaignResupplyRemaining = CAMPAIGN_RESUPPLY_INTERVAL;
  if (session.gameMode === 'airspace') startAirspaceBattle();else if (session.gameMode === 'campaign') startCampaign();else {
    session.campaignElapsed = 0;
    spawnEnemy(redSpawn.clone(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  }
  renderSortieUI();
  syncMenuMusic();
  viewState.clock.getDelta();
}
function damage(target, n, campaignTarget = null) {
  if (session.gameMode === 'airspace') {
    damageAirspaceUnit(target === 'player' ? airspaceUnitFor(session.player) : campaignTarget || airspaceUnitFor(session.enemy), n);
    return;
  }
  if (target === 'enemy' && session.gameMode === 'campaign' && campaignTarget) {
    damageCampaignTarget(campaignTarget, n);
    return;
  }
  if (target === 'enemy') {
    session.eHp = Math.max(0, session.eHp - n);
    $('#enemyHealth').style.width = session.eHp / planeInfo[session.enemyPlaneType].health * 100 + '%';
    if (session.eHp === 0) {
      playSfx('kill', .35);
      session.kills++;
      $('#kills').textContent = String(session.kills).padStart(2, '0');
      toast('敌机击落');
      const spawn = redSpawn.clone().add(new THREE.Vector3((Math.random() - .5) * 24, 0, (Math.random() - .5) * 24)),
        rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      retireAircraft(session.enemy);
      spawnEnemy(spawn, rot);
      if (session.kills >= 3) finish(true);
    }
  } else {
    session.hp = Math.max(0, session.hp - n);
    $('#playerHealth').style.width = session.hp / planeInfo[session.playerPlane].health * 100 + '%';
    $('#hpText').textContent = Math.round(session.hp / planeInfo[session.playerPlane].health * 100) + '%';
    triggerDamageFlash();
    if (session.hp === 0) finish(false);
  }
}
function finish(win) {
  if (session.ended) return;
  if (session.gameMode === 'airspace') {
    finishAirspaceBattle(win === null ? null : win ? 'blue' : 'red');
    return;
  }
  resetDuelBoundary();
  session.battlePaused = false;
  clearFlightInputs();
  session.playing = false;
  session.ended = true;
  if (session.player) {
    session.player.userData.engineRunning = false;
    if (session.hp <= 0) session.player.userData.destroyed = true;
  }
  if (session.enemy) session.enemy.userData.engineRunning = false;
  for (const target of campaignTargets()) target.root.userData.engineRunning = false;
  stopGunSounds();
  stopEngineSound();
  updateCampaignHud();
  if (session.gameMode === 'campaign') {
    $('#resultTitle').textContent = win ? '战役胜利' : '任务失败';
    $('#resultCopy').textContent = win ? '米格之舞完成：3架 B-29 均已击落。' : session.hp <= 0 ? 'MIG-15 已被击落，南市空战失败。' : '300秒时限已到，仍有 B-29 未被击落。';
  } else {
    $('#resultTitle').textContent = win ? '王牌飞行员' : '任务失败';
    $('#resultCopy').textContent = win ? `空战战果：${session.kills} 架。你已夺取局部制空权。` : `你击落了 ${session.kills} 架敌机。整备机体，再次出击。`;
  }
  $('#end').classList.remove('hidden');
  settleSortieEconomy(win);
}
function updateNonAirspaceStep(dt) {
  profileState.battleRewardSeconds += dt;
  session.worldTime += dt;
  rememberAircraftFrameStart();
  updateAllPropellers(dt);
  updatePlayerFlightControls(dt);
  if (session.player.position.y < terrainHeightAt(session.player.position.x, session.player.position.z)) {
    session.hp = 0;
    updateHealthUI();
    finish(false);
  }
  if (session.playing) {
    if (session.gameMode === 'campaign') updateCampaign(dt);else updateDuelEnemy(dt);
  }
  if (session.playing) updateDuelBoundary(dt);
  if (session.playing) {
    updateCursorTarget(dt);
    fireWeapons(session.player, false, dt, inputState.keys.fire);
    if (inputState.keys.bomb && !inputState.bombKeyWasDown) dropBomb();
    inputState.bombKeyWasDown = inputState.keys.bomb;
    updateDroppedBombs(dt);
    if (session.gameMode === 'duel') {
      fireBomberTurrets(session.player, false, dt);
      fireBomberTurrets(session.enemy, true, dt);
    }
    const campaignShotTargets = session.gameMode === 'campaign' ? campaignTargets() : null;
    updateProjectileSmoke(dt);
    for (let i = session.bullets.length - 1; i >= 0; i--) {
      const bullet = session.bullets[i];
      (bullet.previousPosition ??= new THREE.Vector3()).copy(bullet.mesh.position);
      const shotStep = Math.min(dt, Math.max(0, bullet.life));
      bullet.mesh.position.addScaledVector(bullet.dir, bullet.speed * shotStep);
      bullet.life -= dt;
      traceBulletSmoke(bullet, dt);
      let hit = false;
      if (bullet.enemy) {
        if (sweptAircraftHit(bullet.previousPosition, bullet.mesh.position, session.player, bullet.radius)) {
          damage('player', bullet.damage);
          hit = true;
        }
      } else if (session.gameMode === 'campaign') {
        for (const target of campaignShotTargets) {
          if (sweptAircraftHit(bullet.previousPosition, bullet.mesh.position, target.root, bullet.radius)) {
            damage('enemy', bullet.damage, target);
            hit = true;
            break;
          }
        }
      } else if (session.enemy && sweptAircraftHit(bullet.previousPosition, bullet.mesh.position, session.enemy, bullet.radius)) {
        damage('enemy', bullet.damage);
        hit = true;
      }
      if (hit || bullet.life <= 0) releaseBullet(i);
      if (!session.playing) break;
    }
  }
}
// Fixed simulation keeps the entire active frame interval, with bounded catch-up.

function shouldUpdateBattleHUD(dt) {
  session.battleHudElapsed += dt;
  if (session.battleHudElapsed + 1e-9 < BATTLE_TIMING.hudIntervalSeconds) return false;
  session.battleHudElapsed = 0;
  return true;
}
function activeBattleAircraft() {
  if (session.gameMode === 'airspace') return airspaceLiveUnits().map(unit => unit.root);
  return [session.player, ...(session.gameMode === 'campaign' ? campaignTargets().map(target => target.root) : [session.enemy])].filter(Boolean);
}
function applyBattleRenderPose() {
  session.battleRenderRoots.length = 0;
  const step = session.gameMode === 'airspace' ? AIRSPACE_RULES.stepSeconds : BATTLE_TIMING.stepSeconds;
  const remainder = session.gameMode === 'airspace' ? session.airspaceAccumulator : session.battleSimulationAccumulator;
  const alpha = THREE.MathUtils.clamp(remainder / step, 0, 1);
  for (const root of activeBattleAircraft()) {
    const data = root.userData;
    if (!data.renderPreviousPosition) continue;
    (data.renderActualPosition ??= new THREE.Vector3()).copy(root.position);
    (data.renderActualQuaternion ??= new THREE.Quaternion()).copy(root.quaternion);
    root.position.lerpVectors(data.renderPreviousPosition, data.renderActualPosition, alpha);
    root.quaternion.copy(data.renderPreviousQuaternion).slerp(data.renderActualQuaternion, alpha);
    session.battleRenderRoots.push(root);
  }
}
function restoreBattlePhysicsPose() {
  for (const root of session.battleRenderRoots) {
    root.position.copy(root.userData.renderActualPosition);
    root.quaternion.copy(root.userData.renderActualQuaternion);
  }
  session.battleRenderRoots.length = 0;
}
function advanceBattleSimulation(elapsed) {
  if (!session.playing) return;
  session.battleSimulationAccumulator += elapsed;
  let steps = 0;
  while (session.battleSimulationAccumulator >= BATTLE_TIMING.stepSeconds - 1e-9 && steps < BATTLE_TIMING.maxStepsPerFrame && session.playing) {
    updateNonAirspaceStep(BATTLE_TIMING.stepSeconds);
    session.battleSimulationAccumulator = Math.max(0, session.battleSimulationAccumulator - BATTLE_TIMING.stepSeconds);
    steps++;
  }
}
function setBattleLoading(active, message = '正在准备战区…') {
  const overlay = $('#battleLoading');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !active);
  $('#battleLoadingText').textContent = message;
}
async function warmBattleRenderer() {
  const roots = activeBattleAircraft(),
    types = [...new Set(roots.map(root => root.userData.type))],
    warmMeshes = [];
  try {
    await Promise.all(types.map(loadPlaneModel));
    await Promise.all(roots.map(root => root.userData.modelReady));
    for (const root of roots) if (!root.userData.disposed && (!root.userData.modelAttached || root.userData.modelError)) throw new Error('战机初始化失败：' + root.userData.type);
    updateChaseCamera(0);
    for (const type of types) for (const id of Object.keys(weaponInfo[type] || {})) {
      const resource = ensureBulletResources(type, id),
        mesh = new THREE.Mesh(resource.geometry, resource.material);
      mesh.position.copy(session.player.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(session.player.quaternion));
      mesh.scale.setScalar(.001);
      mesh.frustumCulled = false;
      viewState.scene.add(mesh);
      warmMeshes.push(mesh);
    }
    if (viewState.renderer.compileAsync) await viewState.renderer.compileAsync(viewState.scene, viewState.camera);else if (viewState.renderer.compile) viewState.renderer.compile(viewState.scene, viewState.camera);
    viewState.renderer.render(viewState.scene, viewState.camera);
  } finally {
    for (const mesh of warmMeshes) mesh.removeFromParent();
  }
}
function animate() {
  requestAnimationFrame(animate);
  if (!viewState.scene) return;
  const elapsed = Math.max(0, viewState.clock.getDelta()),
    visualDt = Math.min(elapsed, .1);
  if (!session.playing && !session.battlePaused) {
    updateProjectileSmoke(elapsed);
    if (session.gameMode === 'airspace') {
      for (const unit of session.airspaceUnits) if (!unit.dead) updatePropeller(unit.root, elapsed);
    } else updateAllPropellers(elapsed);
  }
  if (session.gameMode === 'airspace' && session.airspaceState) advanceAirspaceSimulation(elapsed);else if (session.playing) advanceBattleSimulation(elapsed);else session.worldTime += elapsed;
  applyBattleRenderPose();
  try {
    if (session.gameMode === 'airspace' && session.airspaceState) {
      updateAirspaceFrame(0, visualDt);
      updateAllPropellers(visualDt);
    } else if (session.player && viewState.camera) {
      updateChaseCamera(visualDt);
      if (session.playing && shouldUpdateBattleHUD(visualDt)) {
        if (session.gameMode === 'campaign') updateCampaignHud();
        updateTacticalDisplay();
        $('#speed').textContent = Math.round(session.player.userData.airspeed * 3.6);
        $('#throttlePercent').textContent = Math.round(inputState.throttleValue * 100) + '%';
        $('#throttleControl').setAttribute('aria-valuenow', String(Math.round(inputState.throttleValue * 100)));
        $('#alt').textContent = Math.max(0, Math.round((session.player.position.y + 90) * METERS_PER_UNIT)) + ' m';
        const degrees = session.player.userData.aoa * 180 / Math.PI;
        $('#aoa').textContent = degrees.toFixed(1) + '°';
        $('#aoa').classList.toggle('warning', Math.abs(degrees) > 14);
        if (PROPELLER_SPECS[session.playerPlane]) updateEngineUI();
      }
      if (session.playing) updateEngineAudio();
    }
    mapState.clouds.forEach(cloud => {
      cloud.position.x += cloud.userData.drift * visualDt;
      if (cloud.position.x > cloud.userData.range) cloud.position.x = -cloud.userData.range;
    });
    viewState.renderer.render(viewState.scene, viewState.camera);
    if (viewState.previewRenderer && !$('#encyclopedia').classList.contains('hidden')) {
      if (viewState.previewPlane) viewState.previewPlane.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), session.worldTime * .32);
      viewState.previewCamera.lookAt(0, 0, 0);
      viewState.previewRenderer.render(viewState.previewScene, viewState.previewCamera);
    }
  } finally {
    restoreBattlePhysicsPose();
  }
}
// One owned aircraft opens the next BR stage, across all national branches.

function clearBattleWorld() {
  disposeAircraft(session.player);
  disposeAircraft(session.enemy);
  clearCampaignEntities();
  clearAirspaceEntities();
  for (const wreck of resourceState.wreckedAircraft) disposeAircraft(wreck.root);
  resourceState.wreckedAircraft.length = 0;
  for (const bomb of session.bombsInFlight) disposeBomb(bomb);
  session.bombsInFlight.length = 0;
  for (let i = session.bullets.length - 1; i >= 0; i--) releaseBullet(i);
  clearProjectileSmoke();
  session.player = null;
  session.enemy = null;
}
function initializeSortiePlayer() {
  session.player = aircraft(true, session.playerPlane);
  viewState.scene.add(session.player);
  session.player.position.copy(blueSpawn);
  session.player.quaternion.identity();
  resetCursorControl();
  const speed = Math.max(session.player.userData.minFlightSpeedMps * 1.12, session.player.userData.maxSpeedMps * .68);
  session.player.userData.airspeed = speed;
  session.player.userData.velocity.set(0, 0, -speed / METERS_PER_UNIT);
  session.player.userData.throttle = inputState.throttleValue;
  session.player.userData.engineRunning = true;
  session.weaponMode = session.playerPlane === 'mig15' ? 'both' : session.playerPlane === 'meteor' ? 'hispano' : 'mg';
  session.playerAmmo = freshAmmo(session.playerPlane);
  session.playerWeaponCooldowns = {};
  session.hp = planeInfo[session.playerPlane].health;
  session.kills = 0;
  $('#kills').textContent = '00';
}
