var c=require('./core');
var fs=require('fs');
var t=fs.readFileSync('题库.json','utf8');
var b=c.parseJSON(t);
var newQuestions=[];
b.questions.forEach(function(q){
  q.enabled = q.enabled !== false;
  if (!q.hasOwnProperty('test')) q.test = false;
  if (!q.hasOwnProperty('_players')) q._players = 10;
  var ordered={};
  var keys=['id','type','enabled','text','desc','_players','options','minSel','maxSel','minFill','maxFill','test','formula'];
  keys.forEach(function(k){if(k in q)ordered[k]=q[k];});
  for(var k in q){if(!(k in ordered))ordered[k]=q[k];}
  newQuestions.push(ordered);
});
b.questions=newQuestions;
var raw=JSON.stringify(b, null, 2);
fs.writeFileSync('题库.json', raw, 'utf8');
console.log('Done,', b.questions.length, 'questions');
