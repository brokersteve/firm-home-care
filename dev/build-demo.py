# Builds the static phone demo (one HTML page) from tenant pages crawled off the local dev app.
# Usage: run mock + wrangler dev, then: node dev/crawl-demo.mjs <sig> && python3 dev/build-demo.py <sig> <out.html> [dir]
import json, re, sys
sig, out = sys.argv[1], sys.argv[2]
# Crawled pages, the fixed/submitted endings and the admin__*.html staff pages (curl'd with the admin cookie).
DIR = sys.argv[3] if len(sys.argv) > 3 else '/tmp/claude-0/demo/'
d = json.load(open(DIR + 'pages.json'))
base = f"/t/501/{sig}"
def body_of(h):
    m = re.search(r'<body[^>]*>(.*)</body>', h, re.S); return m.group(1) if m else h
def title_of(h):
    m = re.search(r'<title>(.*?)</title>', h, re.S); return m.group(1) if m else ""
pages = {}
for p, s, h, l in d:
    if s == 200: pages[p[len(base)+1:]] = {"t": title_of(h), "b": body_of(h)}
# Staff pages, captured from the local app after seeding sample vendors and work orders .
for k, f in [("/admin/workorders", "admin__admin_workorders.html"), ("/admin/workorders/4", "admin__admin_workorders_4.html"),
             ("/admin/workorders/5", "admin__admin_workorders_5.html"), ("/admin/vendors", "admin__admin_vendors.html")]:
    h = open(DIR + f).read(); pages[k] = {"t": title_of(h), "b": body_of(h)}
for k, f in [("__fixed", "fixed.html"), ("__submitted", "submitted.html")]:
    h = open(DIR + f).read(); pages[k] = {"t": title_of(h), "b": body_of(h)}
pages["__submitted"]["b"] = pages["__submitted"]["b"].replace("</main>", '<div class="card note"><p><strong>Demo:</strong> see what F.I.R.M. staff do next. A sample work order like this one is waiting to be sent to a vendor.</p><a class="btn primary" href="/admin/workorders/5">Open it as staff</a></div></main>', 1)
assert "Open it as staff" in pages["__submitted"]["b"]
first = [h for p, s, h, l in d if p == base + "/"][0]
css = re.search(r'<style>(.*?)</style>', first, re.S).group(1)
dark = re.search(r'@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}', css).group(1)
css = css.replace('@media (prefers-color-scheme:dark){:root{', '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){').rstrip() + '\n:root[data-theme="dark"]{' + dark + ';color-scheme:dark}\n'
css = css.replace('main{max-width:560px;margin:0 auto;padding:16px}', 'main{max-width:560px;margin:0 auto;padding-block:16px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}')
assert 'padding-left:max' in css
blob = json.dumps(pages).replace('</', '<\\/').replace("location.href=base+'/guide/'+shown[on].guide", "demoGo(base+'/guide/'+shown[on].guide)")
script = r'''
(function(){
  var BASE=%s, pages=JSON.parse(document.getElementById('pages').textContent), app=document.getElementById('app');
  var current='', sent={};
  function keyOf(href){
    var u=href.replace(/^https?:\/\/[^/]+/,'').replace(/&amp;/g,'&').split('#')[0];
    if(u==='#tenant') return '';
    if(u.indexOf('/admin')===0){ u=u.split('?')[0]; return (u in pages)?u:'/admin/workorders'; }
    if(u.indexOf(BASE)!==0) return null; return u.slice(BASE.length+1);
  }
  function note(text){ var n=document.createElement('div'); n.className='card note'; n.innerHTML='<p></p>'; n.firstChild.textContent=text; var h=app.querySelector('main h1'); var q=h&&h.nextElementSibling; (q||h).after(n); n.scrollIntoView({block:'center'}); }
  function patchList(){ app.querySelectorAll('a[href^="/admin/workorders/"]').forEach(function(a){ var id=a.getAttribute('href').split('/').pop(); if(!sent[id]) return; var cell=a.closest('tr').lastElementChild; cell.innerHTML=''; cell.textContent=sent[id]+' (just now)'; }); }
  function show(k,push){
    if(!(k in pages)) k=(k.split('?')[0] in pages)?k.split('?')[0]:'';
    current=k; var p=pages[k]; app.innerHTML=p.b; if(k==='/admin/workorders') setTimeout(patchList); document.title=p.t.replace('F.I.R.M. Home Care','FIRM Home Care Demo');
    app.querySelectorAll('link,meta').forEach(function(n){n.remove();});
    app.querySelectorAll('script').forEach(function(old){ if(old.type==='application/json') return; var s=document.createElement('script'); s.textContent=old.textContent; old.replaceWith(s); });
    if(push) try{history.pushState({k:k},'');}catch(e){}
    window.scrollTo(0,0);
  }
  window.demoGo=function(href){var k=keyOf(href); if(k!==null) show(k,true);};
  document.addEventListener('click',function(e){ var a=e.target.closest&&e.target.closest('a[href]'); if(!a) return; var k=keyOf(a.getAttribute('href')); if(k===null) return; e.preventDefault(); show(k,true); });
  document.addEventListener('submit',function(e){
    var f=e.target, action=f.getAttribute('action')||''; e.preventDefault(); e.stopPropagation();
    if((f.method||'get').toLowerCase()==='get'){ show('help',true); return; }
    if(/\/fixed$/.test(action)){ show('__fixed',true); return; }
    if(/\/insurance$/.test(action)){ var n=f.querySelector('.demo-note')||document.createElement('p'); n.className='demo-note'; n.textContent='In the real app this saves the date and the reminders follow it. The demo does not save it.'; f.appendChild(n); return; }
    if(/\/report\//.test(action)){ show('__submitted',true); return; }
    var sel=f.querySelector('#vendor');
    if(/^\/admin\/workorders\/\d+$/.test(current)&&sel){
      var name=sel.options[sel.selectedIndex].text.replace(/ \(.*$/,''), id=current.split('/').pop();
      var hour=+new Date().toLocaleString('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false});
      var text=(hour>=8&&hour<21)?'texted':'the text goes out at 8am (no texts 9pm to 8am)';
      sent[id]=name;
      note('Sent to '+name+': emailed, '+text+'. A copy went to steve@firm.vip for your Outlook folder. (Demo: nothing was actually sent.)');
      return;
    }
    if(current.indexOf('/admin')===0){ var n=f.querySelector('.demo-note')||document.createElement('p'); n.className='demo-note'; n.textContent='In the real app this saves the vendor. The demo does not save it.'; f.appendChild(n); return; }
  },true);
  window.addEventListener('popstate',function(e){ show(e.state&&e.state.k||'',false); });
  try{history.replaceState({k:''},'');}catch(e){}
  show('',false);
})();''' % json.dumps(base)
html = f'''<title>FIRM Home Care Demo</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>{css}
.demo-bar{{background:var(--tint);color:var(--ink);font-size:14px;text-align:center;padding-block:8px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}
.demo-bar a{{color:var(--brand);font-weight:600}}
.demo-note{{background:var(--tint);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:14px}}
</style>
<div class="demo-bar"><strong>Demo</strong> with a sample home, tenant and vendors. Nothing you enter is saved or sent.<br><a href="#tenant">Tenant view</a> &middot; <a href="/admin/workorders">Staff view: work orders</a></div>
<div id="app"></div>
<script id="pages" type="application/json">{blob}</script>
<script>{script}</script>
'''
open(out, 'w').write(html)
print(len(html)//1024, 'KB', len(pages), 'pages')
