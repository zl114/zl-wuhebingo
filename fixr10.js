var f=require('fs'),c=require('./core');
var t=f.readFileSync('rS1/round_10/ans10.csv','utf8');
var lines=t.split('\n');
for(var i=0;i<lines.length;i++){
  if(lines[i].indexOf('澄喵')>=0){
    var cols=c.parseCSVLine(lines[i]);
    cols[10]='0';
    lines[i]='';
    for(var j=0;j<cols.length;j++){
      var v=cols[j];
      if(v.indexOf(',')>=0||v.indexOf('"')>=0) v='"'+v.replace(/"/g,'""')+'"';
      lines[i]+=(j>0?',':'')+v;
    }
    console.log('Fixed T6 to 0');
  }
}
f.writeFileSync('rS1/round_10/ans10.csv',lines.join('\n'),'utf8');
