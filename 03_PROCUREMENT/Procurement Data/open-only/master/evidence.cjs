'use strict';
// Receipts are an append-only audit trail; only the latest attempt governs a new decision.
function latestReceipts(rows,key){return [...new Map(rows.map(r=>[r[key],r])).values()];}
module.exports={latestReceipts};
