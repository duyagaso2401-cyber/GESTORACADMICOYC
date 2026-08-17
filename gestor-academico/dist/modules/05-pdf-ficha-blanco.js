function pdfFichaBlanco(){
  var doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'letter'});
  var PW=215.9,ML=15,MR=15,lw=PW-ML-MR;
  var y=12;
  // Header
  if(db.logo&&db.logo.startsWith('data:')){try{doc.addImage(db.logo,'JPEG',ML,y,22,22);}catch(e){}}
  doc.setFontSize(10);doc.setFont(undefined,'bold');doc.setTextColor(0,51,102);
  doc.text('INSTITUCIÓN EDUCATIVA',PW/2,y+5,{align:'center'});
  doc.setFontSize(12);doc.text((db.nombre||'INETIS').toUpperCase(),PW/2,y+11,{align:'center'});
  doc.setFontSize(8);doc.setFont(undefined,'normal');doc.setTextColor(80,80,80);
  doc.text('DANE: '+(db.dane||'—')+'   NIT: '+(db.nit||'—'),PW/2,y+16,{align:'center'});
  doc.text((db.municipio||'')+' '+(db.corregimiento||''),PW/2,y+20,{align:'center'});
  doc.setDrawColor(0,51,102);doc.setLineWidth(0.8);doc.line(ML,y+24,PW-MR,y+24);
  y+=27;
  doc.setFontSize(12);doc.setFont(undefined,'bold');doc.setTextColor(0,51,102);
  doc.text('FICHA DE MATRÍCULA '+new Date().getFullYear()+' — FORMATO EN BLANCO',PW/2,y+6,{align:'center'});
  doc.setLineWidth(0.4);doc.line(ML,y+9,PW-MR,y+9);
  y+=13;
  // Photo box
  doc.setDrawColor(0,51,102);doc.setLineWidth(0.5);doc.rect(PW-MR-30,12,28,34);
  doc.setFontSize(7);doc.setTextColor(100,100,100);doc.text('FOTO',PW-MR-16,29,{align:'center'});
  function sec(t){doc.setFillColor(220,233,248);doc.rect(ML,y,lw,6,'F');doc.setFontSize(8.5);doc.setFont(undefined,'bold');doc.setTextColor(0,51,102);doc.text(t,ML+2,y+4.2);y+=8;}
  function campo(label,w,addY){
    addY=addY||7;
    doc.setFontSize(7.5);doc.setFont(undefined,'bold');doc.setTextColor(50,50,50);
    doc.text(label+':',ML,y+3.5);
    doc.setDrawColor(150,150,150);doc.setLineWidth(0.3);doc.line(ML+w,y+5,ML+lw,y+5);
    doc.setDrawColor(220,220,220);doc.line(ML,y+addY,PW-MR,y+addY);y+=addY;
  }
  function campo2(l1,l2){
    if(y>245){doc.addPage();y=20;}
    doc.setFontSize(7.5);doc.setFont(undefined,'bold');doc.setTextColor(50,50,50);
    doc.text(l1+':',ML,y+3.5);doc.setDrawColor(150,150,150);doc.setLineWidth(0.3);doc.line(ML+32,y+5,ML+lw/2-2,y+5);
    doc.text(l2+':',ML+lw/2+2,y+3.5);doc.line(ML+lw/2+34,y+5,PW-MR,y+5);
    doc.setDrawColor(220,220,220);doc.line(ML,y+7,PW-MR,y+7);y+=7;
  }
  sec('DATOS PERSONALES DEL ESTUDIANTE');
  campo2('Nombre(s) completo(s)','Apellidos completos');
  campo2('Tipo de documento','Número de documento');
  campo2('Fecha de nacimiento','Lugar de nacimiento');
  campo2('Género','Grupo sanguíneo');
  campo2('EPS / Seguridad Social','Estrato socioeconómico');
  campo('Condición especial',40);
  sec('LUGAR DE RESIDENCIA');
  campo2('Municipio','Corregimiento / Vereda');
  campo('Dirección',35);
  sec('PERTENENCIA ÉTNICA Y VULNERABILIDAD');
  campo2('Pertenencia étnica','Pueblo indígena (si aplica)');
  campo2('¿Víctima del conflicto armado?','Situación de desplazamiento');
  campo('No. declaración RUV / UARIV (si aplica)',60);
  sec('INFORMACIÓN ACADÉMICA');
  campo2('Estado (Nuevo/Repitente/Trasladado)','Fecha de matrícula');
  campo('Institución de procedencia (si aplica)',52);
  sec('INFORMACIÓN DEL ACUDIENTE Y PADRES');
  campo('Nombre completo del padre',40);
  campo('Nombre completo de la madre',40);
  campo2('Acudiente responsable','Parentesco con el estudiante');
  campo2('Tipo y número de documento del acudiente','Ocupación del acudiente');
  campo2('Teléfono principal','Teléfono alternativo');
  campo2('Correo electrónico','Nivel educativo del acudiente');
  sec('OBSERVACIONES');
  doc.setDrawColor(150,150,150);doc.setLineWidth(0.3);
  for(var i=0;i<3;i++){doc.line(ML,y+6+i*7,PW-MR,y+6+i*7);}
  y+=22;
  // Signatures
  if(y>228){doc.addPage();y=20;}
  y+=6;
  var sw=(lw-20)/3;
  [['Firma del Estudiante',''],['Firma del Acudiente',''],['Rector(a)',(db.rectora||'')]].forEach(function(s,i){
    var x=ML+i*(sw+10);
    doc.setDrawColor(0,51,102);doc.setLineWidth(0.4);doc.line(x,y+15,x+sw,y+15);
    doc.setFontSize(7.5);doc.setFont(undefined,'bold');doc.setTextColor(0,51,102);
    doc.text(s[0],x+sw/2,y+19,{align:'center'});
    if(s[1]){doc.setFont(undefined,'normal');doc.setTextColor(60,60,60);doc.text(s[1],x+sw/2,y+23,{align:'center',maxWidth:sw});}
  });
  // Footer
  var fyPos=doc.internal.pageSize.height-10;
  doc.setDrawColor(0,51,102);doc.setLineWidth(0.5);doc.line(ML,fyPos-4,PW-MR,fyPos-4);
  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(100,100,100);
  doc.text((db.nombre||'INETIS')+' — Ficha en blanco '+new Date().getFullYear(),PW/2,fyPos,{align:'center'});
  doc.save('Ficha_Matricula_EnBlanco_'+new Date().getFullYear()+'.pdf');
}

var _fm_docs = [];

function fmRenderDocs(){
  var wrap=document.getElementById('fm_docsList');if(!wrap)return;
  if(!_fm_docs.length){wrap.innerHTML='<p style="color:#999;font-size:0.8rem;margin:4px 0">No hay documentos adjuntos.</p>';return;}
  wrap.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:0.8rem">'+
    '<thead><tr style="background:#dce9f7"><th style="padding:4px 8px;text-align:left">Documento</th><th style="padding:4px 8px;text-align:right;width:100px">Acciones</th></tr></thead><tbody>'+
    _fm_docs.map(function(d,i){
      return '<tr style="border-bottom:1px solid #eee"><td style="padding:4px 8px">📄 '+d.name+' <span style="color:#999">('+Math.round(d.size/1024)+' KB)</span></td>'+
        '<td style="padding:4px 8px;text-align:right">'+
        '<button class="btn-sm" style="background:#2980b9" onclick="fmDescargarDoc('+i+')">⬇️</button> '+
        '<button class="btn-sm" style="background:#c0392b" onclick="fmEliminarDoc('+i+')">🗑</button>'+
        '</td></tr>';
    }).join('')+'</tbody></table>';
}

function fmAgregarDocs(ev){
  var files=Array.from(ev.target.files);
  var maxSize=1*1024*1024;
  var promises=files.map(function(f){
    return new Promise(function(resolve){
      if(f.size>maxSize){alert('El archivo "'+f.name+'" supera 1MB y no se adjuntará. Reduzca el tamaño.');resolve(null);return;}
      var r=new FileReader();
      r.onload=function(e){resolve({name:f.name,type:f.type,data:e.target.result,size:f.size});};
      r.readAsDataURL(f);
    });
  });
  Promise.all(promises).then(function(results){
    results.forEach(function(d){if(d)_fm_docs.push(d);});
    fmRenderDocs();
    ev.target.value='';
  });
}

function fmEliminarDoc(idx){
  if(!confirm('¿Eliminar este documento?'))return;
  _fm_docs.splice(idx,1);fmRenderDocs();
}

function fmDescargarDoc(idx){
  var d=_fm_docs[idx];if(!d)return;
  var a=document.createElement('a');a.href=d.data;a.download=d.name;a.click();
}

