const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const{chromium}=require((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()+'/node_modules')+'/playwright');
let lastPage=null;
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const bridge=`
const qaRoots={};
function qaSourceSignature(source){const rows=[];source.traverse(n=>rows.push([n.name,n.visible,...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()]));return JSON.stringify(rows)}
function qaSummary(root){
 if(!root)return null;
 const box=aircraftLocalBounds(root,[root]),gear=root.userData.landingGear;
 let texturedMeshes=0,standardMeshes=0;root.traverse(n=>{if(n.isMesh){const materials=Array.isArray(n.material)?n.material:[n.material];if(materials.some(m=>m.map?.image))texturedMeshes++;if(materials.every(m=>m.isMeshStandardMaterial||m.isMeshBasicMaterial))standardMeshes++}});
 return{texturedMeshes,standardMeshes,materialSamples:(()=>{const out=[];root.traverse(n=>{if(n.isMesh&&out.length<5)out.push({name:n.name,material:n.material?.type,map:!!n.material?.map,image:!!n.material?.map?.image,imageType:n.material?.map?.image?.constructor?.name})});return out})(),type:root.userData.type,context:root.userData.modelContext,attached:!!root.userData.modelAttached,error:!!root.userData.modelError,length:root.userData.lengthMeters,modelSize:box.getSize(new THREE.Vector3()).multiplyScalar(10).toArray(),propAxis:root.userData.propeller?.spinAxis.toArray(),propeller:!!root.userData.propeller,gear:gear?{state:gear.state,assemblies:gear.assemblies.map(g=>({name:g.name,parts:g.parts,before:g.wheelBefore,after:g.wheelAfter,angle:g.foldAngleDegrees,axis:g.foldAxis,doorSegments:g.doorSegments,doorState:g.doorState}))}:null}
}
window.__airspaceQA={
 state:()=>({playing,ended,mode:gameMode,spectating:airspaceSpectating,observed:airspaceObservedId,hp,counts:airspaceState?.counts,progress:airspaceState?.progress,scores:airspaceState?.scores,units:airspaceUnits.map(u=>({id:u.id,team:u.team,type:u.type,health:u.health,dead:u.dead,position:u.root.position.toArray(),attached:u.root.userData.modelAttached,error:u.root.userData.modelError,gear:u.root.userData.landingGear?.state,ammo:{...u.ammo}}))}),
 catalog:()=>Object.entries(planeInfo).map(([type,info])=>({type,intro:info.intro,specs:info.specs})),
 allModels:async()=>{const models=[];for(const type of Object.keys(planeInfo)){await loadPlaneModel(type);const root=aircraft(false,type);await Promise.resolve();models.push(qaSummary(root))}return models},
 kill:()=>{damageAirspaceUnit(airspaceUnitFor(player),100000,'red-0');updateAirspaceFrame(0,1/60);renderer.render(scene,camera)},
 render:()=>{updateAirspaceFrame(0,1/60);renderer.render(scene,camera)},
 step:(frames)=>{for(let i=0;i<frames&&playing;i++)updateAirspaceStep(1/60);updateAirspaceFrame(0,1/60);renderer.render(scene,camera)},
 camera:()=>camera.position.toArray()
};
window.__aircraftQA={
 ready:()=>Promise.all([...audioLoads.values()]),
 profile:()=>({unlocked:[...unlockedPlanes],selected:selectedAircraft}),
 make:async(type,preview=false)=>{
  const source=await loadPlaneModel(type),signature=qaSourceSignature(source),root=aircraft(false,type,{preview});
  await loadPlaneModel(type);await Promise.resolve();
  const after=qaSourceSignature(source);qaRoots[type+(preview?'Preview':'Combat')]=root;
  return{...qaSummary(root),sourceUnchanged:signature===after,sourceSignature:after}
 },
 fight:()=>({playing,type:playerPlane,hp,ammo:{...playerAmmo},engine:engineAudioType,root:qaSummary(player),enemy:qaSummary(enemy),cameraLocal:camera.position.clone().sub(player.position).applyQuaternion(player.quaternion.clone().invert()).multiplyScalar(10).toArray()}),
 fire:()=>{fireWeapons(player,false,1/60,true);return{ammo:{...playerAmmo},bullets:bullets.map(b=>({weapon:b.weapon,speed:b.speed*10,damage:b.damage}))}},
 camera:()=>{resetCameraTracking();updateChaseCamera(0)},
 cameraOffsets:async()=>{const savedPlayer=player,savedType=playerPlane,savedMode=gameMode,result=[];gameMode='duel';for(const type of ['mig15','f86','meteor','b29','mig3']){await loadPlaneModel(type);player=aircraft(true,type);await Promise.resolve();playerPlane=type;player.position.set(0,100,0);player.quaternion.identity();resetCursorControl();resetCameraTracking();updateChaseCamera(0);result.push({type,local:camera.position.clone().sub(player.position).multiplyScalar(10).toArray()})}player=savedPlayer;playerPlane=savedType;gameMode=savedMode;resetCursorControl();resetCameraTracking();return result},
 markerLabel:()=>{const savedMode=gameMode,savedType=enemyPlaneType;gameMode='duel';enemyPlaneType='f3f2';updateHealthUI();const text=$('#enemyMarker .marker-label').textContent;gameMode=savedMode;enemyPlaneType=savedType;updateHealthUI();return text},
 tailHidden:()=>{const root=qaRoots.mig3Combat;return root.userData.landingGear.assemblies[2].parts.every(name=>!root.getObjectByName(name).visible)},
 roster:()=>{chooseDuelOpponent=type=>duelOpponentsFor(type).find(id=>id==='f3f2')||duelOpponentsFor(type)[0]},
 select:type=>{setSelectedAircraft(type);showMenuScreen('modeSelect')},
 migOrientation:()=>{const root=qaRoots.mig3Preview;const center=name=>new THREE.Box3().setFromObject(root.getObjectByName(name)).getCenter(new THREE.Vector3()).multiplyScalar(10).toArray();return{spinner:center('kok'),fin:center('kil')}},
 propeller:()=>{const source=qaRoots.f3f2Combat,pivot=source.userData.propeller.pivot;source.userData.engineRunning=true;source.userData.throttle=1;source.userData.propRpm=0;updatePropeller(source,1);const running={rpm:source.userData.propRpm,blur:source.userData.propeller.disc.visible,quaternion:pivot.quaternion.toArray()};updatePropeller(source,3);const highRpm={rpm:source.userData.propRpm,blur:source.userData.propeller.disc.visible};source.userData.engineRunning=false;updatePropeller(source,5);return{running,highRpm,stopped:{rpm:source.userData.propRpm,blur:source.userData.propeller.disc.visible}}},
 view:(type,preview,side)=>{
  const active=qaRoots[type+(preview?'Preview':'Combat')],viewScene=new THREE.Scene();viewScene.background=new THREE.Color(0x253846);viewScene.add(new THREE.HemisphereLight(0xffffff,0x7d858c,2.2));const sun=new THREE.DirectionalLight(0xfff3de,2.8);sun.position.set(2,3,-4);viewScene.add(sun);viewScene.add(active);
  const c=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.001,30);c.position.fromArray(side==='side'?[1.3,.12,0]:side==='bottom'?[.7,-.65,.9]:[.8,.42,-1]);c.lookAt(0,0,0);renderer.render(viewScene,c)
 }
};`;
async function main(){
 const server=http.createServer((req,res)=>{const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(assets+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}const type={'.js':'text/javascript','.html':'text/html','.wav':'audio/wav','.mp3':'audio/mpeg','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(res)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.SKY_DUEL_CHROME||path.resolve(root,'../tools-audio-build/chrome-headless-shell-linux64/chrome-headless-shell'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:760}}),errors=[],httpErrors=[];
  lastPage=page;page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.error('BROWSER',m.text())});page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()})});
  await page.addInitScript(()=>{window.requestAnimationFrame=cb=>{window.__nextFrame=cb;return 1};localStorage.setItem('sky-duel-profile-v1',JSON.stringify({unlocked:['f86','mig15','meteor','b29','i15bis','bf109b1','p36a'],selected:'p36a'}))});
  await page.route('**/index.html',r=>r.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(path.join(assets,'index.html'),'utf8').replace('</script>',bridge+'\n</script>')}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html',{waitUntil:'load'});
  await page.waitForFunction(()=>!!window.__aircraftQA,null,{polling:100});await page.evaluate(()=>window.__aircraftQA.ready());
  const profile=await page.evaluate(()=>window.__aircraftQA.profile());assert(profile.unlocked.includes('f3f2'));assert(profile.unlocked.includes('mig3'));assert.equal(profile.selected,'p36a');
  const models=[];
  for(const type of ['f3f2','p36a']){
   const preview=await page.evaluate(type=>window.__aircraftQA.make(type,true),type),combat=await page.evaluate(type=>window.__aircraftQA.make(type,false),type);
   assert(preview.attached&&!preview.error);assert(combat.attached&&!combat.error);assert(preview.sourceUnchanged&&combat.sourceUnchanged);assert.equal(preview.sourceSignature,combat.sourceSignature);delete preview.sourceSignature;delete combat.sourceSignature;
   assert.equal(preview.gear,null);assert.equal(combat.gear.state,'stowed');assert.equal(combat.gear.assemblies.length,3);
   for(const assembly of combat.gear.assemblies){assert.equal(assembly.angle,-90);assert(assembly.after[1]>assembly.before[1],JSON.stringify(assembly));assert(assembly.after[2]>assembly.before[2],JSON.stringify(assembly))}
   if(type==='f3f2'){assert.equal(preview.length,7.06);assert(Math.abs(preview.modelSize[2]-7.06)<.001);assert(preview.propeller);assert.deepEqual(preview.propAxis,[0,0,-1])}
   models.push({preview,combat});
  }
  await page.locator('#openResearch').click({force:true});assert(await page.locator('[data-tree-plane="f3f2"]').count()>=1);assert.equal(await page.locator('#ownedCount').innerText(),'09');
  await page.locator('#researchHome').click({force:true});await page.locator('#openHangar').click({force:true});await page.locator('[data-hangar-select="f3f2"]').click({force:true});await page.locator('#hangarHome').click({force:true});
  await page.locator('#start').click({force:true});await page.evaluate(()=>{window.__aircraftQA.roster()});await page.locator('#chooseAIBattle').click({force:true});
  await page.waitForFunction(()=>window.__aircraftQA.fight().playing&&window.__airspaceQA.state().units.length===10&&window.__airspaceQA.state().units.every(u=>u.attached&&!u.error),null,{polling:100});await page.evaluate(()=>window.__aircraftQA.camera());
  const fight=await page.evaluate(()=>window.__aircraftQA.fight());assert(fight.playing);assert.equal(fight.type,'f3f2');assert.equal(fight.hp,360);assert.equal(fight.engine,'prop');assert.equal(fight.ammo.m2,200);assert.equal(fight.ammo.mg762,500);assert(Math.abs(fight.cameraLocal[1]-2.3)<1e-8);assert(Math.abs(fight.cameraLocal[2]-(7.06/2+2.3))<1e-8);
  const fired=await page.evaluate(()=>window.__aircraftQA.fire());assert.equal(fired.ammo.m2,199);assert.equal(fired.ammo.mg762,499);assert.deepEqual(fired.bullets.map(b=>[b.weapon,b.speed,b.damage]),[['m2',860,34],['mg762',810,13]]);
  await page.evaluate(()=>window.showPause());await page.locator('#returnHome').click({force:true});await page.locator('#openEncyclopedia').click({force:true});await page.locator('[data-preview-plane="f3f2"]').click({force:true});assert.equal(await page.locator('#catalogName').innerText(),'F3F-2');assert((await page.locator('#catalogSpecs').innerText()).includes('16.5 s'));await page.locator('[data-preview-plane="p36a"]').click({force:true});assert.equal(await page.locator('#catalogName').innerText(),'P-36A');
  const catalogs=await page.evaluate(()=>window.__airspaceQA.catalog());
  for(const item of catalogs){assert(!/低于最小|起落架|失速/.test(item.intro));assert.equal(item.specs.filter(s=>s[0]==='水平转弯性能').length,1);assert.equal(item.specs.filter(s=>s[0]==='垂直转弯性能').length,1);assert(!item.specs.some(s=>/追尾|起落架/.test(s[0])));for(const key of ['最大航速','最小航速'])assert(!/[（()）]/.test(item.specs.find(s=>s[0]===key)[1]))}
  const allModels=await page.evaluate(()=>window.__airspaceQA.allModels());assert.equal(allModels.length,9);assert(allModels.every(m=>m.attached&&!m.error));
  assert.equal(await page.evaluate(()=>window.__aircraftQA.markerLabel()),'F3F-2');
  const migPreview=await page.evaluate(()=>window.__aircraftQA.make('mig3',true)),migCombat=await page.evaluate(()=>window.__aircraftQA.make('mig3',false));assert(migPreview.attached&&migCombat.attached&&!migPreview.error&&!migCombat.error);assert(migPreview.sourceUnchanged&&migCombat.sourceUnchanged);await page.evaluate(()=>window.__aircraftQA.view('mig3',true,'side'));await page.locator('#scene canvas').screenshot({path:path.join(__dirname,'mig3-inspect-v15.png')});assert(migCombat.texturedMeshes>=61,JSON.stringify({textured:migCombat.texturedMeshes,materials:migCombat.materialSamples}));assert(Math.abs(migPreview.modelSize[2]-8.25)<1e-5);assert(Math.abs(migPreview.modelSize[0]/migPreview.modelSize[2]-10.21490002/8.2374922)<1e-5);assert.deepEqual(migCombat.propAxis,[0,0,-1]);assert.equal(migPreview.gear,null);assert.equal(migCombat.gear.state,'stowed');assert.equal(migCombat.gear.assemblies.length,3);for(const a of migCombat.gear.assemblies){assert.equal(a.doorState,'closed');assert(a.after[1]>a.before[1]);if(a.name.includes('Main')){assert(Math.abs(a.after[0])<Math.abs(a.before[0])-.04);assert.equal(a.axis,'z');assert.equal(a.doorSegments,3)}else{assert(a.after[2]>a.before[2]+.005);assert.equal(a.axis,'x');assert.equal(a.doorSegments,2)}}delete migPreview.sourceSignature;delete migCombat.sourceSignature;
  const orientation=await page.evaluate(()=>window.__aircraftQA.migOrientation());assert(orientation.spinner[2]<-3);assert(orientation.fin[2]>2);assert(orientation.fin[1]>0);
  const cameras=await page.evaluate(()=>window.__aircraftQA.cameraOffsets());for(const c of cameras){const offset=c.type==='mig3'?2.7:1,length=allModels.find(m=>m.type===c.type).length;assert(Math.abs(c.local[1]-offset)<1e-7);assert(Math.abs(c.local[2]-(length/2+offset))<1e-7)}
  if(process.env.SKY_DUEL_GEAR_ONLY==='1'){
   const tailHidden=await page.evaluate(()=>window.__aircraftQA.tailHidden());assert(tailHidden);
   await page.addStyleTag({content:'.screen,#hud,#campaignHud,#toast{display:none!important}'});
   for(const preview of [false,true])for(const side of ['side','bottom']){await page.evaluate(([preview,side])=>window.__aircraftQA.view('mig3',preview,side),[preview,side]);await page.locator('#scene canvas').screenshot({path:path.join(__dirname,`mig3-${preview?'catalog':'combat'}-${side}-v15.png`)})}
   assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);const report={result:'passed',method:'Final MiG-3 gear, underside doors and source/catalog isolation in native GLTF/WebGL.',tailHidden,migPreview,migCombat,orientation,cameras,pageErrors:errors,httpErrors};fs.writeFileSync(path.join(__dirname,'mig3-gear-v15.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'passed',tailHardwareInsideClosedBay:tailHidden,catalogSourceUnchanged:migPreview.sourceUnchanged,assemblies:migCombat.gear.assemblies},null,2));return;
  }
  await page.locator('[data-preview-plane="mig3"]').click({force:true});assert.equal(await page.locator('#catalogName').innerText(),'MiG-3');assert(!(await page.locator('#catalogSpecs').innerText()).includes('机长'));

  await page.locator('#closeEncyclopedia').click({force:true});await page.locator('#start').click({force:true});await page.locator('#chooseAIBattle').click({force:true});
  await page.waitForFunction(()=>window.__airspaceQA.state().playing&&window.__airspaceQA.state().units.length===10&&window.__airspaceQA.state().units.every(u=>u.attached),null,{polling:100});
  await page.evaluate(()=>window.__airspaceQA.render());const airspace=await page.evaluate(()=>window.__airspaceQA.state());assert.equal(airspace.mode,'airspace');assert.equal(airspace.units.filter(u=>u.team==='blue').length,5);assert.equal(airspace.units.filter(u=>u.team==='red').length,5);assert.equal(airspace.progress,0);assert.equal(airspace.scores.blue,0);assert(airspace.units.filter(u=>u.type==='f3f2').every(u=>u.gear==='stowed'));
  await page.screenshot({path:path.join(__dirname,'airspace-start-v15.png')});
  await page.evaluate(()=>window.__airspaceQA.step(180));const afterFlight=await page.evaluate(()=>window.__airspaceQA.state());assert(afterFlight.units.every(u=>u.position.every(Number.isFinite)));
  await page.evaluate(()=>window.__airspaceQA.kill());assert(await page.locator('#spectatorControls').isVisible());const beforeWatch=await page.evaluate(()=>window.__airspaceQA.state());assert(beforeWatch.playing&&!beforeWatch.ended&&beforeWatch.spectating&&beforeWatch.hp===0);assert.equal(beforeWatch.units.filter(u=>u.team==='blue'&&!u.dead).length,4);
  await page.locator('#spectateNext').click();await page.evaluate(()=>window.__airspaceQA.render());const afterWatch=await page.evaluate(()=>window.__airspaceQA.state());assert.notEqual(afterWatch.observed,beforeWatch.observed);assert.equal(afterWatch.units.length,10);assert(!(await page.locator('[data-key="fire"]').isVisible()));
  await page.screenshot({path:path.join(__dirname,'airspace-spectator-v15.png')});
  await page.evaluate(()=>window.showPause());await page.locator('#again').click({force:true});assert((await page.evaluate(()=>window.__airspaceQA.state())).spectating);
  await page.evaluate(()=>{window.showPause();window.__aircraftQA.select('mig3')});await page.locator('#chooseAIBattle').click({force:true});
  await page.waitForFunction(()=>window.__airspaceQA.state().playing&&window.__airspaceQA.state().units.length===10&&window.__airspaceQA.state().units.every(u=>u.attached&&!u.error),null,{polling:100});await page.evaluate(()=>window.__aircraftQA.camera());
  const migFight=await page.evaluate(()=>window.__aircraftQA.fight());assert.equal(migFight.type,'mig3');assert.equal(migFight.hp,480);assert.equal(migFight.engine,'prop');assert.equal(migFight.ammo.m2,280);assert.equal(migFight.ammo.mg762,1500);
  const migFired=await page.evaluate(()=>window.__aircraftQA.fire());assert.equal(migFired.ammo.m2,279);assert.equal(migFired.ammo.mg762,1498);assert.deepEqual(migFired.bullets.map(b=>[b.weapon,b.speed,b.damage]),[['m2',860,28],['mg762',820,15],['mg762',820,15]]);
  const layouts=[];
  for(const [width,height] of [[1100,760],[844,390],[640,360]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>window.__airspaceQA.render());
   const layout=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};return{radar:box('.radar-box'),status:box('#airspaceHud'),readout:box('.readout'),throttle:box('#throttleControl'),label:box('#aCaptureText')}});
   assert.equal(layout.status.y,0);assert(layout.radar.x<width/4&&layout.radar.y<=8);assert(Math.abs(layout.throttle.h-height*.5)<.1);assert(layout.readout.y>=layout.status.bottom,JSON.stringify(layout));assert(layout.status.x>=layout.radar.right,JSON.stringify(layout));assert(layout.label.x>=layout.status.x&&layout.label.right<=layout.status.right,JSON.stringify(layout));assert.equal(await page.locator('#hud .brand').count(),0);
   layouts.push({width,height,airspace:layout});await page.screenshot({path:path.join(__dirname,`airspace-mobile-${width}-v15.png`)});
  }
  await page.evaluate(()=>{window.showPause();document.querySelector('#returnHome').click();document.querySelector('#start').click();document.querySelector('#chooseCampaign').click()});await page.locator('#beginCampaign').click({force:true});
  await page.waitForFunction(()=>window.__aircraftQA.fight().playing&&window.__aircraftQA.fight().type==='mig15',null,{polling:100});
  const campaignLayout=await page.evaluate(()=>{const a=document.querySelector('#campaignHud').getBoundingClientRect(),t=document.querySelector('#throttleControl').getBoundingClientRect();return{top:a.top,statusBottom:a.bottom,throttleHeight:t.height}});assert.equal(campaignLayout.top,0);assert.equal(campaignLayout.throttleHeight,layouts.at(-1).airspace.throttle.h);
  await page.screenshot({path:path.join(__dirname,'campaign-mobile-v15.png')});await page.setViewportSize({width:1100,height:760});
  const propeller=await page.evaluate(()=>window.__aircraftQA.propeller());assert(propeller.running.rpm>0);assert(propeller.highRpm.blur);assert.equal(propeller.highRpm.rpm,1900);assert.equal(propeller.stopped.rpm,0);assert.equal(propeller.stopped.blur,false);
  await page.addStyleTag({content:'.screen,#hud,#campaignHud,#toast{display:none!important}'});
  for(const type of ['f3f2','p36a','mig3'])for(const preview of [false,true])for(const side of ['side','bottom']){await page.evaluate(([type,preview,side])=>window.__aircraftQA.view(type,preview,side),[type,preview,side]);await page.locator('#scene canvas').screenshot({path:path.join(__dirname,`${type}-${preview?'catalog':'combat'}-${side}-v15.png`)})}
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
  const report={result:'passed',method:'Actual generated v15 page with native GLTF/Draco decoding, Web Audio, SwiftShader WebGL and UI interactions; controlled animation frames. No Android device.',browser:browser.version(),checks:['Existing v12 profile receives F3F-2 and retains its selected aircraft','Research/hangar/catalog expose nine aircraft','Both aircraft have rearward/upward combat gear and untouched catalog source transforms','F3F-2 model length and forward propeller axis match game axes','F3F-2 sortie has 360 HP, 200/500 ammunition, propeller engine and 2.3 m chase height/offset','Two actual projectiles have the supplied speed and damage','F3F-2 propeller starts and stops with RPM','All nine actual GLB models decode; catalogs use unified turn labels and cleaned speed values','Airspace UI starts 5v5 with zero capture and score and correctly stowed combat gear','Three seconds of real flight remain finite; player death preserves the roster and exposes allied observation controls','Touch spectator switching and pause/resume preserve the dead player','MiG-3 actual model retains textures, correct axes and proportional 8.25 m length; three barrels fire at supplied speed/damage','MiG-3 combat wheels fold inward into three-segment closed wing bays and aft into a two-leaf tail bay; catalog gear and shared source transforms/visibility remain extended','Five camera offsets match the requested metres','HUD objective bars sit on the top edge, radar sits top-left, text stays separated and throttle length matches the campaign at three landscape sizes'],profile,models,allModels,catalogs,migPreview,migCombat,orientation,cameras,layouts,campaignLayout,migFight,migFired,airspace,beforeWatch,afterWatch,fight,fired,propeller,pageErrors:errors,httpErrors};
  fs.writeFileSync(path.join(__dirname,'browser-aircraft-v15.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,checks:report.checks,pageErrors:errors,httpErrors},null,2));
 }finally{if(lastPage)await lastPage.screenshot({path:path.join(__dirname,'last-browser-v15.png')}).catch(()=>{});await browser.close();await new Promise(r=>server.close(r))}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
