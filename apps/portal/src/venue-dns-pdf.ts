import {PDFDocument,StandardFonts} from 'pdf-lib';
import type {Copy} from './locale.ts';
import type {VenueDnsAlias} from './remote-types.ts';

export async function makeDnsPdf(records:VenueDnsAlias[],c:Pick<Copy,'venueDnsRecords'|'remoteRecordName'|'remoteRecordValue'>){
 const pdf=await PDFDocument.create(),page=pdf.addPage(),font=await pdf.embedFont(StandardFonts.Courier);
 const width=page.getWidth()-88;
 let y=page.getHeight()-50;
 const draw=(text:string,size:number)=>{
  const columns=Math.floor(width/font.widthOfTextAtSize('0',size));
  for(let start=0;start<text.length;start+=columns){
   page.drawText(text.slice(start,start+columns),{x:44,y,size,font});
   y-=size+6;
  }
 };
 draw(c.venueDnsRecords,18);
 for(const record of records){
  y-=15;
  draw(record.type,13);
  draw(c.remoteRecordName,11);
  draw(record.name,10);
  draw(c.remoteRecordValue,11);
  draw(record.value,10);
 }
 return pdf.save({useObjectStreams:false});
}
