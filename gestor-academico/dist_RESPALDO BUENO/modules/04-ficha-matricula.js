// ============================================================
// MÓDULO FICHA DE MATRÍCULA COMPLETA — funciones
// ============================================================
var _fm_foto = null;

function abrirFichaModal(id){
  var modal = document.getElementById('fichaModal');
  document.getElementById('fm_estId').value = id!=null ? id : '';
  var rect = document.getElementById('fm_firmaRect');
  if(rect) rect.value = db.rectora||'';
  document.getElementById('fm_fechaMatricula').value = new Date().toISOString().slice(0,10);
  _fm_foto = null;
  document.getElementById('fm_fotoPreview').style.display='none';
  document.getElementById('fm_fotoPreview').src='';
  // Clear all text fields
  ['nombres','apellidos','numDoc','fechaNac','lugarNac','eps','municipio','vereda','direccion','pueblo','ruv','instAnterior','padre','madre','acudiente','numDocAcud','telAcud','telAlt','email','ocupacion','firmaEst','firmaAcud','obs'].forEach(function(k){
    var el=document.getElementById('fm_'+k); if(el) el.value='';
  });
  ['tipoDoc','genero','grupoSang','estrato','condicion','etnia','victima','desplazado','estado','parentesco','docAcud','nivelEd'].forEach(function(k){
    var el=document.getElementById('fm_'+k); if(el) el.selectedIndex=0;
  });
  _fm_docs=[];fmRenderDocs();
  // Load existing ficha if editing
  if(id!=null){
    var est = db.ests.find(function(x){return x.id===id;});
    if(est && est.ficha){
      var f=est.ficha;
      ['nombres','apellidos','tipoDoc','numDoc','genero','fechaNac','lugarNac','grupoSang','eps','estrato','condicion','municipio','vereda','direccion','etnia','pueblo','victima','desplazado','ruv','estado','instAnterior','fechaMatricula','padre','madre','acudiente','parentesco','docAcud','numDocAcud','telAcud','telAlt','email','ocupacion','nivelEd','firmaEst','firmaAcud','firmaRect','obs'].forEach(function(k){
        var el=document.getElementById('fm_'+k);
        if(el && f[k]!==undefined) el.value=f[k];
      });
      if(f.foto){_fm_foto=f.foto;var p=document.getElementById('fm_fotoPreview');p.src=f.foto;p.style.display='block';}
      _fm_docs=f.docs||[];
    } else { _fm_docs=[]; }
    fmRenderDocs();
  }
  modal.classList.add('open');
}

function cerrarFichaModal(){
  document.getElementById('fichaModal').classList.remove('open');
}

function fmCargarFoto(ev){
  var file=ev.target.files[0]; if(!file) return;
  var r=new FileReader();
  r.onload=function(e){
    var img=new Image();
    img.onload=function(){
      var canvas=document.createElement('canvas');
      var max=200,w=img.width,h=img.height;
      if(w>max||h>max){if(w>h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;}}
      canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      _fm_foto=canvas.toDataURL('image/jpeg',0.75);
      var p=document.getElementById('fm_fotoPreview');p.src=_fm_foto;p.style.display='block';
    };
    img.src=e.target.result;
  };
  r.readAsDataURL(file);
}

function fmQuitarFoto(){
  _fm_foto=null;
  var p=document.getElementById('fm_fotoPreview');p.src='';p.style.display='none';
  document.getElementById('fm_fotoInput').value='';
}

function guardarFichaMatricula(){
  var idRaw=document.getElementById('fm_estId').value;
  var nombres=document.getElementById('fm_nombres').value.trim();
  var apellidos=document.getElementById('fm_apellidos').value.trim();
  if(!nombres||!apellidos){alert('Ingrese nombres y apellidos del estudiante.');return;}
  var campos=['nombres','apellidos','tipoDoc','numDoc','genero','fechaNac','lugarNac','grupoSang','eps','estrato','condicion','municipio','vereda','direccion','etnia','pueblo','victima','desplazado','ruv','estado','instAnterior','fechaMatricula','padre','madre','acudiente','parentesco','docAcud','numDocAcud','telAcud','telAlt','email','ocupacion','nivelEd','firmaEst','firmaAcud','firmaRect','obs'];
  var ficha={};
  campos.forEach(function(k){var el=document.getElementById('fm_'+k);if(el)ficha[k]=el.value;});
  ficha.foto=_fm_foto;
  ficha.docs=_fm_docs;
  ficha.fechaGuardado=new Date().toISOString();
  if(idRaw){
    updDB(function(d){var idx=d.ests.findIndex(function(x){return x.id==idRaw;});if(idx!==-1)d.ests[idx].ficha=ficha;return d;});
    alert('✅ Ficha de matrícula guardada correctamente.');
  } else {
    var grado=db.grados.length?db.grados[0].n:'';
    var nomComp=(nombres+' '+apellidos).toUpperCase();
    updDB(function(d){d.ests.push({id:Date.now()+Math.random(),n:nomComp,g:grado,nts:{},observaciones:[],ficha:ficha});return d;});
    alert('✅ Estudiante y ficha de matrícula guardados.');
    renderApp();
  }
  cerrarFichaModal();
}

function pdfFichaMatricula(){
  var nombres=document.getElementById('fm_nombres').value.trim();
  var apellidos=document.getElementById('fm_apellidos').value.trim();
  if(!nombres&&!apellidos){alert('Complete los nombres y apellidos antes de imprimir.');return;}
  var doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'letter'});
  var PW=215.9,ML=15,MR=15,MT=12,lw=PW-ML-MR;
  var y=MT;
  function fv(id){var el=document.getElementById('fm_'+id);return el?el.value||'—':'—';}
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
  doc.text('FICHA DE MATRÍCULA '+new Date().getFullYear(),PW/2,y+6,{align:'center'});
  doc.setLineWidth(0.4);doc.line(ML,y+9,PW-MR,y+9);
  y+=13;
  if(_fm_foto&&_fm_foto.startsWith('data:')){try{doc.addImage(_fm_foto,'JPEG',PW-MR-28,MT+2,26,32);}catch(e){}}
  function sec(t){doc.setFillColor(220,233,248);doc.rect(ML,y,lw,6,'F');doc.setFontSize(8.5);doc.setFont(undefined,'bold');doc.setTextColor(0,51,102);doc.text(t,ML+2,y+4.2);y+=8;}
  function row2(l1,v1,l2,v2){
    if(y>240){doc.addPage();y=20;}
    doc.setFontSize(7.8);doc.setFont(undefined,'bold');doc.setTextColor(50,50,50);doc.text(l1+':',ML,y+3.5);
    doc.setFont(undefined,'normal');doc.setTextColor(0,0,0);doc.text(String(v1||'—'),ML+32,y+3.5,{maxWidth:lw/2-34});
    if(l2){doc.setFont(undefined,'bold');doc.setTextColor(50,50,50);doc.text(l2+':',ML+lw/2+2,y+3.5);doc.setFont(undefined,'normal');doc.setTextColor(0,0,0);doc.text(String(v2||'—'),ML+lw/2+34,y+3.5,{maxWidth:lw/2-36});}
    doc.setDrawColor(220,220,220);doc.line(ML,y+6,PW-MR,y+6);y+=7;
  }
  function row1(l,v){
    if(y>240){doc.addPage();y=20;}
    doc.setFontSize(7.8);doc.setFont(undefined,'bold');doc.setTextColor(50,50,50);doc.text(l+':',ML,y+3.5);
    doc.setFont(undefined,'normal');doc.setTextColor(0,0,0);doc.text(String(v||'—'),ML+40,y+3.5,{maxWidth:lw-42});
    doc.setDrawColor(220,220,220);doc.line(ML,y+6,PW-MR,y+6);y+=7;
  }
  sec('DATOS PERSONALES DEL ESTUDIANTE');
  row2('Nombres',fv('nombres'),'Apellidos',fv('apellidos'));
  row2('Tipo documento',fv('tipoDoc'),'No. documento',fv('numDoc'));
  row2('Fecha nacimiento',fv('fechaNac'),'Lugar nacimiento',fv('lugarNac'));
  row2('Género',fv('genero'),'Grupo sanguíneo',fv('grupoSang'));
  row2('EPS',fv('eps'),'Estrato',fv('estrato'));
  row1('Condición especial',fv('condicion'));
  sec('LUGAR DE RESIDENCIA');
  row2('Municipio',fv('municipio'),'Corregimiento / Vereda',fv('vereda'));
  row1('Dirección',fv('direccion'));
  sec('PERTENENCIA ÉTNICA Y VULNERABILIDAD');
  row2('Pertenencia étnica',fv('etnia'),'Pueblo indígena',fv('pueblo'));
  row2('Víctima conflicto armado',fv('victima'),'Desplazamiento',fv('desplazado'));
  if(fv('ruv')!=='—')row1('No. declaración RUV/UARIV',fv('ruv'));
  sec('INFORMACIÓN ACADÉMICA');
  row2('Estado',fv('estado'),'Fecha de matrícula',fv('fechaMatricula'));
  row1('Institución anterior',fv('instAnterior'));
  sec('INFORMACIÓN DEL ACUDIENTE Y PADRES');
  row1('Padre',fv('padre'));row1('Madre',fv('madre'));
  row2('Acudiente',fv('acudiente'),'Parentesco',fv('parentesco'));
  row2('Doc. acudiente',fv('docAcud')+' '+fv('numDocAcud'),'Ocupación',fv('ocupacion'));
  row2('Teléfono',fv('telAcud'),'Tel. alternativo',fv('telAlt'));
  row2('Correo',fv('email'),'Nivel educativo',fv('nivelEd'));
  if(fv('obs')!=='—'){sec('OBSERVACIONES');row1('',fv('obs'));}
  // Signatures
  y+=8;if(y>235){doc.addPage();y=20;}
  var sw=(lw-20)/3;
  [['Firma del Estudiante',fv('firmaEst')],['Firma del Acudiente',fv('firmaAcud')],['Rector(a)',fv('firmaRect')]].forEach(function(s,i){
    var x=ML+i*(sw+10);
    doc.setDrawColor(0,51,102);doc.setLineWidth(0.4);doc.line(x,y+15,x+sw,y+15);
    doc.setFontSize(7.5);doc.setFont(undefined,'bold');doc.setTextColor(0,51,102);
    doc.text(s[0],x+sw/2,y+19,{align:'center'});
    if(s[1]&&s[1]!=='—'){doc.setFont(undefined,'normal');doc.setTextColor(60,60,60);doc.text(s[1],x+sw/2,y+23,{align:'center',maxWidth:sw});}
  });
  // Footer
  var fyPos=doc.internal.pageSize.height-10;
  doc.setDrawColor(0,51,102);doc.setLineWidth(0.5);doc.line(ML,fyPos-4,PW-MR,fyPos-4);
  doc.setFontSize(7);doc.setFont(undefined,'normal');doc.setTextColor(100,100,100);
  doc.text((db.nombre||'INETIS')+' — Generado: '+new Date().toLocaleDateString('es-CO'),PW/2,fyPos,{align:'center'});
  var nomArch='Ficha_'+(apellidos+' '+nombres).replace(/[^a-zA-Z0-9 ]/g,'').trim().replace(/ /g,'_')+'.pdf';
  doc.save(nomArch);
}
