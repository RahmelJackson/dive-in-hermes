// Shade the main lens with a ray through a sphere and sample the scene behind it.
function mountGlassOptics() {
 const surface=document.createElement('canvas');
 const sample=document.createElement('canvas');
 const size=288;
 surface.width=surface.height=sample.width=sample.height=size;
 const gl=surface.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false});
 const backdrop=sample.getContext('2d');
 if(!gl||!backdrop||typeof gl.createShader!=='function')return null;
 const vertex=gl.createShader(gl.VERTEX_SHADER), fragment=gl.createShader(gl.FRAGMENT_SHADER);
 gl.shaderSource(vertex,`
  attribute vec2 position;
  varying vec2 uv;
  void main() {
   uv=position*.5+.5;
   gl_Position=vec4(position,0.,1.);
  }`);
 gl.shaderSource(fragment,`
  precision mediump float;
  varying vec2 uv;
  uniform sampler2D behind;
  uniform float turn;
  uniform float daylight;
  uniform float accent;
  void main() {
   vec2 p=(uv*2.-1.)/.96;
   float radius=length(p);
   if(radius>1.){gl_FragColor=vec4(0.);return;}
   vec3 n=vec3(p,sqrt(max(0.,1.-dot(p,p))));
   vec3 ray=vec3(0.,0.,-1.);
   vec3 inside=refract(ray,n,1./1.42);
   float thickness=-2.*dot(n,inside);
   vec3 farSide=n+inside*thickness;
   vec3 exitRay=refract(inside,-farSide,1.42);
   vec2 offset=(farSide.xy-p)*.33+exitRay.xy*.063;
   vec2 ref=clamp(uv+offset,.015,.985);
   vec3 view=vec3(
    texture2D(behind,clamp(ref+offset*.015,.015,.985)).r,
    texture2D(behind,ref).g,
    texture2D(behind,clamp(ref-offset*.02,.015,.985)).b);
   vec3 tint=mix(vec3(.14,.44,.78),vec3(.14,.65,.62),accent);
   vec3 reflected=reflect(ray,n);
   vec3 key=normalize(vec3(-.43+sin(turn)*.20,.64,.85));
   vec3 strip=normalize(vec3(.60,.13+cos(turn)*.22,.70));
   float softbox=pow(max(0.,dot(reflected,key)),17.);
   float rim=pow(1.-n.z,2.8);
   float ribbon=exp(-pow((reflected.y-.31*sin(reflected.x*3.+turn)-.44)*7.,2.))
    *smoothstep(-.30,.54,reflected.x)*smoothstep(-.07,.55,reflected.z);
   float fill=pow(max(0.,dot(reflected,strip)),7.);
   vec3 edge=mix(vec3(.27,.63,.95),vec3(.76,.61,.98),smoothstep(-.70,.8,p.x));
   vec3 glass=view*exp(-thickness*vec3(.56,.27,.16))
    +tint*(.11+.24*fill)*thickness+rim*edge*(.27+.38*fill)
    +vec3(.80,.94,1.)*(.91*softbox+.28*ribbon);
   glass=mix(glass,view*.75+glass*.44,daylight*.62);
   float coverage=1.-smoothstep(.985,1.,radius);
   gl_FragColor=vec4(clamp(glass,0.,1.),coverage);
  }`);
 gl.compileShader(vertex);
 gl.compileShader(fragment);
 const program=gl.createProgram();
 gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
 gl.deleteShader(vertex);gl.deleteShader(fragment);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);return null;}
 gl.useProgram(program);
 const buffer=gl.createBuffer();
 gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'position');
 gl.enableVertexAttribArray(position);
 gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();
 gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
 const turn=gl.getUniformLocation(program,'turn'), daylight=gl.getUniformLocation(program,'daylight');
 const accent=gl.getUniformLocation(program,'accent');
 return function drawLens(scene,ctx,point,radius,scale,phase,light,teal){
  if(gl.isContextLost()||radius<32)return false;
  const extent=radius/.96,x=point.x-extent,y=point.y-extent,d=extent*2;
  backdrop.fillStyle=light?'#c6dded':'#0b172b';
  backdrop.fillRect(0,0,size,size);
  backdrop.drawImage(scene,x*scale,y*scale,d*scale,d*scale,0,0,size,size);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,sample);
  gl.uniform1f(turn,phase);gl.uniform1f(daylight,Number(light));gl.uniform1f(accent,Number(teal));
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  ctx.drawImage(surface,x,y,d,d);
  return true;
 };
}
