function validPlayerName(name) {
  return typeof name === 'string' && /^[\p{L}\p{N}_ -]{2,16}$/u.test(name);
}
function randomPlayerName() {
  const values = new Uint32Array(1);
  try { globalThis.crypto.getRandomValues(values); } catch { values[0] = Math.floor(Math.random() * 10000); }
  return 'player_' + String(values[0] % 10000).padStart(4, '0');
}
function renderPlayerProfile() {
  $('#playerName').textContent = profileState.playerName;
}
function openPlayerProfile() {
  $('#profileNameInput').value = profileState.playerName;
  $('#profileNameStatus').textContent = '';
  $('#playerProfile').classList.remove('hidden');
  $('#profileNameInput').focus?.();
}
function savePlayerName() {
  const name = $('#profileNameInput').value.trim();
  if (!validPlayerName(name)) {
    $('#profileNameStatus').textContent = '请输入 2—16 位文字、数字、空格或下划线。';
    return false;
  }
  const before = profileState.playerName;
  profileState.playerName = name;
  if (!saveHangar()) {
    profileState.playerName = before;
    $('#profileNameStatus').textContent = '昵称保存失败，请重试。';
    return false;
  }
  renderPlayerProfile();
  $('#playerProfile').classList.add('hidden');
  return true;
}
function syncLobbyVideo() {
  const video = $('#menuVideo');
  const allowed = !document.hidden && !soundState.nativeSuspended && !$('#menu').classList.contains('hidden');
  if (!allowed) { video.pause?.(); return; }
  video.muted = true;
  const attempt = video.play?.();
  attempt?.catch?.(() => {});
}
function lobbyNotice() {
  const node = $('#menuNotice');
  node.textContent = '暂未开放'; node.classList.add('show');
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove('show'), 1400);
}
