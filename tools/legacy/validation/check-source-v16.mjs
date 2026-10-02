import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {func,declaration,source} from './runtime.mjs';
const html=fs.readFileSync(new URL('../app/src/main/assets/index.html',import.meta.url),'utf8'),base=fs.readFileSync(new URL('../baseline/v15-index.html',import.meta.url),'utf8').split('<script type="module">')[1].split('</script>')[0];
const oldDecl=name=>{const start=base.indexOf('const '+name+'=');return base.slice(start,base.indexOf(';',start)+1)};
for(const name of ['AIRCRAFT_SPECS','PROPELLER_SPECS','AIRCRAFT_TREE','planeInfo','weaponInfo','AI_FIGHTER']){
 const old=JSON.parse(vm.runInNewContext(oldDecl(name)+';JSON.stringify('+name+')')),now=JSON.parse(vm.runInNewContext(declaration(name)+';JSON.stringify('+name+')'));
 assert(now.i15,name);for(const type of Object.keys(old)){
  if(name==='AIRCRAFT_SPECS'&&['mig15','f86','meteor'].includes(type)){old[type].chaseOffsetMeters=.5;old[type].chaseHeightMeters=2}
  if(name==='AIRCRAFT_SPECS'&&type==='b29')old[type].chaseHeightMeters=2;
  if(name==='planeInfo'&&type==='meteor')old[type].name='Meteor F Mk 4 G.41G';
  assert.deepEqual(now[type],old[type],name+':'+type)
 }
}
assert.equal(html.split('<script type="module">')[1].split('</script>')[0],source);
for(const name of ['integrateAircraftFlight','updatePlayerFlightControls','turnRateForPlane','verticalTurnRateForPlane','updatePropeller','configureCombatLandingGear','configureMiG3CombatLandingGear','sweptAircraftHit','solveBulletIntercept'])assert(base.includes(func(name)),name+' changed unexpectedly');
assert.equal(declaration('AUDIO_FILES'),oldDecl('AUDIO_FILES'));
const h=vm.runInNewContext(declaration('planeInfo')+';planeInfo.i15');assert.equal(h.health,340);assert.equal(h.maxSpeedKmh,365);assert.equal(h.minLevelFlightKmh,105);assert.equal(h.bestClimbMps,12.7);assert.equal(h.turnTimeS,13.8);assert.equal(h.verticalTurnTimeS,8.6);assert.equal(h.name,'I-15');assert(!h.specs.some(row=>/追尾|机长/.test(row[0])));
const weapons=vm.runInNewContext(declaration('weaponInfo')+';weaponInfo.i15.mg');assert.deepEqual([weapons.rpm,weapons.speed,weapons.damage,weapons.cost,weapons.offsets.length],[750,775,13,4,4]);
assert(html.includes('data-preview-plane="i15"'));assert(source.includes('maxAltitudeMeters:3000'));assert(source.includes('followCameraAnchor(player)'));assert(source.includes('advanceBattleSimulation(elapsed)'));assert(source.includes('restoreBattlePhysicsPose()'));
const report={result:'passed',embeddedModuleMatches:true,existingAircraftPreservedExceptRequestedCameraAndMeteorName:true,existingFlightIntegratorControlsAndGearPreserved:true,I15StatsAndFourGuns:true,existingAudioFilesUnchanged:true};fs.writeFileSync(new URL('source-v16.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
