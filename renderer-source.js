/* Embedded into the offline HTML by the local authoring step. No runtime imports. */
function observerRayToLab(n, view = state.view) {
 const b=[state.vx/C,0,state.vz/C], b2=dot(b,b);
 if(b2<1e-18||view==='classic')return n.slice();
 const beta=state.speed/C,axis=[state.vx/state.speed,0,state.vz/state.speed],mu=clamp(dot(axis,n),-1,1),g=state.gamma;
 // Inverse aberration maps an observed source direction to the laboratory ray.
 // For a same-time measurement, invert only the spatial contraction instead.
 const q=view==='optical'?n.map((v,i)=>(v-mu*axis[i])/g+((mu-1)+(1-beta))*axis[i]):n.map((v,i)=>v+(g-1)*mu*axis[i]),len=Math.hypot(...q);
 return q.map(v=>v/len);
}
function simultaneousPosition(r) {
 const b=[state.vx/C,0,state.vz/C],g=state.gamma;
 const k=-g/(g+1)*dot(b,r); // (1/gamma - 1)/beta², stable near beta = 0.
 return r.map((v,i)=>v+k*b[i]);
}
function fitCanvas(canvas,ratio=2){
 const r=canvas.getBoundingClientRect(),dpr=ratio,w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 return {w,h,dpr};
}
function createRelativisticRenderer(canvas) {
 const gl=canvas.getContext('webgl',{alpha:false,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:false})||canvas.getContext('experimental-webgl');
 if(!gl)throw new Error('浏览器未启用 WebGL。请使用启用硬件加速的现代浏览器打开本地 HTML。');
 const derivatives=!!gl.getExtension('OES_standard_derivatives');
 const vertexSource=`
 precision highp float;
 attribute vec3 aPosition,aNormal,aColor;
 attribute float aMaterial,aSign;
 attribute vec2 aUV;
 uniform vec3 uEye;
 uniform int uFace;
 varying vec3 vPosition,vNormal,vColor;
 varying vec2 vUV;
 varying float vMaterial,vSign;
 void main(){
  vec3 p=aPosition-uEye;vec3 q;
  if(uFace==0)q=vec3(-p.z,-p.y,p.x);
  else if(uFace==1)q=vec3(p.z,-p.y,-p.x);
  else if(uFace==2)q=vec3(p.x,p.z,p.y);
  else if(uFace==3)q=vec3(p.x,-p.z,-p.y);
  else if(uFace==4)q=vec3(p.x,-p.y,p.z);
  else q=vec3(-p.x,-p.y,-p.z);
  gl_Position=vec4(q.xy,1.00025*q.z-.08001,q.z);
  vPosition=aPosition;vNormal=aNormal;vColor=aColor;vUV=aUV;vMaterial=aMaterial;vSign=aSign;
 }`;
 const fragmentSource=(derivatives?'#extension GL_OES_standard_derivatives : enable\n':'')+`
 precision highp float;
 uniform sampler2D uNoise,uAtlas;
 uniform vec3 uEye;
 varying vec3 vPosition,vNormal,vColor;
 varying vec2 vUV;
 varying float vMaterial,vSign;
 float edgeAA(float distance){return smoothstep(.012,.012+${derivatives?'max(fwidth(distance)*1.4,.002)':'.014'},distance);}
 void main(){
  vec3 normal=normalize(vNormal),rgb=vColor;
  vec2 surface=abs(normal.y)>.5?vPosition.xz:(abs(normal.x)>.5?vPosition.zy:vPosition.xy);
  float grain=texture2D(uNoise,surface*3.5).r;
  float broad=texture2D(uNoise,surface*.12).g;
  if(vMaterial>.5&&vMaterial<1.5){
   rgb=rgb*(.78+.32*grain+.12*broad);
   float fleck=texture2D(uNoise,surface*13.0).b;
   rgb+=vec3(.035)*(fleck-.5);
  }else if(vMaterial>1.5&&vMaterial<2.5){rgb*=.75+.5*broad+.12*grain;
  }else if(vMaterial>2.5&&vMaterial<3.5){
   vec2 tile=fract(surface*1.4);float edge=min(min(tile.x,1.0-tile.x),min(tile.y,1.0-tile.y));
   rgb*=mix(.74,1.0,edgeAA(edge))*(.94+.10*grain);
  }else if(vMaterial>3.5&&vMaterial<4.5&&abs(normal.y)<.5){
   float row=floor(surface.y/.32);vec2 brick=fract(vec2(surface.x/.84+mod(row,2.0)*.5,surface.y/.32));
   float edge=min(min(brick.x,1.0-brick.x),min(brick.y,1.0-brick.y));
   rgb*=mix(.85,1.0,edgeAA(edge))*(.97+.06*grain);
  }else if(vMaterial>4.5&&vMaterial<5.5){
   rgb=mix(rgb,vec3(.58,.75,.78),.14+.22*pow(1.0-vUV.y,2.0));
   float reflection=1.0-smoothstep(.0,.06,abs(vUV.x-vUV.y*.32-.3));rgb+=reflection*.07;
  }else{rgb*=.97+.06*grain;}
  float light=.72+.28*max(0.0,dot(normal,normalize(vec3(-.4,.85,-.35))));
  rgb*=light;
  if(vSign>=-.1){
   vec2 cell=vec2(mod(vSign,4.0),floor(vSign/4.0));
   float ink=texture2D(uAtlas,(cell+clamp(vUV,.002,.998))/4.0).a;
   rgb=mix(rgb,vec3(.96,.97,.87),ink);
  }
  float distance=length(vPosition-uEye);float fog=1.0-exp(-pow(distance/195.0,2.0));
  rgb=mix(rgb,vec3(.69,.77,.75),fog*.72);
  gl_FragColor=vec4(rgb,1.0);
 }`;
 const screenVertex=`attribute vec2 aPoint;varying vec2 vPoint;void main(){vPoint=aPoint;gl_Position=vec4(aPoint,0.0,1.0);}`;
 const screenFragment=`
 precision highp float;
 uniform samplerCube uEnvironment;
 uniform vec2 uResolution;
 uniform vec3 uBeta,uDirection;
 uniform float uGamma,uYaw,uOneMinusBeta;
 uniform int uView,uDoppler;
 varying vec2 vPoint;
 vec3 sky(vec3 n){
  float above=clamp(n.y,0.0,1.0);
  vec3 col=mix(vec3(.81,.86,.84),vec3(.43,.65,.80),pow(above,.48));
  float cloud=sin(n.x*19.0+n.z*4.0)*sin(n.z*14.0-n.x*3.0);
  col=mix(col,vec3(.9,.92,.91),smoothstep(.26,.72,cloud)*smoothstep(.03,.19,n.y)*.25);
  float sun=pow(max(0.0,dot(n,normalize(vec3(-.5,.52,.7)))),500.0);
  col+=vec3(.22,.17,.08)*sun;
  return mix(vec3(.48,.55,.47),col,smoothstep(-.06,.01,n.y));
 }
 void main(){
  // The principal ray is at 43% of the image height, matching the crosshair.
  vec2 pixel=(vPoint*.5+.5)*uResolution;
  vec3 local=normalize(vec3((pixel.x-uResolution.x*.5)/(uResolution.x*.65),(pixel.y-uResolution.y*.57)/(uResolution.x*.65),1.0));
  float s=sin(uYaw),c=cos(uYaw);vec3 observed=vec3(local.x*c+local.z*s,local.y,-local.x*s+local.z*c);
  vec3 ray=observed;
  float b2=dot(uBeta,uBeta);
  if(b2>1e-16&&uView!=2){
   float mu=clamp(dot(uDirection,observed),-1.0,1.0);
   if(uView==0)ray=normalize((observed-mu*uDirection)/uGamma+((mu-1.0)+uOneMinusBeta)*uDirection);
   else ray=normalize(observed+(uGamma-1.0)*mu*uDirection);
  }
  vec4 scene=textureCube(uEnvironment,ray);
  vec3 rgb=scene.rgb+sky(ray)*(1.0-scene.a);
  if(uDoppler==1&&b2>1e-12){
   // Each output pixel receives its own frequency shift, including ground pixels.
   float mu=clamp(dot(uDirection,ray),-1.0,1.0);
   float D=uGamma*((1.0+mu)-uOneMinusBeta*mu);
   if(uView==0){float observedMu=clamp(dot(uDirection,observed),-1.0,1.0);D=1.0/(uGamma*((1.0-observedMu)+uOneMinusBeta*observedMu));}
   float shift=clamp(log(max(D,.00001)),-4.0,4.0);
   float luma=dot(rgb,vec3(.2126,.7152,.0722));
   vec3 filtered=rgb*exp(vec3(-.85,.015,.85)*shift);
   filtered*=luma/max(.001,dot(filtered,vec3(.2126,.7152,.0722)));
   rgb=filtered/(1.0+max(vec3(0.0),filtered-1.0)*.45);
  }
  float vignette=1.0-.11*pow(length(vPoint*.65),2.0);
  gl_FragColor=vec4(clamp(rgb*vignette,0.0,1.0),1.0);
 }`;
 function shader(type,source){const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh));return sh;}
 function program(vs,fs){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
 const sceneProgram=program(vertexSource,fragmentSource),screenProgram=program(screenVertex,screenFragment);
 const sceneUniform=Object.fromEntries(['uEye','uFace','uNoise','uAtlas'].map(k=>[k,gl.getUniformLocation(sceneProgram,k)]));
 const screenUniform=Object.fromEntries(['uEnvironment','uResolution','uBeta','uDirection','uGamma','uYaw','uOneMinusBeta','uView','uDoppler'].map(k=>[k,gl.getUniformLocation(screenProgram,k)]));
 const sceneBuffer=gl.createBuffer(),screenBuffer=gl.createBuffer();
 gl.bindBuffer(gl.ARRAY_BUFFER,screenBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const environment=gl.createTexture(),framebuffer=gl.createFramebuffer(),depth=gl.createRenderbuffer();
 gl.bindTexture(gl.TEXTURE_CUBE_MAP,environment);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 const noise=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,noise);
 const noiseData=new Uint8Array(256*256*4);let seed=94623;for(let i=0;i<noiseData.length;i+=4){for(let j=0;j<3;j++){seed=(Math.imul(seed,1664525)+1013904223)|0;noiseData[i+j]=(seed>>>24);}noiseData[i+3]=255;}
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,noiseData);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
 const atlasTexture=gl.createTexture(),atlasCanvas=document.createElement('canvas');atlasCanvas.width=2048;atlasCanvas.height=256;const atlasCtx=atlasCanvas.getContext('2d'),signs=new Map();
 function signIndex(text){if(!signs.has(text)){if(signs.size>=16)return -1;const index=signs.size;signs.set(text,index);atlasCtx.fillStyle='#ffffff';atlasCtx.font='500 38px "PingFang SC","Microsoft YaHei",sans-serif';atlasCtx.textAlign='center';atlasCtx.textBaseline='middle';atlasCtx.fillText(text,(index%4)*512+256,Math.floor(index/4)*64+32,465);}return signs.get(text);}
 function uploadAtlas(){gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,atlasTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlasCanvas);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
 const attributeSpec=[['aPosition',3,0],['aNormal',3,3],['aColor',3,6],['aMaterial',1,9],['aUV',2,10],['aSign',1,12]].map(([name,size,offset])=>({location:gl.getAttribLocation(sceneProgram,name),size,offset}));
 const screenLocation=gl.getAttribLocation(screenProgram,'aPoint');
 let meshKey='',vertexCount=0,cubeSize=0,dirty=true,lastCamera='',contextLost=false;
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;toast('图形上下文暂时丢失，请重新打开 HTML。',8000);});
 function updateMesh(blocks){const key=blocks.map(b=>b.key).join('|');if(key===meshKey)return;meshKey=key;const data=[],uv=[[0,0],[1,0],[1,1],[0,1]];
  for(const block of blocks)for(const group of block.groups)for(const f of group.faces){
   let normal=f.normal;if(!normal){const [a,b,c]=f.points,u=b.map((v,i)=>v-a[i]),v=c.map((q,i)=>q-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n)||1;normal=n.map(v=>v/len);}
   const sign=f.text?signIndex(f.text):-1;
   for(let t=1;t<f.points.length-1;t++)for(const i of [0,t,t+1])data.push(...f.points[i],...normal,...f.color.map(v=>v/255),f.material||0,...uv[i%4],sign);
  }
  vertexCount=data.length/13;gl.bindBuffer(gl.ARRAY_BUFFER,sceneBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);uploadAtlas();dirty=true;
 }
 function allocateCube(){const wanted=Math.min(gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),state.quality===3?2048:state.quality===1?512:1024);if(cubeSize===wanted)return;cubeSize=wanted;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_CUBE_MAP,environment);for(let i=0;i<6;i++)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,gl.RGBA,cubeSize,cubeSize,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,cubeSize,cubeSize);dirty=true;}
 function disableAttributes(){for(let i=0;i<8;i++)gl.disableVertexAttribArray(i);}
 function captureEnvironment(){
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);gl.viewport(0,0,cubeSize,cubeSize);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.useProgram(sceneProgram);
  disableAttributes();gl.bindBuffer(gl.ARRAY_BUFFER,sceneBuffer);for(const a of attributeSpec){if(a.location<0)continue;gl.enableVertexAttribArray(a.location);gl.vertexAttribPointer(a.location,a.size,gl.FLOAT,false,52,a.offset*4);}
  gl.uniform3f(sceneUniform.uEye,state.x,1.72,state.z);gl.uniform1i(sceneUniform.uNoise,1);gl.uniform1i(sceneUniform.uAtlas,2);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,noise);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,atlasTexture);
  for(let i=0;i<6;i++){gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,environment,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('环境纹理缓冲创建失败');gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform1i(sceneUniform.uFace,i);gl.drawArrays(gl.TRIANGLES,0,vertexCount);}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);dirty=false;
 }
 function composite(w,h,yaw){
  gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.useProgram(screenProgram);disableAttributes();gl.bindBuffer(gl.ARRAY_BUFFER,screenBuffer);gl.enableVertexAttribArray(screenLocation);gl.vertexAttribPointer(screenLocation,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_CUBE_MAP,environment);gl.uniform1i(screenUniform.uEnvironment,0);gl.uniform2f(screenUniform.uResolution,w,h);gl.uniform3f(screenUniform.uBeta,state.vx/C,0,state.vz/C);gl.uniform3f(screenUniform.uDirection,state.speed>1e-9?state.vx/state.speed:0,0,state.speed>1e-9?state.vz/state.speed:1);gl.uniform1f(screenUniform.uOneMinusBeta,1-state.speed/C);gl.uniform1f(screenUniform.uGamma,state.gamma);gl.uniform1f(screenUniform.uYaw,yaw);gl.uniform1i(screenUniform.uView,state.view==='optical'?0:state.view==='measurement'?1:2);gl.uniform1i(screenUniform.uDoppler,state.doppler?1:0);gl.drawArrays(gl.TRIANGLES,0,3);
 }
 return {invalidate(){dirty=true;},render(blocks,main,rear,rearContext){if(contextLost)return;updateMesh(blocks);allocateCube();const camera=state.x.toFixed(6)+','+state.z.toFixed(6);if(dirty||camera!==lastCamera){captureEnvironment();lastCamera=camera;}composite(rear.w,rear.h,state.yaw+Math.PI);rearContext.drawImage(canvas,0,canvas.height-rear.h,rear.w,rear.h,0,0,rear.w,rear.h);composite(main.w,main.h,state.yaw);},getInfo:()=>({renderer:'WebGL cube-ray',cubeSize,vertexCount,output:[canvas.width,canvas.height]})};
}
