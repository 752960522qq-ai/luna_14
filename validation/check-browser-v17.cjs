const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'app/src/main/assets');
const bridge=`
const qaRoots={};
function qaSummary(root){
 const box=aircraftLocalBounds(root,[root]);let textured=0,meshes=0;
 root.traverse(n=>{if(n.isMesh){meshes++;if((Array.isArray(n.material)?n.material:[n.material]).some(m=>m.map?.image))textured++}});
 return{type:root.userData.type,attached:!!root.userData.modelAttached,error:!!root.userData.modelError,sizeMeters:box.getSize(new THREE.Vector3()).multiplyScalar(10).toArray(),textured,meshes,propeller:!!root.userData.propeller,propAxis:root.userData.propeller?.spinAxis.toArray()}
}
function qaPoints(root){
 const points=[];root.updateMatrixWorld(true);
 root.traverse(n=>{if(!n.isMesh)return;for(let p=n;p;p=p.parent)if(!p.visible)return;
  const position=n.geometry.attributes.position;if(!position)return;
  for(let i=0;i<position.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(n.matrixWorld))
 });return points
}
window.__qa={
 ready:()=>Promise.all([...audioLoads.values()]),
 preload:async()=>{await Promise.all(Object.keys(AIRCRAFT_SPECS).map(loadPlaneModel));for(const type of Object.keys(AIRCRAFT_SPECS)){qaRoots[type]=aircraft(true,type);await Promise.resolve()}return Object.fromEntries(Object.entries(qaRoots).map(([id,r])=>[id,qaSummary(r)]))},
 info:()=>({types:Object.keys(planeInfo),unlocked:[...unlockedPlanes],selected:selectedAircraft,economy:JSON.parse(JSON.stringify(economy)),states:Object.fromEntries(Object.keys(AIRCRAFT_SPECS).map(id=>[id,aircraftResearchState(id).status]))}),
 makePreview:async()=>{await loadPlaneModel('i16');qaRoots.i16Preview=aircraft(false,'i16',{preview:true});await Promise.resolve();return qaSummary(qaRoots.i16Preview)},
 prop:()=>{const r=qaRoots.i16;r.userData.engineRunning=true;r.userData.throttle=1;updatePropeller(r,3);const running={rpm:r.userData.propRpm,blur:r.userData.propeller.disc.visible};r.userData.engineRunning=false;updatePropeller(r,4);return{running,stoppedRpm:r.userData.propRpm}},
 viewI16:()=>{const s=new THREE.Scene();s.background=new THREE.Color(0x263e50);s.add(new THREE.HemisphereLight(0xffffff,0x7c897a,2.4));const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(2,3,-4);s.add(light);s.add(qaRoots.i16Preview);const c=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.01,30);c.position.set(1.05,.32,-1.2);c.lookAt(0,0,0);renderer.render(s,c);return renderer.domElement.toDataURL('image/png')},
 cameras:()=>{const original=player,originalType=playerPlane,originalMode=gameMode,originalAspect=camera.aspect,originalControls=controlSettings.mode,result=[];gameMode='duel';controlSettings.mode='joystick';
  for(const type of Object.keys(AIRCRAFT_SPECS)){
   player=qaRoots[type];player.position.set(0,0,0);player.quaternion.identity();playerPlane=type;const points=qaPoints(player),screens=[];
   for(const aspect of [2048/920,844/390,16/9]){
    camera.aspect=aspect;camera.updateProjectionMatrix();resetCursorControl();resetCameraTracking();updateChaseCamera(0);
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const v of points){const p=v.clone().project(camera),x=(p.x+1)/2,y=(1-p.y)/2;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}
    screens.push({aspect,offset:camera.position.clone().sub(player.position).multiplyScalar(10).toArray(),width:x1-x0,centerY:(y0+y1)/2,bounds:[x0,y0,x1,y1]})
   }result.push({type,screens})
  }player=original;playerPlane=originalType;gameMode=originalMode;controlSettings.mode=originalControls;camera.aspect=originalAspect;camera.updateProjectionMatrix();resetCursorControl();resetCameraTracking();return result
 },
 reward:()=>{gameMode='airspace';reset();battleRewardSeconds=180;kills=2;finishAirspaceBattle('blue');const first=JSON.parse(JSON.stringify(economy));finishAirspaceBattle('blue');return{first,repeat:JSON.parse(JSON.stringify(economy)),text:$('#sortieRewards').textContent}},
 fight:()=>({playing,mode:gameMode,type:playerPlane,hp,ammo:{...playerAmmo},root:qaSummary(player),cameraLocal:camera.position.clone().sub(player.position).applyQuaternion(player.quaternion.clone().invert()).multiplyScalar(10).toArray(),offset:chaseFrameOffsets(playerPlane),units:airspaceUnits.map(u=>({team:u.team,type:u.type,attached:u.root.userData.modelAttached,error:u.root.userData.modelError})),bomberCount:campaignBombers.length,escortCount:campaignEscorts.length}),
 fire:()=>{fireWeapons(player,false,1/120,true);return{ammo:{...playerAmmo},bullets:bullets.map(b=>({speed:b.speed*10,damage:b.damage}))}},
 render:()=>{if(gameMode==='airspace')updateAirspaceFrame(0,1/60);else{updateChaseCamera(0);updateCampaignHud()}renderer.render(scene,camera)}
};`;
async function main(){
 const server=http.createServer((req,res)=>{const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(assets+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream')});fs.createReadStream(file).pipe(res)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.SKY_DUEL_CHROME,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-angle=swiftshader']});let page;
 try{
  page=await browser.newPage({viewport:{width:844,height:390}});page.setDefaultTimeout(60000);const errors=[],httpErrors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()})});
  await page.addInitScript(()=>{window.requestAnimationFrame=cb=>{window.__nextFrame=cb;return 1}});
  await page.route('**/index.html',route=>route.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(path.join(assets,'index.html'),'utf8').replace('</script>',bridge+'\n</script>')}));
  const url='http://127.0.0.1:'+server.address().port+'/index.html';await page.goto(url,{waitUntil:'load'});await page.waitForFunction(()=>!!window.__qa,null,{polling:100});await page.evaluate(()=>window.__qa.ready());
  const fresh=await page.evaluate(()=>window.__qa.info());assert.equal(fresh.types.length,11);assert.deepEqual(fresh.unlocked,['i15','i15bis']);assert.equal(fresh.selected,'i15');assert.equal(fresh.economy.rp,0);assert.equal(fresh.economy.gp,2000);
  await page.locator('#start').click({force:true});assert(await page.locator('#chooseCampaign').isDisabled());await page.locator('#modeHome').click({force:true});
  const models=await page.evaluate(()=>window.__qa.preload());assert(Object.values(models).every(r=>r.attached&&!r.error));const combat=models.i16,preview=await page.evaluate(()=>window.__qa.makePreview());
  assert(combat.textured>=22);assert(preview.textured>=22);assert(Math.abs(combat.sizeMeters[2]-6)<1e-5);assert(Math.abs(combat.sizeMeters[0]-9.0064495)<1e-5);assert.deepEqual(combat.propAxis,[0,0,-1]);
  const modelPNG=await page.evaluate(()=>window.__qa.viewI16());fs.writeFileSync(path.join(__dirname,'i16-model-v17.png'),Buffer.from(modelPNG.split(',')[1],'base64'));
  const cameras=await page.evaluate(()=>window.__qa.cameras());for(const row of cameras)for(const s of row.screens){assert(Math.abs(s.width-528/2048)<.004,JSON.stringify(row));assert(Math.abs(s.centerY-679/920)<.004,JSON.stringify(row));assert(s.bounds.every(v=>v>=0&&v<=1),JSON.stringify(row))}
  const prop=await page.evaluate(()=>window.__qa.prop());assert.equal(prop.running.rpm,1900);assert(prop.running.blur);assert.equal(prop.stoppedRpm,0);console.log('Native I-16 textures/scale/propeller and 33 chase-camera projections passed');
  await page.locator('#openEncyclopedia').click({force:true});await page.locator('[data-preview-plane="i16"]').click({force:true});assert.equal(await page.locator('#catalogName').innerText(),'I-16 type 5');const specs=await page.locator('#catalogSpecs').innerText();for(const word of ['850','825','1800','17.8','9.8'])assert(specs.includes(word));assert(!specs.includes('6.00 m'));assert(await page.locator('#useCatalogPlane').isDisabled());await page.locator('#closeEncyclopedia').click({force:true});
  await page.locator('#openResearch').click({force:true});assert(await page.locator('#researchTree [data-tree-plane="mig3"]').isDisabled());assert.equal(await page.locator('#ownedCount').innerText(),'02');
  await page.screenshot({path:path.join(__dirname,'research-start-v17.png')});
  const rewards=[];
  for(let i=0;i<2;i++){
   const reward=await page.evaluate(()=>window.__qa.reward());assert.deepEqual(reward.first,reward.repeat);assert(reward.text.includes('334'));assert(reward.text.includes('944'));rewards.push(reward);
   await page.locator('#returnHome').click({force:true});await page.locator('#openResearch').click({force:true});await page.locator('#researchTree [data-tree-plane="i16"]').click({force:true});
   if(i===0){const partial=await page.evaluate(()=>window.__qa.info());assert.equal(partial.economy.research.i16,334);assert.equal(partial.economy.rp,0);assert(!partial.unlocked.includes('i16'))}
  }
  await page.locator('#researchTree [data-tree-plane="i16"]').click({force:true});const purchased=await page.evaluate(()=>window.__qa.info());assert.equal(purchased.selected,'i16');assert(purchased.unlocked.includes('i16'));assert.equal(purchased.economy.gp,2488);assert.equal(purchased.economy.rp,168);assert.equal(purchased.states.mig3,'research');assert(!purchased.unlocked.includes('f3f2'));assert.equal(await page.locator('#ownedCount').innerText(),'03');
  const layouts=[];for(const [width,height] of [[844,390],[640,360],[480,320]]){
   await page.setViewportSize({width,height});const layout=await page.evaluate(()=>{const p=document.querySelector('#research .tech-panel'),cards=[...document.querySelectorAll('#researchTree .tech-node')];return{panelClient:p.clientWidth,panelScroll:p.scrollWidth,cards:cards.map(c=>({w:c.clientWidth,scroll:c.scrollWidth,text:c.innerText,copyWidth:c.querySelector('.node-copy').clientWidth,trackWidth:c.querySelector('.research-progress').clientWidth,fillWidth:c.querySelector('.research-progress i').clientWidth}))}});assert(layout.panelScroll<=layout.panelClient+1,JSON.stringify({width,height,...layout}));assert(layout.cards.every(c=>c.scroll<=c.w+1),JSON.stringify(layout));layouts.push({width,height,...layout});if(width===844||width===640)await page.screenshot({path:path.join(__dirname,'research-owned-'+width+'-v17.png')})
  }
  await page.setViewportSize({width:844,height:390});await page.reload({waitUntil:'load'});await page.waitForFunction(()=>!!window.__qa,null,{polling:100});const reloaded=await page.evaluate(()=>window.__qa.info());assert.deepEqual(reloaded,purchased);console.log('Native research UI, exact RP/GP charges, one-of-stage prerequisite and save reload passed');
  await page.locator('#start').click({force:true});await page.locator('#chooseAIBattle').click({force:true});await page.waitForFunction(()=>window.__qa.fight().playing,null,{timeout:90000,polling:100});const fight=await page.evaluate(()=>window.__qa.fight());assert.equal(fight.type,'i16');assert.equal(fight.hp,350);assert.equal(fight.ammo.mg,850);assert.equal(fight.units.length,10);assert.equal(fight.units.filter(u=>u.team==='blue').length,5);assert(fight.units.every(u=>u.attached&&!u.error));const fired=await page.evaluate(()=>window.__qa.fire());assert.equal(fired.ammo.mg,848);assert.equal(fired.bullets.length,2);assert(fired.bullets.every(b=>b.speed===825&&b.damage===16));await page.evaluate(()=>window.__qa.render());await page.screenshot({path:path.join(__dirname,'i16-airspace-mobile-v17.png')});
  await page.evaluate(()=>{localStorage.setItem('sky-duel-profile-v1',JSON.stringify({unlocked:['f86','mig15','meteor','b29','i15bis','bf109b1','p36a','f3f2','mig3','i15'],selected:'f86'}))});await page.reload({waitUntil:'load'});await page.waitForFunction(()=>!!window.__qa,null,{polling:100});const legacy=await page.evaluate(()=>window.__qa.info());assert.equal(legacy.unlocked.length,10);assert.equal(legacy.selected,'f86');assert(!legacy.unlocked.includes('i16'));assert.equal(legacy.states.i16,'research');
  await page.locator('#start').click({force:true});assert(!(await page.locator('#chooseCampaign').isDisabled()));await page.locator('#chooseCampaign').click({force:true});await page.locator('#beginCampaign').click({force:true});await page.waitForFunction(()=>window.__qa.fight().playing&&window.__qa.fight().mode==='campaign',null,{timeout:90000,polling:100});const campaign=await page.evaluate(()=>window.__qa.fight());assert.equal(campaign.type,'mig15');assert.equal(campaign.bomberCount,3);assert.equal(campaign.escortCount,5);assert(Math.abs(campaign.cameraLocal[1]-campaign.offset.heightMeters)<1e-6);assert(Math.abs(campaign.cameraLocal[2]-campaign.offset.backMeters)<1e-6);
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);const report={result:'passed',method:'Actual generated v17 page, native GLTF/Draco/PBR/WebGL/audio/DOM, controlled RAF and software rendering. Not an Android device.',checks:['All eleven combat models decode; I-16 uses textured 6m model and correct propeller axis, RPM and blur','Thirty-three actual vertex projections match reference width and screen height across three landscape aspects','Fresh and migrated saves enforce ownership and retain old aircraft','Native research buttons save partial progress, charge exact RP/GP once, and open next stage with one BR1.3 aircraft','Research cards and wallet stay within panel at three landscape widths','Actual I-16 5v5 sortie has correct HP/ammunition and two correct projectiles','Migrated MiG-15 campaign keeps three B-29 and five escorts with new camera'],fresh,models,preview,prop,cameras,rewards,purchased,reloaded,layouts,fight,fired,legacy,campaign,errors,httpErrors};fs.writeFileSync(path.join(__dirname,'browser-v17.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,checks:report.checks,errors},null,2));
 }finally{if(page)await page.screenshot({path:path.join(__dirname,'last-browser-v17.png')}).catch(()=>{});await browser.close();await new Promise(r=>server.close(r))}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
