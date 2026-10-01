#!/usr/bin/env node
'use strict';
require('./collect.cjs').main().catch(error=>{
 console.error(error.message);
 process.exitCode=1;
});
