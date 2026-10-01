import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {func,declaration,source} from './runtime.mjs';
const baseline=fs.readFileSync(new URL('../baseline/v14-index.html',import.meta.url),'utf8').split('<script type="module">')[1].split('</script>')[0];
function oldFunction(name){const start=baseline.indexOf('function '+name+'(');let i=baseline.indexOf('(',start),depth=1;while(depth){i++;if(baseline[i]==='(')depth++;else if(baseline[i]===')')depth--}let end=baseline.indexOf('{',i),braces=1;while(braces){end++;if(baseline[end]==='{')braces++;else if(baseline[end]==='}')braces--}return baseline.slice(start,end+1)}
const unchanged=['integrateAircraftFlight','steerAircraftToward','updatePlayerFlightControls','turnRateForPlane','verticalTurnRateForPlane','updatePropeller','configureCombatLandingGear','sweptAircraftHit','solveBulletIntercept','startCampaign','updateCampaign','updateCampaignEscortAI'];
for(const name of unchanged)assert.equal(func(name),oldFunction(name),name);
const configs=['AIRCRAFT_SPECS','PROPELLER_SPECS','AIRCRAFT_TREE','planeInfo','weaponInfo','AI_FIGHTER'];
for(const name of configs){
 const next=vm.runInNewContext(declaration(name)+';JSON.stringify('+name+')');
 const start=baseline.indexOf('const '+name+'='),end=baseline.indexOf(';',start),old=JSON.parse(vm.runInNewContext(baseline.slice(start,end+1)+';JSON.stringify('+name+')'));
 const now=JSON.parse(next);
 for(const type of Object.keys(old)){
  if(name==='AIRCRAFT_SPECS'&&['mig15','f86','meteor','b29'].includes(type))old[type].chaseOffsetMeters=1;
  assert.deepEqual(now[type],old[type],name+':'+type);
 }
 assert(now.mig3,name+' lacks MiG-3');
}
const audioStart=baseline.indexOf('const AUDIO_FILES=');assert.equal(declaration('AUDIO_FILES'),baseline.slice(audioStart,audioStart+declaration('AUDIO_FILES').length));
const html=fs.readFileSync(new URL('../app/src/main/assets/index.html',import.meta.url),'utf8');assert.equal(source,html.split('<script type="module">')[1].split('</script>')[0]);
const hud=html.slice(html.indexOf('<div class="hud'),html.indexOf('<div class="screen'));
assert(!/天空决斗|SKY DUEL/.test(hud));assert(!html.includes('.hud.airspace .throttle-control'));assert(hud.includes('id="blueAlive">5</b> / 5'));assert(hud.includes('id="redAlive">5</b> / 5'));
const report={result:'passed',unchangedExistingFlightPhysicsAndGear:unchanged,existingAircraftDataPreservedExceptRequestedCameraOffsets:true,embeddedModuleMatches:true,HUDBrandingRemoved:true};
fs.writeFileSync(new URL('source-v15.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
