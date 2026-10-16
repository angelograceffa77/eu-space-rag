'use strict';
// The official API limit is 30 requests/minute/IP. Share one queue across
// Polish adapters in this process, including direct Board calls and retries.
function isPolishApi(url){const u=new URL(url);return /(^|\.)ezamowienia\.gov\.pl$/i.test(u.hostname)&&/^\/(mo-board|bzp-archival-web)\/api\//.test(u.pathname);}
function createLimiter({now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),minimum=2100}={}){let next=0,queue=Promise.resolve();return async function wait(url,delay=0){if(!isPolishApi(url))return;const ticket=queue.then(async()=>{await sleep(Math.max(0,next-now()));next=now()+Math.max(minimum,Number(delay)||0);});queue=ticket.catch(()=>{});return ticket;};}
const waitForPolishApi=createLimiter();
module.exports={isPolishApi,createLimiter,waitForPolishApi};
