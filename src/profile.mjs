function economyInteger(value, maximum = ECONOMY_RULES.maxBalance) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.floor(value))) : 0;
}
function loadProgressionProfile() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const preserved = Array.isArray(saved.unlocked) ? saved.unlocked.filter(id => typeof id === 'string' && AIRCRAFT_SPECS[id]) : [];
  profileState.unlockedPlanes = [...new Set(['i15', 'i15bis', ...preserved])];
  profileState.selectedAircraft = profileState.unlockedPlanes.includes(saved.selected) ? saved.selected : 'i15';
  if (BOMBER_LOADOUTS[saved.bomberLoadout]) profileState.selectedBombPayload = saved.bomberLoadout;
  const wallet = saved.economy;
  if (wallet && typeof wallet === 'object' && !Array.isArray(wallet)) {
    profileState.economy = {
      rp: economyInteger(wallet.rp),
      gp: economyInteger(wallet.gp),
      research: {},
      completedSorties: economyInteger(wallet.completedSorties)
    };
    if (wallet.research && typeof wallet.research === 'object') for (const [type, value] of Object.entries(wallet.research)) if (RESEARCH_COSTS[type]) profileState.economy.research[type] = economyInteger(value, RESEARCH_COSTS[type].rp);
  } else profileState.economy = {
    rp: 0,
    gp: ECONOMY_RULES.startGP,
    research: {},
    completedSorties: 0
  };
  session.playerPlane = profileState.selectedAircraft;
  saveHangar();
}
function researchStages() {
  return [...new Set(Object.values(AIRCRAFT_TREE).map(info => info.rating))].sort((a, b) => a - b);
}
function researchPrerequisite(type) {
  const rating = AIRCRAFT_TREE[type]?.rating;
  if (!Number.isFinite(rating)) return {
    allowed: false,
    rating: null,
    choices: []
  };
  const prior = researchStages().filter(value => value < rating - 1e-9).at(-1);
  if (prior === undefined) return {
    allowed: true,
    rating: null,
    choices: []
  };
  const choices = Object.keys(AIRCRAFT_TREE).filter(id => Math.abs(AIRCRAFT_TREE[id].rating - prior) < 1e-9);
  return {
    allowed: choices.some(id => profileState.unlockedPlanes.includes(id)),
    rating: prior,
    choices
  };
}
function aircraftResearchState(type) {
  const cost = RESEARCH_COSTS[type];
  if (!cost) return {
    status: 'invalid'
  };
  const owned = profileState.unlockedPlanes.includes(type),
    progress = owned ? cost.rp : economyInteger(profileState.economy.research[type], cost.rp),
    prerequisite = researchPrerequisite(type);
  return {
    status: owned ? 'owned' : !prerequisite.allowed ? 'blocked' : progress >= cost.rp ? 'ready' : 'research',
    owned,
    progress,
    cost,
    prerequisite
  };
}
function investAircraftResearch(type) {
  const state = aircraftResearchState(type);
  if (state.status !== 'research') return {
    ok: false,
    reason: state.status
  };
  const amount = Math.min(profileState.economy.rp, state.cost.rp - state.progress);
  if (amount <= 0) return {
    ok: false,
    reason: 'points'
  };
  const before = profileState.economy;
  profileState.economy = {
    ...profileState.economy,
    rp: profileState.economy.rp - amount,
    research: {
      ...profileState.economy.research,
      [type]: state.progress + amount
    }
  };
  if (!saveHangar()) {
    profileState.economy = before;
    reportSaveFailure();
    return {
      ok: false,
      reason: 'storage'
    };
  }
  return {
    ok: true,
    amount,
    complete: profileState.economy.research[type] === state.cost.rp
  };
}
function purchaseResearchedAircraft(type) {
  const state = aircraftResearchState(type);
  if (state.status !== 'ready') return {
    ok: false,
    reason: state.status
  };
  if (profileState.economy.gp < state.cost.gp) return {
    ok: false,
    reason: 'gp'
  };
  const before = profileState.economy,
    owned = profileState.unlockedPlanes;
  profileState.economy = {
    ...profileState.economy,
    gp: profileState.economy.gp - state.cost.gp
  };
  profileState.unlockedPlanes = [...profileState.unlockedPlanes, type];
  if (!saveHangar()) {
    profileState.economy = before;
    profileState.unlockedPlanes = owned;
    reportSaveFailure();
    return {
      ok: false,
      reason: 'storage'
    };
  }
  return {
    ok: true
  };
}
function beginSortieEconomy() {
  profileState.battleRewardSeconds = 0;
  profileState.battleRewardSettled = false;
  const reward = $('#sortieRewards');
  if (reward) {
    reward.textContent = '';
    reward.classList.add('hidden');
  }
}
function settleSortieEconomy(win) {
  if (profileState.battleRewardSettled) return null;
  profileState.battleRewardSettled = true;
  const seconds = Math.min(ECONOMY_RULES.maxRewardSeconds, Math.max(0, profileState.battleRewardSeconds)),
    confirmedKills = economyInteger(session.kills, 100),
    eligible = seconds >= ECONOMY_RULES.minResultSeconds || confirmedKills > 0;
  const rp = Math.floor(seconds * ECONOMY_RULES.timeRP) + confirmedKills * ECONOMY_RULES.killRP + (eligible ? win === true ? ECONOMY_RULES.winRP : ECONOMY_RULES.lossRP : 0);
  const gp = Math.floor(seconds * ECONOMY_RULES.timeGP) + confirmedKills * ECONOMY_RULES.killGP + (eligible ? win === true ? ECONOMY_RULES.winGP : ECONOMY_RULES.lossGP : 0);
  const reward = {
    rp,
    gp,
    seconds,
    kills: confirmedKills
  };
  profileState.pendingRewards.push(reward);
  const saved = retryPendingRewards(),
    node = $('#sortieRewards');
  updateEconomyDisplay();
  if (node) {
    node.textContent = '本局获得 ' + rp + ' 研发点 · ' + gp + ' GP' + (saved ? '' : ' · 保存失败，请返回菜单重试');
    node.classList.remove('hidden');
  }
  syncMenuMusic();
  return reward;
}
function saveHangar() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({
      version: 2,
      unlocked: profileState.unlockedPlanes,
      selected: profileState.selectedAircraft,
      bomberLoadout: profileState.selectedBombPayload,
      economy: profileState.economy
    }));
    return true;
  } catch (error) {
    console.warn('无法保存游戏进度', error);
    return false;
  }
}
function setSelectedAircraft(type) {
  if (!profileState.unlockedPlanes.includes(type)) return false;
  const before = profileState.selectedAircraft;
  profileState.selectedAircraft = type;
  if (!saveHangar()) {
    profileState.selectedAircraft = before;
    reportSaveFailure();
    return false;
  }
  stopGunSounds();
  session.playerPlane = type;
  updateThrottleUI();
  renderHangar();
  $('#homeSelectedPlane').textContent = planeInfo[type].name;
  return true;
}
function reportSaveFailure() {
  toast('保存失败，操作未扣费。请释放存储空间后重试。');
}
function retryPendingRewards() {
  const queue = profileState.pendingRewards || [];
  if (!queue.length) return true;
  const before = profileState.economy;
  const rp = queue.reduce((n, item) => n + item.rp, 0),
    gp = queue.reduce((n, item) => n + item.gp, 0);
  profileState.economy = {
    ...profileState.economy,
    rp: economyInteger(profileState.economy.rp + rp),
    gp: economyInteger(profileState.economy.gp + gp),
    completedSorties: economyInteger(profileState.economy.completedSorties + queue.length)
  };
  if (!saveHangar()) {
    profileState.economy = before;
    return false;
  }
  profileState.pendingRewards = [];
  updateEconomyDisplay();
  return true;
}
