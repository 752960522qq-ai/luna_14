function rotateAircraftLocal(root, axis, angle) {
  if (!Number.isFinite(angle) || Math.abs(angle) < 1e-12) return;
  root.quaternion.multiply(flightWorkspace(root, 'rotation').q.setFromAxisAngle(axis, angle)).normalize();
}
function softLimitRate(value, limit) {
  if (limit <= 0) return 0;
  return limit * Math.tanh(value / limit);
}
function flightControlAuthority(data) {
  const airflow = THREE.MathUtils.clamp((data.airspeed || 0) / data.minFlightSpeedMps, .35, 1);
  return airflow * (1 - .45 * THREE.MathUtils.smoothstep(Math.abs(data.aoa || 0), .25, .6));
}
function turnRateForPlane(type, airspeedMps) {
  const info = planeInfo[type];
  if (!info) return 0;
  const timedRate = Number.isFinite(info.horizontalTurnRateDps) ? THREE.MathUtils.degToRad(info.horizontalTurnRateDps) : 2 * Math.PI / Math.max(info.turnTimeS || 24, 1),
    radiusRate = Math.max(0, airspeedMps) / Math.max(info.turnRadiusM || 300, 1);
  return Math.min(timedRate, radiusRate);
}
function verticalTurnRateForPlane(type) {
  const info = planeInfo[type];
  return info && Number.isFinite(info.verticalTurnRateDps) ? THREE.MathUtils.degToRad(info.verticalTurnRateDps) : 0;
}
function steerAircraftToward(aircraft, targetDirection, dt) {
  const w = flightWorkspace(aircraft, 'steering'),
    data = aircraft.userData,
    type = data.type,
    speed = Math.max(data.airspeed || 0, 1),
    authority = flightControlAuthority(data),
    target = limitAICeilingDirection(aircraft, instructorDirection(aircraft, targetDirection, dt)),
    forward = w.a.set(0, 0, -1).applyQuaternion(aircraft.quaternion),
    travel = w.b.copy(data.velocity).normalize(),
    targetFlat = w.c.copy(target).setY(0),
    travelFlat = w.d.copy(travel).setY(0),
    turnLimit = turnRateForPlane(type, speed);
  let targetBank = 0;
  if (targetFlat.lengthSq() > .001 && travelFlat.lengthSq() > .001 && !data.instructorRecovering) {
    targetFlat.normalize();
    travelFlat.normalize();
    const yawError = Math.atan2(w.e.crossVectors(travelFlat, targetFlat).y, THREE.MathUtils.clamp(travelFlat.dot(targetFlat), -1, 1));
    const desiredRate = THREE.MathUtils.clamp(yawError * 1.4, -turnLimit, turnLimit),
      pathHorizontal = Math.sqrt(Math.max(0, 1 - travel.y * travel.y)),
      verticalError = Math.asin(THREE.MathUtils.clamp(target.y, -1, 1)) - Math.asin(THREE.MathUtils.clamp(travel.y, -1, 1));
    const requiredUp = 9.81 * pathHorizontal + speed * THREE.MathUtils.clamp(verticalError * 1.4, -verticalTurnRateForPlane(type) * FLIGHT_PHYSICS.negativePitchFraction, verticalTurnRateForPlane(type));
    if (requiredUp < -4) data.instructorLiftSign = -1;else if (requiredUp > 4) data.instructorLiftSign = 1;
    const liftSign = data.instructorLiftSign || 1;
    targetBank = THREE.MathUtils.clamp(Math.atan2(-speed * desiredRate * pathHorizontal * liftSign, Math.max(3, Math.abs(requiredUp))), -FLIGHT_PHYSICS.maxBankRadians, FLIGHT_PHYSICS.maxBankRadians);
  }
  const up = w.f.set(0, 1, 0).applyQuaternion(aircraft.quaternion),
    horizonUp = w.g.set(0, 1, 0).addScaledVector(forward, -forward.y);
  // Bank is undefined exactly above/below the horizon: keep the current roll reference.
  if (horizonUp.lengthSq() < .0001) horizonUp.copy(up);
  horizonUp.normalize();
  const levelRight = w.h.crossVectors(forward, horizonUp).normalize(),
    bank = Math.atan2(up.dot(levelRight), up.dot(horizonUp)),
    bankError = Math.atan2(Math.sin(targetBank - bank), Math.cos(targetBank - bank)),
    rollLimit = THREE.MathUtils.degToRad(AIRCRAFT_SPECS[type].rollRateDps) * authority;
  data.aiRollRate = THREE.MathUtils.damp(data.aiRollRate || 0, THREE.MathUtils.clamp(bankError * 4.2, -rollLimit, rollLimit), AI_CONTROL.rollResponse, dt);
  rotateAircraftLocal(aircraft, FLIGHT_AXES.nose, data.aiRollRate * dt);
  const local = w.i.copy(target).applyQuaternion(w.q.copy(aircraft.quaternion).invert());
  let pitchError = Math.atan2(local.y, -local.z);
  // An exactly rearward, level target needs a banked turn, not an arbitrary vertical loop.
  if (local.z > 0 && Math.abs(local.y) < .01) pitchError = 0;
  const pitchTarget = limitedPitchRate(data, softLimitRate(pitchError * 3.2, verticalTurnRateForPlane(type) * authority));
  data.aiPitchRate = THREE.MathUtils.damp(data.aiPitchRate || 0, pitchTarget, AI_CONTROL.pitchResponse, dt);
  rotateAircraftLocal(aircraft, FLIGHT_AXES.x, limitedPitchRate(data, data.aiPitchRate) * dt);
}
// PCM slices: one attack per weapon packet; stationary, crossfaded engine loops.

function advanceAircraft(aircraft, dt) {
  const count = Math.max(1, Math.ceil(dt / FLIGHT_PHYSICS.stepSeconds)),
    step = dt / count;
  for (let i = 0; i < count; i++) {
    integrateAircraftFlight(aircraft, step);
    enforceAICeiling(aircraft);
  }
  return aircraft.userData.airspeed;
}
// Fighter tactics use the same steering and flight dynamics as the player.

function recoverAircraftAttitude(root, dt) {
  const travel = flightWorkspace(root, 'recovery').a.copy(root.userData.velocity);
  if (travel.lengthSq() < .001) return;
  steerAircraftToward(root, travel.normalize(), dt);
}
function limitAICeilingDirection(root, direction) {
  const data = root.userData;
  if (data.isPlayer !== false || data.modelContext === 'preview') return direction;
  const ceiling = AI_TACTICS.maxAltitudeMeters / METERS_PER_UNIT - 90,
    gap = (ceiling - root.position.y) * METERS_PER_UNIT;
  if (gap > 180) return direction;
  const result = direction.clone().normalize(),
    speed = Math.max(data.airspeed, 30);
  const climbLimit = THREE.MathUtils.clamp((gap - 50) / (speed * 4), -.20, .20);
  if (result.y <= climbLimit) return result;
  const flat = result.setY(0);
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1).applyQuaternion(root.quaternion).setY(0);
  return flat.normalize().multiplyScalar(Math.sqrt(1 - climbLimit * climbLimit)).setY(climbLimit);
}
function enforceAICeiling(root) {
  const data = root.userData;
  if (data.isPlayer !== false || data.modelContext === 'preview' || data.destroyed) return;
  const ceiling = AI_TACTICS.maxAltitudeMeters / METERS_PER_UNIT - 90;
  if (root.position.y > ceiling) {
    root.position.y = ceiling;
    data.velocity.y = Math.min(data.velocity.y, 0);
    data.airspeed = data.velocity.length() * METERS_PER_UNIT;
  }
}
function limitedPitchRate(data, rate) {
  const limit = verticalTurnRateForPlane(data.type) * flightControlAuthority(data),
    aoa = data.aoa || 0;
  rate = THREE.MathUtils.clamp(rate, -limit * FLIGHT_PHYSICS.negativePitchFraction, limit);
  if (aoa * rate > 0) rate *= THREE.MathUtils.clamp((FLIGHT_PHYSICS.aoaLimit - Math.abs(aoa)) / (FLIGHT_PHYSICS.aoaLimit - FLIGHT_PHYSICS.aoaSoft), 0, 1);
  return rate;
}
function instructorDirection(root, direction, dt) {
  const data = root.userData,
    w = flightWorkspace(root, 'instructor'),
    speed = Math.max(data.airspeed || 0, 1),
    travel = w.a.copy(data.velocity).normalize(),
    forward = w.b.set(0, 0, -1).applyQuaternion(root.quaternion),
    target = w.c.copy(direction).normalize();
  const unsafe = Math.abs(data.aoa || 0) > .30 || forward.dot(travel) < .80;
  data.instructorUnsafeSeconds = unsafe ? (data.instructorUnsafeSeconds || 0) + dt : Math.max(0, (data.instructorUnsafeSeconds || 0) - dt * 2);
  if (unsafe && (data.instructorUnsafeSeconds > .12 || forward.dot(travel) < 0)) data.instructorRecovering = true;
  if (data.instructorRecovering && Math.abs(data.aoa || 0) < .14 && forward.dot(travel) > .97) data.instructorRecovering = false;
  if (data.instructorRecovering && travel.lengthSq() > .1) return travel;
  data.instructorEnergyGuard = false;
  if (target.y > 0) {
    const energy = THREE.MathUtils.smoothstep(speed, data.minFlightSpeedMps * 1.08, data.minFlightSpeedMps * 1.65),
      sustained = Math.min(.5, data.bestClimbMps * Math.max(data.throttle, .25) / speed),
      allowed = THREE.MathUtils.lerp(sustained, Math.sin(Math.PI * 5 / 12), energy);
    if (target.y > allowed) {
      const flat = w.d.copy(target).setY(0).normalize();
      target.copy(flat.multiplyScalar(Math.sqrt(1 - allowed * allowed))).setY(allowed);
      data.instructorEnergyGuard = true;
    }
  }
  return target;
}
function integrateAircraftFlight(aircraft, dt) {
  const data = aircraft.userData,
    w = flightWorkspace(aircraft, 'integration'),
    velocity = data.velocity,
    forward = w.a.set(0, 0, -1).applyQuaternion(aircraft.quaternion).normalize(),
    up = w.b.set(0, 1, 0).applyQuaternion(aircraft.quaternion).normalize(),
    right = w.c.set(1, 0, 0).applyQuaternion(aircraft.quaternion).normalize();
  const velocityMps = w.d.copy(velocity).multiplyScalar(METERS_PER_UNIT);
  let speed = velocityMps.length();
  const throttle = THREE.MathUtils.clamp(data.throttle, 0, 1),
    along = Math.max(0, velocityMps.dot(forward)),
    propSpec = PROPELLER_SPECS[data.type],
    enginePower = propSpec && Number.isFinite(data.propRpm) ? THREE.MathUtils.clamp(data.propRpm / propSpec.maxRpm, 0, 1) : 1;
  const powerLimit = .018 * speed + 9.81 * data.bestClimbMps * Math.max(throttle, .05) / Math.max(speed, data.minFlightSpeedMps * .75);
  const thrust = data.engineRunning !== false ? THREE.MathUtils.clamp((data.maxSpeedMps * throttle - along) * .85 + (AIRCRAFT_SPECS[data.type].levelDragCompensation || 0) * along, 0, Math.min(18, powerLimit)) * enginePower : 0;
  velocity.addScaledVector(forward, thrust / METERS_PER_UNIT * dt);
  velocityMps.copy(velocity).multiplyScalar(METERS_PER_UNIT);
  speed = velocityMps.length();
  const travel = speed > .01 ? w.e.copy(velocityMps).divideScalar(speed) : w.e.copy(forward),
    aoa = Math.atan2(-velocityMps.dot(up), Math.max(velocityMps.dot(forward), .01)),
    absAoA = Math.abs(aoa),
    lowLift = THREE.MathUtils.clamp(speed / data.minFlightSpeedMps, 0, 1),
    stall = THREE.MathUtils.smoothstep(absAoA, .20, .56),
    turnLimit = turnRateForPlane(data.type, speed),
    verticalLimit = verticalTurnRateForPlane(data.type),
    horizontalLimit = speed * turnLimit;
  const liftAxis = w.f.copy(up).addScaledVector(travel, -up.dot(travel));
  if (liftAxis.lengthSq() > .00001) liftAxis.normalize();else liftAxis.copy(up);
  const upright = Math.max(0, liftAxis.y),
    trimLoad = upright > 0 ? 1 / Math.max(upright, .10) : 1,
    maxLift = 9.81 + speed * Math.max(turnLimit, verticalLimit),
    minLift = -speed * verticalLimit * FLIGHT_PHYSICS.negativePitchFraction;
  const lift = THREE.MathUtils.clamp((9.81 * Math.max(0, 1 - travel.y * travel.y) * trimLoad + speed * FLIGHT_PHYSICS.liftResponse * aoa) * lowLift * lowLift * (1 - .76 * stall), minLift, maxLift);
  const acceleration = liftAxis.multiplyScalar(lift),
    slip = THREE.MathUtils.clamp(velocityMps.dot(right) / Math.max(speed, .01), -1, 1),
    slipAxis = w.g.copy(right).addScaledVector(travel, -right.dot(travel));
  let slipAssist = 0;
  if (slipAxis.lengthSq() > .00001) {
    slipAssist = Math.min(Math.abs(velocityMps.dot(right)) * 1.8, horizontalLimit * (data.ai || data.flightAssist ? .5 : .3)) * lowLift * (1 - stall * .7);
    acceleration.addScaledVector(slipAxis.normalize(), -Math.sign(slip) * slipAssist);
  }
  const horizontal = Math.hypot(acceleration.x, acceleration.z);
  if (horizontal > horizontalLimit && horizontal > 0) {
    acceleration.x *= horizontalLimit / horizontal;
    acceleration.z *= horizontalLimit / horizontal;
  }
  velocity.addScaledVector(acceleration, dt / METERS_PER_UNIT);
  velocity.y -= 9.81 / METERS_PER_UNIT * dt;
  const yawRate = THREE.MathUtils.clamp(-Math.asin(slip) * 6, -turnLimit, turnLimit) * lowLift;
  rotateAircraftLocal(aircraft, FLIGHT_AXES.y, yawRate * dt);
  const overspeed = Math.max(0, velocity.length() * METERS_PER_UNIT / data.maxSpeedMps - 1),
    turnLoad = THREE.MathUtils.clamp(horizontal / 9.81, 0, 2.4),
    drag = .018 + Math.min(absAoA, .55) ** 2 * .22 + Math.min(Math.abs(slip), .7) ** 2 * .16 + stall * .10 + overspeed * overspeed * 2 + .002 * turnLoad * turnLoad + (AIRCRAFT_SPECS[data.type].highSpeedTurnDrag || 0) * turnLoad * turnLoad * THREE.MathUtils.smoothstep(speed, data.maxSpeedMps * .75, data.maxSpeedMps);
  velocity.multiplyScalar(Math.exp(-drag * dt));
  aircraft.position.addScaledVector(velocity, dt);
  data.aoa = aoa;
  data.sideslip = Math.asin(slip);
  data.slipAssistAcceleration = slipAssist;
  data.turnRate = THREE.MathUtils.clamp(w.h.copy(travel).cross(acceleration).y / Math.max(speed, .01), -turnLimit, turnLimit);
  data.airspeed = velocity.length() * METERS_PER_UNIT;
  return data.airspeed;
}
function flightWorkspace(root, name) {
  const stores = root.userData.workspaces ??= {};
  if (!stores[name]) stores[name] = {
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    c: new THREE.Vector3(),
    d: new THREE.Vector3(),
    e: new THREE.Vector3(),
    f: new THREE.Vector3(),
    g: new THREE.Vector3(),
    h: new THREE.Vector3(),
    i: new THREE.Vector3(),
    j: new THREE.Vector3(),
    k: new THREE.Vector3(),
    l: new THREE.Vector3(),
    q: new THREE.Quaternion()
  };
  return stores[name];
}
