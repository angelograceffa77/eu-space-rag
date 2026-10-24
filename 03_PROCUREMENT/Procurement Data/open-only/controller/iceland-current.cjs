'use strict';
const url='https://utbodsvefur.is/';
function parse(raw,sourceUrl){
 if(sourceUrl!==url)throw Error('Iceland broad listing scope changed');
 const $=require(process.env.PROCUREMENT_CHEERIO_MODULE||'../../node_modules/cheerio').load(raw),text=e=>$(e).clone().find('br').replaceWith(' ').end().text().replace(/\s+/g,' ').trim(),table=$('table').first(),header=table.find('thead th').map((i,e)=>text(e)).get().join(' ');
 if(header!=='Númer Lýsing Útboðsaðili Tegund Skilafrestur')throw Error('Iceland listing schema changed');
 const count=$('body').text().match(/Fjöldi útboða:\s*(\d+)/);if(!count)throw Error('Iceland reported total missing');
 if($('a[rel=next],.next.page-numbers').length)throw Error('Iceland pagination requires traversal');
 const rows=table.find('tbody tr').map((i,e)=>{const cells=$(e).find('td'),a=cells.eq(1).find('a[href]').first(),sourceUrl=a.attr('href'),title=a.attr('title'),reference=text(cells.eq(0)),deadline=text(cells.eq(4));
 if(cells.length!==5||!title||!reference||!sourceUrl||new URL(sourceUrl).origin!=='https://utbodsvefur.is'||!/^\d{2}\.\d{2}\.\d{4} kl\. \d{2}:\d{2}$/.test(deadline))throw Error('Iceland row identity/deadline schema changed');
 const description=text(cells.eq(1).children('span.hide-lt-lg')),type=text(cells.eq(3));
 return {reference:sourceUrl,noticeReference:reference,title,description,buyer:text(cells.eq(2)),country:'IS',sourceUrl,status:'unverified',stage:/Markaðskönnun|RFI/i.test(type+' '+title)?'market consultation':'unverified procurement stage',cells:[reference,title,description,text(cells.eq(2)),type,deadline],links:[sourceUrl]};
 }).get();
 if(rows.length!==Number(count[1]))throw Error('Iceland inventory count mismatch');
 if(new Set(rows.map(r=>r.reference)).size!==rows.length)throw Error('Iceland duplicate source identities');
 return {rows,reportedTotal:Number(count[1]),nextUrl:null};
}
function jobs(day){return [{id:'national-IS-Utbodsvefur-current',kind:'institution',day,parser:'iceland-current',url,limitations:['Official public inventory without keyword or publication-date filter; totals reconciled.','Listing contains tenders and market consultations; a future listed deadline alone does not establish open bidding.','Buyer-platform documents, restricted invitations and unlisted procurements remain separate coverage gaps.']}];}
module.exports={parse,jobs};
