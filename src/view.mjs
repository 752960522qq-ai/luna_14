function availableCursorTargets() {
  if (session.gameMode === 'airspace') return airspacePlayerAlive() ? airspaceLiveUnits('red').map(unit => unit.root) : [];
  return session.gameMode === 'campaign' ? campaignTargets().filter(t => t.health > 0).map(t => t.root) : session.enemy && session.eHp > 0 ? [session.enemy] : [];
}
function updateCursorTarget(dt) {
  if (session.gameMode === 'airspace' && !airspacePlayerAlive()) {
    inputState.cursorTarget = null;
    return;
  }
  if (!session.playing) {
    inputState.cursorTarget = null;
    return;
  }
  const targets = availableCursorTargets(),
    isCursor = inputState.controlSettings.mode === 'cursor';
  if (inputState.cursorTarget && !targets.includes(inputState.cursorTarget)) inputState.cursorTarget = null;
  if (inputState.keys.look) return;
  const reference = isCursor ? inputState.cursorDirectionWorld : new THREE.Vector3(0, 0, -1).applyQuaternion(session.player.quaternion);
  let candidate = null,
    bestAngle = isCursor ? .065 : .40;
  for (const root of targets) {
    const relative = root.position.clone().sub(session.player.position),
      distance = relative.length() * METERS_PER_UNIT;
    if (distance < 20 || distance > 3500) continue;
    const angle = Math.acos(THREE.MathUtils.clamp(relative.normalize().dot(reference), -1, 1));
    if (angle < bestAngle) {
      bestAngle = angle;
      candidate = root;
    }
  }
  if (candidate !== inputState.cursorCandidate) {
    inputState.cursorCandidate = candidate;
    inputState.cursorCandidateSeconds = 0;
  }
  if (candidate) {
    inputState.cursorCandidateSeconds += dt;
    if (inputState.cursorCandidateSeconds >= .3) {
      inputState.cursorTarget = candidate;
      inputState.cursorOutsideSeconds = 0;
    }
  }
  if (inputState.cursorTarget) {
    const relative = inputState.cursorTarget.position.clone().sub(session.player.position),
      outside = relative.length() * METERS_PER_UNIT > 4000 || relative.normalize().dot(reference) < Math.cos(isCursor ? .4 : .75);
    inputState.cursorOutsideSeconds = outside ? inputState.cursorOutsideSeconds + dt : 0;
    if (inputState.cursorOutsideSeconds > .45) {
      inputState.cursorTarget = null;
      inputState.cursorCandidate = null;
      inputState.cursorCandidateSeconds = 0;
      inputState.cursorOutsideSeconds = 0;
    }
  }
}
function playerGunReference() {
  for (const id of selectedWeaponIds(session.playerPlane, session.weaponMode)) {
    const spec = weaponInfo[session.playerPlane]?.[id];
    if (!spec) continue;
    const offset = new THREE.Vector3();
    spec.offsets.forEach(o => offset.add(new THREE.Vector3(...o)));
    offset.divideScalar(spec.offsets.length).multiplyScalar(session.player.scale.x).applyQuaternion(session.player.quaternion);
    return {
      id,
      spec,
      origin: session.player.position.clone().add(offset)
    };
  }
  return null;
}
function placeFlightMarker(node, worldPoint, edgeHint = false) {
  const relative = worldPoint.clone().sub(viewState.camera.position),
    inFront = relative.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(viewState.camera.quaternion)) > 0;
  const point = worldPoint.clone().project(viewState.camera),
    visible = inFront && point.z >= -1 && point.z <= 1 && Math.abs(point.x) <= .96 && Math.abs(point.y) <= .94;
  if (!visible && !edgeHint) {
    node.style.display = 'none';
    return false;
  }
  if (!inFront) {
    node.style.display = 'none';
    return false;
  }
  node.style.display = 'block';
  node.classList.toggle('at-edge', !visible);
  node.style.left = (THREE.MathUtils.clamp(point.x, -.94, .94) + 1) * .5 * innerWidth + 'px';
  node.style.top = (1 - THREE.MathUtils.clamp(point.y, -.92, .92)) * .5 * innerHeight + 'px';
  return visible;
}
function updateFlightAimingHUD() {
  if (session.gameMode === 'airspace' && session.airspaceSpectating) {
    for (const id of ['reticle', 'aimCursor', 'leadIndicator']) $('#' + id).style.display = 'none';
    $('#cursorStatus').classList.add('hidden');
    return;
  }
  if (!session.player || !viewState.camera) return;
  const isCursor = inputState.controlSettings.mode === 'cursor',
    gun = playerGunReference(),
    forward = new THREE.Vector3(0, 0, -1).applyQuaternion(session.player.quaternion).normalize(),
    origin = gun?.origin || session.player.position,
    reticle = $('#reticle'),
    ring = $('#aimCursor'),
    lead = $('#leadIndicator'),
    status = $('#cursorStatus');
  if (gun) placeFlightMarker(reticle, origin.clone().addScaledVector(forward, 100));else reticle.style.display = 'none';
  if (isCursor) placeFlightMarker(ring, session.player.position.clone().addScaledVector(inputState.cursorDirectionWorld, 120), true);else ring.style.display = 'none';
  lead.style.display = 'none';
  status.classList.remove('hidden');
  const prefix = isCursor ? '方向环操控' : '摇杆操控';
  if (!gun) {
    status.textContent = prefix + ' · 炮塔自动防御';
    return;
  }
  if (!inputState.cursorTarget) {
    status.textContent = prefix + ' · 指向敌机显示预瞄点';
    if (isCursor && (session.player.userData.instructorRecovering || session.player.userData.instructorEnergyGuard)) status.textContent += ' · 优先恢复速度';
    return;
  }
  const targetName = planeInfo[inputState.cursorTarget.userData.type]?.name || '敌机',
    solution = solveBulletIntercept(gun.origin, inputState.cursorTarget.position, inputState.cursorTarget.userData.velocity, gun.spec.speed / METERS_PER_UNIT);
  if (!solution) {
    status.textContent = targetName + ' · 超出有效弹道';
    return;
  }
  placeFlightMarker(lead, gun.origin.clone().addScaledVector(solution.direction, 100));
  const angle = Math.acos(THREE.MathUtils.clamp(solution.direction.dot(forward), -1, 1));
  lead.classList.toggle('aligned', angle < .015);
  const names = {
    n37: 'N-37',
    ns23: 'NS-23',
    m2: '12.7 mm',
    mg762: '7.62 mm',
    hispano: '20 mm',
    mg: '机枪'
  };
  status.textContent = targetName + ' · ' + (names[gun.id] || '主武器') + '预瞄点' + (angle < .015 ? ' · 准星已对齐' : '');
}
function projectEnemyMarkerPoint(position) {
  const clip = position.clone().project(viewState.camera);
  let nx = clip.x,
    ny = -clip.y;
  const behind = clip.z > 1;
  if (behind) {
    nx = -nx;
    ny = -ny;
  }
  const visible = !behind && clip.z >= -1 && Math.abs(nx) < .9 && Math.abs(ny) < .9;
  if (!visible) {
    if (Math.abs(nx) + Math.abs(ny) < .001) ny = 1;
    const maxX = Math.max(.15, 1 - 36 / innerWidth),
      maxY = Math.max(.15, 1 - 48 / innerHeight),
      scale = Math.min(maxX / Math.max(Math.abs(nx), .001), maxY / Math.max(Math.abs(ny), .001));
    nx *= scale;
    ny *= scale;
  }
  return {
    x: (nx + 1) * innerWidth * .5,
    y: (ny + 1) * innerHeight * .5,
    visible
  };
}
function updateTacticalDisplay() {
  if (session.gameMode === 'airspace') {
    updateAirspaceTacticalDisplay();
    return;
  }
  if (!session.player || !viewState.camera) return;
  const tracked = session.gameMode === 'campaign' ? nearestCampaignTarget()?.root : session.enemy;
  if (!tracked) return;
  viewState.camera.updateMatrixWorld(true);
  if (session.gameMode === 'campaign') updateCampaignEnemyMarkers();else {
    const layer = $('#campaignEnemyMarkers'),
      marker = $('#enemyMarker');
    layer.classList.add('hidden');
    marker.classList.remove('hidden');
    const point = projectEnemyMarkerPoint(tracked.position);
    marker.classList.toggle('offscreen', !point.visible);
    marker.style.left = point.x / innerWidth * 100 + '%';
    marker.style.top = point.y / innerHeight * 100 + '%';
  }
  const canvas = $('#radar'),
    ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    cx = w / 2,
    cy = h / 2,
    r = w * .39;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(5,20,31,.72)';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(105,219,231,.43)';
  ctx.lineWidth = 1;
  for (const f of [.36, .68, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(session.player.quaternion),
    forward = new THREE.Vector3(0, 0, -1).applyQuaternion(session.player.quaternion),
    range = 260;
  const plotBase = (point, color, label) => {
    const rel = point.clone().sub(session.player.position);
    let bx = rel.dot(right) / range * r,
      by = -rel.dot(forward) / range * r,
      bd = Math.hypot(bx, by);
    if (bd > r - 5) {
      bx *= (r - 5) / bd;
      by *= (r - 5) / bd;
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + bx, cy + by, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + bx, cy + by);
  };
  plotBase(blueSpawn, '#39aaff', 'A');
  if (session.gameMode === 'campaign') {
    for (const target of session.campaignBombers) plotBase(target.root.position, '#ff6268', 'B');
    for (const target of session.campaignEscorts) plotBase(target.root.position, '#ffb14d', 'F');
  } else plotBase(redSpawn, '#ff5258', 'B');
  const delta = tracked.position.clone().sub(session.player.position);
  let ex = delta.dot(right) / range * r,
    ey = -delta.dot(forward) / range * r,
    d = Math.hypot(ex, ey);
  if (d > r - 4) {
    ex *= (r - 4) / d;
    ey *= (r - 4) / d;
  }
  ctx.fillStyle = '#ff6e68';
  ctx.shadowColor = '#ff544b';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(cx + ex, cy + ey, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  $('#radarDistance').textContent = Math.round(delta.length() * METERS_PER_UNIT) + ' m';
}
function resetCameraTracking() {
  viewState.cameraTrackedRoot = null;
  viewState.cameraOrbitYaw = 0;
  viewState.cameraOrbitPitch = 0;
  viewState.cameraInputAt = -1;
  viewState.cameraDragPointer = null;
  viewState.cameraPoseInitialized = false;
  inputState.filteredControlX = 0;
  inputState.filteredControlY = 0;
}
function chaseFrameOffsets(type, aspect = viewState.camera.aspect) {
  const spec = AIRCRAFT_SPECS[type],
    baseBack = spec.lengthMeters * .5 + spec.chaseOffsetMeters,
    baseHeight = spec.chaseHeightMeters,
    narrow = CHASE_NARROW_PRESETS[type];
  if (spec.chaseFixed) return { backMeters: baseBack, heightMeters: baseHeight };
  const t = (CHASE_REFERENCE_ASPECT / Math.max(aspect, 1) - 1) / (CHASE_REFERENCE_ASPECT / (16 / 9) - 1);
  return {
    backMeters: baseBack + (narrow[0] - baseBack) * t,
    heightMeters: baseHeight + (narrow[1] - baseHeight) * t
  };
}
function updateChaseCamera(dt) {
  if (!session.player || !viewState.camera) return;
  followCameraAnchor(session.player);
  if (!inputState.keys.look && session.worldTime - viewState.cameraInputAt >= 2) {
    viewState.cameraOrbitYaw = THREE.MathUtils.damp(viewState.cameraOrbitYaw, 0, 2.8, dt);
    viewState.cameraOrbitPitch = THREE.MathUtils.damp(viewState.cameraOrbitPitch, 0, 2.8, dt);
    if (Math.abs(viewState.cameraOrbitYaw) < .002) viewState.cameraOrbitYaw = 0;
    if (Math.abs(viewState.cameraOrbitPitch) < .002) viewState.cameraOrbitPitch = 0;
  }
  const orbit = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), viewState.cameraOrbitYaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), viewState.cameraOrbitPitch));
  const baseViewPose = inputState.controlSettings.mode === 'cursor' ? cursorChaseQuaternion() : session.player.quaternion.clone();
  const trackedPose = baseViewPose.clone().multiply(orbit),
    offset = chaseFrameOffsets(session.playerPlane),
    tailDistance = offset.backMeters / METERS_PER_UNIT,
    chaseHeight = offset.heightMeters / METERS_PER_UNIT;
  const desiredPosition = session.player.position.clone().add(new THREE.Vector3(0, chaseHeight, tailDistance).applyQuaternion(trackedPose));
  const viewForward = new THREE.Vector3(0, 0, -1).applyQuaternion(trackedPose).normalize();
  const lookTarget = session.player.position.clone().addScaledVector(viewForward, 100),
    inverseAircraftPose = baseViewPose.clone().invert();
  const localBack = desiredPosition.clone().sub(lookTarget).applyQuaternion(inverseAircraftPose).normalize(),
    localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orbit).normalize();
  const localRight = new THREE.Vector3().crossVectors(localUp, localBack);
  if (localRight.lengthSq() < 1e-7) {
    localRight.set(1, 0, 0).applyQuaternion(orbit).addScaledVector(localBack, -localRight.dot(localBack));
    if (localRight.lengthSq() < 1e-7) localRight.set(0, 0, 1).applyQuaternion(orbit).addScaledVector(localBack, -localRight.dot(localBack));
  }
  localRight.normalize();
  const localCameraUp = new THREE.Vector3().crossVectors(localBack, localRight).normalize();
  const localPose = new THREE.Matrix4().makeBasis(localRight, localCameraUp, localBack);
  const desiredQuaternion = baseViewPose.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(localPose)).normalize(),
    positionBlend = 1 - Math.exp(-FLIGHT_CONTROL.cameraPositionResponse * dt),
    rotationBlend = 1 - Math.exp(-FLIGHT_CONTROL.cameraRotationResponse * dt);
  if (!viewState.cameraPoseInitialized) {
    viewState.camera.position.copy(desiredPosition);
    viewState.camera.quaternion.copy(desiredQuaternion);
    viewState.cameraPoseInitialized = true;
  } else {
    viewState.camera.position.lerp(desiredPosition, positionBlend);
    viewState.camera.quaternion.slerp(desiredQuaternion, rotationBlend);
  }
  viewState.camera.updateMatrixWorld(true);
  updateAimingReticle();
}
function updateAimingReticle() {
  updateFlightAimingHUD();
}
function followCameraAnchor(root) {
  if (viewState.cameraTrackedRoot !== root) {
    viewState.cameraTrackedRoot = root;
    viewState.cameraPoseInitialized = false;
    viewState.cameraAnchorPosition.copy(root.position);
  } else if (viewState.cameraPoseInitialized) {
    viewState.cameraAnchorDelta.copy(root.position).sub(viewState.cameraAnchorPosition);
    viewState.camera.position.add(viewState.cameraAnchorDelta);
  }
  viewState.cameraAnchorPosition.copy(root.position);
}
function cursorChaseQuaternion() {
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(session.player.quaternion),
    angle = nose.angleTo(inputState.cursorDirectionWorld),
    turn = new THREE.Quaternion().setFromUnitVectors(nose, inputState.cursorDirectionWorld);
  const blend = Math.min(.75, THREE.MathUtils.degToRad(55) / Math.max(angle, .001)),
    view = nose.applyQuaternion(new THREE.Quaternion().slerp(turn, blend)).normalize();
  const flat = view.clone().setY(0);
  if (flat.lengthSq() < .000001) flat.copy(inputState.cursorDirectionWorld).setY(0);
  flat.normalize();
  const heading = Math.atan2(-flat.x, -flat.z),
    pitch = Math.asin(THREE.MathUtils.clamp(view.y, -1, 1));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
}
