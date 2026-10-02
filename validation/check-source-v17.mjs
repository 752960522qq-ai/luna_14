import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {func,declaration,source} from './runtime.mjs';
const html=fs.readFileSync(new URL('../app/src/main/assets/index.html',import.meta.url),'utf8'),base=fs.readFileSync(new URL('../baseline/v16-index.html',import.meta.url),'utf8').split('<script type="module">')[1].split('</script>')[0];
const oldDecl=name=>{const start=base.indexOf('const '+name+'=');return base.slice(start,base.indexOf(';',start)+1)};
const calibration=JSON.parse(fs.readFileSync(new URL('../baseline/chase-camera-calibration-v17.json',import.meta.url)));
for(const name of ['AIRCRAFT_SPECS','PROPELLER_SPECS','AIRCRAFT_TREE','planeInfo','weaponInfo','AI_FIGHTER']){
 const old=JSON.parse(vm.runInNewContext(oldDecl(name)+';JSON.stringify('+name+')')),now=JSON.parse(vm.runInNewContext(declaration(name)+';JSON.stringify('+name+')'));
 assert(now.i16,name);for(const type of Object.keys(old)){
  if(name==='AIRCRAFT_SPECS'){old[type].chaseOffsetMeters=calibration.planes[type].tailBackMeters;old[type].chaseHeightMeters=calibration.planes[type].heightMeters}
  assert.deepEqual(now[type],old[type],name+':'+type)
 }
}
assert.equal(html.split('<script type="module">')[1].split('</script>')[0],source);
for(const name of ['integrateAircraftFlight','updatePlayerFlightControls','turnRateForPlane','verticalTurnRateForPlane','updatePropeller','configureCombatLandingGear','configureMiG3CombatLandingGear','sweptAircraftHit','solveBulletIntercept','followCameraAnchor','advanceBattleSimulation','applyBattleRenderPose','restoreBattlePhysicsPose'])assert(base.includes(func(name)),name+' changed unexpectedly');
assert.equal(declaration('AUDIO_FILES'),oldDecl('AUDIO_FILES'));
const i=vm.runInNewContext(declaration('planeInfo')+';planeInfo.i16');assert.deepEqual([i.health,i.maxSpeedKmh,i.minLevelFlightKmh,i.bestClimbMps,i.turnTimeS,i.verticalTurnTimeS],[350,445,118,13.4,17.8,9.8]);assert(!i.specs.some(row=>/追尾|机长/.test(row[0])));
const w=vm.runInNewContext(declaration('weaponInfo')+';weaponInfo.i16.mg');assert.deepEqual([w.rpm,w.speed,w.damage,w.cost,w.count,w.offsets.length],[1800,825,16,2,2,2]);
const report={result:'passed',embeddedModuleMatches:true,existingTenAircraftDataPreservedExceptCalibratedCameras:true,flightIntegratorControlsGearAndV16StabilityPreserved:true,I16SuppliedStatsAndTwoGuns:true,existingAudioFilesUnchanged:true};fs.writeFileSync(new URL('source-v17.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
