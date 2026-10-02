// PCM slices: one attack per weapon packet; stationary, crossfaded engine loops.
const AUDIO_FILES={jetEngine:'./audio/jet_engine_loop.wav',b29Engine:'./audio/b29_engine_loop.wav',i15Engine:'./audio/i15bis_engine_loop.wav',pv1Gun:'./audio/pv1_gun_shot.wav',f86Gun:'./audio/f86_gun_shot.wav',b29Gun:'./audio/b29_gun_shot.wav',mig23Gun:'./audio/mig23_gun_shot.wav',mig37Gun:'./audio/mig37_gun_shot.wav',meteorGun:'./audio/meteor20_gun_shot.wav',bombDrop:'./audio/bomb_drop.mp3',kill:'./audio/kill_confirm.mp3'};
const AUDIO_VOLUMES={f86Gun:.42,b29Gun:.48,pv1Gun:.42,mig23Gun:.53,mig37Gun:.47,meteorGun:.5,bombDrop:.66,kill:.7};
const audioPools=Object.create(null),audioLastPlayed=Object.create(null),audioBuffers=new Map(),audioLoads=new Map(),gunVoices=new Set();
let audioPrepared=false,audioContext=null,audioMaster=null,engineAudio=null,engineAudioType=null,engineGeneration=0,engineStartPending=false,nextGunStart=new WeakMap(),damageFlashTimer=null,damageFlashNextAt=0;

function prepareGameAudio(){
 if(audioPrepared)return;audioPrepared=true;
 const Context=window.AudioContext||window.webkitAudioContext;
 if(Context)try{
  audioContext=new Context();audioMaster=audioContext.createDynamicsCompressor();
  audioMaster.threshold.value=-6;audioMaster.knee.value=8;audioMaster.ratio.value=8;audioMaster.attack.value=.003;audioMaster.release.value=.1;audioMaster.connect(audioContext.destination)
 }catch(error){audioContext=null;console.warn('使用短片段音频备用播放',error)}
 for(const[name,path]of Object.entries(AUDIO_FILES)){
  if(name==='bombDrop'||name==='kill'||!audioContext){const clip=new Audio(path);clip.preload='auto';clip.load();audioPools[name]=[clip]}
  if(audioContext&&name!=='bombDrop'&&name!=='kill')loadAudioBuffer(name)
 }
}
function loadAudioBuffer(name){
 if(audioBuffers.has(name))return Promise.resolve(audioBuffers.get(name));
 if(audioLoads.has(name))return audioLoads.get(name);
 const promise=fetch(AUDIO_FILES[name]).then(response=>{if(!response.ok)throw new Error('音频无法读取：'+name);return response.arrayBuffer()}).then(raw=>audioContext.decodeAudioData(raw)).then(buffer=>{audioBuffers.set(name,buffer);return buffer}).catch(error=>{console.warn('音频解码失败：'+name,error);return null});
 audioLoads.set(name,promise);return promise
}
function resumeGameAudio(){
 prepareGameAudio();if(audioContext&&audioContext.state==='suspended')audioContext.resume().catch(()=>{})
}
function playSfx(name,minGap=.2){
 prepareGameAudio();const now=performance.now(),prior=audioLastPlayed[name];
 if(prior!==undefined&&now-prior<minGap*1000)return;audioLastPlayed[name]=now;
 const pool=audioPools[name]||(audioPools[name]=[]);let voice=pool.find(item=>item.paused||item.ended);
 if(!voice&&pool.length<6){voice=new Audio(AUDIO_FILES[name]);voice.preload='auto';pool.push(voice)}
 if(!voice)voice=pool.reduce((old,item)=>item.currentTime>old.currentTime?item:old,pool[0]);
 voice.pause();voice.currentTime=0;voice.loop=false;voice.volume=AUDIO_VOLUMES[name]??.5;
 const promise=voice.play();if(promise?.catch)promise.catch(()=>{})
}
function releaseGunVoice(voice){
 gunVoices.delete(voice);if(voice.source)try{voice.source.disconnect();voice.gain.disconnect()}catch{}
}
function playGunShot(name,root,isEnemy,interval,automatic=false){
 if(!playing)return;prepareGameAudio();
 const volume=(AUDIO_VOLUMES[name]??.42)*(isEnemy?.35:1),buffer=audioBuffers.get(name);
 // Unloaded/suspended Web Audio never queues stale shots for later replay.
 if(audioContext){
  if(audioContext.state!=='running'||!buffer)return;
  const now=audioContext.currentTime,perRoot=nextGunStart.get(root)||new Map();nextGunStart.set(root,perRoot);
  const start=Math.min(Math.max(now,perRoot.get(name)||now),now+.10);perRoot.set(name,start+interval);
  const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=buffer;source.loop=false;gain.gain.value=volume;source.connect(gain);gain.connect(audioMaster);
  const voice={source,gain,start,isEnemy,automatic};gunVoices.add(voice);source.onended=()=>releaseGunVoice(voice);source.start(start);
 }else{
  // Older WebViews still play a single short WAV, never the original burst.
  const clip=new Audio(AUDIO_FILES[name]);clip.volume=volume;clip.loop=false;
  const voice={element:clip,start:0,isEnemy,automatic};gunVoices.add(voice);clip.onended=()=>releaseGunVoice(voice);
  clip.play().catch(()=>releaseGunVoice(voice))
 }
 if(gunVoices.size>48){const oldest=gunVoices.values().next().value;if(oldest.source){try{oldest.source.stop()}catch{}}else oldest.element.pause();releaseGunVoice(oldest)}
}
function stopPendingGunSounds(){
 if(keys.fire)return;const now=audioContext?.currentTime||0;
 for(const voice of [...gunVoices])if(!voice.isEnemy&&!voice.automatic&&voice.source&&voice.start>now+.001){try{voice.source.stop()}catch{};releaseGunVoice(voice)}
 if(player)nextGunStart.delete(player)
}
function stopGunSounds(){
 for(const voice of [...gunVoices]){
  if(voice.source){const now=audioContext.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.004);try{voice.source.stop(now+.016)}catch{}}
  else{voice.element.pause();releaseGunVoice(voice)}gunVoices.delete(voice)
 }
 nextGunStart=new WeakMap()
}
function stopEngineSound(){
 engineGeneration++;engineStartPending=false;
 if(engineAudio){
  const voice=engineAudio;
  if(voice.source){const now=audioContext.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(0,now,.012);try{voice.source.stop(now+.06)}catch{}}
  else{voice.element.pause();voice.element.currentTime=0}
 }
 engineAudio=null;engineAudioType=null
}
function startEngineSound(type){
 resumeGameAudio();const kind=type==='b29'?'b29':(type==='i15bis'||type==='bf109b1'||type==='p36a')?'prop':'jet';
 if(engineAudioType===kind&&(engineAudio||engineStartPending))return;
 stopEngineSound();engineAudioType=kind;const generation=engineGeneration,name=kind==='b29'?'b29Engine':kind==='prop'?'i15Engine':'jetEngine';engineStartPending=true;
 const begin=buffer=>{
  if(generation!==engineGeneration)return;
  if(!playing||!player||(player.userData.engineRunning===false&&(kind!=='prop'||(player.userData.propRpm||0)===0))){engineStartPending=false;engineAudioType=null;return}
  engineStartPending=false;
  if(audioContext&&buffer){
   const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=buffer;source.loop=true;source.loopStart=0;source.loopEnd=buffer.duration;
   gain.gain.value=0;source.connect(gain);gain.connect(audioMaster);const voice={source,gain};engineAudio=voice;
   source.onended=()=>{try{source.disconnect();gain.disconnect()}catch{}};source.start();updateEngineAudio()
  }else{
   const element=new Audio(AUDIO_FILES[name]);element.loop=true;element.preload='auto';element.volume=0;engineAudio={element};updateEngineAudio();element.play().catch(()=>{})
  }
 };
 if(audioContext){const buffer=audioBuffers.get(name);if(buffer)begin(buffer);else loadAudioBuffer(name).then(begin)}else begin(null)
}
function updateEngineAudio(){
 if(!engineAudio||!player)return;
 const data=player.userData,throttle=THREE.MathUtils.clamp(data.throttle??throttleValue,0,1);let volume,rate;
 if(engineAudioType==='prop'){
  const fraction=THREE.MathUtils.clamp((data.propRpm||0)/PROPELLER_SPECS[playerPlane].maxRpm,0,1);
  volume=(.10+fraction*.24)*THREE.MathUtils.smoothstep(fraction,0,.15);rate=.65+fraction*.52;
  if(!data.engineRunning&&(data.propRpm||0)===0){stopEngineSound();return}
 }else{
  if(!data.engineRunning){stopEngineSound();return}
  volume=engineAudioType==='b29'?.27+throttle*.17:.13+throttle*.13;rate=.84+.30*throttle
 }
 if(engineAudio.source){const now=audioContext.currentTime;engineAudio.gain.gain.setTargetAtTime(volume,now,.06);engineAudio.source.playbackRate.setTargetAtTime(rate,now,.1)}
 else{engineAudio.element.volume=volume;engineAudio.element.playbackRate=rate}
}
