const pendingHermes = new Map();
let requestId = 0;
let demoWorkspace = false;

function requestHermes(method, params) {
 const id = ++requestId;
 return new Promise((resolve,reject)=>{
  const timeout = setTimeout(()=>{
   pendingHermes.delete(id);
   reject(Error('Hermes did not respond. Check the gateway connection and try again.'));
  },30000);
  pendingHermes.set(id,{resolve,reject,timeout});
  window.parent.postMessage({channel:'dive-in',id,method,params},'*');
 });
}
window.addEventListener('message',event=>{
 if(event.source!==window.parent||event.data?.channel!=='dive-in-result')return;
 const {id,result,error}=event.data;
 const request=pendingHermes.get(id);
 if(!request)return;
 pendingHermes.delete(id);
 clearTimeout(request.timeout);
 if(error)request.reject(Error(error));else request.resolve(result);
});

async function api(action,params={}) {
 const result=await requestHermes('action',{...params,action,demo_workspace:demoWorkspace});
 if(action==='demo')demoWorkspace=true;
 if(action==='capture'){demoWorkspace=false;cutoff=undefined;}
 return result;
}
function useLiveWorkspace(){demoWorkspace=false;}
async function askModel(prompt,runId){await requestHermes('research',{prompt,runId});}
document.addEventListener('click',event=>{
 const anchor=event.target.closest('a[href]');
 if(!anchor||!/^https?:\/\//i.test(anchor.href))return;
 event.preventDefault();
 requestHermes('open-link',{url:anchor.href}).catch(error=>status(error.message,true));
});

