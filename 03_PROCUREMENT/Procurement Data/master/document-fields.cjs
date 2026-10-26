'use strict';
const fs=require('fs'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fieldsFor(record,sources){
  const fields=['title','description'].map(field=>({field,text:record[field],sourceRecordId:record.fieldSources?.[field]}));
  if(record.recordType!=='procurement'||!sources)return fields;
  for(const id of record.sourceRecordIds||[]){const s=sources.get(id);if(!s?.documentOrigin)continue;if(typeof s.originalText!=='string'||!s.documentOrigin.file||sha(fs.readFileSync(s.documentOrigin.file))!==s.documentOrigin.sha256)throw Error('Changed matching document evidence');if(s.originalTextSha256&&sha(s.originalText)!==s.originalTextSha256)throw Error('Changed extracted document text');fields.push({field:'documentText',text:s.originalText,sourceRecordId:s.id,origin:{sourceUrl:s.documentOrigin.url,file:s.documentOrigin.file,sha256:s.documentOrigin.sha256,member:s.documentOrigin.member||null,scope:'Procedure-linked document; individual lot applicability requires review'}});}
  return fields;
}
module.exports={fieldsFor};
