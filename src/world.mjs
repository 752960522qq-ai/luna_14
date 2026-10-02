const terrainHeightProbe = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

function buildKoreaHeightGrid(terrain) {
  const resolution = 1024,
    half = MAP_LIBRARY.korea1951.sizeMeters / (2 * METERS_PER_UNIT),
    heights = new Float32Array(resolution * resolution).fill(-Infinity),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    scale = (resolution - 1) / (half * 2);
  terrain.updateMatrixWorld(true);
  terrain.traverse(node => {
    if (!node.isMesh) return;
    const positions = node.geometry.attributes.position,
      index = node.geometry.index,
      count = index ? index.count : positions.count;
    for (let at = 0; at + 2 < count; at += 3) {
      a.fromBufferAttribute(positions, index ? index.getX(at) : at).applyMatrix4(node.matrixWorld);
      b.fromBufferAttribute(positions, index ? index.getX(at + 1) : at + 1).applyMatrix4(node.matrixWorld);
      c.fromBufferAttribute(positions, index ? index.getX(at + 2) : at + 2).applyMatrix4(node.matrixWorld);
      const ax = (a.x + half) * scale,
        az = (a.z + half) * scale,
        bx = (b.x + half) * scale,
        bz = (b.z + half) * scale,
        cx = (c.x + half) * scale,
        cz = (c.z + half) * scale;
      const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(determinant) < 1e-10) continue;
      const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-6)),
        x1 = Math.min(resolution - 1, Math.floor(Math.max(ax, bx, cx) + 1e-6)),
        z0 = Math.max(0, Math.ceil(Math.min(az, bz, cz) - 1e-6)),
        z1 = Math.min(resolution - 1, Math.floor(Math.max(az, bz, cz) + 1e-6));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant,
          wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant,
          wc = 1 - wa - wb;
        if (wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6) {
          const i = z * resolution + x;
          heights[i] = Math.max(heights[i], wa * a.y + wb * b.y + wc * c.y);
        }
      }
    }
  });
  return {
    heights,
    resolution,
    half
  };
}
function terrainHeightAt(x, z) {
  if (mapState.activeMapId !== 'korea1951' || !mapState.koreaHeightGrid) return -90;
  const {
    heights,
    resolution,
    half
  } = mapState.koreaHeightGrid;
  if (Math.abs(x) > half || Math.abs(z) > half) return -90;
  const u = (x + half) / (half * 2) * (resolution - 1),
    v = (z + half) / (half * 2) * (resolution - 1),
    i = Math.min(resolution - 2, Math.floor(u)),
    j = Math.min(resolution - 2, Math.floor(v)),
    fx = u - i,
    fz = v - j;
  const h00 = heights[j * resolution + i],
    h10 = heights[j * resolution + i + 1],
    h01 = heights[(j + 1) * resolution + i],
    h11 = heights[(j + 1) * resolution + i + 1];
  // The outermost mesh edge can miss a raster point. Probe the actual surface
  // there instead of treating a valid mountain edge as sea level.
  if (![h00, h10, h01, h11].every(Number.isFinite)) {
    if (!mapState.koreaTerrain) return -90;
    terrainHeightProbe.ray.origin.set(x, 10000, z);
    return terrainHeightProbe.intersectObject(mapState.koreaTerrain, true)[0]?.point.y ?? -90;
  }
  return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
}
function loadKoreaTerrain() {
  if (!mapState.koreaTerrainPromise) mapState.koreaTerrainPromise = planeModelLoader.loadAsync(MAP_LIBRARY.korea1951.modelFile).then(gltf => {
    const terrain = gltf.scene,
      bounds = new THREE.Box3().setFromObject(terrain),
      size = bounds.getSize(new THREE.Vector3()),
      width = MAP_LIBRARY.korea1951.sizeMeters / METERS_PER_UNIT;
    if (size.x <= 0 || size.z <= 0) throw new Error('地形长宽无效');
    terrain.scale.multiplyScalar(width / Math.max(size.x, size.z));
    terrain.updateMatrixWorld(true);
    const scaledBounds = new THREE.Box3().setFromObject(terrain),
      center = scaledBounds.getCenter(new THREE.Vector3());
    terrain.position.x -= center.x;
    terrain.position.z -= center.z;
    terrain.position.y += -90 - scaledBounds.min.y;
    terrain.updateMatrixWorld(true);
    terrain.traverse(node => {
      if (node.isMesh) {
        node.receiveShadow = true;
        node.frustumCulled = true;
      }
    });
    const coverage = new THREE.Box3().setFromObject(terrain);
    mapState.koreaTerrainBounds = {
      minX: coverage.min.x,
      maxX: coverage.max.x,
      minZ: coverage.min.z,
      maxZ: coverage.max.z
    };
    mapState.koreaTerrain = terrain;
    return terrain;
  }).catch(error => {
    mapState.koreaTerrainPromise = null;
    console.error('无法加载1951·朝鲜地图', error);
    return null;
  });
  return mapState.koreaTerrainPromise;
}
function setBattleMap(id) {
  mapState.activeMapId = id;
  const korea = id === 'korea1951';
  viewState.scene.background.setHex(korea ? 0x9cb9ca : 0x83b9d1);
  viewState.scene.fog.color.setHex(korea ? 0xa9bdc4 : 0x9bbfce);
  viewState.scene.fog.near = korea ? 230 : 170;
  viewState.scene.fog.far = korea ? 1050 : 620;
  mapState.mapHemisphere.color.setHex(korea ? 0xd5e9ef : 0xdaf5ff);
  mapState.mapHemisphere.groundColor.setHex(korea ? 0x62665c : 0x596c74);
  mapState.mapHemisphere.intensity = korea ? 1.95 : 2.3;
  mapState.mapSun.color.setHex(korea ? 0xffe1ad : 0xffedcf);
  mapState.mapSun.intensity = korea ? 2.35 : 2.5;
  mapState.mapSun.position.set(korea ? -160 : 90, korea ? 220 : 150, korea ? -85 : -70);
  mapState.groundPlane.material.color.setHex(korea ? 0x5a6858 : 0x286379);
  mapState.groundPlane.material.roughness = korea ? 1 : .86;
  mapState.groundPlane.material.metalness = korea ? 0 : .12;
  for (const cloud of mapState.clouds) {
    cloud.position.set((Math.random() - .5) * (korea ? 610 : 860), korea ? 140 + Math.random() * 115 : 50 + Math.random() * 125, (Math.random() - .5) * (korea ? 610 : 900));
    cloud.userData.range = korea ? 340 : 430;
    cloud.userData.drift = (korea ? 1.5 : 3) + Math.random() * (korea ? 3 : 8);
    cloud.traverse(node => {
      if (node.isMesh) node.material.color.setHex(korea ? 0xf5eee3 : 0xf1f5f0);
    });
  }
  if (!korea) {
    if (mapState.koreaTerrain) mapState.koreaTerrain.visible = false;
    return;
  }
  loadKoreaTerrain().then(terrain => {
    if (!terrain || mapState.activeMapId !== 'korea1951' || !viewState.scene) return;
    if (terrain.parent !== viewState.scene) viewState.scene.add(terrain);
    terrain.visible = true;
    if (!mapState.koreaHeightGrid) mapState.koreaHeightGrid = buildKoreaHeightGrid(terrain);
  });
}
function terrainLineClear(start, end) {
  for (let i = 1; i <= 6; i++) {
    const p = start.clone().lerp(end, i / 7);
    if (p.y < terrainHeightAt(p.x, p.z) + 2) return false;
  }
  return true;
}
function safeAIGoal(root, goal) {
  const w = flightWorkspace(root, 'goalSafety'),
    safe = goal.clone(),
    half = mapState.activeMapId === 'korea1951' ? 265 : 290;
  if (session.gameMode === 'duel' || session.gameMode === 'airspace') {
    const b = terrainBattleBounds();
    safe.x = THREE.MathUtils.clamp(safe.x, b.minX, b.maxX);
    safe.z = THREE.MathUtils.clamp(safe.z, b.minZ, b.maxZ);
  } else if (mapState.activeMapId === 'korea1951') {
    safe.x = THREE.MathUtils.clamp(safe.x, -half, half);
    safe.z = THREE.MathUtils.clamp(safe.z, -half, half);
  } else {
    const radius = Math.hypot(safe.x, safe.z);
    if (radius > half) {
      safe.x *= half / radius;
      safe.z *= half / radius;
    }
  }
  safe.y = Math.max(safe.y, terrainHeightAt(safe.x, safe.z) + AI_TACTICS.groundClearanceMeters / METERS_PER_UNIT);
  const predicted = w.a.copy(root.position).addScaledVector(root.userData.velocity, 2.5);
  for (let i = 1; i <= 6; i++) {
    const fraction = i / 6,
      p = w.b.copy(root.position).lerp(safe, fraction),
      floor = terrainHeightAt(p.x, p.z) + AI_TACTICS.groundClearanceMeters / METERS_PER_UNIT;
    if (p.y < floor) safe.y = Math.max(safe.y, root.position.y + (floor - p.y) / Math.max(fraction, .15));
  }
  const predictedFloor = terrainHeightAt(predicted.x, predicted.z) + AI_TACTICS.groundClearanceMeters / METERS_PER_UNIT;
  if (predicted.y < predictedFloor) safe.y = Math.max(safe.y, predictedFloor + 12);
  safe.y = Math.min(safe.y, AI_TACTICS.maxAltitudeMeters / METERS_PER_UNIT - 90 - 5);
  return safe;
}
function updateDuelEnemy(dt) {
  if (!session.enemy) return;
  if (session.enemyPlaneType === 'b29') {
    session.enemy.userData.patrolPhase += dt * .15;
    const goal = safeAIGoal(session.enemy, AI_DUEL_CENTER.clone().add(new THREE.Vector3(55 * Math.sin(session.enemy.userData.patrolPhase), 12, 55 * Math.cos(session.enemy.userData.patrolPhase))));
    const boundaryGoal = duelBoundaryReturnGoal(session.enemy),
      direction = (boundaryGoal || goal).sub(session.enemy.position);
    const count = Math.max(1, Math.ceil(dt / FLIGHT_PHYSICS.stepSeconds)),
      step = dt / count;
    for (let i = 0; i < count; i++) {
      steerAircraftToward(session.enemy, direction, step);
      advanceAircraft(session.enemy, step);
      enforceDuelAIBoundary(session.enemy);
    }
  } else updateFighterAI(session.enemy, session.player, AI_DUEL_CENTER, dt);
  enforceDuelAIBoundary(session.enemy);
  if (session.enemy && session.enemy.position.y < terrainHeightAt(session.enemy.position.x, session.enemy.position.z)) damage('enemy', session.eHp);
}
function terrainBattleBounds() {
  if (session.gameMode === 'airspace') {
    const half = 6000 / (2 * METERS_PER_UNIT);
    return {
      minX: -half,
      maxX: half,
      minZ: -half,
      maxZ: half
    };
  }
  if (mapState.activeMapId === 'korea1951' && mapState.koreaTerrainBounds) return mapState.koreaTerrainBounds;
  const half = MAP_LIBRARY[mapState.activeMapId].sizeMeters / (2 * METERS_PER_UNIT);
  return {
    minX: -half,
    maxX: half,
    minZ: -half,
    maxZ: half
  };
}
function outsideTerrainMeters(position) {
  const b = terrainBattleBounds(),
    x = position.x - THREE.MathUtils.clamp(position.x, b.minX, b.maxX),
    z = position.z - THREE.MathUtils.clamp(position.z, b.minZ, b.maxZ);
  return Math.hypot(x, z) * METERS_PER_UNIT;
}
function duelBoundaryReturnGoal(root) {
  if (session.gameMode !== 'duel' && session.gameMode !== 'airspace') return null;
  const data = root.userData,
    b = terrainBattleBounds(),
    speed = Math.max(data.airspeed, 1),
    turn = turnRateForPlane(data.type, speed),
    radius = speed / Math.max(turn, .025),
    buffer = Math.min(radius * 1.35 + speed * .7 + 120, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * METERS_PER_UNIT * .43) / METERS_PER_UNIT;
  const v = data.velocity,
    sideTimes = [],
    marginUnits = DUEL_BOUNDARY_RULES.aiMarginMeters / METERS_PER_UNIT;
  if (v.x > 0) sideTimes.push((b.maxX + marginUnits - root.position.x) / v.x);else if (v.x < 0) sideTimes.push((b.minX - marginUnits - root.position.x) / v.x);
  if (v.z > 0) sideTimes.push((b.maxZ + marginUnits - root.position.z) / v.z);else if (v.z < 0) sideTimes.push((b.minZ - marginUnits - root.position.z) / v.z);
  const margin = Math.min(root.position.x - b.minX, b.maxX - root.position.x, root.position.z - b.minZ, b.maxZ - root.position.z),
    danger = outsideTerrainMeters(root.position) > 0 || sideTimes.length && Math.min(...sideTimes) < buffer * METERS_PER_UNIT / speed;
  if (danger) data.boundaryReturning = true;
  if (data.boundaryReturning && margin > buffer * .8 && Math.min(...sideTimes) > buffer * METERS_PER_UNIT / speed * 1.2) data.boundaryReturning = false;
  if (!data.boundaryReturning) return null;
  return new THREE.Vector3((b.minX + b.maxX) * .5, Math.max(root.position.y, terrainHeightAt(root.position.x, root.position.z) + AI_TACTICS.groundClearanceMeters / METERS_PER_UNIT), (b.minZ + b.maxZ) * .5);
}
function enforceDuelAIBoundary(root) {
  if (session.gameMode !== 'duel' && session.gameMode !== 'airspace' || !root) return;
  const b = terrainBattleBounds(),
    nearest = new THREE.Vector3(THREE.MathUtils.clamp(root.position.x, b.minX, b.maxX), root.position.y, THREE.MathUtils.clamp(root.position.z, b.minZ, b.maxZ)),
    delta = root.position.clone().sub(nearest),
    length = delta.length(),
    limit = DUEL_BOUNDARY_RULES.aiMarginMeters / METERS_PER_UNIT;
  if (length <= limit) return;
  const normal = delta.divideScalar(length);
  root.position.copy(nearest.addScaledVector(normal, limit));
  const outward = root.userData.velocity.dot(normal);
  if (outward > 0) root.userData.velocity.addScaledVector(normal, -outward);
  root.userData.airspeed = root.userData.velocity.length() * METERS_PER_UNIT;
  root.userData.boundaryReturning = true;
}
function resetDuelBoundary() {
  session.duelDesertionRemaining = null;
  $('#boundaryWarning').classList.add('hidden');
}
function updateDuelBoundary(elapsed) {
  if (session.gameMode === 'airspace') {
    if (!session.playing || !airspacePlayerAlive()) {
      resetDuelBoundary();
      return;
    }
  }
  if (session.gameMode !== 'duel' && session.gameMode !== 'airspace' || !session.playing || !session.player) {
    if (session.gameMode !== 'duel' && session.gameMode !== 'airspace') resetDuelBoundary();
    return;
  }
  if (session.gameMode === 'duel') enforceDuelAIBoundary(session.enemy);
  if (outsideTerrainMeters(session.player.position) <= DUEL_BOUNDARY_RULES.playerMarginMeters) {
    const returning = session.duelDesertionRemaining !== null;
    resetDuelBoundary();
    if (returning) toast('已返回战区，自毁倒计时取消');
    return;
  }
  if (session.duelDesertionRemaining === null) session.duelDesertionRemaining = DUEL_BOUNDARY_RULES.desertionSeconds;
  session.duelDesertionRemaining = Math.max(0, session.duelDesertionRemaining - Math.max(0, elapsed));
  const warning = $('#boundaryWarning');
  warning.classList.remove('hidden');
  warning.textContent = '临阵脱逃，自毁倒计时：' + Math.ceil(session.duelDesertionRemaining) + '秒';
  if (session.duelDesertionRemaining <= .000001) {
    if (session.gameMode === 'airspace') {
      session.player.userData.desertionDestroyed = true;
      damageAirspaceUnit(airspaceUnitFor(session.player), airspaceUnitFor(session.player).health);
      toast('越界超过15秒 · 战机自毁，进入观战');
      return;
    }
    session.player.userData.desertionDestroyed = true;
    damage('player', session.hp);
    updateHealthUI();
    $('#resultCopy').textContent = '越界超过15秒，战机已执行强制自毁。';
  }
}
