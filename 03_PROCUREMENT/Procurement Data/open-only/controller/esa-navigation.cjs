'use strict';
async function navigate(page,url){let last;for(let attempt=0;attempt<2;attempt++){try{return await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});}catch(e){last=e;if(e.name!=='TimeoutError'||attempt===1)throw e;await page.waitForTimeout(1500);}}throw last;}
module.exports={navigate};
