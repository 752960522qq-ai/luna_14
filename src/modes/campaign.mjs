function campaignTargets() {
  return [...session.campaignBombers, ...session.campaignEscorts];
}
function nearestCampaignTarget() {
  if (!session.player) return null;
  let nearest = null,
    nearestDistance = Infinity;
  for (const target of campaignTargets()) {
    const distance = target.root.position.distanceToSquared(session.player.position);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  return nearest;
}
function updateCampaignHud() {
  const active = session.gameMode === 'campaign' && session.playing;
  $('#campaignHud').classList.toggle('hidden', !active);
  if (!active) return;
  const seconds = Math.max(0, Math.ceil(session.campaignTimeRemaining)),
    minutes = Math.floor(seconds / 60),
    remainder = seconds % 60;
  $('#campaignTimer').textContent = String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
  $('#campaignBomberCount').textContent = session.campaignBombers.length;
  $('#campaignEscortCount').textContent = session.campaignEscorts.length;
  $('#campaignResupply').textContent = Math.max(0, Math.ceil(session.campaignResupplyRemaining));
}
function spawnCampaignBomber(position, id) {
  const root = aircraft(false, 'b29');
  root.position.copy(position);
  root.quaternion.identity();
  const speed = 320 / 3.6;
  root.userData.airspeed = speed;
  root.userData.velocity.set(0, 0, -speed / METERS_PER_UNIT);
  root.userData.throttle = 320 / 575;
  root.userData.engineRunning = true;
  root.userData.bomberGunsActive = false;
  root.userData.bomberGunClock = 0;
  viewState.scene.add(root);
  const target = {
    root,
    health: 5000,
    maxHealth: 5000,
    isBomber: true,
    id
  };
  session.campaignBombers.push(target);
  return target;
}
function spawnCampaignEscort() {
  if (session.campaignEscorts.length >= CAMPAIGN_ESCORT_LIMIT || session.campaignBombers.length === 0) return null;
  const lead = session.campaignBombers[0].root,
    center = lead.position,
    index = session.campaignEscortSerial++,
    angle = index * 2.399963229728653,
    radius = 36 + index % 3 * 6,
    slot = new THREE.Vector3(Math.cos(angle) * radius, (index % 3 - 1) * 2, Math.sin(angle) * radius),
    position = center.clone().add(slot.clone().applyQuaternion(lead.quaternion));
  const root = aircraft(false, 'f86');
  root.position.copy(position);
  root.quaternion.copy(lead.quaternion);
  const data = root.userData;
  data.campaignCruiseKmh = 400 + index % 5 * 20;
  data.airspeed = data.campaignCruiseKmh / 3.6;
  data.velocity.set(0, 0, -data.airspeed / METERS_PER_UNIT).applyQuaternion(root.quaternion);
  data.throttle = data.campaignCruiseKmh / planeInfo.f86.maxSpeedKmh;
  data.ammo = freshAmmo('f86');
  data.weaponCooldowns = {
    mg: 0,
    n37: 0,
    ns23: 0,
    hispano: 0
  };
  data.weaponMode = 'mg';
  data.escortSerial = index;
  const ai = initializeFighterAI(root, 'escort', index);
  ai.formationRoot = lead;
  ai.formationOffset.copy(slot);
  viewState.scene.add(root);
  const escort = {
    root,
    health: planeInfo.f86.health,
    maxHealth: planeInfo.f86.health,
    isBomber: false,
    id: index + 1
  };
  session.campaignEscorts.push(escort);
  return escort;
}
function startCampaign() {
  session.campaignBombers.length = 0;
  session.campaignEscorts.length = 0;
  session.campaignRespawns.length = 0;
  session.campaignElapsed = 0;
  session.campaignTimeRemaining = CAMPAIGN_DURATION;
  session.campaignResupplyRemaining = CAMPAIGN_RESUPPLY_INTERVAL;
  session.campaignEscortSerial = 0;
  session.campaignBomberPhase = 0;
  session.enemy = null;
  session.enemyPlaneType = 'b29';
  const lead = session.player.position.clone().add(new THREE.Vector3(0, -8, -155));
  spawnCampaignBomber(lead, 1);
  spawnCampaignBomber(lead.clone().add(new THREE.Vector3(-22, 0, 14)), 2);
  spawnCampaignBomber(lead.clone().add(new THREE.Vector3(23, -1, 17)), 3);
  for (let i = 0; i < CAMPAIGN_ESCORT_LIMIT; i++) spawnCampaignEscort();
  updateHealthUI();
  updateCampaignHud();
  toast('战役开始：击落3架B-29');
}
function updateCampaignEscortAI(dt) {
  if (!session.player || !session.campaignBombers.length) return;
  const lead = session.campaignBombers[0].root,
    center = lead.position;
  for (const escort of [...session.campaignEscorts]) {
    escort.root.userData.ai.formationRoot = lead;
    updateFighterAI(escort.root, session.player, center, dt);
    if (escort.health > 0 && escort.root.position.y < terrainHeightAt(escort.root.position.x, escort.root.position.z)) damageCampaignTarget(escort, escort.health);
  }
}
function updateCampaignBomberFlight(dt) {
  // Keep the 3 bombers and their escorts inside the 6 km map for the full 5-minute mission.
  const radius = 130,
    angularSpeed = 320 / 3.6 / METERS_PER_UNIT / radius;
  session.campaignBomberPhase -= angularSpeed * dt;
  const phase = session.campaignBomberPhase,
    center = new THREE.Vector3(-130, 52, -55),
    forward = new THREE.Vector3(Math.sin(phase), 0, -Math.cos(phase)),
    right = new THREE.Vector3(Math.cos(phase), 0, Math.sin(phase)),
    formation = {
      1: [0, 0, 0],
      2: [-22, 0, 14],
      3: [23, -1, 17]
    };
  const lead = center.add(new THREE.Vector3(radius * Math.cos(phase), 0, radius * Math.sin(phase)));
  for (const target of session.campaignBombers) {
    const [side, up, behind] = formation[target.id],
      next = lead.clone().addScaledVector(right, side).addScaledVector(forward, -behind);
    next.y += up;
    target.root.userData.velocity.copy(next).sub(target.root.position).divideScalar(dt);
    target.root.position.copy(next);
    target.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), forward);
    target.root.userData.airspeed = target.root.userData.velocity.length() * METERS_PER_UNIT;
  }
}
function updateCampaign(dt) {
  session.campaignElapsed += dt;
  session.campaignTimeRemaining = Math.max(0, CAMPAIGN_DURATION - session.campaignElapsed);
  session.campaignResupplyRemaining -= dt;
  updateCampaignBomberFlight(dt);
  if (session.campaignResupplyRemaining <= 0) {
    session.campaignResupplyRemaining += CAMPAIGN_RESUPPLY_INTERVAL;
    session.playerAmmo = freshAmmo('mig15');
    session.playerWeaponCooldowns = {
      mg: 0,
      m2: 0,
      mg762: 0,
      n37: 0,
      ns23: 0,
      hispano: 0
    };
    updateAmmoUI();
    toast('战役补给：弹药已补满');
  }
  for (let i = session.campaignRespawns.length - 1; i >= 0 && session.campaignEscorts.length < CAMPAIGN_ESCORT_LIMIT; i--) {
    if (session.campaignRespawns[i] <= session.campaignElapsed) {
      session.campaignRespawns.splice(i, 1);
      spawnCampaignEscort();
      toast('F-86护航机已补入编队');
    }
  }
  if (session.campaignTimeRemaining <= 0) {
    finish(false);
    return;
  }
  updateCampaignEscortAI(dt);
}
function damageCampaignTarget(target, n) {
  if (!target || target.health <= 0) return;
  target.health = Math.max(0, target.health - n);
  if (target.health > 0) {
    updateHealthUI();
    return;
  }
  retireAircraft(target.root);
  const list = target.isBomber ? session.campaignBombers : session.campaignEscorts,
    index = list.indexOf(target);
  if (index >= 0) list.splice(index, 1);
  playSfx('kill', .35);
  session.kills++;
  $('#kills').textContent = String(session.kills).padStart(2, '0');
  if (target.isBomber) toast('B-29击落 · 剩余 ' + session.campaignBombers.length + ' 架');else {
    session.campaignRespawns.push(session.campaignElapsed + CAMPAIGN_ESCORT_RESPAWN);
    toast('F-86被击落 · 30秒内补充');
  }
  updateCampaignHud();
  updateHealthUI();
  if (session.campaignBombers.length === 0) finish(true);
}
function clearCampaignEntities() {
  for (const target of campaignTargets()) disposeAircraft(target.root);
  for (const node of viewState.campaignMarkerNodes.values()) node.remove();
  viewState.campaignMarkerNodes.clear();
  session.campaignBombers.length = 0;
  session.campaignEscorts.length = 0;
  session.campaignRespawns.length = 0;
}
function updateCampaignEnemyMarkers() {
  const layer = $('#campaignEnemyMarkers'),
    single = $('#enemyMarker'),
    targets = campaignTargets(),
    active = new Set(targets);
  layer.classList.remove('hidden');
  single.classList.add('hidden');
  for (const [target, node] of viewState.campaignMarkerNodes) {
    if (!active.has(target)) {
      node.remove();
      viewState.campaignMarkerNodes.delete(target);
    }
  }
  const occupied = [],
    offsets = [[0, 0], [0, -34], [44, 0], [-44, 0], [0, 34], [34, -30], [-34, -30], [34, 30], [-34, 30]];
  for (let radius = 68; radius <= 420; radius += 46) for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  const isClear = (x, y) => occupied.every(p => Math.abs(x - p.x) > 48 || Math.abs(y - p.y) > 34),
    clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  for (const target of targets) {
    let node = viewState.campaignMarkerNodes.get(target);
    if (!node) {
      node = document.createElement('div');
      node.className = 'enemy-marker campaign-target-marker';
      node.innerHTML = '<i class="marker-leader"></i><span class="marker-label"></span>';
      layer.appendChild(node);
      viewState.campaignMarkerNodes.set(target, node);
    }
    const label = node.querySelector('.marker-label'),
      name = (target.isBomber ? 'B-29 #' : 'F-86 #') + target.id;
    if (label.textContent !== name) label.textContent = name;
    const anchor = projectEnemyMarkerPoint(target.root.position);
    node.classList.toggle('offscreen', !anchor.visible);
    let x = anchor.x,
      y = anchor.y;
    const minX = 24,
      maxX = innerWidth - 24,
      minY = 24,
      maxY = innerHeight - 32;
    for (const [dx, dy] of offsets) {
      const candidateX = clamp(anchor.x + dx, minX, maxX),
        candidateY = clamp(anchor.y + dy, minY, maxY);
      if (isClear(candidateX, candidateY)) {
        x = candidateX;
        y = candidateY;
        break;
      }
    }
    occupied.push({
      x,
      y
    });
    node.style.left = x / innerWidth * 100 + '%';
    node.style.top = y / innerHeight * 100 + '%';
    const dx = anchor.x - x,
      dy = anchor.y - y,
      distance = Math.hypot(dx, dy);
    node.style.setProperty('--leader-length', distance > 20 ? distance + 'px' : '0px');
    node.style.setProperty('--leader-angle', Math.atan2(dy, dx) + 'rad');
  }
}
async function prepareCampaignBattle() {
  if (!profileState.unlockedPlanes.includes('mig15')) {
    toast('请先研发并购买 MiG-15');
    showMenuScreen('research');
    return;
  }
  const token = ++session.airspacePrepareToken,
    button = $('#beginCampaign');
  button.disabled = true;
  setBattleLoading(true, '正在准备战役…');
  try {
    const [terrain] = await Promise.all([loadKoreaTerrain(), ...['mig15', 'b29', 'f86'].map(loadPlaneModel), ...soundState.audioLoads.values()]);
    if (token !== session.airspacePrepareToken) return;
    if (!terrain) throw new Error('地图未加载');
    if (!mapState.koreaHeightGrid) mapState.koreaHeightGrid = buildKoreaHeightGrid(terrain);
    session.gameMode = 'campaign';
    reset({
      preparing: true
    });
    await warmBattleRenderer();
    if (token !== session.airspacePrepareToken) return;
    session.playing = true;
    session.battleSimulationAccumulator = 0;
    session.battleHudElapsed = Infinity;
    viewState.clock.getDelta();
    startEngineSound(session.playerPlane);
    updateCampaignHud();
    setBattleLoading(false);
  } catch (error) {
    if (token === session.airspacePrepareToken) {
      console.error('战役准备失败', error);
      showMenuScreen('campaignBriefing');
      toast('战役准备失败，请重试。');
    }
  } finally {
    button.disabled = false;
    if (token === session.airspacePrepareToken) setBattleLoading(false);
  }
}
