import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { daysBetween, formatDay, prettyDay } from "./dates";
import { DIAGRAMS } from "./diagrams";
import type { Env, Property, Tenant } from "./env";
import { filters } from "./fields";
import { SHRINK_PHOTOS_SCRIPT } from "./photos";
import { EMERGENCY, FIXED, GUIDES, WORK_ORDER, fillText, suggestions, type Guide, type Walk } from "./guides";
import { FOLLOW_UPS, STARTED } from "./triage";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const STYLE = `
:root{--ink:#1d2329;--quiet:#5b6670;--line:#d9dee3;--brand:#1f5f8b;--bg:#f6f7f9;--card:#fff;--alert:#b3261e;--tint:#e8f0f6}
@media (prefers-color-scheme:dark){:root{--ink:#e8ebee;--quiet:#a3adb6;--line:#38414a;--brand:#7cb8e4;--bg:#14181c;--card:#1d2328;--alert:#f2b8b5;--tint:#22303b}}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:560px;margin:0 auto;padding:16px}
header{padding:8px 0 4px}header small{color:var(--quiet)}
h1{font-size:22px;margin:4px 0 12px}h2{font-size:17px;margin:0 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.alert{border-color:var(--alert)}.alert h2{color:var(--alert)}.note{background:var(--tint);border-color:var(--tint)}
.btn{display:block;width:100%;text-align:center;padding:14px 16px;margin:8px 0;border-radius:10px;border:1px solid var(--brand);
  background:var(--card);color:var(--brand);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--brand);color:var(--card)}.btn.danger{border-color:var(--alert);color:var(--alert)}
dl{margin:0}dt{color:var(--quiet);font-size:14px;margin-top:8px}dd{margin:0}
input[type=search],input[type=text],input[type=tel],input[type=email],textarea,select{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);font:inherit;background:var(--card);color:var(--ink)}
textarea{min-height:96px}label{display:block;font-weight:600;margin:14px 0 6px}label small{font-weight:400;color:var(--quiet)}
input[type=file]{width:100%;padding:8px 0}
.pick input[type=file]{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}.pick label.btn{position:relative;margin:8px 0}
.pick .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.thumbs{display:flex;flex-wrap:wrap;gap:6px}.thumbs img{width:64px;height:64px;object-fit:cover;border-radius:8px}
ol,ul{padding-left:20px}li{margin:6px 0}.quiet{color:var(--quiet);font-size:14px}
.ac{position:relative}.ac ul{position:absolute;z-index:2;left:0;right:0;margin:4px 0 0;padding:4px;list-style:none;background:var(--card);
  border:1px solid var(--line);border-radius:10px;box-shadow:0 6px 18px rgb(0 0 0 / .12)}
.ac li{margin:0}.ac a{display:block;padding:10px 12px;border-radius:8px;color:var(--ink);text-decoration:none}.ac a:hover,.ac a.on{background:var(--tint)}
.step{color:var(--quiet);font-size:14px;margin:0 0 4px}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
`;

/** manifest: the tenant's own manifest URL, so "Add to Home Screen" opens their page. */
export function layout(title: string, body: Html, script = "", manifest = ""): Html {
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · F.I.R.M. Home Care</title><style>${raw(STYLE)}</style>
<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="FIRM Home"><meta name="theme-color" content="#1f5f8b">
${manifest ? html`<link rel="manifest" href="${manifest}">` : ""}</head>
<body><main><header><small>F.I.R.M. Home Care</small></header>${body}</main>${script ? raw(`<script>${script}</script>`) : ""}
<script src="/app.js" defer></script></body></html>`;
}

export function emergencyCard(env: Env): Html {
  return html`<div class="card alert"><h2>Emergency?</h2>
<p>Fire, gas smell or crime: call 911 first. Then, or for flooding, no heat in freezing weather or anything unsafe, call our emergency maintenance line.</p>
<a class="btn danger" href="tel:${env.EMERGENCY_PHONE}">Call ${env.EMERGENCY_PHONE}</a></div>`;
}

/*
 * The "Something not working?" box. As the tenant types, matching problems drop down; picking one opens
 * that guide's steps directly. Pressing Enter without picking runs the full search on the help page.
 */
const AUTOCOMPLETE = `
(function(){
  var box=document.getElementById('q'), list=document.getElementById('q-list'), data=JSON.parse(document.getElementById('q-data').textContent);
  var base=box.dataset.base, on=-1, shown=[];
  function render(){
    var q=box.value.toLowerCase().trim(), words=q.split(/\\s+/).filter(Boolean);
    shown=!words.length?[]:data.filter(function(s){return words.every(function(w){return s.terms.indexOf(w)>=0||s.terms.indexOf(w.replace(/s$/,''))>=0;});}).slice(0,6);
    on=-1; list.innerHTML='';
    shown.forEach(function(s,i){var li=document.createElement('li'),a=document.createElement('a');a.href=base+'/guide/'+s.guide;a.textContent=s.label;a.id='q-'+i;li.appendChild(a);list.appendChild(li);});
    list.hidden=!shown.length; box.setAttribute('aria-expanded',shown.length?'true':'false');
  }
  function mark(){[].forEach.call(list.querySelectorAll('a'),function(a,i){a.className=i===on?'on':'';});box.setAttribute('aria-activedescendant',on>=0?'q-'+on:'');}
  box.addEventListener('input',render);
  box.addEventListener('keydown',function(e){
    if(e.key==='ArrowDown'&&shown.length){on=(on+1)%shown.length;mark();e.preventDefault();}
    else if(e.key==='ArrowUp'&&shown.length){on=(on-1+shown.length)%shown.length;mark();e.preventDefault();}
    else if(e.key==='Enter'&&on>=0){location.href=base+'/guide/'+shown[on].guide;e.preventDefault();}
    else if(e.key==='Escape'){list.hidden=true;}
  });
  document.addEventListener('click',function(e){if(!list.contains(e.target)&&e.target!==box)list.hidden=true;});
})();`;

function searchBox(base: string, value = ""): Html {
  return html`<form action="${base}/help" method="get" class="ac" role="search">
<input type="search" id="q" name="q" value="${value}" data-base="${base}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="q-list"
 placeholder="Start typing, e.g. garbage disposal" aria-label="Describe the problem">
<ul id="q-list" role="listbox" hidden></ul></form>
<script type="application/json" id="q-data">${raw(JSON.stringify(suggestions()).replace(/</g, "\\u003c"))}</script>`;
}

function infoList(property: Property, rows: [string, string][]): Html {
  const filled = rows.filter(([, field]) => property.fields[field]);
  if (!filled.length) return html`<p class="quiet">Not on file yet. Ask F.I.R.M.</p>`;
  return html`<dl>${filled.map(([label, field]) => html`<dt>${label}</dt><dd>${property.fields[field]}</dd>`)}</dl>`;
}

/**
 * Renters insurance: when it expires and where to upload the new policy. Rentec's API doesn't share policy dates,
 * so the tenant enters the end date here (staff can correct it on the admin Tenants page) and reminders follow it.
 */
function insuranceCard(env: Env, base: string, tenant: Tenant, saved: boolean): Html {
  const expires = tenant.insurance_expires;
  const left = expires ? daysBetween(formatDay(new Date()), expires) : null;
  const status =
    left === null
      ? html`<p>When does your renters insurance policy end? Enter the date below and we'll remind you a month before it renews.</p>`
      : left < 0
        ? html`<p><strong>Your policy ended on ${prettyDay(expires!)}.</strong> Please upload your current policy today and enter its new end date.</p>`
        : html`<p>Your policy ends on <strong>${prettyDay(expires!)}</strong>.${left <= 30 ? " When you renew, upload the new policy and update the date here." : ""}</p>`;
  const urgent = left === null || left <= 30;
  return html`<div class="card${urgent ? " alert" : ""}" id="insurance"><h2>Renters insurance</h2>${status}
${saved ? html`<p class="quiet"><strong>Saved.</strong> Thanks!</p>` : ""}
<form method="post" action="${base}/insurance"><label for="ins-end">Policy end date</label>
<input type="date" id="ins-end" name="expires" value="${expires ?? ""}" required>
<button class="btn">Save date</button></form>
<p class="quiet">Your lease (8.1) requires at least $100,000 of personal liability coverage, with First Investor Realty &amp; Management, LLC listed as an additional insured or interested party. Upload proof in Resident Connect; no need to email it.</p>
<a class="btn${urgent ? " primary" : ""}" href="${env.RESIDENT_CONNECT_URL}">Upload my policy</a></div>`;
}

export function homePage(env: Env, base: string, tenant: Tenant, property: Property, insuranceSaved = false, openRequests = 0): Html {
  const filterList = filters(property.fields);
  return layout(
    "Home",
    html`<h1>Hi ${tenant.first_name}</h1><p class="quiet">${property.address}</p>
${emergencyCard(env)}
<div class="card note" id="a2hs"><h2>Put FIRM on your home screen</h2>
<p>Do this once and the FIRM icon opens this page in one tap, even years from now. No download or password.</p>
<button class="btn primary" id="a2hs-install" hidden>Add to home screen</button>
<p id="a2hs-steps"><strong>iPhone:</strong> in Safari, tap the Share button <span aria-hidden="true">(the square with an arrow)</span>, then <strong>Add to Home Screen</strong>.<br>
<strong>Android:</strong> in Chrome, tap the ⋮ menu, then <strong>Add to Home screen</strong> or <strong>Install app</strong>.</p>
<p class="quiet">Lost the icon or got a new phone? Go to ${env.APP_URL.replace(/^https?:\/\//, "")} and we'll send your link again.</p></div>
<div class="card"><h2>Something not working?</h2>
<p class="quiet">Before you submit a work order, let's check a few quick things. Many problems take two minutes to fix.</p>
${searchBox(base)}
<a class="btn" href="${base}/help">See common problems</a>
${openRequests ? html`<a class="btn primary" href="${base}/requests">My repair requests (${openRequests} open)</a>` : html`<a class="quiet" href="${base}/requests">My repair requests</a>`}</div>
<div class="card"><h2>Emergency guide for your home</h2>${infoList(property, [
      ["Main water shutoff", "HC Water Shutoff"],
      ["Gas shutoff", "HC Gas Shutoff"],
      ["Breaker panel", "HC Breaker Panel"],
    ])}</div>
<div class="card"><h2>Your home</h2>
${filterList.length
  ? html`<dl>${filterList.map((f, i) => html`<dt>Air filter${filterList.length > 1 ? ` ${i + 1}` : ""}</dt><dd>${f.size}${f.location ? html` · ${f.location}` : ""}</dd>`)}</dl>`
  : ""}
${infoList(property, [
  ["Heating", "HC Heat Type"],
  ["Water heater", "HC Water Heater"],
])}</div>
${tenant.move_in && daysBetween(tenant.move_in, formatDay(new Date())) <= 30
  ? html`<div class="card note"><h2>Move-in inspection</h2><p>Note anything damaged or not working, with photos, within 10 days of move-in. It protects your deposit.</p>
<a class="btn primary" href="${base}/inspection">Start or continue</a></div>`
  : ""}
<div class="card"><h2>Local info</h2>${infoList(property, [
      ["Trash and recycling", "HC Trash Day"],
      ["Utilities", "HC Utilities"],
      ["Good to know", "HC Local Notes"],
    ])}</div>
<div class="card note"><h2>Quick reminders from your lease</h2><ul>
<li>Replace air filters at least every 60 days, and detector batteries as needed.</li>
<li>Report leaks, mold, or heating, plumbing or appliance problems within 24 hours.</li>
<li>Slow or clogged drains are yours to clear, unless the line is collapsed or damaged through no fault of yours.</li>
<li>You or an adult 18 or older you authorize must be home for any repair visit. We don't enter without someone there unless it's an emergency.</li>
<li>In freezing weather keep the heat at 55°F or higher, even when away.</li>
<li>Away more than 7 days? Tell us in writing first.</li>
<li>Contact us through the tenant portal or email; phone or text only when it's urgent.</li>
</ul></div>
<div class="card"><h2>Rent and repairs</h2><p class="quiet">Pay rent and see your lease and work orders in Resident Connect.</p>
<a class="btn" href="${env.RESIDENT_CONNECT_URL}">Open Resident Connect</a></div>
${insuranceCard(env, base, tenant, insuranceSaved)}
`,
    AUTOCOMPLETE + HOME_SCREEN_SCRIPT,
    `${base}/manifest.webmanifest`,
  );
}

// Hides the home screen card when the page was opened from the icon, and uses Android's install prompt when offered.
const HOME_SCREEN_SCRIPT = `
(function(){
  var card=document.getElementById('a2hs'); if(!card) return;
  if((window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone){card.hidden=true;return;}
  var btn=document.getElementById('a2hs-install'), prompt=null;
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();prompt=e;btn.hidden=false;document.getElementById('a2hs-steps').hidden=true;});
  btn.addEventListener('click',function(){if(!prompt)return;prompt.prompt();prompt.userChoice.then(function(r){if(r.outcome==='accepted')card.hidden=true;});});
})();`;

export function helpPage(base: string, query: string, matches: Guide[]): Html {
  const others = GUIDES.filter((g) => !matches.includes(g));
  return layout(
    "Troubleshooting",
    html`<h1>What's going on?</h1>
<p class="quiet">Before you submit a work order, let's check a few quick things.</p>
${searchBox(base, query)}
${query && !matches.length ? html`<p class="quiet">Nothing matched “${query}”. Pick a problem below, or submit a work order.</p>` : ""}
${matches.length ? html`<div class="card"><h2>Best match</h2>${matches.map((g) => html`<a class="btn primary" href="${base}/guide/${g.id}">${g.title}</a>`)}</div>` : ""}
<div class="card"><h2>${matches.length ? "Other problems" : "Common problems"}</h2>${others.map((g) => html`<a class="btn" href="${base}/guide/${g.id}">${g.title}</a>`)}</div>
<div class="card"><h2>Not listed?</h2><a class="btn" href="${base}/report/other">Submit a work order</a></div>
<a class="quiet" href="${base}/">Back to my home page</a>`,
    AUTOCOMPLETE,
  );
}

export function safetyPage(base: string, guide: Guide, env: Env, property: Property): Html {
  return layout(
    guide.title,
    html`<h1>${guide.title}</h1>
<div class="card alert"><h2>Safety first</h2><p>${fillText(guide.safety, property.fields)}</p>
<a class="btn danger" href="tel:${env.EMERGENCY_PHONE}">This is an emergency: call ${env.EMERGENCY_PHONE}</a></div>
${guide.leaseNote ? html`<div class="card note"><p>${guide.leaseNote}</p></div>` : ""}
<div class="card"><p>Before you submit a work order, did you check these? Most fixes take a few minutes, and you'll skip the wait for a technician.</p>
<a class="btn primary" href="${base}/guide/${guide.id}?a=">I'm safe, let's check</a>
<a class="btn" href="${base}/report/${guide.id}?a=skip">I've already tried the usual fixes</a></div>`,
  );
}

function videoLink(video: { url: string; title: string } | undefined): Html | string {
  if (!video) return "";
  return html`<a class="btn" href="${video.url}" target="_blank" rel="noopener">Watch: ${video.title}</a>`;
}

export function stepPage(base: string, guide: Guide, answers: number[], walked: Walk, property: Property): Html {
  const node = guide.nodes[walked.at]!;
  const prefix = answers.length ? `${answers.join(",")},` : "";
  return layout(
    guide.title,
    html`<h1>${guide.title}</h1><div class="card"><p class="step">Check ${answers.length + 1}</p><p>${fillText(node.text, property.fields)}</p>
${node.diagram ? raw(DIAGRAMS[node.diagram]) : ""}${videoLink(node.video)}
${node.options.map((o, i) =>
  o.next === FIXED
    ? html`<form method="post" action="${base}/guide/${guide.id}/fixed"><input type="hidden" name="a" value="${prefix}${i}"><button class="btn primary">${o.label}</button></form>`
    : o.next === WORK_ORDER
      ? html`<a class="btn" href="${base}/report/${guide.id}?a=${prefix}${i}">${o.label}</a>`
      : html`<a class="btn" href="${base}/guide/${guide.id}?a=${prefix}${i}">${o.label}</a>`,
)}</div>
<a class="quiet" href="${base}/guide/${guide.id}${answers.length ? `?a=${answers.slice(0, -1).join(",")}` : ""}">Back</a>`,
  );
}

/** The guided work order: what's wrong, photos of the item, and the appliance tag where it's easy to reach. */
/** Work order visit windows: weekdays in business hours only, no nights, weekends or holidays. */
export const VISIT_TIMES = ["Weekday mornings (8am to noon)", "Weekday afternoons (noon to 5pm)", "Any weekday, 8am to 5pm"];

export function reportPage(base: string, env: Env, guide: Guide | null, answers: string, walked: Walk | null, tenant: Tenant, error = ""): Html {
  return layout(
    "Work order",
    html`<h1>Submit a work order</h1>
${walked?.history.length
  ? html`<div class="card"><h2>Checks you've done</h2><ul>${walked.history.map((h) => html`<li>${h.answer}</li>`)}</ul>
<p class="quiet">We'll send these with your request so the technician doesn't repeat them.</p></div>`
  : ""}
${guide?.leaseNote ? html`<div class="card note"><p>${guide.leaseNote}</p></div>` : ""}
${walked?.at === EMERGENCY
  ? html`<div class="card alert"><h2>Call first</h2><p>If you haven't called yet, call our emergency line now. Then send the details and photos here so the technician has them.</p>
<a class="btn danger" href="tel:${env.EMERGENCY_PHONE}">Call ${env.EMERGENCY_PHONE}</a></div>`
  : ""}
<form class="card" method="post" action="${base}/report/${guide?.id ?? "other"}" enctype="multipart/form-data">
<input type="hidden" name="a" value="${answers}">
${error ? html`<p class="card alert">${error}</p>` : ""}
${guide?.drainLine
  ? html`<label><input type="checkbox" name="drain_ack" value="1" required> I understand I'll be charged for clearing a slow or clogged drain, unless the line turns out to be collapsed or damaged through no fault of mine.</label>`
  : ""}
<label for="what">What's happening?</label>
<textarea id="what" name="what" required placeholder="e.g. The disposal hums but won't spin, even after the reset button.">${guide ? `${guide.title}. ` : ""}</textarea>
<label for="where">Where in the home? <small>e.g. kitchen sink, upstairs hall bathroom</small></label>
<input type="text" id="where" name="where">
${guide && FOLLOW_UPS[guide.id]
  ? html`<label for="follow_up">${FOLLOW_UPS[guide.id]!.question}</label><select id="follow_up" name="follow_up" required><option value="">Pick one</option>
${FOLLOW_UPS[guide.id]!.options.map((o) => html`<option>${o.label}</option>`)}</select>`
  : ""}
<label for="started">When did it start?</label>
<select id="started" name="started">${STARTED.map((s) => html`<option>${s}</option>`)}</select>
${walked?.history.length ? "" : html`<label for="tried">Anything you've already tried? <small>Optional</small></label><textarea id="tried" name="tried" style="min-height:64px"></textarea>`}
${photoPicker("photos", "Photos of the problem", `${guide ? `Take a photo of ${guide.photoHint}.` : "A photo or two helps us bring the right parts."} Up to 5.`, 5)}
${guide?.appliance
  ? photoPicker("tag", "Photo of the model and serial tag", "Only if it's easy to see: often inside the door, on the side or behind a front panel. Please don't move the appliance.", 1)
  : ""}
<fieldset style="border:0;padding:0;margin:0"><legend><strong>Best times for a visit</strong> <small>Visits are on weekdays during business hours (8am to 5pm). Pick any that work.</small></legend>
${VISIT_TIMES.map((t) => html`<label><input type="checkbox" name="when" value="${t}"> ${t}</label>`)}</fieldset>
<label><input type="checkbox" name="pets" value="yes"> There are pets in the home</label>
<label for="phone">Your phone number <small>So the technician can reach you</small></label>
<input type="tel" id="phone" name="phone" required autocomplete="tel" inputmode="tel" pattern="[^0-9]*([0-9][^0-9]*){10,11}" value="${tenant.phone ?? ""}" placeholder="704-555-0100">
<label for="email">Your email</label>
<input type="email" id="email" name="email" required autocomplete="email" value="${tenant.email ?? ""}">
<label><input type="checkbox" name="adult_present" value="1" required> I or another adult 18 or older that I authorize will be home for the visit. I understand F.I.R.M. won't enter without someone there unless it's an emergency.</label>
<p class="quiet">If an appointment is missed, the technician can't get in, or the problem turns out to be the tenant's responsibility, the service call (up to $75) may be charged to you (lease 6.5).</p>
<button class="btn primary">Submit work order</button></form>
<p class="quiet">Emergency? Call ${env.EMERGENCY_PHONE}.</p>`,
    PHOTO_PICKER_SCRIPT + SHRINK_PHOTOS_SCRIPT,
  );
}

/**
 * Photo buttons: "Take a photo" opens the camera on a phone; "Choose photos" opens the library. Each camera shot
 * gets its own input (the next one is added after a shot), so several can be taken. All share the field name.
 */
function photoPicker(name: string, title: string, hint: string, max: number): Html {
  return html`<div class="pick" data-max="${max}"><p style="font-weight:600;margin:14px 0 6px">${title} <small style="font-weight:400" class="quiet">${hint}</small></p>
<div class="row"><label class="btn primary">Take a photo<input type="file" name="${name}" accept="image/*" capture="environment" data-camera="1"></label>
<label class="btn">Choose ${max > 1 ? "photos" : "a photo"}<input type="file" name="${name}" accept="image/*"${max > 1 ? " multiple" : ""}></label></div>
<div class="thumbs" aria-live="polite"></div><p class="quiet pick-count" hidden></p></div>`;
}

const PHOTO_PICKER_SCRIPT = `
(function(){
  [].forEach.call(document.querySelectorAll('.pick'),function(pick){
    var max=+pick.dataset.max, thumbs=pick.querySelector('.thumbs'), count=pick.querySelector('.pick-count');
    function inputs(){return [].slice.call(pick.querySelectorAll('input[type=file]'));}
    function refresh(){
      var files=[]; inputs().forEach(function(i){[].push.apply(files,i.files);});
      thumbs.innerHTML='';
      files.slice(0,max).forEach(function(f){var img=document.createElement('img');img.alt='Photo added';img.src=URL.createObjectURL(f);thumbs.appendChild(img);});
      count.hidden=!files.length;
      count.textContent=files.length>max?('Only the first '+max+' will be sent.'):(files.length+(files.length===1?' photo':' photos')+' added.');
    }
    pick.addEventListener('change',function(e){
      var input=e.target;
      if(input.dataset.camera&&input.files.length&&max>1){
        // Keep this shot and give the button a fresh input for the next one.
        var next=input.cloneNode(); next.value=''; input.removeAttribute('data-camera'); input.parentNode.appendChild(next);
        pick.appendChild(input);
      }
      refresh();
    });
  });
})();`;

export function endingPage(base: string, title: string, message: string, env: Env, extra?: Html): Html {
  return layout(
    title,
    html`<h1>${title}</h1><div class="card"><p>${message}</p>${extra ?? ""}</div>
<p class="quiet">Emergency? Call ${env.EMERGENCY_PHONE}.</p><a class="btn" href="${base}/">Back to my home page</a>`,
  );
}

/** reportUrl: after calling, the tenant can send the details and photos too (filed as an emergency work order). */
export function emergencyEnding(base: string, env: Env, reportUrl = ""): Html {
  return endingPage(
    base,
    "Call us now",
    "This needs attention right away. Please call our emergency maintenance line.",
    env,
    html`<a class="btn danger" href="tel:${env.EMERGENCY_PHONE}">Call ${env.EMERGENCY_PHONE}</a>
${reportUrl ? html`<p class="quiet">After you call, you can send us the details and photos too.</p><a class="btn" href="${reportUrl}">Send the details</a>` : ""}`,
  );
}
