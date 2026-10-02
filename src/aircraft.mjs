function loadPlaneModel(type) {
  const spec = AIRCRAFT_SPECS[type];
  if (!spec) throw new Error('未知飞机型号：' + type);
  if (!resourceState.planeModelPromises[type]) {
    const request = planeModelLoader.loadAsync(spec.modelFile).then(gltf => gltf.scene);
    resourceState.planeModelPromises[type] = request.catch(error => {
      delete resourceState.planeModelPromises[type];
      console.error('无法加载飞机模型：' + type, error);
      throw error;
    });
  }
  return resourceState.planeModelPromises[type];
}
function makePropellerBlurTexture() {
  if (resourceState.propellerBlurTexture) return resourceState.propellerBlurTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d'),
    pixels = context.createImageData(256, 256);
  const smooth = (a, b, value) => {
    const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = (x - 127.5) / 127.5,
      dy = (y - 127.5) / 127.5,
      r = Math.hypot(dx, dy),
      angle = Math.atan2(dy, dx);
    const rim = smooth(.16, .29, r) * (1 - smooth(.87, 1, r)),
      streak = Math.pow(Math.max(0, Math.cos(2 * angle + 10 * r)), 10);
    const alpha = rim * (.22 + .18 * streak + .055 * Math.cos(14 * angle - 4 * r) ** 2),
      i = (y * 256 + x) * 4;
    pixels.data[i] = 190;
    pixels.data[i + 1] = 204;
    pixels.data[i + 2] = 204;
    pixels.data[i + 3] = Math.round(255 * alpha);
  }
  context.putImageData(pixels, 0, 0);
  resourceState.propellerBlurTexture = new THREE.CanvasTexture(canvas);
  return resourceState.propellerBlurTexture;
}
// All bounds/hinges here are in aircraft coordinates: +Y up, +Z aft, 1 unit = 10 m.
function aircraftLocalBounds(root, objects) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    box = new THREE.Box3(),
    point = new THREE.Vector3();
  for (const object of objects) object.traverse(node => {
    if (!node.isMesh) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const bounds = node.geometry.boundingBox,
      matrix = inverse.clone().multiply(node.matrixWorld);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) box.expandByPoint(point.set(x, y, z).applyMatrix4(matrix));
  });
  return box;
}
function configureCombatLandingGear(root, model) {
  const type = root.userData.type;
  if (root.userData.modelContext === 'preview' || !['f3f2', 'p36a'].includes(type)) return;
  const settings = type === 'f3f2' ? {
    mainY: -.040,
    mainX: .033,
    rearShift: .025,
    tailY: -.025,
    tailFloor: -.025
  } : {
    mainY: .007,
    mainX: .020,
    rearShift: 0,
    tailY: .008,
    tailFloor: -.004
  };
  // Cylinder_29 / Cylinder001_30 are separately authored P-36A wheel hubs.
  const patterns = type === 'f3f2' ? [/^(?:gear_l\d*|wheel_l)$/i, /^(?:gear_r\d*|wheel_r)$/i, /^(?:gear_c\d*|wheel_c)$/i] : [/^(?:left.*gear.*|Cylinder_29)$/i, /^(?:right.*gear.*|Cylinder001_30)$/i, /^tail.*(?:gear|wheel)/i];
  const assemblies = [];
  for (let i = 0; i < patterns.length; i++) {
    const parts = [];
    model.traverse(node => {
      if (patterns[i].test(node.name)) parts.push(node);
    });
    const wheels = parts.filter(node => /wheel/i.test(node.name) && !/cover|ax/i.test(node.name));
    if (!parts.length || !wheels.length) throw new Error('缺少起落架节点：' + type + ' / ' + i);
    const before = aircraftLocalBounds(root, wheels).getCenter(new THREE.Vector3()),
      bounds = aircraftLocalBounds(root, parts),
      pivot = new THREE.Group();
    pivot.name = 'FlightGear_' + ['Left', 'Right', 'Tail'][i];
    pivot.position.set(before.x, bounds.max.y, before.z);
    root.add(pivot);
    // Attach preserves the authored geometry, while keeping this transform exclusive to this clone.
    for (const part of parts) pivot.attach(part);
    pivot.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    const turned = aircraftLocalBounds(root, wheels).getCenter(new THREE.Vector3()),
      targetX = i === 2 ? 0 : Math.sign(before.x) * settings.mainX;
    pivot.position.x += targetX - turned.x;
    pivot.position.y += (i === 2 ? settings.tailY : settings.mainY) - turned.y;
    if (i !== 2) pivot.position.z += settings.rearShift;
    root.updateMatrixWorld(true);
    if (i === 2) {
      const foldedBounds = aircraftLocalBounds(root, parts);
      pivot.position.y += Math.max(0, settings.tailFloor - foldedBounds.min.y);
      root.updateMatrixWorld(true);
    }
    const after = aircraftLocalBounds(root, wheels).getCenter(new THREE.Vector3());
    assemblies.push({
      name: pivot.name,
      pivot,
      parts: parts.map(part => part.name),
      wheelBefore: before.toArray(),
      wheelAfter: after.toArray(),
      foldAngleDegrees: -90
    });
  }
  root.userData.landingGear = {
    state: 'stowed',
    assemblies
  };
}
// The source GLB and catalog keep their authored, extended landing gear.
function configureMiG3CombatLandingGear(root, model) {
  if (root.userData.type !== 'mig3' || root.userData.modelContext === 'preview') return;
  root.updateMatrixWorld(true);
  const sourceFrame = model.getObjectByName('MiG3_8_25m_YUp_NoseMinusZ');
  if (!sourceFrame) throw new Error('缺少 MiG-3 标准尺寸节点');
  const point = (x, y, z) => root.worldToLocal(sourceFrame.localToWorld(new THREE.Vector3(x, y, z)));
  const scale = point(1, 0, 0).distanceTo(point(0, 0, 0));
  const part = name => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error('缺少 MiG-3 起落架部件：' + name);
    return node;
  };
  const assemblies = [],
    doorMaterial = ownAircraftResource(root, new THREE.MeshStandardMaterial({
      color: 0x3d728a,
      roughness: .82,
      metalness: .12
    }));
  function closedDoors(name, side) {
    const doors = new THREE.Group();
    doors.name = name;
    root.add(doors);
    const count = side ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const width = side ? .498 : .058,
        length = side ? .84 : .52;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(width * scale, .008 * scale, length * scale), doorMaterial);
      ownAircraftResource(root, panel.geometry);
      panel.name = name + '_Segment_' + (i + 1);
      panel.position.copy(side ? point(side * (.5 + i * .5), -.585, -1.60) : point((i - .5) * .06, -.087, 3.385));
      panel.castShadow = true;
      panel.receiveShadow = true;
      doors.add(panel);
    }
    if (side) {
      // A shallow underside fairing gives the horizontal tire its required depth.
      const rim = new THREE.Group();
      rim.name = name + '_BayFairing';
      root.add(rim);
      for (const edge of [0, 1, 2, 3]) {
        const longitudinal = edge < 2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry((longitudinal ? .012 : 1.5) * scale, .118 * scale, (longitudinal ? .84 : .012) * scale), doorMaterial);
        ownAircraftResource(root, wall.geometry);
        wall.position.copy(longitudinal ? point(side * (edge === 0 ? .25 : 1.75), -.526, -1.6) : point(side, -.526, edge === 2 ? -2.02 : -1.18));
        rim.add(wall);
      }
    }
    return doors;
  }
  function fold(name, names, wheelName, hinge, axis, angle, side) {
    const parts = names.map(part),
      wheels = [part(wheelName)],
      before = aircraftLocalBounds(root, wheels).getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.copy(point(...hinge));
    root.add(pivot);
    for (const node of parts) pivot.attach(node);
    pivot.rotation[axis] = angle;
    root.updateMatrixWorld(true);
    if (side) {
      // Seat the tire/hub below the wing's upper skin, inside the closed bay.
      const center = aircraftLocalBounds(root, wheels).getCenter(new THREE.Vector3()),
        offset = point(0, -.47, 0).y - center.y;
      for (const node of [part(wheelName), part(side < 0 ? 'Cylinder18' : 'Cylinder14')]) {
        root.attach(node);
        node.position.y += offset;
      }
      root.updateMatrixWorld(true);
    }
    const after = aircraftLocalBounds(root, wheels).getCenter(new THREE.Vector3()),
      doors = closedDoors(name + '_ClosedDoors', side);
    assemblies.push({
      name,
      pivot,
      parts: parts.map(node => node.name),
      wheelBefore: before.toArray(),
      wheelAfter: after.toArray(),
      foldAxis: axis,
      foldAngleDegrees: angle * 180 / Math.PI,
      doors,
      doorSegments: doors.children.length,
      doorState: 'closed'
    });
  }
  // Roll each main wheel inward until the tire lies flat inside the inner wing.
  fold('MiG3MainGearLeft', ['Cylinder11', 'Box04', 'Cylinder12', 'Box02', 'Cylinder18', 'Torus04'], 'Torus04', [-1.65, -.60, -1.388], 'z', Math.PI / 2, -1);
  fold('MiG3MainGearRight', ['Cylinder16', 'Box06', 'Cylinder15', 'Box05', 'Cylinder14', 'Torus03'], 'Torus03', [1.65, -.60, -1.388], 'z', -Math.PI / 2, 1);
  // The short inboard actuators fold into the wing instead of following the wheel.
  for (const [name, side] of [['stv_gl', -1], ['stv_gl01', 1]]) {
    const hinge = new THREE.Group();
    hinge.name = 'MiG3InboardLink_' + (side < 0 ? 'Left' : 'Right');
    hinge.position.copy(point(side * .37, -.45, -1.283));
    root.add(hinge);
    hinge.attach(part(name));
    hinge.rotation.z = -side * Math.PI / 2;
  }
  // Original extended covers are retained in this clone behind the closed panels.
  for (const name of ['st_gl_1', 'st_gl_02']) part(name).visible = false;
  // Retract the tail wheel upward and aft into the fuselage, then close its two leaves.
  fold('MiG3TailGear', ['Cylinder10', 'Cylinder09', 'Cylinder07', 'Box01', 'Torus02', 'Cylinder02'], 'Torus02', [0, -.12, 3.08], 'x', -Math.PI / 2, 0);
  // Closed tail doors occlude all internal hardware at the rounded tail skin.
  for (const name of assemblies[2].parts) part(name).visible = false;
  for (const name of ['stv_xv', 'stv_xv01']) part(name).visible = false;
  root.updateMatrixWorld(true);
  root.userData.landingGear = {
    state: 'stowed',
    assemblies,
    mainRetraction: 'inward-wing-bays',
    tailRetraction: 'aft-fuselage',
    doorState: 'closed'
  };
}
function attachPropeller(root, source, spec) {
  const settings = PROPELLER_SPECS[root.userData.type];
  if (!settings) return;
  const type = root.userData.type;
  let pivot = source.getObjectByName('PropellerPivot'),
    blades = pivot?.getObjectByName('PropellerBlades');
  if (type === 'p36a') {
    pivot = source.getObjectByName('prop_49');
    blades = pivot?.children.filter(node => node.isMesh) || [];
  }
  if (type === 'i15' || type === 'i16' || type === 'bf109c1') {
    const authored = source.getObjectByName('prop01_1');
    if (!authored) throw new Error('缺少螺旋桨节点：' + type);
    const center = new THREE.Box3().setFromObject(authored).getCenter(new THREE.Vector3());
    authored.parent.worldToLocal(center);
    pivot = new THREE.Group();
    pivot.name = 'PropellerPivot';
    pivot.position.copy(center);
    authored.parent.add(pivot);
    pivot.attach(authored);
    blades = [authored];
  }
  if (type === 'f3f2') {
    const authored = source.getObjectByName('prop01_1');
    if (!authored) throw new Error('缺少 F3F-2 螺旋桨');
    pivot = new THREE.Group();
    pivot.name = 'PropellerPivot';
    pivot.position.set(0, -.292092, -2.30);
    authored.parent.add(pivot);
    pivot.attach(authored);
    blades = [authored];
  }
  if (!pivot || !blades || Array.isArray(blades) && !blades.length) throw new Error('缺少螺旋桨旋转节点：' + type);
  const scaled = ['i16', 'i15', 'p36a', 'f3f2', 'mig3', 'bf109c1'].includes(type),
    worldScale = scaled ? pivot.getWorldScale(new THREE.Vector3()) : null;
  const discRadius = scaled ? settings.radius / METERS_PER_UNIT / Math.max(Math.abs(worldScale.x), .0001) : settings.radius;
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(discRadius * 2, discRadius * 2), new THREE.MeshBasicMaterial({
    map: makePropellerBlurTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide
  }));
  ownAircraftResource(root, disc.geometry);
  ownAircraftResource(root, disc.material);
  disc.name = 'PropellerMotionBlur';
  if (type === 'i16' || type === 'i15' || type === 'f3f2' || type === 'mig3' || type === 'bf109c1') disc.position.z = -.015;else {
    disc.rotation.x = Math.PI / 2;
    disc.position.y = -.015;
  }
  disc.visible = false;
  disc.renderOrder = 2;
  pivot.add(disc);
  const spinAxis = type === 'i16' || type === 'i15' || type === 'f3f2' || type === 'mig3' || type === 'bf109c1' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  root.userData.propeller = {
    pivot,
    blades,
    disc,
    baseQuaternion: pivot.quaternion.clone(),
    spinQuaternion: new THREE.Quaternion(),
    spinAxis
  };
  root.userData.propeller.spinQuaternion.setFromAxisAngle(spinAxis, root.userData.propPhase || 0);
  pivot.quaternion.copy(root.userData.propeller.baseQuaternion).multiply(root.userData.propeller.spinQuaternion);
}
function updatePropeller(root, dt) {
  if (!root) return;
  const data = root.userData,
    spec = PROPELLER_SPECS[data.type];
  if (!spec) return;
  const desired = data.engineRunning && !data.destroyed ? spec.idleRpm + (spec.maxRpm - spec.idleRpm) * THREE.MathUtils.clamp(data.throttle ?? 0, 0, 1) : 0;
  const difference = desired - data.propRpm,
    limit = (difference >= 0 ? spec.maxRpm / spec.spoolUpSeconds : spec.maxRpm / spec.spoolDownSeconds) * dt;
  data.propRpm += THREE.MathUtils.clamp(difference, -limit, limit);
  if (data.propRpm < .001) data.propRpm = 0;
  data.propPhase = (data.propPhase + spec.direction * data.propRpm * Math.PI / 30 * dt) % (Math.PI * 2);
  if (data.propeller) {
    const {
        pivot,
        blades,
        disc
      } = data.propeller,
      blur = THREE.MathUtils.smoothstep(data.propRpm, spec.blurStartRpm, spec.blurFullRpm);
    const propData = data.propeller;
    propData.spinQuaternion.setFromAxisAngle(propData.spinAxis, data.propPhase);
    pivot.quaternion.copy(propData.baseQuaternion).multiply(propData.spinQuaternion);
    if (Array.isArray(blades)) blades.forEach(blade => blade.visible = blur < .96);else blades.visible = blur < .96;
    disc.visible = blur > .01;
    disc.material.opacity = .85 * blur;
  }
}
function updateAllPropellers(dt) {
  if (session.gameMode !== 'airspace') {
    updatePropeller(session.player, dt);
    updatePropeller(session.enemy, dt);
    for (const target of session.campaignBombers) updatePropeller(target.root, dt);
    for (const target of session.campaignEscorts) updatePropeller(target.root, dt);
  }
  if (session.gameMode === 'airspace' && session.battlePaused) return;
  for (let i = resourceState.wreckedAircraft.length - 1; i >= 0; i--) {
    const wreck = resourceState.wreckedAircraft[i];
    updatePropeller(wreck.root, dt);
    wreck.life -= dt;
    wreck.root.position.addScaledVector(wreck.root.userData.velocity, dt * .45);
    wreck.root.position.y -= dt * .6;
    if (wreck.life <= 0 && wreck.root.userData.propRpm === 0) {
      disposeAircraft(wreck.root);
      resourceState.wreckedAircraft.splice(i, 1);
    }
  }
}
function retireAircraft(root) {
  if (!root) return;
  root.userData.engineRunning = false;
  root.userData.destroyed = true;
  if (PROPELLER_SPECS[root.userData.type]) resourceState.wreckedAircraft.push({
    root,
    life: 5
  });else disposeAircraft(root);
}
function aircraft(isPlayer, type, options = {}) {
  const root = new THREE.Group(),
    spec = AIRCRAFT_SPECS[type],
    lengthMeters = spec.lengthMeters,
    collision = spec.collisionMeters;
  const info = planeInfo[type],
    maxSpeedMps = info.maxSpeedKmh / 3.6,
    minFlightSpeedMps = info.minLevelFlightKmh / 3.6,
    initialAirspeedMps = Math.max(minFlightSpeedMps * 1.12, maxSpeedMps * .68);
  root.userData = {
    isPlayer,
    modelContext: options.preview ? 'preview' : 'combat',
    type,
    lengthMeters,
    maxSpeedMps,
    minFlightSpeedMps,
    bestClimbMps: info.bestClimbMps,
    throttle: isPlayer ? inputState.throttleValue : .76,
    engineRunning: false,
    destroyed: false,
    propRpm: 0,
    propPhase: 0,
    velocity: new THREE.Vector3(0, 0, -initialAirspeedMps / METERS_PER_UNIT),
    aoa: 0,
    airspeed: initialAirspeedMps,
    bomberGunClock: 0,
    bomberGunsActive: false,
    collisionHalfExtents: new THREE.Vector3(collision.x, collision.y, collision.z).multiplyScalar(.5 / METERS_PER_UNIT)
  };
  root.userData.modelReady = loadPlaneModel(type).then(source => {
    if (root.userData.disposed || root.userData.modelAttached) return;
    const model = new THREE.Group();
    model.add(source.clone(true));
    // The Meteor GLB already contains a Sketchfab Z-up to Y-up node transform; its source -Y nose arrives along +Z.
    // A 180-degree yaw flips X/Z into the game axes without distorting its native wingspan-to-length ratio.
    // 1) Correct this GLB's axes before measuring it.
    model.rotation.set(spec.axisRotationX || 0, spec.axisRotationY || 0, spec.axisRotationZ || 0);
    model.scale.set(...spec.axisFlip);
    model.updateMatrixWorld(true);
    const correctedBounds = new THREE.Box3().setFromObject(model),
      correctedSize = correctedBounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(correctedSize.z) || correctedSize.z <= 0) throw new Error('飞机模型修正方向后长度无效：' + type);
    // 2) Match the real fuselage length in game units, uniformly on all axes.
    const modelScale = lengthMeters / METERS_PER_UNIT / correctedSize.z;
    model.scale.multiplyScalar(modelScale);
    model.updateMatrixWorld(true);
    // 3) Recompute bounds after scaling, then place the scaled center at the aircraft origin.
    const scaledBounds = new THREE.Box3().setFromObject(model),
      scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
    model.position.sub(scaledCenter);
    model.updateMatrixWorld(true);
    model.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    attachPropeller(root, model, spec);
    root.add(model);
    configureCombatLandingGear(root, model);
    configureMiG3CombatLandingGear(root, model);
    root.userData.modelAttached = true;
    return true;
  }).catch(error => {
    console.error('战机模型初始化失败：' + type, error);
    root.userData.modelError = true;
    for (const resource of root.userData.ownedResources || []) resource.dispose();
    root.userData.ownedResources?.clear();
    return false;
  });
  return root;
}
// Test the entire projectile step against the aircraft's moving collision box.
// Translation is relative; rotation uses the final frame's orientation.

function ownAircraftResource(root, resource) {
  (root.userData.ownedResources ??= new Set()).add(resource);
  return resource;
}
function disposeAircraft(root) {
  if (!root || root.userData.disposed) return;
  root.userData.disposed = true;
  root.userData.engineRunning = false;
  for (const resource of root.userData.ownedResources || []) resource.dispose();
  root.userData.ownedResources?.clear();
  root.removeFromParent();
}
function disposeBomb(bomb) {
  if (!bomb || bomb.disposed) return;
  bomb.disposed = true;
  bomb.mesh.removeFromParent();
  bomb.mesh.geometry.dispose();
  bomb.mesh.material.dispose();
}
