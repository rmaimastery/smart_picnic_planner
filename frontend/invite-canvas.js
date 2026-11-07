/* Fixed-resolution artwork: the preview and downloaded PNG use this same canvas. */
const PicnicInviteCanvas = (() => {
  function rounded(ctx,x,y,w,h,r,fill){
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}
  }
  function wrap(ctx,text,width){
    const lines=[];let line='';
    for(const word of String(text||'').split(/\s+/).filter(Boolean)){
      if(ctx.measureText(word).width>width){
        if(line){lines.push(line);line='';}
        for(const char of Array.from(word)){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}
      }else if(line&&ctx.measureText(line+' '+word).width>width){lines.push(line);line=word;}
      else line+=(line?' ':'')+word;
    }
    if(line)lines.push(line);return lines;
  }
  function textBlock(ctx,text,{x,y,width,size=30,minSize=size,lineHeight=1.35,maxLines=2,color='#244b36',weight=400}){
    let lines=[];
    for(;size>=minSize;size--){ctx.font=`${weight} ${size}px Manrope, Arial, sans-serif`;lines=wrap(ctx,text,width);if(lines.length<=maxLines)break;}
    size=Math.max(size,minSize);ctx.font=`${weight} ${size}px Manrope, Arial, sans-serif`;
    if(lines.length>maxLines){lines=lines.slice(0,maxLines);let last=lines[maxLines-1];while(last&&ctx.measureText(last+'…').width>width)last=last.slice(0,-1);lines[maxLines-1]=last+'…';}
    ctx.fillStyle=color;ctx.textBaseline='top';
    lines.forEach((line,index)=>ctx.fillText(line,x,y+index*size*lineHeight));
    return lines.length*size*lineHeight;
  }
  function photo(ctx,img,x,y,w,h){
    const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight),sw=w/scale,sh=h/scale;
    ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,x,y,w,h);
  }
  function qr(ctx,url,x,y,size){
    const code=qrcode(0,'M');code.addData(url,'Byte');code.make();
    const modules=code.getModuleCount(),cell=Math.floor(size/(modules+8));
    if(cell<2)throw Error('The review link is too long for a readable QR code.');
    const total=(modules+8)*cell,offset=Math.floor((size-total)/2);
    ctx.fillStyle='#fff';ctx.fillRect(x,y,size,size);ctx.fillStyle='#102b20';
    for(let row=0;row<modules;row++)for(let col=0;col<modules;col++)if(code.isDark(row,col))ctx.fillRect(x+offset+(col+4)*cell,y+offset+(row+4)*cell,cell,cell);
  }
  function draw(canvas,data,{image=null,reviewUrl=null}={}){
    canvas.width=1080;canvas.height=1350;
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Your browser cannot create an invitation image.');
    ctx.fillStyle='#fff8e9';ctx.fillRect(0,0,1080,1350);
    ctx.fillStyle='#edc75a22';for(let i=0;i<1080;i+=64)ctx.fillRect(i,0,32,1350);for(let i=0;i<1350;i+=64)ctx.fillRect(0,i,1080,32);
    rounded(ctx,36,32,1008,1286,30,'#fffdf3');
    ctx.save();rounded(ctx,54,50,972,300,22);ctx.clip();
    ctx.fillStyle='#eef4d5';ctx.fillRect(54,50,972,300);if(image)photo(ctx,image,54,50,972,300);
    const wash=ctx.createLinearGradient(0,160,0,350);wash.addColorStop(0,'#fff8e900');wash.addColorStop(1,'#fffdf3');ctx.fillStyle=wash;ctx.fillRect(54,50,972,300);ctx.restore();
    rounded(ctx,82,80,340,90,18,'#fffdf3ed');
    textBlock(ctx,'BLANKET & BITES',{x:102,y:99,width:300,size:25,maxLines:1,weight:800});
    textBlock(ctx,'LOVE LIFE',{x:103,y:137,width:180,size:17,maxLines:1,color:'#173b65',weight:800});
    textBlock(ctx,'♥',{x:215,y:131,width:40,size:27,maxLines:1,color:'#bd2846',weight:800});
    textBlock(ctx,'GOOD FOOD. FRESH AIR. YOUR PEOPLE.',{x:82,y:323,width:920,size:18,maxLines:1,weight:800,color:'#8b512c'});
    textBlock(ctx,data.title,{x:82,y:370,width:916,size:61,minSize:49,maxLines:2,lineHeight:1.15,weight:800});
    textBlock(ctx,data.message,{x:84,y:525,width:910,size:29,minSize:26,maxLines:3,lineHeight:1.36,color:'#173b65'});
    rounded(ctx,78,677,448,118,18,'#ffedac');rounded(ctx,550,677,452,118,18,'#e6efd4');
    textBlock(ctx,'WHEN',{x:100,y:694,width:400,size:17,maxLines:1,weight:800,color:'#765c24'});
    textBlock(ctx,PicnicInvite.dateLabel(data.date),{x:100,y:725,width:400,size:28,minSize:24,maxLines:2,lineHeight:1.2,weight:700});
    textBlock(ctx,'MEET UP',{x:574,y:694,width:400,size:17,maxLines:1,weight:800,color:'#49623b'});
    textBlock(ctx,PicnicInvite.timeLabel(data.time),{x:574,y:729,width:400,size:31,minSize:26,maxLines:2,lineHeight:1.2,weight:700});
    textBlock(ctx,'A PLACE TO GATHER',{x:84,y:830,width:910,size:18,maxLines:1,weight:800,color:'#8b512c'});
    textBlock(ctx,data.venue,{x:84,y:862,width:910,size:35,minSize:27,maxLines:2,lineHeight:1.2,weight:700});
    textBlock(ctx,'FOOD FOR THE DAY',{x:84,y:965,width:910,size:18,maxLines:1,weight:800,color:'#8b512c'});
    textBlock(ctx,data.food||'Good bites and happy company.',{x:84,y:995,width:910,size:28,minSize:23,maxLines:2,lineHeight:1.25,color:'#173b65'});
    textBlock(ctx,'Bring your people.\nMake a little room for a good day.',{x:84,y:1120,width:reviewUrl?620:910,size:31,minSize:28,maxLines:3,lineHeight:1.3,weight:700});
    if(reviewUrl){textBlock(ctx,'SCAN TO REVIEW',{x:782,y:1065,width:220,size:17,maxLines:1,weight:800});qr(ctx,reviewUrl,782,1094,204);}
    textBlock(ctx,'For nature lovers in the age of AI.',{x:84,y:1281,width:670,size:20,maxLines:1,color:'#526044'});
    return canvas;
  }
  return {wrap,textBlock,qr,draw};
})();
