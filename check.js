var fs=require('fs');
var t=fs.readFileSync('E:/wuhebingo/题库.json','utf8');
var i=t.indexOf('"S18p8"');
var block=t.substring(i,i+800);
console.log(block);
