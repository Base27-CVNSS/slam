import {clamp,dist,toLocal,toGeo,project,unproject,buildRoadIndex,nearestRoad,chooseOsmRoute,demoGeometry,makeRng,gaussian,routeLength} from './math.mjs';

const $=id=>document.getElementById(id);
const LOCATIONS={
  hcm:{lon:106.69822,lat:10.77253,name:'Bến Thành, TP.HCM'},
  hanoi:{lon:105.85203,lat:21.02826,name:'Hoàn Kiếm, Hà Nội'},
  danang:{lon:108.22083,lat:16.06826,name:'Hải Châu, Đà Nẵng'},
  cantho:{lon:105.78302,lat:10.03403,name:'Ninh Kiều, Cần Thơ'}
};
const els={map:$('mapCanvas'),chart:$('chartCanvas'),stage:$('mapStage')};
const ctx=els.map.getContext('2d'),chartCtx=els.chart.getContext('2d');
const view={center:{...LOCATIONS.hcm},zoom:16,follow:false};
const state={origin:{...LOCATIONS.hcm},geom:demoGeometry(),dataset:'demo',networkName:'Mạng đường tổng hợp',timer:null,step:0,raw:[],fused:[],ground:[],rawErr:[],fusedErr:[],count:0,loopCount:0,travel:0,rng:makeRng(2026),bias:0,rawPose:null,fusedPose:null,index:null,landmarks:[],tiles:new Map(),timerStamp:0};
let mapW=0,mapH=0,chartW=0,chartH=0;

function resizeCanvas(canvas,context){
  const r=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr));
  context.setTransform(dpr,0,0,dpr,0,0);return {w:r.width,h:r.height};
}
function resize(){let d=resizeCanvas(els.map,ctx);mapW=d.w;mapH=d.h;d=resizeCanvas(els.chart,chartCtx);chartW=d.w;chartH=d.h;render()}
const tileKey=(z,x,y)=>z+'/'+x+'/'+y;
function screenFromGeo(lon,lat){
  const p=project(lon,lat,view.zoom),c=project(view.center.lon,view.center.lat,view.zoom);
  return {x:mapW/2+p.x-c.x,y:mapH/2+p.y-c.y};
}
function screenFromLocal(p){const g=toGeo(p,state.origin);return screenFromGeo(g[0],g[1])}
function drawGrid(){
  ctx.fillStyle='#142b39';ctx.fillRect(0,0,mapW,mapH);
  ctx.save();ctx.strokeStyle='rgba(131,178,188,.095)';ctx.lineWidth=1;
  const stride=48;const c=project(view.center.lon,view.center.lat,view.zoom);
  const shiftX=(-c.x%stride+stride)%stride,shiftY=(-c.y%stride+stride)%stride;
  for(let x=shiftX;x<mapW;x+=stride){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,mapH);ctx.stroke()}
  for(let y=shiftY;y<mapH;y+=stride){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(mapW,y);ctx.stroke()}
  ctx.restore();
}
function drawTiles(){
  if(!$('tilesToggle').checked)return;
  const z=view.zoom,N=2**z,c=project(view.center.lon,view.center.lat,z),tlx=c.x-mapW/2,tly=c.y-mapH/2;
  const x0=Math.floor(tlx/256),x1=Math.floor((tlx+mapW)/256),y0=Math.max(0,Math.floor(tly/256)),y1=Math.min(N-1,Math.floor((tly+mapH)/256));
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
    const wx=((x%N)+N)%N,key=tileKey(z,wx,y),px=Math.round(x*256-tlx),py=Math.round(y*256-tly);
    const item=state.tiles.get(key);
    if(item?.ready){ctx.drawImage(item.img,px,py,257,257);continue}
    if(item||state.tiles.size>130)continue;
    const img=new Image();img.decoding='async';
    state.tiles.set(key,{img,ready:false});
    img.onload=()=>{const cached=state.tiles.get(key);if(cached){cached.ready=true;drawMap()}};
    img.onerror=()=>{const cached=state.tiles.get(key);if(cached)cached.failed=true};
    img.src='https://tile.openstreetmap.org/'+z+'/'+wx+'/'+y+'.png';
  }
  // Bounded in-memory cache; browser honors the HTTP caching instructions from OSM.
  if(state.tiles.size>130){const keys=[...state.tiles.keys()];for(let i=0;i<keys.length-110;i++)state.tiles.delete(keys[i])}
  ctx.fillStyle='rgba(5,21,30,.30)';ctx.fillRect(0,0,mapW,mapH);
}
function drawLine(points,color,width,dash=[],opacity=1){
  if(!points||points.length<2)return;
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';ctx.lineCap='round';ctx.globalAlpha=opacity;ctx.setLineDash(dash);ctx.beginPath();
  for(let i=0;i<points.length;i++){const p=screenFromLocal(points[i]);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y)}
  ctx.stroke();ctx.restore();
}
function drawRoads(){
  if(!state.geom)return;
  const roads=state.geom.roads;
  ctx.save();ctx.strokeStyle='rgba(110,220,244,.78)';ctx.lineWidth=2;
  for(const road of roads){if(road.length<2)continue;ctx.beginPath();let started=false;
    for(const p of road){const q=screenFromLocal(p);if(!started){ctx.moveTo(q.x,q.y);started=true}else ctx.lineTo(q.x,q.y)}ctx.stroke();
  }
  ctx.restore();
  if(state.dataset==='demo')drawLine(state.geom.route,'rgba(227,245,249,.16)',12,[],.5);
}
function drawRange(p,r,color){const center=screenFromLocal(p);const north=screenFromLocal({x:p.x,y:p.y+r});const radius=Math.abs(north.y-center.y);ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash([5,7]);ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.stroke();ctx.restore()}
function drawSensor(){
  if(!state.ground.length||!$('lidarToggle').checked)return;
  const pose=state.ground[state.ground.length-1],q=screenFromLocal(pose);drawRange(pose,85,'rgba(92,217,249,.33)');
  ctx.save();ctx.strokeStyle='rgba(90,224,250,.21)';ctx.fillStyle='#70dafa';ctx.lineWidth=.9;
  let count=0;
  for(const landmark of state.landmarks){if(dist(pose,landmark)>85)continue;if(count++>36)break;const target=screenFromLocal(landmark);
    ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(target.x,target.y);ctx.stroke();ctx.beginPath();ctx.arc(target.x,target.y,2,0,Math.PI*2);ctx.fill();
  }ctx.restore();
}
function drawMarker(p,color,label,size=6){if(!p)return;const q=screenFromLocal(p);ctx.save();ctx.fillStyle=color;ctx.strokeStyle='#071422';ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(q.x,q.y,size,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font='700 10px Inter,system-ui';ctx.fillStyle='#fff';ctx.fillText(label,q.x+11,q.y-7);ctx.restore()}
function drawMap(){
  if(!mapW||!mapH)return;
  ctx.clearRect(0,0,mapW,mapH);drawGrid();drawTiles();drawRoads();
  drawLine(state.geom.route,'#e0ebf1',1.8,[6,9],.40);
  drawLine(state.ground,'#e8ffff',3.2);
  drawLine(state.raw,'#ff956c',3,[5,6]);
  drawLine(state.fused,'#ccff49',3.5);
  drawSensor();
  if(state.geom.route.length)drawMarker(state.geom.route[0],'#e3f4f5','START',4);
  if(state.ground.length){drawMarker(state.raw[state.raw.length-1],'#ff9a74','DRIFT',5);drawMarker(state.fused[state.fused.length-1],'#d5fb3f','SLAM',7)}
}
function chartLine(values,maxY,color){
  if(values.length<2)return;
  const left=42,top=9,w=Math.max(1,chartW-53),h=Math.max(1,chartH-28),total=Math.max(2,state.geom.route.length);
  chartCtx.beginPath();chartCtx.strokeStyle=color;chartCtx.lineWidth=2;
  for(let i=0;i<values.length;i++){
    const x=left+i/(total-1)*w,y=top+h-values[i]/maxY*h;
    if(i===0)chartCtx.moveTo(x,y);else chartCtx.lineTo(x,y);
  }chartCtx.stroke();
}
function drawChart(){
  if(!chartW||!chartH)return;chartCtx.clearRect(0,0,chartW,chartH);
  const maxY=Math.max(2,...state.rawErr,...state.fusedErr)*1.2;
  const left=42,top=9,w=Math.max(1,chartW-53),h=Math.max(1,chartH-28);
  chartCtx.font='10px system-ui';chartCtx.textAlign='right';chartCtx.fillStyle='#9cb0bd';chartCtx.strokeStyle='#314658';chartCtx.lineWidth=.8;
  for(let i=0;i<=3;i++){const y=top+h*i/3;chartCtx.beginPath();chartCtx.moveTo(left,y);chartCtx.lineTo(left+w,y);chartCtx.stroke();chartCtx.fillText((maxY*(1-i/3)).toFixed(1),left-8,y+3)}
  chartCtx.fillText('0',left,chartH-5);chartCtx.textAlign='left';chartCtx.fillText('frame '+state.step,Math.max(left+2,chartW-83),chartH-5);
  chartLine(state.rawErr,maxY,'#ff956c');chartLine(state.fusedErr,maxY,'#d5fb3f');
}
function render(){drawMap();drawChart()}
function landmarksFor(route){
  const items=[],rng=makeRng(13579);
  for(let i=5;i<route.length-5;i+=7){const a=route[i-4],b=route[i+4],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
    for(const sign of [-1,1]){const off=12+20*rng();items.push({x:route[i].x+sign*(-dy/l)*off,y:route[i].y+sign*(dx/l)*off})}
  }return items;
}
function stop(){if(state.timer){clearInterval(state.timer);state.timer=null}$('runBtn').textContent='▶ Chạy mô phỏng'}
function init(){
  stop();state.step=0;state.raw=[];state.fused=[];state.ground=[];state.rawErr=[];state.fusedErr=[];state.count=0;state.loopCount=0;state.travel=0;
  state.rng=makeRng(20261012);state.bias=0;state.rawPose=null;state.fusedPose=null;
  state.index=buildRoadIndex(state.geom.roads);state.landmarks=landmarksFor(state.geom.route);updateMetrics();render();
  $('stepStatus').textContent='SẴN SÀNG';$('systemBadge').textContent='SIMULATION READY';
}
function calculateRmse(values){if(!values.length)return 0;let sum=0;for(const x of values)sum+=x*x;return Math.sqrt(sum/values.length)}
function updateMetrics(){
  const raw=calculateRmse(state.rawErr),fused=calculateRmse(state.fusedErr),gain=raw>0?(raw-fused)/raw*100:0;
  $('distanceMetric').textContent=state.travel.toFixed(1);$('rawMetric').textContent=raw.toFixed(2);$('fusedMetric').textContent=fused.toFixed(2);
  $('gainMetric').textContent=state.step>2?gain.toFixed(1):'—';$('gainMetric').style.color=gain<0?'#ffab8b':'#d5fb3f';
  $('frameMetric').textContent=state.step+' / '+state.geom.route.length;$('roadsMetric').textContent=state.index?.segments.length||0;
  $('matchMetric').textContent=state.count;$('loopMetric').textContent=state.loopCount;
  $('coordMetric').textContent=state.origin.lat.toFixed(5)+', '+state.origin.lon.toFixed(5);
  $('stepStatus').textContent=state.step===0?'SẴN SÀNG':state.step>=state.geom.route.length?'HOÀN THÀNH':'FRAME '+state.step;
}
function stepOnce(){
  const route=state.geom.route;
  if(state.step>=route.length){stop();updateMetrics();return}
  const truth=route[state.step],prev=route[Math.max(0,state.step-1)];
  if(!state.step){state.rawPose={...truth};state.fusedPose={...truth}}
  else{
    const dx=truth.x-prev.x,dy=truth.y-prev.y,noise=+$('noiseRange').value/100;
    const sensor=$('sensorSelect').value,scale=sensor==='visual'?1.55:sensor==='lidar'?.72:1;
    state.bias+=gaussian(state.rng)*.003*noise*scale+.00055*noise*scale;
    const c=Math.cos(state.bias),s=Math.sin(state.bias),eps=.42*noise*scale;
    const ox=dx*c-dy*s+gaussian(state.rng)*eps;
    const oy=dx*s+dy*c+gaussian(state.rng)*eps;
    state.rawPose={x:state.rawPose.x+ox,y:state.rawPose.y+oy};
    state.fusedPose={x:state.fusedPose.x+ox,y:state.fusedPose.y+oy};
    if($('matchToggle').checked){
      const near=nearestRoad(state.fusedPose,state.index,32);
      if(near){const alpha=.68;state.fusedPose.x+=(near.point.x-state.fusedPose.x)*alpha;state.fusedPose.y+=(near.point.y-state.fusedPose.y)*alpha;state.count++}
      // Simulated loop anchor: initial location is known; not a pose-graph optimizer.
      if(state.dataset==='demo'&&state.loopCount===0&&state.step>route.length*.85&&dist(truth,route[0])<9){
        const anchor=state.fused[0];if(anchor){state.fusedPose.x+=(anchor.x-state.fusedPose.x)*.85;state.fusedPose.y+=(anchor.y-state.fusedPose.y)*.85;state.loopCount=1}
      }
    }
    state.travel+=dist(truth,prev);
  }
  state.ground.push({...truth});state.raw.push({...state.rawPose});state.fused.push({...state.fusedPose});
  state.rawErr.push(dist(truth,state.rawPose));state.fusedErr.push(dist(truth,state.fusedPose));state.step++;
}
function runOrPause(){
  if(state.timer){stop();$('stepStatus').textContent='TẠM DỪNG';return}
  if(state.step>=state.geom.route.length)init();
  if(!state.geom.route.length){status('Không có lộ trình đủ dài để mô phỏng.',true);return}
  $('systemBadge').textContent='SIMULATION RUNNING';$('runBtn').textContent='Ⅱ Tạm dừng';
  state.timer=setInterval(()=>{
    const n=+$('speedRange').value;for(let i=0;i<n;i++){if(state.step<state.geom.route.length)stepOnce()}
    updateMetrics();render();if(state.step>=state.geom.route.length){stop();$('systemBadge').textContent='SIMULATION COMPLETED'}
  },100);
}
function updateRoadUI(){
  $('roadType').textContent=state.dataset==='osm'?'OSM REAL':'DEMO';
  $('roadType').classList.toggle('amber',state.dataset!=='osm');
  $('mapMode').textContent=state.dataset==='osm'?'OSM VECTOR ROAD NETWORK':'SIMULATED ROAD GRAPH';
  $('sourceLabel').textContent=state.dataset==='osm'?'Vector: OSM road data':'Vector: synthetic road graph';
}
function status(message,isError=false){const el=$('osmStatus');el.textContent=message;el.classList.toggle('error',isError)}
function loadRoads(roads,name){
  roads=roads.filter(r=>r.length>=2).slice(0,950);
  if(!roads.length)throw Error('Không tìm thấy tuyến đường LineString hợp lệ (WGS84).');
  const route=chooseOsmRoute(roads);
  if(!route||route.length<15)throw Error('Không tìm thấy đoạn đường đủ dài (tối thiểu khoảng 65 m).');
  state.geom={roads,route,synthetic:false};state.dataset='osm';state.networkName=name;
  const mid=route[Math.floor(route.length/2)],g=toGeo(mid,state.origin);
  view.center={lon:g[0],lat:g[1]};view.zoom=16;
  updateRoadUI();init();status('Đã nạp '+roads.length+' đường; tuyến demo dài '+routeLength(route).toFixed(0)+' m.');
}
function parseGeoJSON(json){
  const features=json.type==='FeatureCollection'?json.features:json.type==='Feature'?[json]:[{geometry:json}];
  if(!Array.isArray(features))throw Error('GeoJSON không chứa danh sách features hợp lệ.');
  const roads=[];
  for(const f of features.slice(0,3000)){
    const geom=f.geometry;if(!geom)continue;
    const lines=geom.type==='LineString'?[geom.coordinates]:geom.type==='MultiLineString'?geom.coordinates:[];
    for(const coords of lines){if(!Array.isArray(coords))continue;
      const road=coords.slice(0,3000).filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90).map(p=>toLocal(p[0],p[1],state.origin));
      if(road.length>=2)roads.push(road);
    }
  }
  return roads;
}
function parseOSMxml(xml){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw Error('OSM XML không hợp lệ.');
  const nodes=new Map(),roads=[];
  for(const n of doc.querySelectorAll('node')){
    const lat=+n.getAttribute('lat'),lon=+n.getAttribute('lon');
    if(Number.isFinite(lat)&&Number.isFinite(lon))nodes.set(n.getAttribute('id'),toLocal(lon,lat,state.origin));
  }
  for(const way of doc.querySelectorAll('way')){
    if(!Array.from(way.querySelectorAll('tag')).some(t=>t.getAttribute('k')==='highway'))continue;
    const points=Array.from(way.querySelectorAll('nd')).map(n=>nodes.get(n.getAttribute('ref'))).filter(Boolean);
    if(points.length>1)roads.push(points);
  }
  return roads;
}
async function fetchOsm(){
  stop();$('loadOsmBtn').disabled=true;status('Đang tải đường OSM theo viewport nhỏ tại tâm bản đồ…');
  const c=view.center,bbox=[c.lat-.0045,c.lon-.0045,c.lat+.0045,c.lon+.0045].join(',');
  const query='[out:json][timeout:22];way["highway"~"^(primary|secondary|tertiary|residential|unclassified|service|living_street)$"]('+bbox+');(._;>;);out body;';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),26000);
  try{
    const resp=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({data:query}),signal:controller.signal});
    if(!resp.ok)throw Error('HTTP '+resp.status);
    const data=await resp.json(),nodes=new Map(),roads=[];
    for(const item of data.elements||[])if(item.type==='node')nodes.set(item.id,toLocal(item.lon,item.lat,state.origin));
    for(const item of data.elements||[])if(item.type==='way'&&Array.isArray(item.nodes)){
      const line=item.nodes.map(id=>nodes.get(id)).filter(Boolean);if(line.length>=2)roads.push(line)
    }
    loadRoads(roads,'OpenStreetMap / Overpass');
  }catch(error){status('Không tải được từ Overpass ('+error.message+'). Hãy thử lại hoặc nhập .osm / GeoJSON từ máy.',true)}
  finally{clearTimeout(timer);$('loadOsmBtn').disabled=false}
}
async function readLocalFile(file){
  if(!file)return;if(file.size>25*1024*1024){status('Tệp quá lớn (>25 MB). Chỉ nhập dữ liệu một khu vực nhỏ.',true);return}
  try{
    stop();const text=await file.text();
    const roads=/\.(osm|xml)$/i.test(file.name)?parseOSMxml(text):parseGeoJSON(JSON.parse(text));
    loadRoads(roads,file.name);
  }catch(error){status('Lỗi đọc dữ liệu: '+error.message,true)}finally{$('fileInput').value=''}
}
function geoLine(points){return points.map(p=>toGeo(p,state.origin))}
function download(filename,content,mime){
  const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportGeo(){
  if(state.step<2){status('Hãy chạy ít nhất 2 frame trước khi xuất.',true);return}
  const lines=[['ground_truth',state.ground],['odometry',state.raw],['map_constrained',state.fused]];
  const fc={type:'FeatureCollection',metadata:{generator:'Vietflex SLAM Lab',synthetic:true,source:state.networkName,warning:'Simulation only: NOT a validated SLAM result',coordinates:'WGS84 [lon,lat]'},features:lines.map(([name,poses])=>({type:'Feature',properties:{trajectory:name,frames:poses.length},geometry:{type:'LineString',coordinates:geoLine(poses)}}))};
  download('vietflex-slam-trajectories.geojson',JSON.stringify(fc,null,2),'application/geo+json');
}
function exportCsv(){
  if(state.step<2){status('Hãy chạy ít nhất 2 frame trước khi xuất.',true);return}
  const rows=['frame,truth_lon,truth_lat,odom_lon,odom_lat,matched_lon,matched_lat,odom_error_m,matched_error_m'];
  for(let i=0;i<state.step;i++){
    rows.push([i+1,...geoLine([state.ground[i]])[0],...geoLine([state.raw[i]])[0],...geoLine([state.fused[i]])[0],state.rawErr[i],state.fusedErr[i]].join(','));
  }download('vietflex-slam-telemetry.csv',rows.join('\n'),'text/csv;charset=utf-8');
}
function zoom(delta){view.zoom=clamp(view.zoom+delta,12,19);render()}
function onLocation(){
  const c=LOCATIONS[$('locationSelect').value];state.origin={...c};view.center={...c};view.zoom=16;state.geom=demoGeometry();state.dataset='demo';state.networkName='Mạng đường tổng hợp';updateRoadUI();init();status('Tuyến giả lập mới tại '+c.name+'. Nạp OSM để dùng mạng đường thực.');
}
$('runBtn').addEventListener('click',runOrPause);$('resetBtn').addEventListener('click',init);
$('locationSelect').addEventListener('change',onLocation);
$('sensorSelect').addEventListener('change',init);
$('noiseRange').addEventListener('input',e=>{$('noiseValue').textContent=e.target.value+'%';init()});
$('speedRange').addEventListener('input',e=>{$('speedValue').textContent=e.target.value+'×'});
$('matchToggle').addEventListener('change',init);$('lidarToggle').addEventListener('change',render);$('tilesToggle').addEventListener('change',render);
$('loadOsmBtn').addEventListener('click',fetchOsm);$('fileInput').addEventListener('change',e=>readLocalFile(e.target.files[0]));
$('exportGeoBtn').addEventListener('click',exportGeo);$('exportCsvBtn').addEventListener('click',exportCsv);
$('zoomIn').addEventListener('click',()=>zoom(1));$('zoomOut').addEventListener('click',()=>zoom(-1));
$('recenter').addEventListener('click',()=>{const p=state.geom.route[Math.floor(state.geom.route.length/2)]||{x:0,y:0},g=toGeo(p,state.origin);view.center={lon:g[0],lat:g[1]};render()});
let drag=null;
els.map.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,center:project(view.center.lon,view.center.lat,view.zoom)};els.map.setPointerCapture(event.pointerId)});
els.map.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;view.center=unproject(drag.center.x-dx,drag.center.y-dy,view.zoom);render()});
els.map.addEventListener('pointerup',()=>drag=null);els.map.addEventListener('pointercancel',()=>drag=null);
els.map.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY<0?1:-1)},{passive:false});
new ResizeObserver(resize).observe(els.stage);new ResizeObserver(resize).observe(els.chart);
updateRoadUI();init();