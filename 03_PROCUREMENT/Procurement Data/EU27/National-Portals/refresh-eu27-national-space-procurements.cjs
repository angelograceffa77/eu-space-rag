'use strict';
// Standard refresh now uses the maintained per-country entry points.
const path=require('node:path'),{run,options}=require('../../orchestration/coordinator.cjs'),{registry}=require('../../orchestration/registry.cjs');
async function refresh(argv=process.argv.slice(2)){
 const root=path.resolve(__dirname,'../..');
 if(argv.includes('--help')){console.log('National coordinator: --list --only=national-LU,national-SI --run-dir=DIR --resume --timeout-ms=14400000 --no-consolidate. Outputs are isolated per run. Use collect.cjs directly for legacy source-level smoke checks.');return;}
 if(argv.includes('--list-sources')){console.log(JSON.stringify(require('./sources.cjs').sources,null,2));return;}
 const translated=argv.map(a=>a.startsWith('--output=')?'--run-dir='+a.slice(9):a.startsWith('--to=')?'--as-of='+a.slice(5):a);
 const sourceArg=translated.find(a=>a.startsWith('--sources='));if(sourceArg){translated.splice(translated.indexOf(sourceArg),1);const ids=sourceArg.slice(10);if(ids!=='all'){const known=require('./sources.cjs').sources,wanted=ids.split(',');if(wanted.some(id=>!known.some(s=>s.id===id)))throw Error('Unknown source');translated.push('--only='+[...new Set(known.filter(s=>wanted.includes(s.id)).map(s=>'national-'+s.country))].join(','));console.log('Source selection expanded to full country refresh to preserve specialised country checks.');}}
 const o=options(['--group=national',...translated],root);return run(o);
}
if(require.main===module)refresh().then(s=>{if(s?.status==='partial-failure')process.exitCode=1;}).catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={refresh};
