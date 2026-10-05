'use strict';
const cheerio=require('cheerio'),{chromium}=require('playwright-core');const {clean,parseDate}=require('./core.cjs'),{parsePage}=require('./adapters.cjs');
function parseResults(html,url){const $=cheerio.load(html),rows=[];
 $('#T01 tbody tr').each((i,e)=>{const cells=$(e).find('td'),a=cells.find('a[href*="prepareViewCfTWS.do"]').first();if(!a.length)return;
 const sourceUrl=new URL(a.attr('href'),url).href;rows.push({sourceUrl,title:clean(a.text()),sourceStatus:clean(cells.eq(8).text()),procedure:clean(cells.eq(7).text())});
 });return rows;}
async function epps(ctx){
 const browser=await chromium.launch(process.env.SCRAPER_BROWSER_PATH?{headless:true,executablePath:process.env.SCRAPER_BROWSER_PATH}:{headless:true,channel:'msedge'}),context=await browser.newContext(),page=await context.newPage(),seen=new Set();
 const origin=new URL(ctx.source.url).origin;
 try{for(const term of ['satellite','GNSS','Copernicus','Galileo','earth observation','remote sensing','spacecraft','ground station','CubeSat',...(ctx.source.country==='LT'?['palydov','kosmos','nuotolinis']:[])]){
  if(!ctx.canFetch())break;ctx.recordRequest();await page.goto(origin+'/epps/prepareAdvancedSearch.do?type=cftFTS',{waitUntil:'networkidle',timeout:ctx.options.timeout});
  await page.locator('input[name="title"]').fill(term);if(await page.locator('input[name="captcha"]').isVisible())throw Error('Public advanced search requires CAPTCHA');await page.locator('input[type="submit"]').click();await page.waitForLoadState('networkidle');
  let previous='';while(ctx.canFetch()){
   ctx.recordRequest();const html=await page.content(),raw=ctx.saveRendered(page.url()+'#title='+encodeURIComponent(term)+'&page='+previous,html),rows=parseResults(html,page.url());
   if(!rows.length){const body=await page.locator('body').innerText();if(!/0 results|no results|no records|no items/i.test(body))ctx.gap('No recognized result rows for '+term);break;}
   const signature=rows.map(r=>r.sourceUrl).join('|');if(signature===previous)throw Error('EPPS repeated search page');previous=signature;
   for(const item of rows){if(seen.has(item.sourceUrl))continue;seen.add(item.sourceUrl);if(!ctx.canFetch()){ctx.gap('EPPS detail request budget reached');break;}
    try{const detail=await ctx.get(item.sourceUrl),r=parsePage(detail.body,item.sourceUrl,ctx.source).row;if(!r.noticeVerified){ctx.gap('Unrecognized EPPS detail '+item.sourceUrl);continue;}r.sourceStatus=item.sourceStatus||r.sourceStatus;if(/preliminary market|consultation|request for information/i.test(item.procedure+' '+r.title))r.noticeType='planning';ctx.emit(r,detail.rawFile);}catch(e){ctx.gap(item.sourceUrl+': '+e.message);}
   }
   const next=page.locator('#nextNav:not([disabled])').first();if(!await next.count())break;await new Promise(r=>setTimeout(r,ctx.options.delay));await next.click();await page.waitForLoadState('networkidle');
  }
 }
 if(!ctx.canFetch())ctx.gap('EPPS request budget reached');
 ctx.gap('Public title keyword searches only; descriptions may contain additional space contracts. Platform migrations can leave older notices in a separate legacy archive.');
 }finally{await context.close();await browser.close();}
}
module.exports={epps,parseResults};
