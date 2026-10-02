const PROJECTILE_SMOKE_RULES = { capacity: 32768, lifeSeconds: .6, sampleSeconds: 1 / 30 };

// One reusable GPU batch for every weapon and team. Smoke stays in world space.
function ensureProjectileSmoke() {
  if (resourceState.projectileSmoke) return resourceState.projectileSmoke;
  const capacity = PROJECTILE_SMOKE_RULES.capacity;
  const start = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const end = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,0,0, 1,0,0, -1,1,0, 1,1,0], 3));
  geometry.setIndex([0,1,2, 2,1,3]);
  geometry.setAttribute('smokeStart', start);
  geometry.setAttribute('smokeEnd', end);
  geometry.setAttribute('smokeBirth', birth);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { smokeTime: { value: 0 }, smokeLife: { value: PROJECTILE_SMOKE_RULES.lifeSeconds },
      smokeViewport: { value: new THREE.Vector2(innerWidth, innerHeight) } },
    vertexShader: `
      attribute vec3 smokeStart;
      attribute vec3 smokeEnd;
      attribute float smokeBirth;
      uniform float smokeTime;
      uniform float smokeLife;
      uniform vec2 smokeViewport;
      varying float smokeAge;
      varying float smokeAcross;
      varying float smokeAlong;
      void main() {
        smokeAge = smokeTime - smokeBirth;
        smokeAcross = position.x;
        smokeAlong = position.y;
        if (smokeAge < 0.0 || smokeAge >= smokeLife) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
        vec4 a = projectionMatrix * modelViewMatrix * vec4(smokeStart, 1.0);
        vec4 b = projectionMatrix * modelViewMatrix * vec4(smokeEnd, 1.0);
        if (a.w <= 0.02 || b.w <= 0.02) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
        vec2 delta = (b.xy / b.w - a.xy / a.w) * smokeViewport;
        vec2 side = length(delta) > 0.001 ? normalize(vec2(-delta.y, delta.x)) : vec2(1.0,0.0);
        vec4 center = mix(a, b, position.y);
        float widthPixels = 1.1 + 1.8 * smokeAge / smokeLife;
        center.xy += side * position.x * widthPixels * 2.0 / smokeViewport * center.w;
        gl_Position = center;
      }`,
    fragmentShader: `
      uniform float smokeLife;
      varying float smokeAge;
      varying float smokeAcross;
      varying float smokeAlong;
      void main() {
        float fade = pow(max(0.0, 1.0 - smokeAge / smokeLife), 1.6);
        float softEdge = exp(-3.0 * smokeAcross * smokeAcross);
        float softEnd = smoothstep(0.0,0.035,smokeAlong) * smoothstep(0.0,0.035,1.0-smokeAlong);
        float alpha = 0.68 * fade * softEdge * softEnd;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(1.0,1.0,1.0,alpha);
      }`
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'WhiteProjectileSmoke';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  viewState.scene.add(mesh);
  return resourceState.projectileSmoke = { mesh, geometry, material, start, end, birth,
    time: 0, lastEmission: -Infinity, count: 0, cursor: 0 };
}
function emitProjectileSmoke(x0, y0, z0, x1, y1, z1) {
  if ((x1-x0)**2 + (y1-y0)**2 + (z1-z0)**2 < 1e-10) return;
  const batch = ensureProjectileSmoke(), index = batch.cursor;
  batch.start.setXYZ(index, x0, y0, z0);
  batch.end.setXYZ(index, x1, y1, z1);
  batch.birth.setX(index, batch.time);
  batch.start.needsUpdate = batch.end.needsUpdate = batch.birth.needsUpdate = true;
  batch.cursor = (index + 1) % PROJECTILE_SMOKE_RULES.capacity;
  batch.count = Math.min(PROJECTILE_SMOKE_RULES.capacity, batch.count + 1);
  batch.geometry.instanceCount = batch.count;
  batch.lastEmission = batch.time;
  batch.mesh.visible = true;
}
function startBulletSmoke(bullet) {
  const point = bullet.mesh.position;
  bullet.smokeX = point.x; bullet.smokeY = point.y; bullet.smokeZ = point.z;
  bullet.smokeElapsed = 0;
  bullet.smokeActive = true;
}
function traceBulletSmoke(bullet, dt = 0, flush = false) {
  if (!bullet.smokeActive) return;
  bullet.smokeElapsed += dt;
  if (!flush && bullet.smokeElapsed + 1e-9 < PROJECTILE_SMOKE_RULES.sampleSeconds) return;
  const point = bullet.mesh.position;
  emitProjectileSmoke(bullet.smokeX, bullet.smokeY, bullet.smokeZ, point.x, point.y, point.z);
  bullet.smokeX = point.x; bullet.smokeY = point.y; bullet.smokeZ = point.z;
  bullet.smokeElapsed = 0;
}
function emitTurretSmoke(root, target, turret, rounds) {
  const w = flightWorkspace(root, 'turretSmoke'), offset = turret.offset;
  for (let i = 0; i < rounds; i++) {
    const start = w.a.set(offset[0] + (i - (rounds - 1) / 2) * .012, offset[1], offset[2])
      .multiplyScalar(root.scale.x).applyQuaternion(root.quaternion).add(root.position);
    emitProjectileSmoke(start.x, start.y, start.z, target.position.x, target.position.y, target.position.z);
  }
}
function updateProjectileSmoke(dt) {
  const batch = resourceState.projectileSmoke;
  if (!batch) return;
  batch.time += dt;
  batch.material.uniforms.smokeTime.value = batch.time;
  batch.material.uniforms.smokeViewport.value.set(innerWidth, innerHeight);
  if (batch.time - batch.lastEmission >= PROJECTILE_SMOKE_RULES.lifeSeconds) {
    batch.count = batch.cursor = batch.geometry.instanceCount = 0;
    batch.mesh.visible = false;
  }
}
function clearProjectileSmoke() {
  const batch = resourceState.projectileSmoke;
  if (!batch) return;
  batch.count = batch.cursor = batch.geometry.instanceCount = 0;
  batch.time = batch.material.uniforms.smokeTime.value = 0;
  batch.lastEmission = -Infinity;
  batch.mesh.visible = false;
}
