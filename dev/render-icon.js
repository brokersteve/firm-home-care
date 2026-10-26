const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
for(const v of ['a','b']){const svg=fs.readFileSync(v+'.svg','utf8');
 for(const size of [512,192,180]){await p.setViewportSize({width:size,height:size});
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ','<svg width="'+size+'" height="'+size+'" ')}</body></html>`);
  await p.screenshot({path:`${v}-${size}.png`,clip:{x:0,y:0,width:size,height:size}});}}
// preview: icons as on a phone home screen, rounded
await p.setViewportSize({width:520,height:260});
const img=v=>'data:image/png;base64,'+fs.readFileSync(v+'-180.png').toString('base64');
await p.setContent(`<html><body style="margin:0;background:linear-gradient(#5b7fa6,#2d4a6b);font:14px system-ui;color:#fff;display:flex;gap:60px;justify-content:center;align-items:center;height:260px">
${['a','b'].map((v,i)=>`<div style="text-align:center"><img src="${img(v)}" style="width:120px;height:120px;border-radius:27px;box-shadow:0 4px 12px rgba(0,0,0,.3)"><div style="margin-top:8px">Option ${i?'B':'A'}<br>FIRM Home Care</div></div>`).join('')}</body></html>`);
await p.screenshot({path:'/mnt/project-files/firm-home-care/screenshots/v2/18-icon-options.png'});
await b.close();})();
