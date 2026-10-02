function bomberTurretCanTrack(turret, local) {
  const horizontal = Math.hypot(local.x, local.z),
    elevation = Math.atan2(local.y, horizontal) * 180 / Math.PI,
    yaw = horizontal < 1e-4 ? turret.yawCenterDeg : Math.atan2(local.x, -local.z) * 180 / Math.PI,
    delta = (yaw - turret.yawCenterDeg + 540) % 360 - 180;
  return Math.abs(delta) <= turret.yawHalfDeg + .001 && elevation >= turret.minElevationDeg - .001 && elevation <= turret.maxElevationDeg + .001;
}
// Test the entire projectile step against the aircraft's moving collision box.
// Translation is relative; rotation uses the final frame's orientation.
function sweptAircraftHit(start, end, aircraftRoot, projectileRadius = 0) {
  const half = aircraftRoot.userData.collisionHalfExtents;
  if (!half) return false;
  const previous = aircraftRoot.userData.frameStartPosition || aircraftRoot.position;
  const w = flightWorkspace(aircraftRoot, 'collision'),
    movedStart = w.a.copy(start).add(aircraftRoot.position).sub(previous);
  const a = aircraftRoot.worldToLocal(movedStart),
    b = aircraftRoot.worldToLocal(w.b.copy(end));
  const radius = projectileRadius / Math.max(.00001, Math.min(Math.abs(aircraftRoot.scale.x), Math.abs(aircraftRoot.scale.y), Math.abs(aircraftRoot.scale.z)));
  let enter = 0,
    exit = 1;
  for (const axis of ['x', 'y', 'z']) {
    const extent = half[axis] + radius,
      delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(a[axis]) > extent) return false;
      continue;
    }
    let near = (-extent - a[axis]) / delta,
      far = (extent - a[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return false;
  }
  return true;
}
function rememberAircraftFrameStart() {
  const roots = session.gameMode === 'airspace' ? airspaceLiveUnits().map(unit => unit.root) : [session.player, ...(session.gameMode === 'campaign' ? campaignTargets().map(t => t.root) : [session.enemy])];
  for (const root of roots) {
    if (!root) continue;
    (root.userData.frameStartPosition ??= new THREE.Vector3()).copy(root.position);
    (root.userData.renderPreviousPosition ??= new THREE.Vector3()).copy(root.position);
    (root.userData.renderPreviousQuaternion ??= new THREE.Quaternion()).copy(root.quaternion);
  }
}
function insideAircraftHitbox(point, aircraftRoot, projectileRadius = 0) {
  const half = aircraftRoot.userData.collisionHalfExtents;
  if (!half) return false;
  const local = aircraftRoot.worldToLocal(point.clone());
  return Math.abs(local.x) <= half.x + projectileRadius && Math.abs(local.y) <= half.y + projectileRadius && Math.abs(local.z) <= half.z + projectileRadius;
}
function freshAmmo(type) {
  const ammo = {
    ...AIRCRAFT_DATA[type].ammo
  };
  if (type === 'b29') {
    const payload = BOMBER_LOADOUTS[profileState.selectedBombPayload];
    ammo.bombs = payload.count;
    ammo.bombWeightLb = payload.eachLb;
  }
  return ammo;
}
function selectedWeaponIds(type, mode) {
  if (type === 'mig15') return mode === 'both' ? ['n37', 'ns23'] : [mode];
  return Object.keys(weaponInfo[type] || {});
}
function fireWeapons(from, isEnemy, dt, enabled) {
  const unit = session.gameMode === 'airspace' ? from.userData.airspaceUnit : null;
  const type = unit?.type || (isEnemy ? session.gameMode === 'campaign' ? from.userData.type || 'f86' : session.enemyPlaneType : session.playerPlane),
    state = unit?.ammo || (isEnemy ? session.gameMode === 'campaign' ? from.userData.ammo : session.enemyAmmo : session.playerAmmo),
    cooldowns = unit?.weaponCooldowns || (isEnemy ? session.gameMode === 'campaign' ? from.userData.weaponCooldowns : session.enemyWeaponCooldowns : session.playerWeaponCooldowns),
    mode = unit ? unit.isPlayer ? session.weaponMode : unit.weaponMode : isEnemy ? session.gameMode === 'campaign' ? from.userData.weaponMode : session.enemyWeaponMode : session.weaponMode;
  if (unit?.dead) return;
  let ammoChanged = false;
  const active = selectedWeaponIds(type, mode);
  for (const id of ['mg', 'm2', 'mg762', 'n37', 'ns23', 'hispano']) {
    cooldowns[id] = (cooldowns[id] || 0) - dt;
    const selected = active.includes(id),
      trigger = typeof enabled === 'boolean' ? enabled : !!enabled?.[id],
      spec = weaponInfo[type]?.[id];
    if (!selected || !trigger || !spec) {
      cooldowns[id] = Math.max(0, cooldowns[id]);
      continue;
    }
    let bursts = 0;
    while (cooldowns[id] <= 0 && state[id] >= spec.cost && bursts < 3) {
      const bulletDamage = isEnemy && session.gameMode === 'campaign' && type === 'f86' ? 12 : spec.damage,
        q = from.quaternion,
        resourceId = type + ':' + id;
      const resource = ensureBulletResources(type, id);
      for (const offset of spec.offsets) {
        const bullet = resourceState.bulletPool.pop() || {
          mesh: new THREE.Mesh(resource.geometry, resource.material),
          dir: new THREE.Vector3()
        };
        bullet.mesh.geometry = resource.geometry;
        bullet.mesh.material = resource.material;
        bullet.mesh.position.copy(from.position).add(new THREE.Vector3(offset[0], offset[1], offset[2]).multiplyScalar(from.scale.x).applyQuaternion(q));
        bullet.dir.set(0, 0, -1).applyQuaternion(q);
        bullet.speed = spec.speed / METERS_PER_UNIT;
        bullet.radius = spec.radius / METERS_PER_UNIT;
        bullet.life = 2.1;
        bullet.enemy = isEnemy;
        bullet.team = unit?.team || (isEnemy ? 'red' : 'blue');
        bullet.shooterId = unit?.id || null;
        bullet.shooterRoot = from;
        bullet.damage = bulletDamage;
        bullet.weapon = id;
        startBulletSmoke(bullet);
        viewState.scene.add(bullet.mesh);
        session.bullets.push(bullet);
      }
      recordShotCount(from, spec.offsets.length);
      state[id] -= spec.cost;
      ammoChanged = true;
      cooldowns[id] += 60 / spec.rpm;
      bursts++;
      playGunShot(gunSoundFor(type, id), from, isEnemy, 60 / spec.rpm);
    }
    if (bursts === 3 && cooldowns[id] <= 0) cooldowns[id] = 0;
  }
  if (!isEnemy && ammoChanged) updateAmmoUI();
}
function releaseBullet(index) {
  const bullet = session.bullets[index];
  traceBulletSmoke(bullet, 0, true);
  bullet.smokeActive = false;
  bullet.shooterRoot = null;
  viewState.scene.remove(bullet.mesh);
  session.bullets.splice(index, 1);
  if (resourceState.bulletPool.length < 512) resourceState.bulletPool.push(bullet);
}
function fireBomberTurrets(from, isEnemy, dt) {
  if (session.gameMode === 'airspace') {
    fireAirspaceBomberTurrets(airspaceUnitFor(from), dt);
    return;
  }
  const type = isEnemy ? session.enemyPlaneType : session.playerPlane;
  if (type !== 'b29') return;
  const target = isEnemy ? session.player : session.enemy,
    state = isEnemy ? session.enemyAmmo : session.playerAmmo,
    data = from.userData,
    stopPlayerGun = () => {};
  if (!target || !state || state.b29mg <= 0) {
    data.bomberGunsActive = false;
    data.bomberGunClock = 0;
    data.bomberEligibleTurrets = [];
    data.bomberEligibleGuns = 0;
    stopPlayerGun();
    return;
  }
  data.bomberArcCheckRemaining = (data.bomberArcCheckRemaining ?? 0) - dt;
  if (data.bomberArcTarget !== target || data.bomberArcCheckRemaining <= 0) {
    data.bomberArcTarget = target;
    data.bomberArcCheckRemaining = .075;
    const targetLocal = target.position.clone().sub(from.position).applyQuaternion(from.quaternion.clone().invert());
    data.bomberEligibleTurrets = B29_TURRETS.filter(turret => {
      const relative = targetLocal.clone().sub(new THREE.Vector3(...turret.offset));
      return relative.length() * METERS_PER_UNIT <= 250 && bomberTurretCanTrack(turret, relative);
    });
    data.bomberEligibleGuns = data.bomberEligibleTurrets.reduce((sum, turret) => sum + turret.guns, 0);
  }
  const eligibleTurrets = data.bomberEligibleTurrets || [],
    eligibleGuns = data.bomberEligibleGuns || 0;
  if (!eligibleTurrets.length) {
    data.bomberGunsActive = false;
    data.bomberGunClock = 0;
    stopPlayerGun();
    return;
  }
  if (!data.bomberGunsActive) {
    toast(isEnemy ? '遭到B-29炮塔攻击' : 'B-29炮塔自动开火');
    data.bomberGunsActive = true;
  }
  const interval = 60 / 450;
  data.bomberGunClock += dt;
  let ammoSpent = 0;
  while (data.bomberGunClock >= interval && state.b29mg > 0) {
    data.bomberGunClock -= interval;
    const rounds = Math.min(eligibleGuns, state.b29mg);
    state.b29mg -= rounds;
    ammoSpent += rounds;
    recordShotCount(from, rounds);
    let visualRounds = rounds;
    for (const turret of eligibleTurrets) {
      const count = Math.min(turret.guns, visualRounds);
      emitTurretSmoke(from, target, turret, count);
      visualRounds -= count;
      if (!visualRounds) break;
    }
    playGunShot('b29Gun', from, isEnemy, interval, true);
    let hits = 0;
    for (let i = 0; i < rounds; i++) if (Math.random() < .5) hits++;
    if (hits) damage(isEnemy ? 'player' : 'enemy', hits * 20, null, turretImpact(from, target, hits));
  }
  if (!isEnemy && ammoSpent > 0) updateAmmoUI();
}
function dropBomb() {
  if (session.gameMode === 'airspace' && !airspacePlayerAlive()) return;
  if (!session.playing || session.playerPlane !== 'b29' || !session.playerAmmo || session.playerAmmo.bombs <= 0) return;
  const loadout = BOMBER_LOADOUTS[profileState.selectedBombPayload],
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(.045, .075, .36, 8), new THREE.MeshStandardMaterial({
      color: 0x46505a,
      roughness: .75,
      metalness: .35
    })),
    release = new THREE.Vector3(0, -.16, 0).multiplyScalar(session.player.scale.x).applyQuaternion(session.player.quaternion);
  mesh.position.copy(session.player.position).add(release);
  viewState.scene.add(mesh);
  session.bombsInFlight.push({
    mesh,
    velocity: session.player.userData.velocity.clone(),
    damage: Math.round(700 * loadout.eachLb / 1000),
    radius: .12,
    life: 30
  });
  session.playerAmmo.bombs--;
  playSfx('bombDrop', .5);
  updateAmmoUI();
  toast('炸弹投放 · ' + loadout.eachLb + '磅');
}
function updateDroppedBombs(dt) {
  if (session.gameMode === 'airspace') {
    updateAirspaceBombs(dt);
    return;
  }
  for (let i = session.bombsInFlight.length - 1; i >= 0; i--) {
    const bomb = session.bombsInFlight[i];
    bomb.velocity.y -= 9.81 / METERS_PER_UNIT * dt;
    bomb.mesh.position.addScaledVector(bomb.velocity, dt);
    bomb.life -= dt;
    let hit = false;
    if (session.gameMode === 'campaign') {
      for (const target of campaignTargets()) {
        if (insideAircraftHitbox(bomb.mesh.position, target.root, bomb.radius)) {
          damage('enemy', bomb.damage, target, { source: session.player, point: bomb.mesh.position, projectile: false });
          hit = true;
          break;
        }
      }
    } else if (session.enemy && insideAircraftHitbox(bomb.mesh.position, session.enemy, bomb.radius)) {
      damage('enemy', bomb.damage, null, { source: session.player, point: bomb.mesh.position, projectile: false });
      hit = true;
    }
    if (hit || bomb.mesh.position.y <= -90 || bomb.life <= 0) {
      disposeBomb(bomb);
      session.bombsInFlight.splice(i, 1);
    }
  }
}
function muzzleWorldPoint(root, spec) {
  const first = spec.offsets[0],
    offset = new THREE.Vector3(first[0], first[1], first[2]).multiplyScalar(root.scale.x);
  return root.position.clone().add(offset.applyQuaternion(root.quaternion));
}
function solveBulletIntercept(origin, targetPosition, targetVelocity, bulletSpeed) {
  const displacement = targetPosition.clone().sub(origin),
    velocity = targetVelocity || new THREE.Vector3(),
    a = velocity.lengthSq() - bulletSpeed * bulletSpeed,
    b = 2 * displacement.dot(velocity),
    c = displacement.lengthSq();
  let seconds = null;
  if (Math.abs(a) < 1e-8) {
    if (Math.abs(b) > 1e-8) seconds = -c / b;
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant),
        one = (-b - root) / (2 * a),
        two = (-b + root) / (2 * a);
      seconds = [one, two].filter(t => t > 0).sort((x, y) => x - y)[0] ?? null;
    }
  }
  if (seconds === null || seconds <= 0 || seconds > 2.1) return null;
  const point = targetPosition.clone().addScaledVector(velocity, seconds),
    direction = point.clone().sub(origin).normalize();
  return {
    point,
    direction,
    seconds
  };
}
function ensureBulletResources(type, id) {
  const resourceId = type + ':' + id,
    spec = weaponInfo[type][id];
  return resourceState.bulletResources[resourceId] ??= {
    geometry: new THREE.SphereGeometry(spec.radius / METERS_PER_UNIT, 8, 8),
    material: new THREE.MeshBasicMaterial({
      color: spec.color
    })
  };
}
