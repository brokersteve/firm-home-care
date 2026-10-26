import type { Env } from "./env";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
const MAX_BYTES = 15 * 1024 * 1024;

/** Stores an uploaded photo under a random key and returns its public link, or null if it isn't a usable image. */
export async function savePhoto(env: Env, file: File, prefix: string): Promise<string | null> {
  const ext = TYPES[file.type];
  if (!ext || file.size > MAX_BYTES) return null;
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return `${env.APP_URL}/photo/${key}`;
}

/** The R2 key inside one of our photo links, or null for anything else. */
export function photoKey(env: Pick<Env, "APP_URL">, url: string): string | null {
  const prefix = `${env.APP_URL}/photo/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

export async function servePhoto(env: Env, key: string): Promise<Response> {
  const object = /^[\w/-]+\.(jpg|png|webp|heic)$/.test(key) ? await env.PHOTOS.get(key) : null;
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

/*
 * Browser script for forms with photos: shrinks each photo to at most 1600px before upload, so phones on
 * cellular send ~300KB instead of several MB, and inspection reports stay a sensible size.
 */
export const SHRINK_PHOTOS_SCRIPT = `
(function(){
  function shrink(file){
    return new Promise(function(done){
      if(!/^image\\//.test(file.type)){done(file);return;}
      var img=new Image(), url=URL.createObjectURL(file);
      img.onload=function(){
        var s=Math.min(1,1600/Math.max(img.width,img.height)), c=document.createElement('canvas');
        c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
        c.toBlob(function(b){done(b?new File([b],file.name.replace(/\\.\\w+$/,'')+'.jpg',{type:'image/jpeg'}):file);},'image/jpeg',0.8);
      };
      img.onerror=function(){URL.revokeObjectURL(url);done(file);};
      img.src=url;
    });
  }
  [].forEach.call(document.querySelectorAll('form[enctype="multipart/form-data"]'),function(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var btn=form.querySelector('button[type=submit],button:not([type])'); if(btn){btn.disabled=true;btn.textContent='Sending…';}
      var data=new FormData(form), jobs=[];
      [].forEach.call(form.querySelectorAll('input[type=file]'),function(input){
        data.delete(input.name);
        [].forEach.call(input.files,function(f){jobs.push(shrink(f).then(function(s){data.append(input.name,s);}));});
      });
      Promise.all(jobs).then(function(){return fetch(form.action,{method:'POST',body:data});})
        .then(function(r){ if(r.redirected){location.href=r.url;return;} return r.text().then(function(t){document.open();document.write(t);document.close();}); })
        .catch(function(){ if(btn){btn.disabled=false;btn.textContent='Try again';} alert('That didn\\'t send. Check your connection and try again.'); });
    });
  });
})();`;
