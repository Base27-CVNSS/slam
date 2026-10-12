/* Vietflex SLAM Lab - pure geographic and trajectory primitives (MIT). */
export const R = 6378137;
export const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
export const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
export function toLocal(lon,lat,center){
  return {x:(lon-center.lon)*Math.PI/180*R*Math.cos(center.lat*Math.PI/180),y:(lat-center.lat)*Math.PI/180*R};
}
export function toGeo(p,center){
  return [center.lon+p.x/(R*Math.cos(center.lat*Math.PI/180))*180/Math.PI,center.lat+p.y/R*180/Math.PI];
}
export function project(lon,lat,z){
  const s=256*2**z, phi=clamp(lat,-85.05112878,85.05112878)*Math.PI/180;
  return {x:(lon+180)/360*s,y:(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2*s};
}
export function unproject(x,y,z){
  const s=256*2**z, n=Math.PI-2*Math.PI*y/s;
  return {lon:x/s*360-180,lat:Math.atan(Math.sinh(n))*180/Math.PI};
}
export function segmentClosest(p,a,b){
  const vx=b.x-a.x,vy=b.y-a.y,d=vx*vx+vy*vy;
  const t=d?clamp(((p.x-a.x)*vx+(p.y-a.y)*vy)/d,0,1):0;
  const q={x:a.x+t*vx,y:a.y+t*vy};
  return {point:q,distance:dist(p,q),t};
}
export function segmentsFromRoads(roads){
  const out=[];
  for(const road of roads){for(let i=1;i<road.length;i++){
    if(dist(road[i-1],road[i])>.1)out.push({a:road[i-1],b:road[i]});
  }}return out;
}
export function buildRoadIndex(roads,cell=45){
  const segments=segmentsFromRoads(roads),buckets=new Map();
  for(let n=0;n<segments.length;n++){
    const {a,b}=segments[n];
    let x0=Math.floor(Math.min(a.x,b.x)/cell),x1=Math.floor(Math.max(a.x,b.x)/cell);
    let y0=Math.floor(Math.min(a.y,b.y)/cell),y1=Math.floor(Math.max(a.y,b.y)/cell);
    if((x1-x0+1)*(y1-y0+1)>1000)continue;
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
      const key=x+','+y;let arr=buckets.get(key);if(!arr){arr=[];buckets.set(key,arr)}arr.push(n);
    }
  }
  return {segments,buckets,cell};
}
export function nearestRoad(p,index,radius=40){
  const {segments,buckets,cell}=index;
  const cx=Math.floor(p.x/cell),cy=Math.floor(p.y/cell),r=Math.max(1,Math.ceil(radius/cell));
  const checked=new Set();let best=null;
  for(let x=cx-r;x<=cx+r;x++)for(let y=cy-r;y<=cy+r;y++){
    for(const i of (buckets.get(x+','+y)||[])){
      if(checked.has(i))continue;checked.add(i);
      const found=segmentClosest(p,segments[i].a,segments[i].b);
      if(found.distance<=radius&&(!best||found.distance<best.distance))best={...found,segment:i};
    }
  }
  return best;
}
export function samplePolyline(nodes,step=5,maxPoints=800){
  if(nodes.length<2)return nodes.slice();
  const points=[{...nodes[0]}];let carry=step;
  for(let i=1;i<nodes.length&&points.length<maxPoints;i++){
    let a=nodes[i-1],b=nodes[i],l=dist(a,b);if(l<1e-8)continue;
    while(l+1e-8>=carry&&points.length<maxPoints){
      const t=carry/l;const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      points.push(p);a=p;l=dist(a,b);carry=step;
    }
    carry-=l;
  }
  const end=nodes[nodes.length-1];
  if(points.length<maxPoints&&dist(points[points.length-1],end)>.1)points.push({...end});
  return points;
}
export function routeLength(points){let s=0;for(let i=1;i<points.length;i++)s+=dist(points[i],points[i-1]);return s}
export function rmse(errors){return errors.length?Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length):0}
export function chooseOsmRoute(roads,centerRadius=500){
  let winner=null,score=-Infinity;
  for(const road of roads){
    const length=routeLength(road);if(length<65)continue;
    const nearest=Math.min(...road.map(p=>Math.hypot(p.x,p.y)));
    const candidate=Math.min(length,850)-Math.max(0,nearest-centerRadius)*2;
    if(candidate>score){score=candidate;winner=road}
  }
  if(!winner)return null;
  let points=winner.slice();
  if(dist(points[0],{x:0,y:0})>dist(points[points.length-1],{x:0,y:0}))points.reverse();
  return samplePolyline(points,5,450);
}
export function demoGeometry(){
  const core=[{x:-180,y:-125},{x:175,y:-125},{x:175,y:125},{x:-180,y:125},{x:-180,y:-125}];
  const roads=[core,[{x:-260,y:0},{x:260,y:0}],[{x:0,y:-245},{x:0,y:240}],
    [{x:-260,y:-210},{x:250,y:-210}],[{x:-260,y:210},{x:250,y:210}],
    [{x:-250,y:-240},{x:-250,y:240}],[{x:250,y:-240},{x:250,y:240}],
    [{x:-180,y:-125},{x:0,y:0},{x:175,y:125}],
    [{x:-180,y:125},{x:0,y:0},{x:175,y:-125}]];
  const route=samplePolyline(core,5,600);
  return {roads,route,synthetic:true};
}
export function makeRng(seed){let s=seed>>>0;return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296}}
export function gaussian(rng){const u=Math.max(1e-12,rng()),v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}