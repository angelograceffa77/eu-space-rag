'use strict';
const io=require('../funding data/00_Control/io.cjs'),{fs,path,sha,json,write,evidence,check,request}=io;
const {parse}=require('../funding data/01_Daily-Update/collect-routes.cjs');
const directoryUrl='https://access.esa.int/about-access/about-scale-up/business-incubation-centres';
function centres(raw){
 const $=require('../funding data/node_modules/cheerio').load(raw),out=[];
 if(!$('h1').text().includes('Business Incubation Centres'))throw Error('ESA BIC directory identity changed');
 $('details').each((i,el)=>{const name=$(el).children('summary').text().replace(/\s+/g,' ').trim();if(!/^ESA BIC /i.test(name))return;
 const websites=$(el).find('p').filter((i,p)=>/^Website\s*:/i.test($(p).text().trim())).find('a[href]').map((i,a)=>$(a).attr('href')).get();
 if(!websites.length){out.push({name,url:null,limitation:'Official directory has no recognized website link'});return;}
 for(const originalUrl of websites){let u;try{u=new URL(originalUrl);}catch{out.push({name,url:null,originalUrl,limitation:'Malformed website URL in the official directory; not guessed'});continue;}if(!['http:','https:'].includes(u.protocol))throw Error('Unexpected BIC website protocol');u.protocol='https:';u.hash='';out.push({name,url:u.href,originalUrl,httpsUpgrade:originalUrl.startsWith('http:')});}
 });
 if(!out.length)throw Error('ESA BIC directory has no recognized centres');
 return [...new Map(out.map(c=>[c.name+'|'+c.url,c])).values()];
}
function eligible(link,seed){const u=new URL(link.url),s=new URL(seed);return u.protocol==='https:'&&u.hostname===s.hostname&&!/archive|archiv|past|closed|privacy|cookie|login|logout|202[0-4]/i.test(u.pathname)&&/apply|applicat|incubat|fund|call|support|programme|program|\.pdf(?:$|\?)/i.test(link.url+' '+link.title);}
async function run(runRoot){
 const dir=path.join(require('../funding data/00_Control/policy.json').archiveRoot,'European-Space-Agency','Business-Incubation-Centres','Collection-Runs',path.basename(runRoot));
 const checkpoint=path.join(dir,'checkpoint.json');let state=fs.existsSync(checkpoint)?json(checkpoint):{centres:null,rows:[],reports:[],done:[]};
 for(const x of state.rows)check(x.evidence);
 if(!state.centres){const r=await request(directoryUrl);const proof=evidence(dir,'directory-'+Date.now()+'.html',r.body,{url:r.url,httpStatus:r.status});if(r.status!==200)throw Error('ESA BIC directory HTTP '+r.status);state.centres=centres(r.body);state.directoryEvidence=proof;write(checkpoint,state);}else check(state.directoryEvidence);
 for(const centre of state.centres){const key=centre.name+'|'+centre.url;if(state.done.includes(key))continue;const pages=[],errors=[],seen=new Set(),queue=centre.url?[{url:centre.url,depth:0}]:[];
 while(queue.length&&seen.size<6){const item=queue.shift();if(seen.has(item.url))continue;seen.add(item.url);try{const r=await request(item.url),proof=evidence(dir,sha(item.url)+'-'+Date.now()+'.raw',r.body,{url:r.url,httpStatus:r.status});if(r.status!==200){errors.push({url:item.url,status:r.status,evidence:proof});continue;}
 const p=r.body.subarray(0,4).toString()==='%PDF'?{title:item.title||item.url,text:(await require('../funding data/node_modules/pdf-parse')(r.body)).text,links:[],topicIds:[]}:parse(r.body,r.url);
 if(p.text.length<150||/verify you are human|just a moment|access denied|captcha/i.test(p.text.slice(0,700))){errors.push({url:item.url,error:'Restricted, empty or unrendered page',evidence:proof});continue;}
 const row={group:'Business-Incubation-Centres',centre:centre.name,url:r.url,...p,evidence:proof,directoryEvidence:state.directoryEvidence};pages.push(row);
 if(item.depth===0)queue.push(...p.links.filter(l=>eligible(l,r.url)).map(l=>({...l,depth:1})));
 }catch(e){errors.push({url:item.url,error:e.message});}}
 state.rows.push(...pages);state.reports.push({group:'Business-Incubation-Centres',centre:centre.name,rootUrl:centre.url,status:pages.length?'partial':'failed',pages:pages.length,errors,remaining:queue.length,directoryEvidence:state.directoryEvidence,scope:'Official directory-bound local website and linked application pages; bounded six-page discovery',limitations:['Local cut-offs, application status, national co-funding and eligibility need explicit evidence-bound review.','Directory membership and page access never prove an open grant.','HTTP links are attempted over HTTPS; unavailable secure sites remain gaps.',centre.limitation].filter(Boolean)});state.done.push(key);write(checkpoint,state);console.log('ESA BIC '+centre.name+': '+pages.length+' pages, '+errors.length+' errors');}
 const f=path.join(runRoot,'esa/sources.json'),existing=fs.existsSync(f)?json(f):{rows:[],reports:[]};
 existing.rows=existing.rows.filter(r=>r.group!=='Business-Incubation-Centres').concat(state.rows);existing.reports=existing.reports.filter(r=>r.group!=='Business-Incubation-Centres').concat(state.reports);write(f,existing);write(path.join(dir,'manifest.json'),state);return {centres:state.centres.length,reports:state.reports.length,pages:state.rows.length};
}
module.exports={centres,eligible,run};if(require.main===module)run(process.argv[2]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
