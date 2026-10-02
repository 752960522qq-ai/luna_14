function createAirspaceState() {
  return {
    progress: 0,
    owner: null,
    scores: {
      blue: 0,
      red: 0
    },
    counts: {
      blue: 0,
      red: 0
    },
    elapsed: 0,
    winner: undefined,
    point: new THREE.Vector3(),
    bases: {
      blue: new THREE.Vector3(),
      red: new THREE.Vector3()
    }
  };
}
function airspaceLiveUnits(team = null) {
  return session.airspaceUnits.filter(unit => !unit.dead && unit.health > 0 && (!team || unit.team === team));
}
function airspaceUnitFor(root) {
  return root?.userData.airspaceUnit || null;
}
function airspacePlayerAlive() {
  return session.gameMode !== 'airspace' || !!airspaceUnitFor(session.player) && !airspaceUnitFor(session.player).dead;
}
function airspaceWithin(point, center, radiusMeters) {
  return point.distanceToSquared(center) <= (radiusMeters / METERS_PER_UNIT) ** 2 + 1e-9;
}

// A signed meter takes 15 seconds from neutral and 30 from the opposite end.
// Only a strict numerical advantage advances it; ties and an empty point freeze it.
function advanceAirspaceObjective(state, units, dt) {
  dt = Math.min(Math.max(0, dt), Math.max(0, AIRSPACE_RULES.durationSeconds - state.elapsed));
  const counts = {
    blue: 0,
    red: 0
  };
  for (const unit of units) if (!unit.dead && unit.health > 0 && airspaceWithin(unit.root.position, state.point, AIRSPACE_RULES.captureRadiusMeters)) counts[unit.team]++;
  state.counts = counts;
  state.elapsed += dt;
  const advantage = Math.sign(counts.blue - counts.red),
    oldOwner = state.owner,
    oldProgress = state.progress;
  if (advantage) state.progress = THREE.MathUtils.clamp(oldProgress + advantage * dt / AIRSPACE_RULES.captureSeconds, -1, 1);
  if (state.progress >= 1 - 1e-9) {
    state.progress = 1;
    state.owner = 'blue';
  } else if (state.progress <= -1 + 1e-9) {
    state.progress = -1;
    state.owner = 'red';
  }
  // Split the step at the ownership change so scores do not depend on frame rate.
  if (oldOwner !== state.owner) {
    const transition = advantage ? Math.min(dt, Math.abs((advantage - oldProgress) * AIRSPACE_RULES.captureSeconds)) : dt;
    if (oldOwner) state.scores[oldOwner] += transition * AIRSPACE_RULES.scoreRate;
    if (state.owner) state.scores[state.owner] += (dt - transition) * AIRSPACE_RULES.scoreRate;
  } else if (state.owner) state.scores[state.owner] += dt * AIRSPACE_RULES.scoreRate;
  for (const team of ['blue', 'red']) state.scores[team] = Math.min(AIRSPACE_RULES.scoreToWin, state.scores[team]);
}
function replenishAirspaceUnit(unit, base, dt) {
  if (unit.dead || unit.health <= 0 || !airspaceWithin(unit.root.position, base, AIRSPACE_RULES.baseRadiusMeters)) return false;
  unit.health = Math.min(unit.maxHealth, unit.health + unit.maxHealth * AIRSPACE_RULES.supplyRate * dt);
  const data = unit.root.userData;
  if (data.engineDamage > 0) {
    data.engineDamage = Math.max(0, data.engineDamage - unit.maxHealth * COMBAT_FEEDBACK_RULES.engineHealthFraction * AIRSPACE_RULES.supplyRate * dt);
    data.engineCritical = data.engineDamage >= unit.maxHealth * COMBAT_FEEDBACK_RULES.engineHealthFraction * (1 - COMBAT_FEEDBACK_RULES.engineCriticalFraction);
  }
  for (const [id, capacity] of Object.entries(unit.maxAmmo)) {
    if (id === 'bombWeightLb' || capacity <= 0) continue;
    if (unit.ammo[id] >= capacity) {
      unit.supplyFractions[id] = 0;
      continue;
    }
    const recovered = (unit.supplyFractions[id] || 0) + capacity * AIRSPACE_RULES.supplyRate * dt,
      rounds = Math.floor(recovered + 1e-9);
    unit.supplyFractions[id] = recovered - rounds;
    unit.ammo[id] = Math.min(capacity, (unit.ammo[id] || 0) + rounds);
  }
  return true;
}
function airspaceAmmoFraction(unit) {
  let have = 0,
    capacity = 0;
  for (const [id, max] of Object.entries(unit.maxAmmo)) {
    if (id === 'bombWeightLb' || id === 'bombs') continue;
    have += unit.ammo[id] || 0;
    capacity += max;
  }
  return capacity ? have / capacity : 1;
}
function airspaceWinner(state, units) {
  const blue = units.some(u => u.team === 'blue' && !u.dead && u.health > 0),
    red = units.some(u => u.team === 'red' && !u.dead && u.health > 0);
  if (!blue && !red) return null;
  if (!red) return 'blue';
  if (!blue) return 'red';
  if (state.scores.blue >= AIRSPACE_RULES.scoreToWin - 1e-9) return 'blue';
  if (state.scores.red >= AIRSPACE_RULES.scoreToWin - 1e-9) return 'red';
  if (state.elapsed >= AIRSPACE_RULES.durationSeconds - 1e-9) {
    const bluePoints = Math.floor(state.scores.blue + 1e-9), redPoints = Math.floor(state.scores.red + 1e-9);
    if (bluePoints !== redPoints) return bluePoints > redPoints ? 'blue' : 'red';
    const blueAlive = units.filter(u => u.team === 'blue' && !u.dead && u.health > 0).length;
    const redAlive = units.filter(u => u.team === 'red' && !u.dead && u.health > 0).length;
    return blueAlive === redAlive ? null : blueAlive > redAlive ? 'blue' : 'red';
  }
  return undefined;
}
function clearAirspaceEntities() {
  for (const unit of session.airspaceUnits) disposeAircraft(unit.root);
  for (const node of viewState.airspaceMarkerNodes.values()) node.remove();
  viewState.airspaceMarkerNodes.clear();
  session.airspaceUnits.length = 0;
  session.airspaceState = null;
  session.airspaceSpectating = false;
  session.airspaceObservedId = null;
  session.airspaceAccumulator = 0;
  $('#airspaceHud').classList.add('hidden');
  $('#airspaceMarkers').classList.add('hidden');
  $('#spectatorControls').classList.add('hidden');
  $('#hud').classList.remove('spectating', 'airspace');
  $('#throttleControl').classList.remove('hidden');
}
function makeAirspaceUnit(team, index, type, root) {
  const isPlayer = root === session.player,
    ammo = isPlayer ? session.playerAmmo : freshAmmo(type),
    mode = isPlayer ? session.weaponMode : type === 'mig15' ? ['n37', 'ns23', 'both'][Math.floor(Math.random() * 3)] : type === 'meteor' ? 'hispano' : 'mg';
  const unit = {
    id: team + '-' + index,
    team,
    index,
    type,
    root,
    isPlayer,
    health: planeInfo[type].health,
    maxHealth: planeInfo[type].health,
    ammo,
    maxAmmo: {
      ...ammo
    },
    supplyFractions: {},
    weaponMode: mode,
    weaponCooldowns: isPlayer ? session.playerWeaponCooldowns : {
      mg: 0,
      m2: 0,
      mg762: 0,
      n37: 0,
      ns23: 0,
      hispano: 0
    },
    dead: false,
    damageContributors: new Map(),
    targetId: null,
    targetDecision: 0,
    resupplying: false,
    patrolPhase: index * Math.PI / 4
  };
  Object.assign(root.userData, {
    airspaceUnit: unit,
    team,
    ammo: unit.ammo,
    weaponMode: unit.weaponMode,
    weaponCooldowns: unit.weaponCooldowns,
    engineRunning: true
  });
  if (!isPlayer && type !== 'b29') initializeFighterAI(root, 'airspace', index);
  session.airspaceUnits.push(unit);
  return unit;
}
function startAirspaceBattle() {
  session.airspaceState = createAirspaceState();
  // A common flight level keeps the initial diagonal routes above the terrain.
  let highest = terrainHeightAt(0, 0);
  for (let x = -280; x <= 280; x += 40) for (let z = -280; z <= 280; z += 40) highest = Math.max(highest, terrainHeightAt(x, z));
  const altitude = Math.max(terrainHeightAt(0, 0) + 70, highest + 35);
  session.airspaceState.point.set(0, altitude, 0);
  session.airspaceState.bases.blue.set(-260, altitude, 260);
  session.airspaceState.bases.red.set(260, altitude, -260);
  const slots = [[0, 0], [-8, 8], [8, 8], [-16, 16], [16, 16], [-24, 24], [24, 24], [0, 28]];
  for (const team of ['blue', 'red']) {
    const base = session.airspaceState.bases[team],
      forward = session.airspaceState.point.clone().sub(base).normalize(),
      right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    for (let index = 0; index < AIRSPACE_RULES.teamSize; index++) {
      const isPlayer = team === 'blue' && index === 0,
        type = isPlayer ? session.playerPlane : chooseDuelOpponent(session.playerPlane),
        root = isPlayer ? session.player : aircraft(false, type);
      root.position.copy(base).addScaledVector(right, slots[index][0]).addScaledVector(forward, -slots[index][1]);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), forward);
      root.userData.velocity.copy(forward).multiplyScalar(root.userData.airspeed / METERS_PER_UNIT);
      root.userData.throttle = isPlayer ? inputState.throttleValue : .82;
      if (PROPELLER_SPECS[type]) root.userData.propRpm = PROPELLER_SPECS[type].idleRpm + (PROPELLER_SPECS[type].maxRpm - PROPELLER_SPECS[type].idleRpm) * root.userData.throttle;
      if (!isPlayer) {
        enforceAICeiling(root);
        viewState.scene.add(root);
      }
      makeAirspaceUnit(team, index, type, root);
    }
  }
  session.enemy = airspaceLiveUnits('red')[0].root;
  session.enemyPlaneType = session.enemy.userData.type;
  session.eHp = airspaceUnitFor(session.enemy).health;
  session.airspaceSpectating = false;
  session.airspaceObservedId = null;
  session.airspaceAccumulator = 0;
  resetCursorControl();
  $('#hud').classList.add('airspace');
  $('#airspaceHud').classList.remove('hidden');
  $('#airspaceMarkers').classList.remove('hidden');
  $('#spectatorControls').classList.add('hidden');
  $('#radarScale').textContent = '6 × 6 km';
  updateAirspaceHUD();
}
async function prepareAirspaceBattle() {
  const token = ++session.airspacePrepareToken,
    button = $('#chooseAIBattle');
  button.disabled = true;
  setBattleLoading(true, '正在准备空域与编队…');
  $('#airspaceLoadStatus').textContent = '正在加载空域与编队…';
  try {
    const [terrain] = await Promise.all([loadKoreaTerrain(), ...duelOpponentsFor(profileState.selectedAircraft).map(loadPlaneModel), ...soundState.audioLoads.values()]);
    if (token !== session.airspacePrepareToken) return;
    if (!terrain) throw new Error('地图未加载');
    if (!mapState.koreaHeightGrid) mapState.koreaHeightGrid = buildKoreaHeightGrid(terrain);
    session.gameMode = 'airspace';
    reset({
      preparing: true
    });
    await warmBattleRenderer();
    if (token !== session.airspacePrepareToken) return;
    session.playing = true;
    session.airspaceAccumulator = 0;
    session.battleHudElapsed = Infinity;
    viewState.clock.getDelta();
    startEngineSound(session.playerPlane);
    setBattleLoading(false);
  } catch (error) {
    if (token === session.airspacePrepareToken) {
      console.error('空域加载失败', error);
      $('#airspaceLoadStatus').textContent = '加载失败，请重新进入空域。';
    }
  } finally {
    if (token === session.airspacePrepareToken) {
      button.disabled = false;
      setBattleLoading(false);
      if (session.playing) $('#airspaceLoadStatus').textContent = '';
    }
  }
}
function nearestAirspaceHostile(unit) {
  let closest = null,
    distance = Infinity;
  for (const candidate of airspaceLiveUnits()) if (candidate.team !== unit.team) {
    const d = unit.root.position.distanceToSquared(candidate.root.position);
    if (d < distance) {
      distance = d;
      closest = candidate;
    }
  }
  return closest;
}
function airspaceViewUnit() {
  if (!session.airspaceSpectating) return airspaceUnitFor(session.player);
  const allies = airspaceLiveUnits('blue');
  let unit = allies.find(u => u.id === session.airspaceObservedId);
  if (!unit) {
    unit = allies[0] || null;
    session.airspaceObservedId = unit?.id || null;
    viewState.cameraPoseInitialized = false;
  }
  return unit;
}
function cycleAirspaceSpectator(direction) {
  if (!session.airspaceSpectating || !session.playing) return;
  const allies = airspaceLiveUnits('blue');
  if (!allies.length) return;
  const index = allies.findIndex(u => u.id === session.airspaceObservedId),
    next = (Math.max(0, index) + direction + allies.length) % allies.length;
  session.airspaceObservedId = allies[next].id;
  resetCameraTracking();
  updateAirspaceHUD();
}
function enterAirspaceSpectator() {
  session.airspaceSpectating = true;
  clearFlightInputs();
  resetDuelBoundary();
  inputState.cursorTarget = null;
  stopEngineSound();
  stopGunSounds();
  resetCameraTracking();
  airspaceViewUnit();
  $('#hud').classList.add('spectating');
  $('#spectatorControls').classList.remove('hidden');
  $('#throttleControl').classList.add('hidden');
  for (const id of ['reticle', 'aimCursor', 'leadIndicator']) $('#' + id).style.display = 'none';
  $('#cursorStatus').classList.add('hidden');
  toast('战机已被击落 · 进入队友观战');
}
function damageAirspaceUnit(unit, amount, shooterId = null, hit = null) {
  if (!unit || unit.dead || !Number.isFinite(amount) || amount <= 0 || session.ended) return;
  const shooter = session.airspaceUnits.find(u => u.id === shooterId);
  if (shooter && shooter.team === unit.team) return;
  const before = unit.health;
  unit.health = Math.max(0, unit.health - amount);
  recordCombatDamage(unit.root, before, unit.health, hit || (shooter ? { source: shooter.root, projectile: false } : null));
  if (unit.isPlayer) {
    session.hp = unit.health;
    triggerDamageFlash();
  }
  if (unit.root === session.enemy) session.eHp = unit.health;
  if (unit.health <= 0) {
    unit.dead = true;
    unit.targetId = null;
    retireAircraft(unit.root);
    const assistants = reportAirspaceAssists(unit, shooterId);
    addCombatFeed(shooter, unit, assistants);
    if (shooter?.isPlayer && shooter.team !== unit.team) {
      session.kills++;
      $('#kills').textContent = String(session.kills).padStart(2, '0');
      playSfx('kill', .35);
      toast('敌机击落 · ' + planeInfo[unit.type].name);
    }
    if (unit.isPlayer) enterAirspaceSpectator();
  }
}
function finishAirspaceBattle(winner) {
  if (session.ended) return;
  session.airspaceState.winner = winner;
  resetDuelBoundary();
  session.battlePaused = false;
  clearFlightInputs();
  session.playing = false;
  session.ended = true;
  for (const unit of session.airspaceUnits) unit.root.userData.engineRunning = false;
  stopGunSounds();
  stopEngineSound();
  $('#spectatorControls').classList.add('hidden');
  const state = session.airspaceState, scores = state.scores;
  const reason = state.elapsed >= AIRSPACE_RULES.durationSeconds - 1e-9 ? '五分钟时限已到' : winner === null ? '双方编队全灭' : scores[winner] >= AIRSPACE_RULES.scoreToWin - 1e-9 ? '据点积分达到 100 分' : '对方编队已被全歼';
  const alive = [airspaceLiveUnits('blue').length, airspaceLiveUnits('red').length];
  updateAirspaceHUD();
  renderBattleResult(winner === null ? null : winner === 'blue', `${reason} · 积分 ${Math.floor(scores.blue + 1e-9)} : ${Math.floor(scores.red + 1e-9)} · 存活 ${alive[0]} : ${alive[1]}`, settleSortieEconomy(winner === null ? null : winner === 'blue'));
}
function airspaceNavigationGoal(unit, dt) {
  const ammo = airspaceAmmoFraction(unit);
  if (!unit.resupplying && (unit.health < unit.maxHealth * .45 || ammo < .15)) unit.resupplying = true;
  if (unit.resupplying && unit.health >= unit.maxHealth * .95 && ammo >= .95) unit.resupplying = false;
  const center = unit.resupplying ? session.airspaceState.bases[unit.team] : session.airspaceState.point,
    root = unit.root,
    data = root.userData,
    distance = root.position.distanceTo(center) * METERS_PER_UNIT;
  let goal = center.clone();
  if (distance < 260) {
    // A small orbit lets nimble aircraft accumulate capture and supply time.
    const radial = root.position.clone().sub(center).setY(0);
    if (radial.lengthSq() < .01) radial.set(unit.team === 'blue' ? 1 : -1, 0, 0);
    const tangent = new THREE.Vector3(-radial.z, 0, radial.x).normalize();
    radial.normalize();
    goal.addScaledVector(radial, 13).addScaledVector(tangent, 13);
    goal.y = center.y;
  }
  const min = planeInfo[unit.type].minLevelFlightKmh,
    max = planeInfo[unit.type].maxSpeedKmh;
  data.airspaceNavigationThrottle = THREE.MathUtils.clamp((distance < 650 ? min * 1.4 : max * .82) / max, .3, .9);
  return goal;
}
function airspaceFlightDirection(root, goal) {
  // A waypoint behind the aircraft commands a banked turn, with a separate,
  // gentle altitude correction. It must not command a pitch loop over the point.
  const data = root.userData,
    toGoal = goal.clone().sub(root.position),
    travel = data.velocity.clone().setY(0);
  if (travel.lengthSq() < .001) travel.set(0, 0, -1).applyQuaternion(root.quaternion).setY(0);
  travel.normalize();
  const desired = toGoal.clone().setY(0);
  if (desired.lengthSq() < .001) desired.copy(travel);
  desired.normalize();
  const angle = Math.atan2(new THREE.Vector3().crossVectors(travel, desired).y, THREE.MathUtils.clamp(travel.dot(desired), -1, 1));
  const headingLimit = Math.min(.14, turnRateForPlane(data.type, Math.max(data.airspeed, 1)) * .8);
  const direction = travel.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.clamp(angle, -headingLimit, headingLimit));
  const speed = Math.max(data.airspeed, data.minFlightSpeedMps),
    climbFraction = Math.min(.22, data.bestClimbMps * .8 / speed),
    slope = THREE.MathUtils.clamp(toGoal.y * METERS_PER_UNIT / Math.max(600, speed * 4), -climbFraction, climbFraction);
  return direction.multiplyScalar(Math.sqrt(1 - slope * slope)).setY(slope);
}
function updateAirspaceAI(unit, dt) {
  const root = unit.root,
    data = root.userData,
    goal = airspaceNavigationGoal(unit, dt);
  unit.targetDecision -= dt;
  let target = session.airspaceUnits.find(u => u.id === unit.targetId && !u.dead);
  if (unit.targetDecision <= 0 || !target) {
    const nearest = nearestAirspaceHostile(unit);
    if (!target || nearest && root.position.distanceToSquared(nearest.root.position) < root.position.distanceToSquared(target.root.position) * .65) target = nearest;
    unit.targetId = target?.id || null;
    unit.targetDecision = .3 + unit.index * .01;
  }
  const nearObjective = root.position.distanceTo(session.airspaceState.point) * METERS_PER_UNIT < 650,
    enemyNearPoint = target && target.root.position.distanceTo(session.airspaceState.point) * METERS_PER_UNIT < 650;
  const targetRange = target ? root.position.distanceTo(target.root.position) * METERS_PER_UNIT : Infinity;
  const combat = !unit.resupplying && target && (targetRange < 850 || enemyNearPoint && nearObjective);
  if (unit.type !== 'b29' && target) {
    updateFighterAI(root, target.root, session.airspaceState.point, dt, combat ? null : goal);
  } else {
    data.throttle = data.airspaceNavigationThrottle;
    const safe = safeAIGoal(root, goal),
      boundary = duelBoundaryReturnGoal(root),
      direction = airspaceFlightDirection(root, boundary || safe);
    const steps = Math.max(1, Math.ceil(dt / FLIGHT_PHYSICS.stepSeconds)),
      step = dt / steps;
    for (let i = 0; i < steps; i++) {
      steerAircraftToward(root, direction, step);
      advanceAircraft(root, step);
      enforceDuelAIBoundary(root);
    }
  }
  if (unit.type === 'b29') fireAirspaceBomberTurrets(unit, dt);
}
function fireAirspaceBomberTurrets(unit, dt) {
  if (!unit || unit.dead || unit.type !== 'b29') return;
  const root = unit.root,
    data = root.userData,
    ammo = unit.ammo;
  data.bomberArcCheckRemaining = (data.bomberArcCheckRemaining || 0) - dt;
  if (data.bomberArcCheckRemaining <= 0) {
    data.bomberArcCheckRemaining = .075;
    data.airspaceTurretTargets = [];
    const inverse = root.quaternion.clone().invert(),
      hostiles = airspaceLiveUnits().filter(u => u.team !== unit.team && root.position.distanceToSquared(u.root.position) < 26 ** 2);
    for (const turret of B29_TURRETS) {
      let chosen = null,
        closest = Infinity;
      for (const target of hostiles) {
        const relative = target.root.position.clone().sub(root.position).applyQuaternion(inverse).sub(new THREE.Vector3(...turret.offset)),
          distance = relative.length() * METERS_PER_UNIT;
        if (distance <= 250 && distance < closest && bomberTurretCanTrack(turret, relative) && terrainLineClear(root.position, target.root.position)) {
          chosen = target;
          closest = distance;
        }
      }
      if (chosen) data.airspaceTurretTargets.push({
        turret,
        target: chosen
      });
    }
  }
  const active = (data.airspaceTurretTargets || []).filter(item => !item.target.dead);
  if (!active.length || ammo.b29mg <= 0) {
    data.bomberGunsActive = false;
    data.bomberGunClock = 0;
    return;
  }
  data.bomberGunsActive = true;
  data.bomberGunClock += dt;
  const interval = 60 / 450;
  while (data.bomberGunClock >= interval && ammo.b29mg > 0) {
    data.bomberGunClock -= interval;
    playGunShot('b29Gun', root, !unit.isPlayer, interval, true);
    for (const {
      turret,
      target
    } of active) {
      const rounds = Math.min(turret.guns, ammo.b29mg);
      ammo.b29mg -= rounds;
      recordShotCount(root, rounds);
      emitTurretSmoke(root, target.root, turret, rounds);
      let hits = 0;
      for (let n = 0; n < rounds; n++) if (Math.random() < .5) hits++;
      if (hits && !target.dead) damageAirspaceUnit(target, hits * 20, unit.id, turretImpact(root, target.root, hits));
    }
  }
}
// Return a segment entry fraction, so overlapping shot paths hit the closest enemy.
function airspaceHitFraction(start, end, root, radius) {
  const half = root.userData.collisionHalfExtents;
  if (!half) return null;
  const w = flightWorkspace(root, 'airspaceCollision'),
    previous = root.userData.frameStartPosition || root.position,
    movedStart = w.a.copy(start).add(root.position).sub(previous);
  const broadRadius = half.length() * Math.max(Math.abs(root.scale.x), Math.abs(root.scale.y), Math.abs(root.scale.z)) + radius;
  const segment = w.b.copy(end).sub(movedStart),
    length = segment.lengthSq(),
    projection = length ? THREE.MathUtils.clamp(w.c.copy(root.position).sub(movedStart).dot(segment) / length, 0, 1) : 0;
  if (w.d.copy(movedStart).addScaledVector(segment, projection).distanceToSquared(root.position) > broadRadius ** 2) return null;
  const a = root.worldToLocal(movedStart),
    b = root.worldToLocal(w.e.copy(end)),
    localRadius = radius / Math.max(.00001, Math.min(Math.abs(root.scale.x), Math.abs(root.scale.y), Math.abs(root.scale.z)));
  let enter = 0,
    exit = 1;
  for (const axis of ['x', 'y', 'z']) {
    const extent = half[axis] + localRadius,
      delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(a[axis]) > extent) return null;
      continue;
    }
    let near = (-extent - a[axis]) / delta,
      far = (extent - a[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  return enter;
}
function updateAirspaceBullets(dt) {
  updateProjectileSmoke(dt);
  const live = airspaceLiveUnits();
  for (let i = session.bullets.length - 1; i >= 0; i--) {
    const bullet = session.bullets[i];
    (bullet.previousPosition ??= new THREE.Vector3()).copy(bullet.mesh.position);
    bullet.mesh.position.addScaledVector(bullet.dir, bullet.speed * Math.min(dt, Math.max(0, bullet.life)));
    bullet.life -= dt;
    traceBulletSmoke(bullet, dt);
    let target = null,
      fraction = Infinity;
    for (const unit of live) {
      if (unit.dead || unit.team === bullet.team) continue;
      const hit = airspaceHitFraction(bullet.previousPosition, bullet.mesh.position, unit.root, bullet.radius);
      if (hit !== null && hit < fraction) {
        fraction = hit;
        target = unit;
      }
    }
    if (target) damageAirspaceUnit(target, bullet.damage, bullet.shooterId, projectileImpact(bullet, target.root, fraction));
    if (target || bullet.life <= 0 || bullet.mesh.position.y < terrainHeightAt(bullet.mesh.position.x, bullet.mesh.position.z)) releaseBullet(i);
  }
}
function updateAirspaceBombs(dt) {
  for (let i = session.bombsInFlight.length - 1; i >= 0; i--) {
    const bomb = session.bombsInFlight[i],
      start = bomb.mesh.position.clone();
    bomb.velocity.y -= 9.81 / METERS_PER_UNIT * dt;
    bomb.mesh.position.addScaledVector(bomb.velocity, dt);
    bomb.life -= dt;
    let target = null,
      fraction = Infinity;
    for (const unit of airspaceLiveUnits('red')) {
      const hit = airspaceHitFraction(start, bomb.mesh.position, unit.root, bomb.radius);
      if (hit !== null && hit < fraction) {
        fraction = hit;
        target = unit;
      }
    }
    if (target) damageAirspaceUnit(target, bomb.damage, airspaceUnitFor(session.player).id, { source: session.player, point: bomb.mesh.position, projectile: false });
    if (target || bomb.life <= 0 || bomb.mesh.position.y <= terrainHeightAt(bomb.mesh.position.x, bomb.mesh.position.z)) {
      disposeBomb(bomb);
      session.bombsInFlight.splice(i, 1);
    }
  }
}
function updateAirspaceStep(dt) {
  if (!session.playing || session.ended || !session.airspaceState) return;
  dt = Math.min(Math.max(0, dt), Math.max(0, AIRSPACE_RULES.durationSeconds - session.airspaceState.elapsed));
  if (dt <= 1e-9) {
    const winner = airspaceWinner(session.airspaceState, session.airspaceUnits);
    if (winner !== undefined) finishAirspaceBattle(winner);
    return;
  }
  profileState.battleRewardSeconds += dt;
  advanceCombatStats(dt);
  updateCombatFeedback(dt);
  session.worldTime += dt;
  rememberAircraftFrameStart();
  for (const unit of airspaceLiveUnits()) updatePropeller(unit.root, dt);
  if (airspacePlayerAlive()) {
    updatePlayerFlightControls(dt);
    updateCursorTarget(dt);
    fireWeapons(session.player, false, dt, inputState.keys.fire);
    if (inputState.keys.bomb && !inputState.bombKeyWasDown) dropBomb();
    inputState.bombKeyWasDown = inputState.keys.bomb;
    fireAirspaceBomberTurrets(airspaceUnitFor(session.player), dt);
  }
  for (const unit of airspaceLiveUnits()) if (!unit.isPlayer) updateAirspaceAI(unit, dt);
  for (const unit of airspaceLiveUnits()) if (unit.root.position.y <= terrainHeightAt(unit.root.position.x, unit.root.position.z)) damageAirspaceUnit(unit, unit.health);
  if (airspacePlayerAlive()) updateDuelBoundary(dt);
  updateAirspaceBullets(dt);
  updateAirspaceBombs(dt);
  for (const unit of airspaceLiveUnits()) replenishAirspaceUnit(unit, session.airspaceState.bases[unit.team], dt);
  if (airspacePlayerAlive()) session.hp = airspaceUnitFor(session.player).health;
  advanceAirspaceObjective(session.airspaceState, session.airspaceUnits, dt);
  const winner = airspaceWinner(session.airspaceState, session.airspaceUnits);
  if (winner !== undefined) finishAirspaceBattle(winner);
}
function updateAirspaceFrame(elapsed, dt) {
  if (elapsed > 0) advanceAirspaceSimulation(elapsed);
  const hudDue = shouldUpdateBattleHUD(dt);
  const view = airspaceViewUnit();
  if (session.airspaceSpectating) {
    if (view) updateAirspaceSpectatorCamera(view.root, dt);
  } else updateChaseCamera(dt);
  if (session.playing && hudDue) updateAirspaceTacticalDisplay();
  if (hudDue) updateAirspaceHUD();
  if (view && hudDue) {
    const data = view.root.userData;
    $('#speed').textContent = Math.round(data.airspeed * 3.6);
    $('#alt').textContent = Math.max(0, Math.round((view.root.position.y + 90) * METERS_PER_UNIT)) + ' m';
    $('#aoa').textContent = (data.aoa * 180 / Math.PI).toFixed(1) + '°';
    $('#aoa').classList.toggle('warning', Math.abs(data.aoa) > 14 * Math.PI / 180);
  }
  if (!session.airspaceSpectating) {
    updateEngineAudio();
    if (hudDue) {
      updateAmmoUI();
      updateHealthUI();
      updateEngineUI();
    }
  }
}
function updateAirspaceSpectatorCamera(root, dt) {
  followCameraAnchor(root);
  if (!inputState.keys.look && session.worldTime - viewState.cameraInputAt >= 2) {
    viewState.cameraOrbitYaw = THREE.MathUtils.damp(viewState.cameraOrbitYaw, 0, 2.8, dt);
    viewState.cameraOrbitPitch = THREE.MathUtils.damp(viewState.cameraOrbitPitch, 0, 2.8, dt);
  }
  const orbit = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), viewState.cameraOrbitYaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), viewState.cameraOrbitPitch)),
    pose = root.quaternion.clone().multiply(orbit),
    offset = chaseFrameOffsets(root.userData.type),
    position = root.position.clone().add(new THREE.Vector3(0, offset.heightMeters / METERS_PER_UNIT, offset.backMeters / METERS_PER_UNIT).applyQuaternion(pose));
  const target = root.position.clone().add(new THREE.Vector3(0, 0, -100).applyQuaternion(pose)),
    look = new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)),
    rotation = new THREE.Quaternion().setFromRotationMatrix(look);
  if (!viewState.cameraPoseInitialized) {
    viewState.camera.position.copy(position);
    viewState.camera.quaternion.copy(rotation);
    viewState.cameraPoseInitialized = true;
  } else {
    viewState.camera.position.lerp(position, 1 - Math.exp(-16 * dt));
    viewState.camera.quaternion.slerp(rotation, 1 - Math.exp(-18 * dt));
  }
  viewState.camera.updateMatrixWorld(true);
}
function updateAirspaceHealthUI() {
  const own = airspaceUnitFor(session.player),
    view = airspaceViewUnit();
  if (!own) return;
  $('#playerHealth').style.width = own.health / own.maxHealth * 100 + '%';
  $('#hpText').textContent = Math.round(own.health / own.maxHealth * 100) + '%';
  const target = view && nearestAirspaceHostile(view);
  session.enemy = target?.root || null;
  if (target) {
    session.enemyPlaneType = target.type;
    session.eHp = target.health;
  }
  $('#enemyHealth').style.width = (target ? target.health / target.maxHealth * 100 : 0) + '%';
  $('#targetName').textContent = target ? '敌机 · ' + planeInfo[target.type].name : '敌方编队已全灭';
}
function updateAirspaceHUD() {
  if (!session.airspaceState) return;
  const s = session.airspaceState,
    blue = airspaceLiveUnits('blue').length,
    red = airspaceLiveUnits('red').length;
  $('#blueAlive').textContent = blue;
  $('#redAlive').textContent = red;
  $('#blueScore').textContent = Math.floor(s.scores.blue + 1e-9);
  $('#redScore').textContent = Math.floor(s.scores.red + 1e-9);
  $('#airspaceTimer').textContent = formatBattleTime(AIRSPACE_RULES.durationSeconds - s.elapsed);
  $('#airspaceTimer').classList.toggle('time-warning', AIRSPACE_RULES.durationSeconds - s.elapsed <= 30);
  const owner = s.owner === 'blue' ? '我方占领' : s.owner === 'red' ? '敌方占领' : '中立';
  $('#aPointStatus').textContent = 'A · ' + owner;
  $('#aCaptureBlue').style.width = Math.max(0, s.progress) * 50 + '%';
  $('#aCaptureRed').style.width = Math.max(0, -s.progress) * 50 + '%';
  const direction = Math.sign(s.counts.blue - s.counts.red),
    goal = direction > 0 ? 1 : -1,
    remaining = direction ? Math.max(0, Math.abs(goal - s.progress) * AIRSPACE_RULES.captureSeconds) : 0;
  $('#aCaptureText').textContent = `点内 ${s.counts.blue} : ${s.counts.red} · ` + (direction && remaining > .01 ? (direction > 0 ? '我方' : '敌方') + '占领 ' + Math.ceil(remaining - 1e-9) + '秒' : direction ? '占领完成' : s.counts.blue || s.counts.red ? '争夺中' : '未占领');
  $('#aPointStatus').style.color = s.owner === 'blue' ? '#76d5ff' : s.owner === 'red' ? '#ff8580' : '#ffcf71';
  const view = airspaceViewUnit();
  if (session.airspaceSpectating && view) {
    $('#spectatorLabel').textContent = '观战 · ' + planeInfo[view.type].name + ' #' + (view.index + 1) + ' · ' + Math.round(view.health / view.maxHealth * 100) + '%';
    updateAirspaceHealthUI();
  } else if (!session.airspaceSpectating) {
    const own = airspaceUnitFor(session.player),
      atBase = own && !own.dead && airspaceWithin(session.player.position, s.bases.blue, AIRSPACE_RULES.baseRadiusMeters);
    $('#baseSupplyStatus').textContent = atBase ? '补给中' : '';
  }
}
function airspaceMarker(key, label, position, color, view) {
  let node = viewState.airspaceMarkerNodes.get(key);
  if (!node) {
    node = document.createElement('div');
    node.className = 'airspace-marker';
    node.innerHTML = '<span class="marker-label"></span>';
    $('#airspaceMarkers').appendChild(node);
    viewState.airspaceMarkerNodes.set(key, node);
  }
  node.style.color = color;
  const anchor = projectEnemyMarkerPoint(position);
  node.classList.toggle('offscreen', !anchor.visible);
  node.style.left = anchor.x / innerWidth * 100 + '%';
  node.style.top = anchor.y / innerHeight * 100 + '%';
  node.querySelector('.marker-label').textContent = label + ' · ' + Math.round(position.distanceTo(view.root.position) * METERS_PER_UNIT) + ' m';
  return node;
}
function updateAirspaceTacticalDisplay() {
  const view = airspaceViewUnit();
  if (!view) return;
  viewState.camera.updateMatrixWorld(true);
  $('#enemyMarker').classList.add('hidden');
  $('#campaignEnemyMarkers').classList.add('hidden');
  const live = airspaceLiveUnits(),
    active = new Set(['A', 'base-blue', 'base-red']);
  // Spread the aircraft labels, leaving the objective and bases at their anchors.
  const occupied = [],
    offsets = [[0, 0], [0, -28], [0, 28], [65, 0], [-65, 0], [65, -28], [-65, -28], [65, 28], [-65, 28]];
  for (const unit of live) if (unit !== view) {
    active.add(unit.id);
    const node = airspaceMarker(unit.id, (unit.team === 'blue' ? '友' : '敌') + ' ' + planeInfo[unit.type].name + ' #' + (unit.index + 1), unit.root.position, unit.team === 'blue' ? '#76d5ff' : '#ff8580', view),
      anchor = projectEnemyMarkerPoint(unit.root.position);
    if (anchor.visible) {
      let x = anchor.x,
        y = anchor.y;
      for (const [dx, dy] of offsets) {
        const nx = THREE.MathUtils.clamp(anchor.x + dx, 24, innerWidth - 24),
          ny = THREE.MathUtils.clamp(anchor.y + dy, innerHeight * .28, innerHeight - 40);
        if (occupied.every(p => Math.abs(nx - p.x) > 62 || Math.abs(ny - p.y) > 24) && Math.abs(nx - innerWidth * .5) + Math.abs(ny - innerHeight * .5) > 38) {
          x = nx;
          y = ny;
          break;
        }
      }
      occupied.push({
        x,
        y
      });
      node.style.left = x / innerWidth * 100 + '%';
      node.style.top = y / innerHeight * 100 + '%';
    }
  }
  const owner = session.airspaceState.owner,
    aColor = owner === 'blue' ? '#76d5ff' : owner === 'red' ? '#ff8580' : '#ffcf71';
  airspaceMarker('A', 'A · ' + Math.round((session.airspaceState.point.y + 90) * METERS_PER_UNIT) + ' m ALT', session.airspaceState.point, aColor, view);
  airspaceMarker('base-blue', '我方基地', session.airspaceState.bases.blue, '#76d5ff', view);
  airspaceMarker('base-red', '敌方基地', session.airspaceState.bases.red, '#ff8580', view);
  for (const [key, node] of viewState.airspaceMarkerNodes) if (!active.has(key)) {
    node.remove();
    viewState.airspaceMarkerNodes.delete(key);
  }
  const canvas = $('#radar'),
    ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    cx = w / 2,
    cy = h / 2,
    extent = w * .43;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(5,20,31,.8)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(105,219,231,.43)';
  ctx.strokeRect(cx - extent, cy - extent, extent * 2, extent * 2);
  const plot = (position, color, label, size = 2) => {
    const x = cx + position.x / 300 * extent,
      y = cy + position.z / 300 * extent;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    if (label) {
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 6);
    }
  };
  plot(session.airspaceState.point, aColor, 'A', 4);
  plot(session.airspaceState.bases.blue, '#76d5ff', '友', 4);
  plot(session.airspaceState.bases.red, '#ff8580', '敌', 4);
  for (const unit of live) plot(unit.root.position, unit === view ? '#ffffff' : unit.team === 'blue' ? '#76d5ff' : '#ff8580', null, unit === view ? 3 : 2);
  $('#radarDistance').textContent = 'A ' + Math.round(view.root.position.distanceTo(session.airspaceState.point) * METERS_PER_UNIT) + ' m';
}
function advanceAirspaceSimulation(elapsed) {
  if (!session.playing) return;
  session.airspaceAccumulator += elapsed;
  let steps = 0;
  while (session.airspaceAccumulator >= AIRSPACE_RULES.stepSeconds - 1e-9 && steps < 24 && session.playing) {
    updateAirspaceStep(AIRSPACE_RULES.stepSeconds);
    session.airspaceAccumulator = Math.max(0, session.airspaceAccumulator - AIRSPACE_RULES.stepSeconds);
    steps++;
  }
}
