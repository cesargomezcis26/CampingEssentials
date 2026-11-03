const { chromium } = require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{
  const filename=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(filename,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(data)});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const executablePath=process.env.CHROMIUM_EXECUTABLE || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({headless:true,executablePath});
 const page=await browser.newPage();
 const owner='11111111-1111-4111-8111-111111111111',tripId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const writes=[];let failSave=false;
 const jwt = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:owner,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated',email:'owner@example.invalid'})).toString('base64url'),'test-signature'].join('.');
 const user={id:owner,aud:'authenticated',role:'authenticated',email:'owner@example.invalid',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.route('https://fjjnmksglgepvxvhxpoc.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url());let body={};try{body=req.postDataJSON()||{}}catch{}
  let data,status=200;
  if(url.pathname==='/auth/v1/otp')data={};
  else if(url.pathname==='/auth/v1/verify')data={access_token:jwt,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
  else if(url.pathname==='/auth/v1/logout')data={};
  else if(url.pathname==='/rest/v1/campwell_trips')data=req.method()==='POST'?{id:tripId}:req.headers().accept?.includes('object')?{id:tripId,name:'Test camp',owner_id:owner}:[{id:tripId,name:'Test camp',owner_id:owner}];
  else if(url.pathname==='/rest/v1/campwell_fields'||url.pathname==='/rest/v1/campwell_personal_fields'){
   if(req.method()==='POST') { if(failSave){status=500;data={message:'Test save failed',code:'XX000'}}else{writes.push({table:url.pathname,body});data=[{key:body.key}]}}
   else data=url.pathname.endsWith('personal_fields')?[]:[{key:'shared-0-owner',value:'<img src=x onerror=alert(1)>'},{key:'trip-location',value:'Test canyon'}];
  }else if(url.pathname==='/rest/v1/campwell_invitations'){writes.push({table:url.pathname,body});data=null;status=201}
  else throw Error('Unexpected request '+url.pathname);
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('**/supabase-config.js',route=>route.fulfill({contentType:'text/javascript',body: "window.CAMPWELL_SUPABASE={url:'https://fjjnmksglgepvxvhxpoc.supabase.co',publishableKey:'sb_publishable_test'}"}));
 await page.goto(base+'/planning.html');
 await page.locator('#signin-email').fill('owner@example.invalid');await page.locator('#email-form button').click();
 await page.locator('#signin-code').fill('123456');await page.locator('#code-form button').click();
 await page.locator('#shared-account').waitFor({state:'visible'});
 await page.locator('#trip-select').selectOption(tripId);await page.locator('#open-trip').click();
 await page.locator('#shared-trip').waitFor({state:'visible'});
 assert.equal(await page.locator('#shared-0-owner').inputValue(),'<img src=x onerror=alert(1)>');
 assert.equal(await page.locator('#shared-0-owner').evaluate(el=>el.parentNode.querySelectorAll('img').length),0);
 await page.locator('#shared-0-owner').fill('Alex');await page.locator('[data-save="personal-0-packed"]').check();await page.locator('#save-trip').click();
 await page.waitForFunction(()=>document.querySelector('#shared-status').textContent.startsWith('All changes saved'));
 assert.equal(writes.length,2);assert(writes.some(w=>w.body.key==='personal-0-packed'&&w.body.user_id===owner));assert(writes.some(w=>w.body.key==='shared-0-owner'&&w.body.value==='Alex'));
 failSave=true;await page.locator('#shared-1-owner').fill('Taylor');await page.locator('#save-trip').click();
 await page.waitForFunction(()=>document.querySelector('#shared-status').textContent.includes('Test save failed'));
 assert.equal(await page.locator('#shared-1-owner').inputValue(),'Taylor');
 failSave=false;await page.locator('#save-trip').click();await page.waitForFunction(()=>document.querySelector('#shared-status').textContent.startsWith('All changes saved'));
 assert.equal(writes.length,3);
 await page.locator('#invite-email').fill('friend@example.invalid');await page.locator('#invite-form button').click();
 await page.waitForFunction(()=>document.querySelector('#shared-status').textContent.startsWith('Email allowed'));
 assert.equal(writes[3].body.email,'friend@example.invalid');
 await page.locator('#local-mode').click();assert.equal(await page.locator('#shared-trip').isVisible(),false);
 await page.locator('#shared-0-owner').fill('Local only');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('campwell-plan-v1'))['shared-0-owner']),'Local only');
 await page.locator('#signout').click();await page.locator('#shared-signin').waitFor({state:'visible'});
 console.log('PASS: browser sign-in, private trip load, safe text rendering, only dirty fields saved, personal checks scoped, failed saves retained/retried, invitation, local fallback, sign-out.');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});const info=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,nav:[...document.querySelectorAll('nav a')].every(a=>{const r=a.getBoundingClientRect();return r.width>0&&r.height>=44&&r.right<=innerWidth})}));assert(!info.overflow&&info.nav,JSON.stringify({width,info}));}console.log('PASS: planning page at 320, 390, 768, and 1280px: visible navigation, no horizontal overflow.');
 // Verify incomplete setup preserves local mode and shows an actionable message.
 await page.route('**/supabase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.CAMPWELL_SUPABASE={url:"",publishableKey:""}'}));
 await page.reload();
 assert((await page.locator('#shared-status').textContent()).includes('not configured'));
 await page.locator('#shared-0-owner').fill('Offline organizer');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('campwell-plan-v1'))['shared-0-owner']),'Offline organizer');
 console.log('PASS: local planning remains available when shared configuration is absent.');
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
})().catch(e=>{console.error(e);process.exit(1)});
