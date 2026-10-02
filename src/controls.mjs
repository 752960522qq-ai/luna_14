function loadControlSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONTROL_SETTINGS_KEY) || 'null');
    return {
      mode: saved?.mode === 'joystick' ? 'joystick' : 'cursor',
      sensitivity: THREE.MathUtils.clamp(Number.isFinite(saved?.sensitivity) ? saved.sensitivity : 1, .5, 1.8)
    };
  } catch {
    return {
      ...DEFAULT_CONTROL_SETTINGS
    };
  }
}
function controlModeName() {
  return inputState.controlSettings.mode === 'cursor' ? '瞄准环操作' : '摇杆操作';
}
function saveControlSettings() {
  try {
    localStorage.setItem(CONTROL_SETTINGS_KEY, JSON.stringify(inputState.controlSettings));
  } catch {}
}
function renderControlSettings() {
  document.querySelectorAll('[name="flightControlMode"]').forEach(input => {
    input.checked = input.value === inputState.controlSettings.mode;
  });
  const slider = $('#cursorSensitivity');
  slider.value = inputState.controlSettings.sensitivity;
  slider.disabled = inputState.controlSettings.mode !== 'cursor';
  $('#cursorSensitivityValue').textContent = inputState.controlSettings.sensitivity.toFixed(1) + '×';
  $('#homeControlMode').textContent = controlModeName();
  $('#controlInstructions').textContent = inputState.controlSettings.mode === 'cursor' ? '拖动空白区域移动方向环，松手保持指向。飞机会逐渐转向，实际准星对准提前量圈后再射击。按住“观察”并拖动可自由观察。' : '左右移动摇杆进行滚转；向下拉杆抬头，向上推杆俯冲。松手停止操纵，拖动空白区域可自由观察。指向敌机显示预瞄点，实际准星对齐后开火。';
  applyControlModeUI();
}
function applyControlModeUI() {
  const isCursor = inputState.controlSettings.mode === 'cursor';
  $('#joystick').classList.toggle('hidden', isCursor);
  $('#freeLook').classList.toggle('hidden', !isCursor);
  $('#cursorStatus').classList.remove('hidden');
  if (!isCursor) $('#aimCursor').style.display = 'none';
}
function clearFlightInputs() {
  inputState.flightPointerClearers.forEach(clear => clear());
  for (const key of Object.keys(inputState.keys)) inputState.keys[key] = false;
  inputState.joystickInput.x = 0;
  inputState.joystickInput.y = 0;
  inputState.filteredControlX = 0;
  inputState.filteredControlY = 0;
  inputState.cursorDragPointer = null;
  viewState.cameraDragPointer = null;
  $('#joystickKnob').style.transform = 'translate(-50%,-50%)';
  document.querySelectorAll('[data-key]').forEach(button => button.classList.remove('on'));
}
function resetCursorControl() {
  inputState.cursorDragPointer = null;
  inputState.cursorTarget = null;
  inputState.cursorCandidate = null;
  inputState.cursorCandidateSeconds = 0;
  inputState.cursorOutsideSeconds = 0;
  if (session.player) inputState.cursorDirectionWorld.set(0, 0, -1).applyQuaternion(session.player.quaternion).normalize();else inputState.cursorDirectionWorld.set(0, 0, -1);
  $('#leadIndicator').style.display = 'none';
  applyControlModeUI();
}
function changeControlMode(mode) {
  if (mode !== 'cursor' && mode !== 'joystick') return;
  inputState.controlSettings.mode = mode;
  clearFlightInputs();
  resetCursorControl();
  if (session.player) {
    session.player.userData.aiRollRate = 0;
    session.player.userData.aiPitchRate = 0;
    session.player.userData.bankRate = 0;
    session.player.userData.verticalTurnRate = 0;
    session.player.userData.flightAssist = mode === 'cursor';
  }
  viewState.cameraPoseInitialized = false;
  saveControlSettings();
  renderControlSettings();
}
function moveCursorDirection(dx, dy, width = innerWidth, height = innerHeight) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const scale = THREE.MathUtils.degToRad(viewState.camera?.fov || 63) * inputState.controlSettings.sensitivity * 1.4 / Math.max(height, 1);
  const heading = Math.atan2(-inputState.cursorDirectionWorld.x, -inputState.cursorDirectionWorld.z) - dx * scale;
  const elevation = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(inputState.cursorDirectionWorld.y, -1, 1)) - dy * scale, -Math.PI * 5 / 12, Math.PI * 5 / 12);
  inputState.cursorDirectionWorld.set(-Math.sin(heading) * Math.cos(elevation), Math.sin(elevation), -Math.cos(heading) * Math.cos(elevation)).normalize();
}
function updateCursorFlightControls(dt) {
  const horizontal = (inputState.keys.right ? 1 : 0) - (inputState.keys.left ? 1 : 0),
    vertical = (inputState.keys.down ? 1 : 0) - (inputState.keys.up ? 1 : 0);
  if (horizontal || vertical) moveCursorDirection(horizontal * innerHeight * .55 * dt, vertical * innerHeight * .55 * dt);
  session.player.userData.flightAssist = true;
  const count = Math.max(1, Math.ceil(dt / FLIGHT_PHYSICS.stepSeconds)),
    step = dt / count;
  for (let i = 0; i < count; i++) {
    steerAircraftToward(session.player, inputState.cursorDirectionWorld, step);
    advanceAircraft(session.player, step);
  }
  return session.player.userData.airspeed;
}
function resumeBattle() {
  if (!session.battlePaused || session.ended) return;
  clearFlightInputs();
  session.battlePaused = false;
  session.playing = true;
  session.player.userData.engineRunning = airspacePlayerAlive() && session.pausedEngineRunning;
  $('#end').classList.add('hidden');
  $('#again').textContent = '再次升空　→';
  if (airspacePlayerAlive()) startEngineSound(session.playerPlane);
  viewState.clock.getDelta();
  toast('继续战斗');
}
function shapeStickVector(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= FLIGHT_CONTROL.deadzone) return {
    x: 0,
    y: 0
  };
  const shapedMagnitude = Math.min(1, (Math.min(magnitude, 1) - FLIGHT_CONTROL.deadzone) / (1 - FLIGHT_CONTROL.deadzone)),
    scale = shapedMagnitude / magnitude;
  return {
    x: x * scale,
    y: y * scale
  };
}
function shapeControl(value) {
  const magnitude = Math.abs(value);
  return Math.sign(value) * (.30 * magnitude + .70 * Math.pow(magnitude, 1.5));
}
function readFlightControls(dt) {
  const response = AIRCRAFT_SPECS[session.playerPlane].control;
  const raw = shapeStickVector(inputState.joystickInput.x + (inputState.keys.right ? 1 : 0) - (inputState.keys.left ? 1 : 0), -inputState.joystickInput.y + (inputState.keys.down ? 1 : 0) - (inputState.keys.up ? 1 : 0));
  const pushBlend = 1 - Math.exp(-dt / response.stickAttackSeconds),
    releaseBlend = 1 - Math.exp(-dt / response.stickReleaseSeconds);
  inputState.filteredControlX += (raw.x - inputState.filteredControlX) * (raw.x ? pushBlend : releaseBlend);
  inputState.filteredControlY += (raw.y - inputState.filteredControlY) * (raw.y ? pushBlend : releaseBlend);
  return {
    roll: shapeControl(inputState.filteredControlX),
    pitch: -shapeControl(inputState.filteredControlY)
  };
}
function updatePlayerFlightControls(dt) {
  session.player.userData.throttle = inputState.throttleValue;
  if (inputState.controlSettings.mode === 'cursor') return updateCursorFlightControls(dt);
  session.player.userData.flightAssist = false;
  session.player.userData.instructorRecovering = false;
  session.player.userData.instructorEnergyGuard = false;
  const count = Math.max(1, Math.ceil(dt / FLIGHT_PHYSICS.stepSeconds)),
    step = dt / count;
  for (let i = 0; i < count; i++) {
    const data = session.player.userData,
      controls = readFlightControls(step),
      spec = AIRCRAFT_SPECS[session.playerPlane],
      response = spec.control,
      rollLimit = THREE.MathUtils.degToRad(spec.rollRateDps);
    data.controlRoll = controls.roll;
    data.controlPitch = controls.pitch;
    data.controlAuthority = flightControlAuthority(data);
    data.bankRate = THREE.MathUtils.clamp(THREE.MathUtils.damp(data.bankRate || 0, controls.roll * rollLimit * data.controlAuthority, Math.abs(controls.roll) > .001 ? response.rollResponse : response.rollRelease, step), -rollLimit, rollLimit);
    rotateAircraftLocal(session.player, FLIGHT_AXES.nose, data.bankRate * step);
    data.verticalTurnRate = THREE.MathUtils.damp(data.verticalTurnRate || 0, limitedPitchRate(data, controls.pitch * verticalTurnRateForPlane(session.playerPlane) * data.controlAuthority), response.pitchResponse, step);
    rotateAircraftLocal(session.player, FLIGHT_AXES.x, limitedPitchRate(data, data.verticalTurnRate) * step);
    advanceAircraft(session.player, step);
  }
  return session.player.userData.airspeed;
}
function bindFlightControls() {
  const joystick = $('#joystick'),
    knob = $('#joystickKnob');
  let joystickPointer = null;
  const moveJoystick = e => {
    const r = joystick.getBoundingClientRect(),
      radius = Math.max(1, r.width * .36),
      rawX = e.clientX - (r.left + r.width / 2),
      rawY = e.clientY - (r.top + r.height / 2),
      length = Math.hypot(rawX, rawY),
      scale = length > radius ? radius / length : 1,
      x = rawX * scale,
      y = rawY * scale;
    inputState.joystickInput.x = x / radius;
    inputState.joystickInput.y = y / radius;
    knob.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
  };
  const releaseJoystick = (e = {}) => {
    if (joystickPointer !== null && e.pointerId !== undefined && e.pointerId !== joystickPointer) return;
    joystickPointer = null;
    inputState.joystickInput.x = 0;
    inputState.joystickInput.y = 0;
    knob.style.transform = 'translate(-50%,-50%)';
  };
  joystick.addEventListener('pointerdown', e => {
    if (!session.playing || session.gameMode === 'airspace' && session.airspaceSpectating || inputState.controlSettings.mode !== 'joystick' || joystickPointer !== null && joystickPointer !== e.pointerId) return;
    e.preventDefault();
    joystickPointer = e.pointerId;
    try {
      joystick.setPointerCapture(e.pointerId);
    } catch {}
    moveJoystick(e);
  });
  joystick.addEventListener('pointermove', e => {
    if (e.pointerId === joystickPointer) moveJoystick(e);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => joystick.addEventListener(type, releaseJoystick));
  const canvas = viewState.renderer.domElement;
  canvas.addEventListener('pointerdown', e => {
    if (!session.playing || e.button !== 0) return;
    e.preventDefault();
    if (inputState.controlSettings.mode === 'cursor' && !inputState.keys.look && !(session.gameMode === 'airspace' && session.airspaceSpectating)) {
      if (inputState.cursorDragPointer) return;
      inputState.cursorDragPointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY
      };
    } else {
      if (viewState.cameraDragPointer) return;
      viewState.cameraDragPointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY
      };
      viewState.cameraInputAt = session.worldTime;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });
  canvas.addEventListener('pointermove', e => {
    if (inputState.cursorDragPointer && e.pointerId === inputState.cursorDragPointer.id) {
      const dx = e.clientX - inputState.cursorDragPointer.x,
        dy = e.clientY - inputState.cursorDragPointer.y;
      inputState.cursorDragPointer.x = e.clientX;
      inputState.cursorDragPointer.y = e.clientY;
      moveCursorDirection(dx, dy);
      return;
    }
    if (!viewState.cameraDragPointer || e.pointerId !== viewState.cameraDragPointer.id) return;
    const dx = e.clientX - viewState.cameraDragPointer.x,
      dy = e.clientY - viewState.cameraDragPointer.y;
    viewState.cameraDragPointer.x = e.clientX;
    viewState.cameraDragPointer.y = e.clientY;
    viewState.cameraOrbitYaw = THREE.MathUtils.euclideanModulo(viewState.cameraOrbitYaw - dx * .008 + Math.PI, Math.PI * 2) - Math.PI;
    viewState.cameraOrbitPitch = THREE.MathUtils.clamp(viewState.cameraOrbitPitch + dy * .008, -1.25, 1.25);
    viewState.cameraInputAt = session.worldTime;
  });
  const releaseCanvas = (e = {}) => {
    if (inputState.cursorDragPointer && (e.pointerId === undefined || e.pointerId === inputState.cursorDragPointer.id)) inputState.cursorDragPointer = null;
    if (viewState.cameraDragPointer && (e.pointerId === undefined || e.pointerId === viewState.cameraDragPointer.id)) {
      viewState.cameraDragPointer = null;
      viewState.cameraInputAt = session.worldTime;
    }
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => canvas.addEventListener(type, releaseCanvas));
  const track = $('#throttleTrack');
  let throttlePointer = null;
  const setThrottle = e => {
    const r = track.getBoundingClientRect();
    inputState.throttleValue = THREE.MathUtils.clamp(1 - (e.clientY - r.top) / Math.max(r.height, 1), 0, 1);
    if (session.player) session.player.userData.throttle = inputState.throttleValue;
    updateThrottleUI();
  };
  track.addEventListener('pointerdown', e => {
    if (!session.playing || session.gameMode === 'airspace' && session.airspaceSpectating || throttlePointer !== null && throttlePointer !== e.pointerId) return;
    e.preventDefault();
    throttlePointer = e.pointerId;
    try {
      track.setPointerCapture(e.pointerId);
    } catch {}
    setThrottle(e);
  });
  track.addEventListener('pointermove', e => {
    if (e.pointerId === throttlePointer) setThrottle(e);
  });
  const releaseThrottle = (e = {}) => {
    if (throttlePointer !== null && e.pointerId !== undefined && e.pointerId !== throttlePointer) return;
    throttlePointer = null;
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => track.addEventListener(type, releaseThrottle));
  inputState.flightPointerClearers.push(() => {
    const pointers = [[joystick, joystickPointer], [canvas, inputState.cursorDragPointer?.id], [canvas, viewState.cameraDragPointer?.id], [track, throttlePointer]];
    pointers.forEach(([node, id]) => {
      if (id !== null && id !== undefined) try {
        if (node.hasPointerCapture(id)) node.releasePointerCapture(id);
      } catch {}
    });
    releaseJoystick();
    releaseCanvas();
    releaseThrottle();
  });
}
