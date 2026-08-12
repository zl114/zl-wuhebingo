var fs=require('fs');
var core=require('./core');
var t=fs.readFileSync('rS1/round_8/ans8.csv','utf8');
var lines=t.split('\n');
for(var i=0;i<lines.length;i++){
  if(lines[i].indexOf('尧')>=0){
    var cols=core.parseCSVLine(lines[i]);
    cols[4]='H';  // Restore 尧's CASTLE answer
    lines[i]='';
    for(var j=0;j<cols.length;j++){
      var c=cols[j];
      if(c.indexOf(',')>=0||c.indexOf('\"')>=0) c='\"'+c.replace(/\"/g,'\"\"')+'\"';
      lines[i]+=(j>0?',':'')+c;
    }
  }
}
fs.writeFileSync('rS1/round_8/ans8.csv', lines.join('\n'), 'utf8');
console.log('Restored 尧 H at R8');
