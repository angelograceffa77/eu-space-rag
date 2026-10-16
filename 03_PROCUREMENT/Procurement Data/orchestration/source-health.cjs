'use strict';
const fs=require('node:fs'),path=require('node:path');
function sourceHealth(files){const checks=[];
 for(const file of files.filter(f=>/summary.*\.json$/i.test(path.basename(f)))){
  const summary=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const check of summary.currentSourceChecks||summary.sourceCounts?.currentSourceChecks||[])checks.push({...check,summaryFile:file});
  if(summary.liveInTendLayerAccessible===false)checks.push({source:'ESO In-Tend',state:'blocked',error:'Current portal layer was not accessible; zero collected rows is not evidence of no tenders.',summaryFile:file});
 }
 return checks;
}
module.exports={sourceHealth};
