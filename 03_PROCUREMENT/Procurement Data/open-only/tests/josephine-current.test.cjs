'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{parse}=require('../controller/josephine-current.cjs');
const url='https://josephine.proebiz.com/sk/public-tenders/all?filter%5Bstate%5D=executed&filter%5Bnuts%5D=1&order=id&sort=ASC';
function fixture(next=true){return `<select name="filter[state]"><option selected value="executed">Prebiehajúca</option></select><select name="filter[nuts]"><option selected value="1">SK - Slovenská republika</option></select><table><thead><tr><th>Lehota na predkladanie</th></tr></thead><tbody><tr><td>22</td><td>01/2016</td><td>Title</td><td></td><td>Buyer SK</td><td>100 EUR</td><td>26.10.2016 10:00:00 Prebiehajúca</td><td><a href="/sk/tender/22/summary">Detail</a></td></tr></tbody></table>${next?`<ul class="pagination"><li><a href="${url.replace('/all?','/all/2?').replaceAll('&','&amp;')}">Ďalšia</a></li></ul>`:''}`;}
test('JOSEPHINE retains native ongoing rows without downloading old details',()=>{const d=parse(Buffer.from(fixture()),url);a.equal(d.rows.length,1);a.equal(d.rows[0].reference,'22');a.deepEqual(d.rows[0].links,[]);a.match(d.rows[0].sourceUrl,/tender\/22\/summary$/);a.match(d.rows[0].cells[6],/2016/);a.equal(d.nextUrl,url.replace('/all?','/all/2?'));});
test('JOSEPHINE scope and pagination changes fail closed',()=>{a.throws(()=>parse(fixture(),url.replace('executed','ended')),/scope/);a.throws(()=>parse(fixture().replace('Slovenská','Česká'),url),/scope/);a.throws(()=>parse(fixture().replace('/all/2?','/all/3?'),url),/next-page/);a.throws(()=>parse(fixture().replace('/tender/22/','/tender/23/'),url),/identity/);});
test('JOSEPHINE final page is accepted; missing table is not zero coverage',()=>{a.equal(parse(fixture(false),url).nextUrl,null);a.throws(()=>parse(fixture(false).replace('<table>','<div>').replace('</table>','</div>'),url),/absent/);});
test('JOSEPHINE short last page may expose a next link to itself, but an earlier self-loop is rejected',()=>{
 const last=url.replace('/all?','/all/494?'),html=fixture(false)+`<ul class="pagination"><li class="active"><a href="${last}">494</a></li><li><a href="${last}">Ďalšia</a></li></ul>`;
 a.equal(parse(html,last).nextUrl,null);
 a.throws(()=>parse(html.replace('>494<','>495<'),last),/next-page/);
});
