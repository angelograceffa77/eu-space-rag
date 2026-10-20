'use strict';
function parse(raw,url){
 const u=new URL(url),$=require(process.env.PROCUREMENT_CHEERIO_MODULE||'../../node_modules/cheerio').load(raw),text=e=>$(e).text().replace(/\s+/g,' ').trim();
 if(u.hostname!=='josephine.proebiz.com'||!/^\/sk\/public-tenders\/all(?:\/\d+)?$/.test(u.pathname)||u.searchParams.get('filter[state]')!=='executed'||u.searchParams.get('filter[nuts]')!=='1'||u.searchParams.get('order')!=='id'||u.searchParams.get('sort')!=='ASC')throw Error('JOSEPHINE current scope differs');
 const select=name=>$('select').filter((i,e)=>$(e).attr('name')===name);
 if(select('filter[state]').val()!=='executed'||select('filter[nuts]').val()!=='1'||!select('filter[state]').find('option[value=executed]').text().includes('Prebiehajúca')||!select('filter[nuts]').find('option[value="1"]').text().includes('Slovenská'))throw Error('JOSEPHINE native scope not confirmed');
 const table=$('table').filter((i,e)=>$(e).find('th').text().includes('Lehota na predkladanie')).first();
 if(!table.length)throw Error('JOSEPHINE listing table absent');
 const rows=table.find('tbody tr').map((i,e)=>{
  const cells=$(e).find('td').map((i,t)=>text(t)).get(),link=$(e).find('a[href]').map((i,a)=>$(a).attr('href')).get().find(h=>/^\/sk\/tender\/\d+\/summary$/.test(h));
  if(cells.length!==8||!/^\d+$/.test(cells[0])||!cells[6].includes('Prebiehajúca')||!link||link.split('/')[3]!==cells[0])throw Error('JOSEPHINE row identity/status changed');
  return {reference:cells[0],cells,sourceUrl:new URL(link,u).href,links:[]};
 }).get();
 if(!rows.length)throw Error('JOSEPHINE unexpectedly empty current inventory');
 const current=Number(u.pathname.match(/\/(\d+)$/)?.[1]||1);
 const next=$('ul.pagination a').filter((i,e)=>text(e)==='Ďalšia');
 let nextUrl=null;const pages=$('ul.pagination a').map((i,a)=>Number(text(a))).get().filter(Number.isFinite);
 if(next.length){if(next.length!==1)throw Error('JOSEPHINE ambiguous next page');const n=new URL(next.attr('href'),u);if(n.origin!==u.origin||n.searchParams.toString()!==u.searchParams.toString())throw Error('JOSEPHINE next-page scope changed');if(n.pathname===u.pathname&&rows.length<20&&Number($('ul.pagination li.active').text().trim())===current&&Math.max(...pages)===current){nextUrl=null;}else{if(n.pathname!=='/sk/public-tenders/all/'+(current+1))throw Error('JOSEPHINE next-page scope changed');nextUrl=n.href;}}
 if(!nextUrl&&pages.some(p=>p>current))throw Error('JOSEPHINE pagination truncated');
 return {rows,nextUrl};
}
module.exports={parse};
