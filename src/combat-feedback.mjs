const COMBAT_FEEDBACK_RULES = {
  sparks: 192, smoke: 320, sparkSeconds: .18, smokeSeconds: 2.4,
  heavySmokeSeconds: 2, engineHealthFraction: .35, engineCriticalFraction: .3,
  assistDamageFraction: .05, assistSeconds: 30
};

function beginCombatStats() {
  session.combatStats = { shots: 0, hits: 0, damageTaken: 0, survival: 0, assists: 0, active: true };
  session.lastBattleResult = null;
  clearCombatFeedback();
}
function recordShotCount(root, count) {
  if (session.combatStats?.active && root === session.player) session.combatStats.shots += count;
}
function advanceCombatStats(dt) {
  if (!session.combatStats?.active || !session.playing) return;
  if (session.hp > 0 && (session.gameMode !== 'airspace' || airspacePlayerAlive())) session.combatStats.survival += dt;
}
function projectileImpact(bullet, target, fraction = null) {
  const point = bullet.mesh.position.clone();
  if (fraction === null) fraction = airspaceHitFraction(bullet.previousPosition, point, target, bullet.radius);
  if (fraction !== null) point.lerpVectors(bullet.previousPosition, bullet.mesh.position, fraction);
  return { source: bullet.shooterRoot, point, projectile: true, hits: 1 };
}
function turretImpact(source, target, hits) {
  const fraction = airspaceHitFraction(source.position, target.position, target, 0);
  return { source, point: source.position.clone().lerp(target.position, fraction ?? 1), projectile: true, hits };
}
function recordCombatDamage(root, before, after, hit = null) {
  const amount = Math.max(0, before - after);
  if (!root || amount <= 0) return;
  const stats = session.combatStats;
  if (stats?.active && root === session.player) stats.damageTaken += amount;
  if (!hit) return;
  const unit = airspaceUnitFor(root), shooter = airspaceUnitFor(hit.source);
  if (unit && shooter && unit.team === shooter.team) return;
  if (stats?.active && hit.projectile && hit.source === session.player) {
    stats.hits += hit.hits || 1;
    viewState.hitFlashRemaining = .14;
    $('#reticle').classList.add('hit-confirm');
    playSfx('hit', .075);
  }
  if (unit && shooter && unit.team !== shooter.team) {
    const contributors = unit.damageContributors ??= new Map();
    const previous = contributors.get(shooter.id)?.damage || 0;
    contributors.set(shooter.id, { damage: previous + amount, at: session.airspaceState.elapsed });
  }
  const maxHealth = planeInfo[root.userData.type]?.health || before;
  if (after > 0 && (amount >= maxHealth * .15 || before > maxHealth * .5 && after <= maxHealth * .5)) {
    root.userData.heavySmokeRemaining = COMBAT_FEEDBACK_RULES.heavySmokeSeconds;
  }
  if (hit.projectile) {
    const point = hit.point || root.position;
    emitImpactSparks(point, Math.min(10, 4 + (hit.hits || 1)));
    const half = root.userData.collisionHalfExtents;
    if (half) {
      const local = root.worldToLocal(point.clone()), type = root.userData.type;
      const engineHit = type === 'b29' ? Math.abs(local.x) > half.x * .25 && Math.abs(local.x) < half.x * .85 && Math.abs(local.z) < half.z * .5 :
        Math.abs(local.x) < half.x * .3 && (PROPELLER_SPECS[type] ? local.z < -half.z * .2 : local.z > -half.z * .25);
      if (engineHit) {
        root.userData.engineDamage = (root.userData.engineDamage || 0) + amount;
        root.userData.engineCritical = root.userData.engineDamage >= maxHealth * COMBAT_FEEDBACK_RULES.engineHealthFraction * (1 - COMBAT_FEEDBACK_RULES.engineCriticalFraction);
        if (root.userData.engineCritical) root.userData.smokeLocalPoint = local;
      }
    }
  }
}
function reportAirspaceAssists(victim, killerId) {
  const contributors = victim.damageContributors;
  if (!contributors) return [];
  const assistants = [];
  for (const [id, record] of contributors) {
    if (id === killerId || session.airspaceState.elapsed - record.at > COMBAT_FEEDBACK_RULES.assistSeconds ||
        record.damage < victim.maxHealth * COMBAT_FEEDBACK_RULES.assistDamageFraction) continue;
    const unit = session.airspaceUnits.find(u => u.id === id);
    if (!unit || unit.team === victim.team) continue;
    assistants.push(unit);
    if (unit.isPlayer && session.combatStats?.active) {
      session.combatStats.assists++;
      toast('助攻 · ' + planeInfo[victim.type].name);
    }
  }
  return assistants;
}
function combatUnitName(unit) {
  return unit?.isPlayer ? profileState.playerName : unit ? planeInfo[unit.type].name + ' #' + (unit.index + 1) : '环境';
}
function addCombatFeed(killer, victim, assistants) {
  const host = $('#killFeed'), node = document.createElement('div');
  node.className = victim.team === 'red' ? 'feed-friendly' : 'feed-enemy';
  node.textContent = combatUnitName(killer) + ' 击落 ' + combatUnitName(victim) +
    (assistants.length ? ' · 助攻：' + assistants.map(combatUnitName).join('、') : '');
  host.appendChild(node);
  while (host.children.length > 4) host.children[0].remove();
  node.dataset.expires = String(session.worldTime + 6);
}
function clearCombatFeedback() {
  resourceState.combatEffects?.clear();
  viewState.hitFlashRemaining = 0;
  $('#reticle')?.classList.remove('hit-confirm');
  $('#killFeed')?.replaceChildren();
}

class CombatParticles {
  constructor() {
    this.capacity = COMBAT_FEEDBACK_RULES.sparks + COMBAT_FEEDBACK_RULES.smoke;
    this.sparkCursor = 0; this.smokeCursor = COMBAT_FEEDBACK_RULES.sparks;
    this.life = new Float32Array(this.capacity); this.duration = new Float32Array(this.capacity);
    this.velocity = new Float32Array(this.capacity * 3);
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity); this.alphas = new Float32Array(this.capacity);
    this.geometry = new THREE.BufferGeometry();
    for (const [name, values, count] of [['position', this.positions, 3], ['aColor', this.colors, 3], ['aSize', this.sizes, 1], ['aAlpha', this.alphas, 1]]) {
      this.geometry.setAttribute(name, new THREE.BufferAttribute(values, count).setUsage(THREE.DynamicDrawUsage));
    }
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uHeight: { value: innerHeight } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uHeight; varying vec4 vColor;
        void main(){ vec4 p=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*p;
          gl_PointSize=clamp(aSize*uHeight*projectionMatrix[1][1]/max(.1,-p.z),2.0,72.0);
          vColor=vec4(aColor,aAlpha); }`,
      fragmentShader: `varying vec4 vColor;
        void main(){ float r=length(gl_PointCoord-vec2(.5))*2.0;
          float alpha=vColor.a*(1.0-smoothstep(.2,1.0,r));
          if(alpha<.005) discard; gl_FragColor=vec4(vColor.rgb,alpha); }`
    });
    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    viewState.scene.add(this.mesh);
  }
  emit(point, smoke) {
    const i = smoke ? this.smokeCursor++ : this.sparkCursor++, at = i * 3;
    if (this.sparkCursor >= COMBAT_FEEDBACK_RULES.sparks) this.sparkCursor = 0;
    if (this.smokeCursor >= this.capacity) this.smokeCursor = COMBAT_FEEDBACK_RULES.sparks;
    this.life[i] = this.duration[i] = smoke ? COMBAT_FEEDBACK_RULES.smokeSeconds : COMBAT_FEEDBACK_RULES.sparkSeconds;
    this.positions[at] = point.x; this.positions[at + 1] = point.y; this.positions[at + 2] = point.z;
    this.velocity[at] = (Math.random() - .5) * (smoke ? .15 : 1.2);
    this.velocity[at + 1] = smoke ? .12 : (Math.random() - .3) * 1.2;
    this.velocity[at + 2] = (Math.random() - .5) * (smoke ? .15 : 1.2);
    this.colors[at] = smoke ? .055 : 1; this.colors[at + 1] = smoke ? .06 : .72; this.colors[at + 2] = smoke ? .065 : .22;
    this.sizes[i] = smoke ? .09 : .025; this.alphas[i] = smoke ? .65 : 1;
    this.refresh();
  }
  refresh() {
    for (const attribute of Object.values(this.geometry.attributes)) attribute.needsUpdate = true;
  }
  update(dt) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt);
      const at = i * 3, fraction = this.life[i] / this.duration[i];
      for (let axis = 0; axis < 3; axis++) this.positions[at + axis] += this.velocity[at + axis] * dt;
      this.alphas[i] = fraction * (i < COMBAT_FEEDBACK_RULES.sparks ? 1 : .65);
      if (i >= COMBAT_FEEDBACK_RULES.sparks) this.sizes[i] = .09 + (1 - fraction) * .5;
    }
    this.material.uniforms.uHeight.value = innerHeight * Math.min(devicePixelRatio, 1.6);
    this.refresh();
  }
  clear() { this.life.fill(0); this.alphas.fill(0); this.refresh(); }
}
function ensureCombatParticles() {
  return resourceState.combatEffects ??= new CombatParticles();
}
function emitImpactSparks(point, count) {
  const batch = ensureCombatParticles();
  for (let i = 0; i < count; i++) batch.emit(point, false);
}
function updateCombatFeedback(dt) {
  resourceState.combatEffects?.update(dt);
  viewState.hitFlashRemaining = Math.max(0, (viewState.hitFlashRemaining || 0) - dt);
  if (!viewState.hitFlashRemaining) $('#reticle').classList.remove('hit-confirm');
  for (const node of [...$('#killFeed').children]) if (Number(node.dataset.expires) <= session.worldTime) node.remove();
  if (!session.playing || session.ended) return;
  for (const root of activeBattleAircraft()) {
    const data = root.userData;
    data.heavySmokeRemaining = Math.max(0, (data.heavySmokeRemaining || 0) - dt);
    if (data.destroyed || data.disposed || !data.engineCritical && !data.heavySmokeRemaining) continue;
    data.damageSmokeClock = (data.damageSmokeClock || 0) - dt;
    if (data.damageSmokeClock > 0) continue;
    data.damageSmokeClock = 1 / 12;
    const half = data.collisionHalfExtents;
    const point = (data.damageSmokePoint ??= new THREE.Vector3()).copy(data.smokeLocalPoint || FLIGHT_AXES.y);
    if (!data.smokeLocalPoint) point.set(0, 0, (half?.z || .1) * (PROPELLER_SPECS[data.type] ? -.7 : .7));
    root.localToWorld(point);
    ensureCombatParticles().emit(point, true);
  }
}
function renderBattleResult(win, reason, reward) {
  if (session.combatStats) session.combatStats.active = false;
  const stats = session.combatStats || { shots: 0, hits: 0, damageTaken: 0, survival: 0, assists: 0 };
  session.lastBattleResult = { ...stats, kills: session.kills, win, reward };
  $('#end').dataset.outcome = win === null ? 'draw' : win ? 'win' : 'loss';
  $('#resultTitle').textContent = win === null ? '平局' : win ? '胜利' : '失败';
  $('#resultCopy').textContent = reason;
  const values = {
    resultKills: session.kills, resultAssists: stats.assists, resultHits: stats.hits, resultShots: stats.shots,
    resultAccuracy: (stats.shots ? Math.min(100, stats.hits / stats.shots * 100) : 0).toFixed(1) + '%',
    resultDamage: Math.round(stats.damageTaken), resultSurvival: formatBattleTime(Math.floor(stats.survival + 1e-9)),
    resultGP: (reward?.gp || 0).toLocaleString('zh-CN'), resultRP: (reward?.rp || 0).toLocaleString('zh-CN')
  };
  for (const [id, value] of Object.entries(values)) $('#' + id).textContent = value;
  $('#battleResults').classList.remove('hidden');
  $('#end').classList.remove('hidden');
  $('#again').textContent = '再次出战';
  $('#sortieRewards').classList.toggle('save-error', !!profileState.pendingRewards.length);
}
function formatBattleTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds - 1e-9));
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
}
