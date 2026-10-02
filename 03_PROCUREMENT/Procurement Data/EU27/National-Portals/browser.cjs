'use strict';
const {chromium}=require('playwright-core');
class PublicBrowser {
 constructor(){this.launch=null;}
 async get(url,timeout){
  if(!this.launch)this.launch=chromium.launch(process.env.SCRAPER_BROWSER_PATH?{headless:true,executablePath:process.env.SCRAPER_BROWSER_PATH}:{headless:true,channel:'msedge'});
  const browser=await this.launch;const context=await browser.newContext({acceptDownloads:false});
  const page=await context.newPage();
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout});
   if(response&&response.status()>=400)throw Error('Browser HTTP '+response.status());
   await page.waitForLoadState('networkidle',{timeout:Math.min(timeout,12000)}).catch(()=>{});
   const text=await page.locator('body').innerText();
   if(/verify you are human|access denied|just a moment/i.test(text)&&text.length<10000)throw Error('Public page has an access challenge');
   return {html:await page.content(),finalUrl:page.url()};
  }finally{await context.close();}
 }
 async close(){if(this.launch)await (await this.launch).close();}
}
module.exports={PublicBrowser};
