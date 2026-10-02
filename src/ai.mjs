function duelOpponentsFor(type) {
  const rating = AIRCRAFT_TREE[type]?.rating;
  if (!Number.isFinite(rating)) return [];
  return Object.keys(AIRCRAFT_TREE).filter(candidate => Math.abs(AIRCRAFT_TREE[candidate].rating - rating) <= DUEL_RATING_RANGE + 1e-9);
}
function chooseDuelOpponent(type, random = Math.random) {
  const eligible = duelOpponentsFor(type);
  if (!eligible.length) throw new Error('没有符合权重范围的对手：' + type);
  return eligible[Math.min(eligible.length - 1, Math.floor(random() * eligible.length))];
}
// Fighter tactics use the same steering and flight dynamics as the player.
function initializeFighterAI(root, role, index = 0) {
  root.userData.engineRunning = true;
  root.userData.ai = {
    role,
    index,
    state: 'GUARD',
    stateAge: 0,
    decisionRemaining: 0,
    goal: root.position.clone(),
    breakGoal: null,
    fireIntent: {},
    telemetry: null,
    targetAcquired: false,
    escortThreat: false,
    unsafeSeconds: 0,
    stableSeconds: 0,
    formationOffset: new THREE.Vector3(),
    recoveries: 0,
    contact: { phase: 'UNSEEN', reactionRemaining: 0, age: 0, closestMeters: Infinity, target: null, goal: null },
    headOnBurstRemaining: 0,
    headOnPauseRemaining: 0
  };
  return root.userData.ai;
}
function updateAIFirstContact(root, target, dt) {
  const data = root.userData, ai = data.ai, contact = ai.contact;
  const range = root.position.distanceTo(target.position) * METERS_PER_UNIT;
  if (contact.phase === 'UNSEEN') {
    if (range >= AI_FIGHTER[data.type].detectMeters) return null;
    contact.reactionRemaining = THREE.MathUtils.lerp(AI_CONTACT_RULES.reactionMinSeconds, AI_CONTACT_RULES.reactionMaxSeconds, Math.random());
    contact.phase = 'MANEUVER';
    contact.target = target;
    contact.forward = data.velocity.clone().setY(0);
    if (contact.forward.lengthSq() < .001) contact.forward.set(0, 0, -1).applyQuaternion(root.quaternion).setY(0);
    contact.forward.normalize();
    // Each aircraft flies past on its own right. Opposing formations therefore
    // take opposite sides, and each slot has a different lane and reaction time.
    contact.right = new THREE.Vector3().crossVectors(contact.forward, new THREE.Vector3(0, 1, 0)).normalize();
    contact.goal = root.position.clone().addScaledVector(contact.forward, (range + AI_CONTACT_RULES.pullAwayMeters) / METERS_PER_UNIT)
      .addScaledVector(contact.right, (150 + ai.index * 35) / METERS_PER_UNIT);
    contact.goal.y += (ai.index % 3) * 2;
    contact.passLimitSeconds = THREE.MathUtils.clamp(range / Math.max(data.airspeed, 50) + 4, 12, 35);
  }
  contact.reactionRemaining = Math.max(0, contact.reactionRemaining - dt);
  contact.age += dt;
  if (contact.phase === 'MANEUVER' && contact.reactionRemaining <= 0) {
    contact.phase = ai.role === 'airspace' ? 'APPROACH' : 'COMPLETE';
    contact.age = 0;
  }
  if (ai.role !== 'airspace' || contact.phase === 'COMPLETE') return null;
  const tracked = contact.target, relative = tracked.position.clone().sub(root.position), trackedRange = relative.length() * METERS_PER_UNIT;
  contact.closestMeters = Math.min(contact.closestMeters, trackedRange);
  const crossed = contact.closestMeters < AI_CONTACT_RULES.passRangeMeters &&
    (relative.dot(contact.forward) <= 0 || trackedRange > contact.closestMeters + 180);
  if ((contact.phase === 'APPROACH' || contact.phase === 'MANEUVER') &&
      (crossed || tracked.userData.destroyed || contact.age > contact.passLimitSeconds)) {
    contact.phase = 'PULL_AWAY';
    contact.age = 0;
    contact.crossPosition = root.position.clone();
    contact.goal = root.position.clone().addScaledVector(contact.forward, AI_CONTACT_RULES.pullAwayMeters / METERS_PER_UNIT)
      .addScaledVector(contact.right, 12 + ai.index * 2);
  }
  if (contact.phase === 'PULL_AWAY') {
    const travelled = root.position.distanceTo(contact.crossPosition) * METERS_PER_UNIT;
    if (contact.reactionRemaining <= 0 && contact.age >= AI_CONTACT_RULES.minimumPullAwaySeconds + ai.index * .12 &&
        (trackedRange >= AI_CONTACT_RULES.separationMeters && travelled >= 400 || contact.age >= AI_CONTACT_RULES.maximumPullAwaySeconds)) {
      contact.phase = 'COMPLETE';
      changeAIState(ai, 'INTERCEPT', true);
    }
  }
  return contact.phase === 'COMPLETE' ? null : safeAIGoal(root, contact.goal);
}
function changeAIState(ai, state, force = false) {
  if (ai.state === state) return false;
  if (!force && ai.stateAge < (AI_TACTICS.minStateSeconds[ai.state] || 0)) return false;
  ai.state = state;
  ai.stateAge = 0;
  ai.decisionRemaining = 0;
  if (state !== 'BREAK') ai.breakGoal = null;
  return true;
}
function chooseAIBreakPoint(root, target, center) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion).setY(0).normalize(),
    right = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion).setY(0).normalize(),
    fromTarget = root.position.clone().sub(target.position),
    side = right.dot(fromTarget) >= 0 ? 1 : -1;
  let goal = root.position.clone().addScaledVector(forward, 105).addScaledVector(right, side * 90).add(new THREE.Vector3(0, 45, 0));
  if (goal.distanceTo(center) * METERS_PER_UNIT > AI_TACTICS.escortLeashMeters && root.userData.ai.role === 'escort') goal = center.clone().add(new THREE.Vector3(side * 30, 35, 0));
  return safeAIGoal(root, goal);
}
function aiFormationGoal(root, formationRoot, seconds) {
  const offset = root.userData.ai.formationOffset.clone().applyQuaternion(formationRoot.quaternion);
  return formationRoot.position.clone().addScaledVector(formationRoot.userData.velocity, seconds).add(offset);
}
function decideFighterAI(root, target, center) {
  const ai = root.userData.ai,
    type = root.userData.type,
    config = AI_FIGHTER[type],
    toTarget = target.position.clone().sub(root.position),
    distance = toTarget.length() * METERS_PER_UNIT,
    fromCenter = root.position.distanceTo(center) * METERS_PER_UNIT,
    targetFromCenter = target.position.distanceTo(center) * METERS_PER_UNIT,
    ammo = ai.role === 'escort' || ai.role === 'airspace' ? root.userData.ammo : session.enemyAmmo,
    mode = ai.role === 'escort' || ai.role === 'airspace' ? root.userData.weaponMode : session.enemyWeaponMode;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion),
    alignment = distance > 1 ? forward.dot(toTarget.clone().normalize()) : 0,
    local = toTarget.clone().applyQuaternion(root.quaternion.clone().invert());
  // Separate enter and exit ranges prevent a target at the 3 km boundary from
  // repeatedly flipping between GUARD and INTERCEPT.
  ai.targetAcquired = ai.targetAcquired ? distance < config.loseMeters : distance < config.detectMeters;
  if (ai.role === 'escort') ai.escortThreat = ai.escortThreat ? targetFromCenter < AI_TACTICS.escortTargetExitMeters : targetFromCenter < AI_TACTICS.escortEngageMeters;
  const available = ai.targetAcquired && (ai.role !== 'escort' || ai.escortThreat);
  if (ai.state === 'RECOVER') {
    if (ai.stateAge >= AI_TACTICS.minStateSeconds.RECOVER && ai.stableSeconds >= AI_TACTICS.recoveryStableSeconds) changeAIState(ai, ai.role === 'escort' ? 'REJOIN' : available ? 'INTERCEPT' : 'GUARD', true);
  } else if (ai.role === 'escort' && fromCenter >= AI_TACTICS.escortReturnTriggerMeters && ai.state !== 'REJOIN') changeAIState(ai, 'REJOIN', true);else if (ai.state === 'BREAK') {
    if (ai.stateAge >= AI_TACTICS.minStateSeconds.BREAK && (ai.stateAge > 2.1 || distance > config.alignMeters)) changeAIState(ai, ai.role === 'escort' ? 'REJOIN' : available ? 'INTERCEPT' : 'GUARD');
  } else if (!available) {
    const fallback = ai.role === 'escort' && (ai.state === 'GUARD' || ai.state === 'REJOIN' && fromCenter < AI_TACTICS.escortReturnMeters) ? 'GUARD' : ai.role === 'escort' ? 'REJOIN' : 'GUARD';
    if (ai.state !== fallback) changeAIState(ai, fallback, true);
  } else if (ai.state === 'GUARD') changeAIState(ai, 'INTERCEPT');else if (ai.state === 'REJOIN') {
    if (ai.role === 'duel' || fromCenter < AI_TACTICS.escortReturnMeters) changeAIState(ai, 'INTERCEPT');
  } else if (ai.state === 'INTERCEPT') {
    if (distance < config.alignMeters && local.z < 0) changeAIState(ai, 'ALIGN');
  } else if (ai.state === 'ALIGN') {
    if (distance > config.alignMeters * 1.4 || local.z > 0) changeAIState(ai, 'INTERCEPT', true);else if (alignment > .97 && distance < config.alignMeters * .9) changeAIState(ai, 'FIRE_PASS');
  } else if (ai.state === 'FIRE_PASS' && (ai.stateAge > config.passSeconds || distance < config.breakMeters || local.z > 12)) {
    if (changeAIState(ai, 'BREAK')) ai.breakGoal = chooseAIBreakPoint(root, target, center);
  }
  if (ai.state === 'BREAK' && !ai.breakGoal) ai.breakGoal = chooseAIBreakPoint(root, target, center);
  if (ai.state === 'BREAK') ai.goal = ai.breakGoal.clone();else if (ai.state === 'REJOIN' && ai.role === 'escort' && ai.formationRoot) ai.goal = aiFormationGoal(root, ai.formationRoot, THREE.MathUtils.clamp(fromCenter / Math.max(root.userData.airspeed, 1), 4, 8));else if (ai.state === 'GUARD' && ai.role === 'escort' && ai.formationRoot) ai.goal = aiFormationGoal(root, ai.formationRoot, 5);else if (ai.state === 'REJOIN' || ai.state === 'GUARD') ai.goal = AI_DUEL_CENTER.clone().add(new THREE.Vector3(45 * Math.cos(session.worldTime * .15), 10, 45 * Math.sin(session.worldTime * .15)));else if (ai.state === 'RECOVER') ai.goal = root.position.clone().addScaledVector(root.userData.velocity, 3);else if (ai.state === 'INTERCEPT') ai.goal = target.position.clone().addScaledVector(target.userData.velocity, Math.min(distance / Math.max(root.userData.airspeed, 1), 1.4));else {
    const id = selectedWeaponIds(type, mode).find(name => weaponInfo[type]?.[name] && ammo?.[name] >= weaponInfo[type][name].cost),
      spec = weaponInfo[type]?.[id],
      intercept = spec && solveBulletIntercept(muzzleWorldPoint(root, spec), target.position, target.userData.velocity, spec.speed / METERS_PER_UNIT);
    ai.goal = intercept?.point || target.position.clone();
  }
  ai.goal = safeAIGoal(root, ai.goal);
  ai.telemetry = {
    state: ai.state,
    distanceMeters: distance,
    escortDistanceMeters: fromCenter,
    targetFromCenterMeters: targetFromCenter,
    goal: ai.goal.clone(),
    headingVelocityDot: ai.headingVelocityDot,
    lateralVelocityMps: ai.lateralVelocityMps,
    recoveries: ai.recoveries,
    armed: selectedWeaponIds(type, mode).some(id => weaponInfo[type]?.[id] && ammo?.[id] >= weaponInfo[type][id].cost)
  };
}
function aiFireIntent(root, target, dt = FLIGHT_PHYSICS.stepSeconds) {
  const data = root.userData,
    ai = data.ai,
    type = data.type,
    config = AI_FIGHTER[type],
    mode = ai.role === 'escort' || ai.role === 'airspace' ? data.weaponMode : session.enemyWeaponMode,
    ammo = ai.role === 'escort' || ai.role === 'airspace' ? data.ammo : session.enemyAmmo,
    forward = new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion).normalize(),
    local = target.position.clone().sub(root.position).applyQuaternion(root.quaternion.clone().invert()),
    intent = {};
  ai.fireIntent = intent;
  ai.headOnPauseRemaining = Math.max(0, ai.headOnPauseRemaining - dt);
  if (data.boundaryReturning || data.instructorRecovering || ai.state !== 'FIRE_PASS' || local.z >= 0 ||
      ai.contact.reactionRemaining > 0 || ai.role === 'airspace' && ai.contact.phase !== 'COMPLETE') return intent;
  const relative = target.position.clone().sub(root.position).normalize(), targetVelocity = target.userData.velocity;
  const headOn = targetVelocity.lengthSq() > .001 && forward.dot(targetVelocity.clone().normalize()) < -.65 &&
    targetVelocity.dot(relative) < -3;
  if (headOn && ai.headOnPauseRemaining > 0) return intent;
  for (const id of selectedWeaponIds(type, mode)) {
    const spec = weaponInfo[type]?.[id],
      gun = config.gun[id];
    if (!spec || !gun || ammo?.[id] < spec.cost) continue;
    const origin = muzzleWorldPoint(root, spec),
      intercept = solveBulletIntercept(origin, target.position, target.userData.velocity, spec.speed / METERS_PER_UNIT);
    if (!intercept || origin.distanceTo(target.position) * METERS_PER_UNIT > gun.rangeMeters) continue;
    const alignment = forward.dot(intercept.direction),
      cone = Math.cos(THREE.MathUtils.degToRad(gun.coneDeg));
    if (alignment < cone || !terrainLineClear(origin, intercept.point)) continue;
    if (headOn) {
      const range = origin.distanceTo(target.position) * METERS_PER_UNIT;
      const missMeters = intercept.point.distanceTo(origin) * METERS_PER_UNIT * Math.sqrt(Math.max(0, 1 - alignment * alignment));
      const radius = Math.max(1.5, (target.userData.collisionHalfExtents?.x || .3) * METERS_PER_UNIT * .65);
      const probability = Math.exp(-.5 * (missMeters / radius) ** 2) * THREE.MathUtils.clamp(ai.headingVelocityDot ?? 1, 0, 1);
      if (range > Math.min(gun.rangeMeters, AI_CONTACT_RULES.headOnRangeMeters) ||
          alignment < Math.cos(THREE.MathUtils.degToRad(AI_CONTACT_RULES.headOnConeDegrees)) || probability < AI_CONTACT_RULES.headOnHitProbability) continue;
    }
    intent[id] = true;
  }
  if (headOn && Object.keys(intent).length) {
    if (ai.headOnBurstRemaining <= 0) ai.headOnBurstRemaining = AI_CONTACT_RULES.headOnBurstSeconds;
    ai.headOnBurstRemaining -= dt;
    if (ai.headOnBurstRemaining <= 0) ai.headOnPauseRemaining = AI_CONTACT_RULES.headOnPauseSeconds;
  } else if (!headOn) ai.headOnBurstRemaining = 0;
  ai.fireIntent = intent;
  return intent;
}
function updateFighterAI(root, target, center, dt, orderGoal = null) {
  const w = flightWorkspace(root, 'fighter'),
    data = root.userData,
    ai = data.ai;
  if (!ai || !target) return;
  const openingGoal = updateAIFirstContact(root, target, dt);
  if (openingGoal && !data.airspaceUnit?.resupplying) orderGoal = openingGoal;
  ai.stateAge += dt;
  ai.decisionRemaining -= dt;
  const forward = w.a.set(0, 0, -1).applyQuaternion(root.quaternion),
    travel = w.b.copy(data.velocity),
    speed = travel.length() * METERS_PER_UNIT;
  ai.headingVelocityDot = speed > .5 ? forward.dot(travel.normalize()) : 1;
  ai.lateralVelocityMps = data.velocity.dot(w.c.set(1, 0, 0).applyQuaternion(root.quaternion)) * METERS_PER_UNIT;
  const unsafe = ai.headingVelocityDot < AI_TACTICS.recoveryEnterDot || speed < data.minFlightSpeedMps * .68;
  ai.unsafeSeconds = unsafe ? ai.unsafeSeconds + dt : Math.max(0, ai.unsafeSeconds - dt * 2);
  ai.stableSeconds = ai.headingVelocityDot > AI_TACTICS.recoveryExitDot && speed > data.minFlightSpeedMps * .9 ? ai.stableSeconds + dt : 0;
  if (ai.state !== 'RECOVER' && (ai.headingVelocityDot < 0 || ai.unsafeSeconds >= AI_TACTICS.recoveryEnterSeconds)) {
    changeAIState(ai, 'RECOVER', true);
    ai.recoveries++;
    ai.stableSeconds = 0;
  }
  if (ai.decisionRemaining <= 0) {
    decideFighterAI(root, target, center);
    do {
      ai.decisionRemaining += AI_TACTICS.decisionSeconds;
    } while (ai.decisionRemaining <= 0);
  }
  const toGoal = safeAIGoal(root, orderGoal || ai.goal).sub(root.position),
    goalAlignment = toGoal.lengthSq() > .001 ? forward.dot(w.d.copy(toGoal).normalize()) : 1;
  if (ai.role === 'escort') {
    const slotDistance = ai.formationRoot ? root.position.distanceTo(aiFormationGoal(root, ai.formationRoot, 2)) * METERS_PER_UNIT : 0;
    let desiredKmh;
    if (ai.state === 'REJOIN') desiredKmh = slotDistance > 300 && goalAlignment > .65 ? THREE.MathUtils.clamp(430 + slotDistance * .18, 430, 650) : THREE.MathUtils.clamp(320 + slotDistance * .18, 320, 500);else if (ai.state === 'GUARD') desiredKmh = THREE.MathUtils.clamp(320 + slotDistance * .20, 320, 450);else desiredKmh = data.campaignCruiseKmh + 60;
    data.throttle = ai.state === 'RECOVER' ? .95 : THREE.MathUtils.clamp(desiredKmh / planeInfo.f86.maxSpeedKmh, .27, .9);
  } else if (ai.role === 'airspace' && orderGoal) data.throttle = ai.state === 'RECOVER' ? .95 : data.airspaceNavigationThrottle;else data.throttle = ai.state === 'RECOVER' ? .95 : THREE.MathUtils.clamp(.78 + (ai.state === 'INTERCEPT' || ai.state === 'FIRE_PASS' ? .11 : 0), .35, .95);
  if (openingGoal && !data.airspaceUnit?.resupplying && ai.state !== 'RECOVER') data.throttle = .88;
  const boundaryGoal = duelBoundaryReturnGoal(root),
    direction = ai.role === 'airspace' && orderGoal ? airspaceFlightDirection(root, boundaryGoal || safeAIGoal(root, orderGoal)) : boundaryGoal ? boundaryGoal.sub(root.position) : toGoal;
  const count = Math.max(1, Math.ceil(dt / FLIGHT_PHYSICS.stepSeconds)),
    step = dt / count;
  for (let i = 0; i < count; i++) {
    if (ai.state === 'RECOVER' && !boundaryGoal) recoverAircraftAttitude(root, step);else if (direction.lengthSq() > .001) steerAircraftToward(root, direction, step);
    advanceAircraft(root, step);
    enforceDuelAIBoundary(root);
  }
  if (ai.telemetry) ai.telemetry.boundaryReturning = !!data.boundaryReturning;
  const actualForward = w.e.set(0, 0, -1).applyQuaternion(root.quaternion),
    actualSpeed = data.velocity.length();
  ai.headingVelocityDot = actualSpeed > .001 ? actualForward.dot(w.b.copy(data.velocity).divideScalar(actualSpeed)) : 1;
  ai.lateralVelocityMps = data.velocity.dot(w.c.set(1, 0, 0).applyQuaternion(root.quaternion)) * METERS_PER_UNIT;
  if (ai.telemetry) {
    ai.telemetry.headingVelocityDot = ai.headingVelocityDot;
    ai.telemetry.lateralVelocityMps = ai.lateralVelocityMps;
    ai.telemetry.speedKmh = data.airspeed * 3.6;
    ai.telemetry.throttle = data.throttle;
    ai.telemetry.unsafeSeconds = ai.unsafeSeconds;
    ai.telemetry.contactPhase = ai.contact.phase;
    ai.telemetry.reactionRemaining = ai.contact.reactionRemaining;
  }
  // Opening flight orders keep the guns silent throughout the first crossing
  // and separation, including frames where the normal AI has entered FIRE_PASS.
  fireWeapons(root, true, dt, orderGoal ? false : aiFireIntent(root, target, dt));
}
