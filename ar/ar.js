const $=id=>document.getElementById(id); const status=t=>$('status').textContent=t;
const defaults={"scale": 1.51, "x": 0, "y": 0, "depth": 0.23, "tilt": 0, "key": 0.01, "edge": 0.25, "spill": 0.74, "loop": true, "safeMin": 0.95, "safeMax": 0.95};let cfg={...defaults};const studio=new URLSearchParams(location.search).has('studio');let sound=false;let viewer={size:1,x:0,y:0};
let rawPos,rawQuat,rawScale;let worldPoint,camQuat;let ar,THREE,running=false,busy=false,active=null,entries=[];
async function init(){try{
 const settings=await fetch('./zeus-settings.json',{cache:'no-store'});if(settings.ok)cfg={...defaults,...await settings.json()};
 if(studio){try{cfg={...cfg,...JSON.parse(localStorage.getItem('zeus-studio')||'{}')}}catch{} cfg.tilt=0;cfg.safeMax=Math.max(cfg.safeMin,cfg.safeMax);setupStudio();}else{cfg.tilt=0;cfg.safeMax=Math.max(cfg.safeMin,cfg.safeMax);setupViewer();}

 if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('請使用 HTTPS 網址及 Safari 或 Chrome');
 const r=await fetch('./targets/gods.mind',{method:'HEAD'});if(!r.ok||(r.headers.get('content-type')||'').includes('text/html'))throw Error('尚未編譯 targets/gods.mind，請依 README 操作');
 THREE=await import('three');rawPos=new THREE.Vector3();rawQuat=new THREE.Quaternion();rawScale=new THREE.Vector3();worldPoint=new THREE.Vector3();camQuat=new THREE.Quaternion();const {MindARThree}=await import('https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js');
 const gods=await (await fetch('gods.json')).json();ar=new MindARThree({container:$('camera'),imageTargetSrc:'./targets/gods.mind',maxTrack:1,warmupTolerance:5,missTolerance:5,uiLoading:'no',uiScanning:'no',uiError:'no'});
 for(const g of gods.filter(g=>g.index===0)){const anchor=ar.addAnchor(g.index),pivot=new THREE.Group();pivot.position.set(g.x,g.y,0.015);const stable=new THREE.Group();stable.visible=false;stable.add(pivot);ar.scene.add(stable);const entry={g,anchor,pivot,stable,mesh:null,found:false,t:0,lostAt:null,poseReady:false,lastFrame:0,pendingQuat:new THREE.Quaternion(),pendingCount:0};entries.push(entry);
 anchor.onTargetFound=()=>{const now=performance.now(),resume=entry.lostAt!==null&&now-entry.lostAt<350&&entry.poseReady;entry.found=true;entry.lostAt=null;entry.poseReady=false;entry.pendingCount=0;if(!resume){entry.t=now;}active=entry;status('辨識成功：'+g.name);$('guide').hidden=true;load(entry).then(()=>{if(entry.found&&active===entry&&entry.video.paused)play(entry)}).catch(e=>status('影片載入失敗：'+e.message));};
 anchor.onTargetLost=()=>{entry.found=false;entry.lostAt=performance.now();};
 }
 $('start').disabled=false;$('startMuted').disabled=false;$('start').textContent='開啟聲音並開始';status('準備完成');
 }catch(e){status(e.message);$('start').textContent='重新載入';$('start').disabled=false;$('start').onclick=()=>location.reload();}}
// Bound the projected video rectangle, not the tracked anchor or its pose.
// The same uniform multiplier is applied on all axes, preserving aspect ratio.
function safeSize(e){
 const camera=ar.camera, mesh=e.mesh, pivot=e.pivot;
 const rect=ar.renderer.domElement.getBoundingClientRect();
 if(rect.width<1||rect.height<1)return;
 const top=document.querySelector('header').getBoundingClientRect();
 const bottom=$('status').getBoundingClientRect();
 const usableW=Math.min(rect.width,document.documentElement.clientWidth)*.94, usableH=Math.max(1,Math.min(rect.bottom,bottom.top)-Math.max(rect.top,top.bottom)-16);
 const factor=studio?1:viewer.size;
 const min=Math.max(.05,Math.min(.95,(Number(cfg.safeMin)||.30)*factor));
 const max=Math.max(min,Math.min(1,(Number(cfg.safeMax)||.90)*factor));
 const base=pivot.scale.x;
 // Fixed envelope measured across the Zeus test clip; retain all original UVs.
 const W=mesh.geometry.parameters.width,H=mesh.geometry.parameters.height;
 const xs=[(.24-.5)*W,(.96-.5)*W],ys=[(.5-.98)*H,(.5-.02)*H];
 const corner=new THREE.Vector3();
 function coverage(f){
  pivot.scale.setScalar(base*f);mesh.updateWorldMatrix(true,false);
  let l=Infinity,r=-Infinity,b=Infinity,t=-Infinity;
  for(const x of xs)for(const y of ys){
   corner.set(x,y,0).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
   if(corner.z>=-camera.near)return Infinity;
   corner.applyMatrix4(camera.projectionMatrix);
   l=Math.min(l,corner.x);r=Math.max(r,corner.x);b=Math.min(b,corner.y);t=Math.max(t,corner.y);
  }
  return Math.max((r-l)*rect.width/2/usableW,(t-b)*rect.height/2/usableH);
 }
 const natural=coverage(1);if(!Number.isFinite(natural)){pivot.scale.setScalar(base);return;}
 const target=Math.max(min,Math.min(max,natural));
 if(Math.abs(target-natural)<.0001)return;
 let lo=0,hi=natural>target?1:Math.min(20,target/Math.max(natural,.001)*2);
 for(let i=0;i<12;i++){const mid=(lo+hi)/2;if(coverage(mid)>target)hi=mid;else lo=mid;}
 pivot.scale.setScalar(base*lo);
}
function syncSound(){$('sound').textContent=sound?'關閉聲音':'開啟聲音';} async function play(e){if(!e.video)return;e.video.muted=!sound;try{await e.video.play();}catch{sound=false;e.video.muted=true;syncSound();try{await e.video.play();status('已靜音播放，請點擊開啟聲音');}catch{status('影片播放受限，請點擊開啟聲音重試');}}}
async function load(e){if(e.mesh)return;if(e.loading)return e.loading;
 e.loading=(async()=>{
 const v=document.createElement('video');v.muted=true;v.defaultMuted=true;v.playsInline=true;v.setAttribute('playsinline','');v.loop=cfg.loop;v.preload='auto';e.video=v;
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('影片載入逾時')),20000);v.onloadedmetadata=()=>{clearTimeout(timer);resolve()};v.onerror=()=>{clearTimeout(timer);reject(Error('請確認 videos/'+e.g.key+'.mp4 存在且可播放'))};v.src='./videos/'+e.g.key+'.mp4';v.load();});
 const tex=new THREE.VideoTexture(v);tex.colorSpace=THREE.SRGBColorSpace;
 const mat=new THREE.ShaderMaterial({uniforms:{videoMap:{value:tex},fade:{value:0},key:{value:cfg.key},edge:{value:cfg.edge},spill:{value:cfg.spill}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
 vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
 fragmentShader:`uniform sampler2D videoMap;uniform float fade;uniform float key;uniform float edge;uniform float spill;varying vec2 vUv;void main(){vec3 c=texture2D(videoMap,vUv).rgb;float excess=c.g-max(c.r,c.b);float a=1.0-smoothstep(key,key+edge,excess);c.g=mix(c.g,min(c.g,max(c.r,c.b)),(1.0-a)*spill);// VideoTexture samples are sRGB-encoded in this custom shader (Three r160).
// Key in video color space, then decode once before output conversion.
c=mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));
gl_FragColor=vec4(c,a*fade);
#include <colorspace_fragment>
}`});
 const h=e.g.h*1.20,w=h*v.videoWidth/v.videoHeight;e.mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);e.mesh.position.y=h*0.40;e.pivot.add(e.mesh);e.t=performance.now();
 })();try{await e.loading}finally{e.loading=null;}}
async function start(){if(!ar||busy||running)return;busy=true;$('start').disabled=true;$('startMuted').disabled=true;syncSound();status('正在啟動相機…');try{await ar.start();running=true;$('welcome').hidden=true;$('stop').hidden=false;$('sound').hidden=false;if(!studio)$('studioToggle').hidden=false;$('guide').hidden=!!active;status(active?'辨識成功：'+active.g.name:'請對準神祇立繪');ar.renderer.setAnimationLoop(()=>{const now=performance.now();const e=active;if(e){
 if(!e.found&&e.lostAt!==null&&now-e.lostAt>=180){e.stable.visible=false;e.poseReady=false;e.video?.pause();active=null;$('guide').hidden=false;status('請對準神祇立繪');}
 else {
 if(e.found&&e.anchor.group.visible){
 e.anchor.group.updateWorldMatrix(true,false);e.anchor.group.matrixWorld.decompose(rawPos,rawQuat,rawScale);
 const valid=[...rawPos.toArray(),...rawQuat.toArray(),...rawScale.toArray()].every(Number.isFinite)&&rawScale.x>0&&rawScale.y>0&&rawScale.z>0;
 if(valid){const dt=Math.min(50,Math.max(1,now-e.lastFrame));const t=Math.max(0,Math.min(1,(now-e.t)/1300)),k=1-Math.pow(1-t,3);
 // Transform the actual attachment point, not the video orientation.
 worldPoint.set(e.g.x+cfg.x+(studio?0:viewer.x),e.g.y+cfg.y+(studio?0:viewer.y),.015+cfg.depth*k).applyMatrix4(e.anchor.group.matrixWorld);
 const size=(rawScale.x+rawScale.y+rawScale.z)/3;
 if(!e.poseReady){e.stable.position.copy(worldPoint);e.stable.scale.setScalar(size);e.poseReady=true;}
 else {const a=1-Math.exp(-dt/100);e.stable.position.lerp(worldPoint,a);e.stable.scale.lerp(rawScale.setScalar(size),a);}
 e.lastFrame=now;
 ar.camera.getWorldQuaternion(camQuat);e.stable.quaternion.copy(camQuat);
 }else{e.poseReady=false;}
 }
 e.stable.visible=e.found&&e.anchor.group.visible&&e.poseReady&&!!e.mesh;
 if(e.mesh){const t=Math.max(0,Math.min(1,(now-e.t)/1300)),k=1-Math.pow(1-t,3);e.pivot.position.set(0,0,0);e.pivot.rotation.set(0,0,0);e.pivot.scale.setScalar(cfg.scale*(studio?1:viewer.size)*(1+.12*k));if(e.stable.visible)safeSize(e);for(const n of ['key','edge','spill'])e.mesh.material.uniforms[n].value=cfg[n];e.mesh.material.uniforms.fade.value=Math.min(1,t*4);}
 }}ar.renderer.render(ar.scene,ar.camera);});}catch(e){try{ar.stop()}catch{}status('相機啟動失敗：'+e.message);$('start').disabled=false;$('startMuted').disabled=false;}finally{busy=false;if(document.hidden)stop();}}
function stop(){if(!running)return;running=false;active=null;ar.renderer.setAnimationLoop(null);try{ar.stop()}catch{}for(const e of entries){e.found=false;e.video?.pause();e.anchor.group.visible=false;e.stable.visible=false;e.poseReady=false;e.lostAt=null;} $('welcome').hidden=false;$('stop').hidden=true;$('sound').hidden=true;if(!studio){$('studioToggle').hidden=true;$('studio').hidden=true;}sound=false;$('sound').textContent='開啟聲音';for(const e of entries)if(e.video)e.video.muted=true;$('guide').hidden=true;$('start').disabled=false;$('startMuted').disabled=false;status('相機已停止');}
$('sound').onclick=async()=>{const v=active?.video;if(!v){sound=!sound;syncSound();return;}sound=!sound;v.muted=!sound;try{await v.play();$('sound').textContent=sound?'關閉聲音':'開啟聲音';}catch{sound=false;v.muted=true;status('聲音播放受限，請再點一次');}};
function setupViewer(){
 const panel=$('studio'),toggle=$('studioToggle');toggle.textContent='觀看設定';toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
 panel.replaceChildren();const title=document.createElement('strong');title.textContent='個人觀看設定';panel.append(title);
 const note=document.createElement('p');note.textContent='以展館設定為基準，僅影響本次觀看。';panel.append(note);
 const syncs=[];
 for(const [key,label,min,max,step] of [['size','角色大小',.75,1.25,.05],['x','左右位置',-.2,.2,.01],['y','上下位置',-.2,.2,.01]]){
  const row=document.createElement('label'),out=document.createElement('output'),input=document.createElement('input');input.type='range';Object.assign(input,{min,max,step});row.append(label,' ',out,input);panel.append(row);
  const sync=()=>{input.value=viewer[key];out.textContent=key==='size'?Math.round(viewer[key]*100)+'%':(viewer[key]>0?'+':'')+viewer[key].toFixed(2);};input.oninput=()=>{viewer[key]=Number(input.value);sync();};syncs.push(sync);sync();
 }
 const reset=document.createElement('button');reset.textContent='恢復展館設定';reset.onclick=()=>{viewer={size:1,x:0,y:0};syncs.forEach(f=>f());};
 const close=document.createElement('button');close.textContent='完成';close.onclick=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};panel.append(reset,close);
}
function setupStudio(){const panel=$('studio');$('studioToggle').hidden=false;$('studioToggle').onclick=()=>panel.hidden=!panel.hidden;
 const fields=[['scale','大小',.3,3,.01],['safeMin','安全最小比例',.1,.95,.01],['safeMax','安全最大比例',.4,1,.01],['x','左右',-.8,.8,.01],['y','上下',-.8,.8,.01],['depth','深度',0,.8,.01],['key','去背門檻',0,.5,.01],['edge','邊緣柔化',.01,.5,.01],['spill','綠邊抑制',0,1,.01]];
 const controls=[];for(const [n,label,min,max,step] of fields){const row=document.createElement('label'),out=document.createElement('output'),input=document.createElement('input');input.type='range';Object.assign(input,{min,max,step,value:cfg[n]});row.append(label,' ',out,input);panel.insertBefore(row,$('studioActions'));const sync=()=>{input.value=cfg[n];out.textContent=Number(cfg[n]).toFixed(2)};input.oninput=()=>{cfg[n]=Number(input.value);if(n==='safeMin'&&cfg.safeMin>cfg.safeMax)cfg.safeMax=cfg.safeMin;if(n==='safeMax'&&cfg.safeMax<cfg.safeMin)cfg.safeMin=cfg.safeMax;controls.forEach(f=>f())};controls.push(sync);sync();}
 const loop=$('loop');loop.checked=cfg.loop;loop.onchange=()=>{cfg.loop=loop.checked;for(const e of entries)if(e.video)e.video.loop=cfg.loop;};
 $('reset').onclick=()=>{cfg={...defaults};controls.forEach(f=>f());loop.checked=cfg.loop;loop.onchange();};
 $('save').onclick=()=>{try{localStorage.setItem('zeus-studio',JSON.stringify(cfg));$('studioNote').textContent='已儲存在本裝置的調整模式';}catch{$('studioNote').textContent='儲存失敗，請使用匯出';}};
 $('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(cfg,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='zeus-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};}
$('start').onclick=()=>{sound=true;start();};$('startMuted').onclick=()=>{sound=false;start();};$('stop').onclick=stop;document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});addEventListener('pagehide',stop);init();
