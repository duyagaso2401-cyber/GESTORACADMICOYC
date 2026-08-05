// ── DOCUMENTOS: guardados en servidor (PostgreSQL) ──
function docsGuardar(clave, data){
  return fetch(API_BASE+'/api/inetis/docs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clave,...data})}).then(r=>{if(!r.ok)throw new Error('Error guardando doc');});
}
function docsLeer(clave){
  return fetch(API_BASE+'/api/inetis/docs/'+encodeURIComponent(clave)).then(r=>r.ok?r.json():null);
}
function docsEliminar(clave){
  return fetch(API_BASE+'/api/inetis/docs/'+encodeURIComponent(clave),{method:'DELETE'}).then(r=>{if(!r.ok)throw new Error('Error eliminando doc');});
}
function docsListarPorEstudiante(estId){
  return fetch(API_BASE+'/api/inetis/docs?estId='+encodeURIComponent(String(estId))).then(r=>r.ok?r.json():[]);
}

// ============================================================
// DEFINICIÓN DE TIPOS DE DOCUMENTOS
// ============================================================
const TIPOS_DOCS = {
  estudiante:[
    {id:'ti',        label:'Tarjeta de Identidad / Cédula del Estudiante'},
    {id:'regcivil',  label:'Registro Civil / Acta de Nacimiento'},
    {id:'foto',      label:'Foto 3×4 del Estudiante'},
    {id:'eps',       label:'Carné o Certificado de EPS / Afiliación Salud'},
    {id:'cert_ant',  label:'Certificado del Colegio Anterior (Traslado)'},
    {id:'sisben',    label:'Comprobante de SISBEN'},
    {id:'discap',    label:'Certificado de Discapacidad (si aplica)'},
    {id:'victima',   label:'Declaración de Víctima / Desplazado (si aplica)'},
  ],
  acudiente:[
    {id:'cedula_ac', label:'Cédula de Ciudadanía del Acudiente'},
    {id:'servicio',  label:'Comprobante de Servicios Públicos (Dirección)'},
    {id:'custodia',  label:'Documento de Custodia / Tutela (si aplica)'},
  ]
};

// ============================================================
// MODAL DE DOCUMENTOS
// ============================================================
let _docsEstId = null;

async function abrirDocsModal(estId){
  _docsEstId = String(estId);
  const est = db.ests.find(x=>String(x.id)===_docsEstId);
  document.getElementById('docs_estNombre').textContent = est ? est.n : '(Estudiante)';
  document.getElementById('docsModal').classList.add('open');
  await renderDocsModal();
}

function cerrarDocsModal(){
  document.getElementById('docsModal').classList.remove('open');
  _docsEstId = null;
}

async function renderDocsModal(){
  const bd = document.getElementById('docs_bd');
  if(!bd) return;

  // Cargar todos los documentos del estudiante desde IndexedDB
  const guardados = await docsListarPorEstudiante(_docsEstId);
  const mapaGuardados = {};
  guardados.forEach(d=>{ mapaGuardados[d.tipo]=d; });

  let html = '';

  const renderSeccion = (titulo, tipos, secKey) => {
    html += `<div class="docs-sec">${titulo}</div>`;
    tipos.forEach(t=>{
      const clave = `${_docsEstId}_${t.id}`;
      const guardado = mapaGuardados[t.id];
      const tieneDoc = !!guardado;
      const badge = tieneDoc
        ? `<span class="doc-badge ok">✅ Cargado</span>`
        : `<span class="doc-badge pend">⭕ Pendiente</span>`;
      const info = tieneDoc
        ? `<span style="font-size:0.73rem;color:#555">${guardado.nombre} (${(guardado.tamano/1024).toFixed(1)} KB)</span>`
        : '';
      const btnVer = tieneDoc
        ? `<button class="btn-sm" style="background:#1a5276" onclick="verDoc('${clave}')">👁 Ver</button>
           <button class="btn-sm" style="background:#27ae60" onclick="descargarDoc('${clave}')">⬇️ Descargar</button>
           <button class="btn-sm" style="background:#c0392b" onclick="eliminarDoc('${clave}')">🗑</button>`
        : '';
      html += `
        <div class="doc-row" id="row_${clave}">
          <div class="doc-name">
            ${badge}${t.label}
            <div>${info}</div>
          </div>
          <div class="doc-actions">
            <label class="btn-sm" style="background:#16a085;cursor:pointer;padding:4px 10px;display:inline-block">
              📎 ${tieneDoc ? 'Reemplazar' : 'Cargar PDF'}
              <input type="file" accept=".pdf,image/*" style="display:none" onchange="subirDoc('${clave}','${t.id}','${t.label}',this)">
            </label>
            ${btnVer}
          </div>
        </div>`;
    });
  };

  renderSeccion('👨‍🎓 DOCUMENTOS DEL ESTUDIANTE', TIPOS_DOCS.estudiante, 'est');
  renderSeccion('👪 DOCUMENTOS DEL ACUDIENTE', TIPOS_DOCS.acudiente, 'ac');

  // Resumen
  const total = TIPOS_DOCS.estudiante.length + TIPOS_DOCS.acudiente.length;
  const cargados = guardados.length;
  const pct = Math.round(cargados/total*100);
  html = `<div style="background:#f0f9f6;border:1px solid #b2dfdb;border-radius:7px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:14px">
    <div style="flex:1">
      <b style="color:#0e6655">Completitud de documentos:</b>
      <div class="doc-prog"><div class="doc-prog-bar" style="width:${pct}%"></div></div>
    </div>
    <div style="font-size:1.1rem;font-weight:bold;color:${pct===100?'#27ae60':'#e67e22'}">${cargados}/${total} (${pct}%)</div>
  </div>` + html;

  bd.innerHTML = html;
}

async function subirDoc(clave, tipo, label, input){
  const archivo = input.files[0];
  if(!archivo) return;
  if(archivo.size > 15*1024*1024){ alert('❌ El archivo no debe superar 15 MB.'); return; }

  const reader = new FileReader();
  reader.onload = async e => {
    const base64 = e.target.result;
    await docsGuardar(clave, {
      estId: _docsEstId,
      tipo,
      label,
      nombre: archivo.name,
      mime: archivo.type || 'application/pdf',
      tamano: archivo.size,
      base64,
      fecha: new Date().toISOString()
    });
    await renderDocsModal();
  };
  reader.readAsDataURL(archivo);
}

async function verDoc(clave){
  const d = await docsLeer(clave);
  if(!d){ alert('Documento no encontrado.'); return; }
  const blob = base64ToBlob(d.base64, d.mime);
  const url = URL.createObjectURL(blob);
  window.open(url,'_blank');
}

async function descargarDoc(clave){
  const d = await docsLeer(clave);
  if(!d){ alert('Documento no encontrado.'); return; }
  const blob = base64ToBlob(d.base64, d.mime);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = d.nombre;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },1000);
}

async function eliminarDoc(clave){
  if(!confirm('¿Eliminar este documento? Esta acción no se puede deshacer.')) return;
  await docsEliminar(clave);
  await renderDocsModal();
}

async function descargarTodosLosDocsZip(){
  const guardados = await docsListarPorEstudiante(_docsEstId);
  if(!guardados.length){ alert('No hay documentos cargados para este estudiante.'); return; }
  const est = db.ests.find(x=>String(x.id)===_docsEstId);
  const nombreEst = est ? est.n.replace(/[^a-zA-Z0-9]/g,'_') : 'estudiante';

  // Descargar uno a uno (sin dependencia de JSZip)
  for(const d of guardados){
    const blob = base64ToBlob(d.base64, d.mime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreEst + '_' + d.tipo + '_' + d.nombre;
    document.body.appendChild(a); a.click();
    URL.revokeObjectURL(url); a.remove();
    await new Promise(r=>setTimeout(r,300));
  }
  alert(`✅ Se descargaron ${guardados.length} documento(s) del estudiante.`);
}

function base64ToBlob(b64, mime){
  const bin = atob(b64.split(',')[1] || b64);
  const buf = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
  return new Blob([buf],{type:mime||'application/octet-stream'});
}


// ============================================================
// CARGAR PLANILLA DESDE EXCEL (.xlsx / .csv)
// ============================================================
function cargarPlanillaExcel(inp){
  const f=inp.files[0];if(!f) return;
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(ext==='csv'){cargarPlanillaCSV(inp);return;}
  const _msg=document.getElementById('_xlsxMsg');
  function _showImportMsg(txt,bg,clr){
    if(_msg){_msg.textContent=txt;_msg.style.display='block';_msg.style.background=bg||'#fef9e7';_msg.style.color=clr||'#7d6608';}
    else alert(txt);
  }
  // Esperar librería si aún carga
  if(typeof XLSX==='undefined'){
    let _w=0;const _wait=setInterval(function(){
      _w+=200;
      if(typeof XLSX!=='undefined'){clearInterval(_wait);cargarPlanillaExcel(inp);}
      else if(_w>3000){clearInterval(_wait);_showImportMsg('❌ Librería Excel no disponible. Recargue la página.','#fdecea','#922b21');}
    },200);
    return;
  }
  const carga=db.carga.find(x=>x.id===Number(planCId));
  if(!carga){alert('Seleccione una asignatura primero.');return;}
  const per=Number(planPer);
  const cId=carga.id; // capturar como número para usar dentro del updDB
  const _cfgXl=db.config||{};const _colsXl=_resolverColumnas(_cfgXl);
  // Parsear nota: acepta coma o punto decimal, rango 0–5; vacío → null (no tocar)
  const pv=function(v){
    const s=String(v==null?'':v).replace(/,/,'.').trim();
    if(s===''||s==='-') return null;
    const n=parseFloat(s);
    return isNaN(n)?null:Math.min(5,Math.max(0,n));
  };
  _showImportMsg('⏳ Leyendo archivo "'+f.name+'"...','#fef9e7','#7d6608');
  const processWB=function(ev){
    try{
      const data=ev.target.result;
      // Leer dos veces: raw:true para números exactos, raw:false para textos
      const wb=XLSX.read(data,{type:'array',cellDates:false,cellNF:false,cellText:false});
      if(!wb||!wb.SheetNames||!wb.SheetNames.length){
        _showImportMsg('❌ El archivo no contiene hojas de datos. Verifique que sea un .xlsx válido.','#fdecea','#922b21');
        inp.value='';return;
      }
      const ws=wb.Sheets[wb.SheetNames[0]];
      // Lectura con raw:true (valores numéricos exactos sin formato de texto)
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
      console.log('[XLSX Import] Hoja:',wb.SheetNames[0],' | Filas totales:',rows.length);
      if(!rows.length){
        _showImportMsg('❌ La hoja de cálculo está vacía.','#fdecea','#922b21');
        inp.value='';return;
      }
      // ── Detectar fila de claves (#ID_SISTEMA → keysRow) y fila de encabezados ──
      let hdrRow=-1,keysRow=-1;
      for(let i=0;i<Math.min(rows.length,14);i++){
        const r0=(rows[i]||[]).map(function(c){return String(c==null?'':c).trim();});
        const r0up=r0.map(function(c){return c.toUpperCase();});
        // Nuevo formato: fila de claves con #ID_SISTEMA; legado: #ID
        if(keysRow===-1&&(r0.includes('#ID_SISTEMA')||r0.includes('#ID'))) keysRow=i;
        // Fila encabezado: contiene ID_SISTEMA o NOMBRE
        if(hdrRow===-1&&(r0up.includes('ID_SISTEMA')||r0up.includes('ID')||r0up.some(function(c){return c.includes('NOMBRE');}))) hdrRow=i;
      }
      console.log('[XLSX Import] keysRow:',keysRow,' hdrRow:',hdrRow);
      if(hdrRow===-1&&keysRow===-1){
        _showImportMsg('❌ Formato no reconocido. Descargue la planilla desde "📥 Descargar Excel" y úsela como plantilla.','#fdecea','#922b21');
        inp.value='';return;
      }
      // ── Mapear columnas por claves internas o por nombre de encabezado ──
      // Soporta tanto el nuevo formato (ID_SISTEMA|DOCUMENTO|NOMBRE) como el legado (ID|NOMBRE)
      const colMap={};
      const refRow=keysRow>-1?keysRow:hdrRow;
      (rows[refRow]||[]).forEach(function(k,i){
        const ks=String(k==null?'':k).trim();
        if(!ks) return;
        const ksl=ks.toLowerCase();
        const ksu=ks.toUpperCase().replace(/ *\([^)]*\)/g,'').trim();
        // ── Columna A: ID_SISTEMA (nuevo) o ID (legado) ──
        if(ks==='#ID_SISTEMA'||ks==='#ID'||ksu==='ID_SISTEMA'||ksu==='ID'||ksu==='ID_ESTUDIANTE') colMap['id']=i;
        // ── Columna B: Documento de identidad ──
        else if(ks==='#DOCUMENTO'||ksu==='DOCUMENTO IDENTIDAD'||ksu==='DOCUMENTO'||ksu==='CEDULA'||ksu==='TI') colMap['doc']=i;
        // ── Columna C: Nombre completo ──
        else if(ks==='#NOMBRE'||ksu==='NOMBRE COMPLETO'||ksu.includes('NOMBRE')||ksu.includes('ESTUDIANTE')) colMap['nombre']=i;
        // ── Columnas de solo lectura — ignorar ──
        else if(ks==='#BASE'||ks==='#DEF'||ksu==='NOTA BASE'||ksu==='DEFINITIVA') return;
        // ── Recuperación y nivelación ──
        else if(ksl==='rec'||ksu.startsWith('RECUP')) colMap['rec']=i;
        else if(ksl==='niv'||ksu.startsWith('NIVEL')) colMap['niv']=i;
        else {
          // Matching por clave interna (s, sb, h, ex0…) o por nombre de columna
          _colsXl.forEach(function(col){
            if(ksl===col.key) colMap[col.key]=i;
            else {
              const cn=(col.nom||'').toUpperCase().replace(/ *\([^)]*\)/,'').trim();
              if(cn&&ksu.length>=3&&(ksu===cn||ksu.startsWith(cn.substring(0,Math.min(5,cn.length))))) colMap[col.key]=i;
            }
          });
        }
      });
      console.log('[XLSX Import] colMap:',JSON.stringify(colMap));
      if(!('id' in colMap)&&!('nombre' in colMap)&&!('doc' in colMap)){
        _showImportMsg('❌ No se encontraron columnas de identificación. Use el archivo descargado directamente desde este sistema.','#fdecea','#922b21');
        inp.value='';return;
      }
      const dataStart=(keysRow>-1?keysRow:hdrRow)+1;
      const _skip=['PROMEDIO','TOTAL','DEFINITIVA','NOTA BASE','PUESTO','SITUACION','SITUACIÓN'];
      let importados=0,errores=0,sinNota=0;
      const _errDetalle=[];
      // UPSERT: actualizar si existe, crear si no — usando updDB para persistencia automática
      updDB(function(d){
        for(let i=dataStart;i<rows.length;i++){
          const row=rows[i]||[];
          if(!row.length||!row.some(function(c){return String(c==null?'':c).trim()!=='';})) continue;
          // Leer los tres campos de identificación
          const rawId=('id' in colMap)?String(row[colMap['id']]==null?'':row[colMap['id']]).trim():'';
          const rawDoc=('doc' in colMap)?String(row[colMap['doc']]==null?'':row[colMap['doc']]).trim():'';
          const nombre=('nombre' in colMap)?String(row[colMap['nombre']]==null?'':row[colMap['nombre']]).trim().toUpperCase():'';
          if(!rawId&&!rawDoc&&!nombre) continue;
          if(_skip.some(function(s){return nombre.startsWith(s);})) continue;
          // ── JERARQUÍA de búsqueda: ID_SISTEMA → DOCUMENTO → NOMBRE ──
          let est=null;
          // 1. Primario — ID_SISTEMA exacto (más confiable, sin ambigüedad)
          if(rawId){
            est=d.ests.find(function(e){return String(e.id)===rawId&&e.g===carga.g;});
            if(!est){const rid=Number(rawId);if(!isNaN(rid)&&rid>0) est=d.ests.find(function(e){return Math.abs(Number(e.id)-rid)<0.5&&e.g===carga.g;});}
          }
          // 2. Secundario — Documento de identidad (cédula / TI)
          if(!est&&rawDoc){
            est=d.ests.find(function(e){return e.g===carga.g&&String(e.ti||e.cc||e.doc||'').trim()===rawDoc;});
          }
          // 3. Terciario — Nombre completo (puede haber homónimos)
          if(!est&&nombre){
            est=d.ests.find(function(e){return e.g===carga.g&&e.n.toUpperCase()===nombre;});
            if(!est) est=d.ests.find(function(e){
              return e.g===carga.g&&(
                nombre.length>=10&&e.n.toUpperCase().startsWith(nombre.substring(0,10))||
                nombre.length>=10&&nombre.startsWith(e.n.toUpperCase().substring(0,10))
              );
            });
          }
          if(!est){
            errores++;
            _errDetalle.push('Fila '+(i+1)+': ID='+rawId+' DOC='+rawDoc+' NOMBRE='+nombre+' → No encontrado en grado '+carga.g);
            console.log('[XLSX Import] Fila',i+1,'no encontrada — ID:',rawId,'DOC:',rawDoc,'Nombre:',nombre);
            continue;
          }
          // ── UPSERT de notas: crear estructura si no existe ──
          if(!est.nts) est.nts={};
          if(!est.nts[cId]) est.nts[cId]={};
          if(!est.nts[cId][per]) est.nts[cId][per]={rec:0,niv:0};
          let actualizoCelda=false;
          _colsXl.forEach(function(col){
            if(col.key in colMap){
              const nv=pv(row[colMap[col.key]]);
              if(nv!==null){est.nts[cId][per][col.key]=nv;actualizoCelda=true;}
            }
          });
          if('rec' in colMap){const rv=pv(row[colMap['rec']]);if(rv!==null){est.nts[cId][per].rec=rv;actualizoCelda=true;}}
          if('niv' in colMap){const nv2=pv(row[colMap['niv']]);if(nv2!==null){est.nts[cId][per].niv=nv2;actualizoCelda=true;}}
          if(actualizoCelda) importados++;
          else sinNota++;
        }
        console.log('[XLSX Import] Resultado — importados:',importados,' errores:',errores,' sinNota:',sinNota);
        return d;
      });
      inp.value='';
      let resMsg,resBg,resClr;
      if(importados===0&&errores===0){
        resMsg='⚠️ El archivo no contiene notas diligenciadas o no corresponde a este grado/asignatura. Grado esperado: '+carga.g+' | Asignatura: '+carga.m+' | P'+per+'.';
        resBg='#fff3cd';resClr='#7d6608';
      } else if(importados===0){
        resMsg='⚠️ Se leyó el archivo pero ningún estudiante fue identificado ('+errores+' no encontrados). Verifique que el grado seleccionado ('+carga.g+') coincida con el del archivo.';
        resBg='#fff3cd';resClr='#7d6608';
      } else {
        resMsg='✅ Notas importadas: '+importados+' estudiante(s) actualizados en '+carga.g+' — '+carga.m+' P'+per
          +(errores>0?' | ⚠️ '+errores+' fila(s) no encontrada(s)':'');
        resBg='#eafaf1';resClr='#145a32';
        // Forzar push a la nube para garantizar persistencia
        _pushDB();
      }
      // Mostrar detalle de errores en consola si hubo filas no identificadas
      if(_errDetalle.length) console.warn('[XLSX Import] Filas no encontradas:\n'+_errDetalle.join('\n'));
      _showImportMsg(resMsg+(errores>0?'\n⚠️ Filas no encontradas (ver consola): '+_errDetalle.slice(0,3).join(' | ')+(errores>3?'…':''):''),resBg,resClr);
      renderApp();
    }catch(ex){
      console.error('[XLSX Import] Error:',ex);
      _showImportMsg('❌ Error al procesar el archivo: '+ex.message+'. Asegúrese de usar un archivo .xlsx descargado desde este sistema.','#fdecea','#922b21');
      inp.value='';
    }
  };
  const r=new FileReader();r.onload=processWB;r.onerror=function(){_showImportMsg('❌ No se pudo leer el archivo. Verifique que no esté dañado.','#fdecea','#922b21');inp.value='';};
  r.readAsArrayBuffer(f);
}

// ============================================================
// MÓDULO ASISTENCIA
// ============================================================
let asistFecha=new Date().toISOString().slice(0,10);
let asistHora=new Date().toTimeString().slice(0,5);
let asistGrado='';
let asistCId='';

function htmlAsistencia(){
  var isAdmin=sesion.r==='admin';
  var misCargas=isAdmin?db.carga:db.carga.filter(function(c){return c.d===sesion.u;});
  var gradosDisp=[...new Set(misCargas.map(function(c){return c.g;}))].sort();
  if(!asistGrado&&gradosDisp.length) asistGrado=gradosDisp[0];
  var cargasGrado=misCargas.filter(function(c){return c.g===asistGrado;});
  if(!asistCId&&cargasGrado.length) asistCId=String(cargasGrado[0].id);
  var ests=asistGrado?db.ests.filter(function(e){return e.g===asistGrado;}).sort(function(a,b){return a.n.localeCompare(b.n);}):[];
  var historial=(db.asistencia||[]).filter(function(a){
    return (isAdmin||a.docente===sesion.u)&&(!asistGrado||a.grado===asistGrado)&&(!asistCId||String(a.cargaId)===String(asistCId));
  }).sort(function(a,b){return b.fecha.localeCompare(a.fecha)||b.hora.localeCompare(a.hora);});
  var gradoOpts=gradosDisp.map(function(g){return '<option value="'+g+'"'+(g===asistGrado?' selected':'')+'>'+g+'</option>';}).join('');
  var cargaOpts=cargasGrado.map(function(c){return '<option value="'+c.id+'"'+(String(c.id)===asistCId?' selected':'')+'>'+c.m+' ('+c.a+')</option>';}).join('');
  // Buscar registro existente para esta fecha/cargaId/grado — para pre-cargar estados
  var existingReg=(db.asistencia||[]).find(function(a){
    return a.fecha===asistFecha&&String(a.cargaId)===String(asistCId)&&a.grado===asistGrado;
  });
  var estRows=ests.map(function(e){
    var eid=String(e.id);
    var st='P'; // default Presente
    if(existingReg){
      if((existingReg.ausentes||[]).some(function(x){return String(x)===eid;})) st='A';
      else if((existingReg.justificados||[]).some(function(x){return String(x)===eid;})) st='J';
    }
    return '<tr>'+
      '<td style="text-align:left;font-size:0.82rem;padding:7px">'+e.n+'</td>'+
      '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="P"'+(st==='P'?' checked':'')+'> Presente</label></td>'+
      '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="A"'+(st==='A'?' checked':'')+'>  Ausente</label></td>'+
      '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="J"'+(st==='J'?' checked':'')+'>  Justificado</label></td>'+
    '</tr>';
  }).join('');
  var histRows=historial.slice(0,50).map(function(a){
    var c=db.carga.find(function(x){return x.id===a.cargaId;});
    var tot=db.ests.filter(function(e){return e.g===a.grado;}).length||1;
    var pct=(a.presentes.length/tot*100).toFixed(0);
    var colPct=parseInt(pct)>=90?'#27ae60':parseInt(pct)>=70?'#e67e22':'#c0392b';
    var puedeEditar=isAdmin||(a.docente&&a.docente===sesion.u);
    var perLabel=a.periodo?('P'+a.periodo):'—';
    return '<tr data-periodo="'+(a.periodo||'')+'">'+
      '<td>'+a.fecha+'</td><td>'+a.hora+'</td><td>'+a.grado+'</td>'+
      '<td style="text-align:left">'+(c?c.m:'\u2014')+'</td>'+
      '<td style="text-align:center;font-weight:bold">'+perLabel+'</td>'+
      '<td style="text-align:left;font-size:0.78rem">'+(a.actividad||'\u2014')+'</td>'+
      '<td style="color:#27ae60;font-weight:bold">'+a.presentes.length+'</td>'+
      '<td style="color:#c0392b;font-weight:bold">'+a.ausentes.length+'</td>'+
      '<td style="color:#e67e22;font-weight:bold">'+a.justificados.length+'</td>'+
      '<td><span style="background:'+colPct+';color:#fff;border-radius:4px;padding:2px 6px;font-size:0.75rem">'+pct+'%</span></td>'+
      '<td style="white-space:nowrap">'+
        '<button class="btn-sm" style="background:#1a5276" onclick="verDetalleAsistencia(\''+a.id+'\')" title="Ver detalle">👁</button> '+
        '<button class="btn-sm" style="background:#27ae60" onclick="descargarAsistenciaRegistradaPDF(\''+a.id+'\')" title="Descargar PDF">📄</button>'+
        (puedeEditar?' <button class="btn-sm" style="background:#e67e22" onclick="editarAsistencia(\''+a.id+'\')" title="Editar">✏️</button>':'')+
        (puedeEditar?' <button class="btn-sm" style="background:#c0392b" onclick="eliminarAsistencia(\''+a.id+'\')" title="Eliminar">\u{1F5D1}</button>':'')+
      '</td></tr>';
  }).join('');
  var tabDefs=[{id:'reg',label:'Registrar'},{id:'hist',label:'Historial'},{id:'desc',label:'📥 Planillas'}];
  if(isAdmin) tabDefs.push({id:'rep',label:'Reportes'});
  if(!asistTabActivo) asistTabActivo='reg';
  var tabBtns=tabDefs.map(function(t){return '<button class="tab-btn'+(asistTabActivo===t.id?' active':'')+'" onclick="cambiarTabAsist(\''+t.id+'\')">'+t.label+'</button>';}).join('');
  var html='<h3 class="sec-title">&#x1F4C5; Control de Asistencia</h3>';
  html+='<div class="tab-btns">'+tabBtns+'</div>';
  var dReg=asistTabActivo==='reg'?'':'display:none';
  html+='<div id="asist-reg" style="'+dReg+'"><div class="card"><h4 class="card-title">Registrar Asistencia</h4>';
  html+='<div class="warn-box">&#x1F4CC; Si no tuvo acceso el dia de clase, puede ingresar la asistencia con la fecha y hora reales de esa jornada.</div>';
  html+='<div class="grid4" style="margin-bottom:12px">';
  html+='<div><label class="lbl">Fecha de la clase</label><input type="date" id="asistFechaInp" value="'+asistFecha+'" onchange="asistFecha=this.value"></div>';
  html+='<div><label class="lbl">Hora de inicio</label><input type="time" id="asistHoraInp" value="'+asistHora+'" onchange="asistHora=this.value"></div>';
  html+='<div><label class="lbl">Grado</label><select id="asistGradoSel" onchange="asistGrado=this.value;asistCId=\'\';actualizarAsignaturasReg(this.value)">'+gradoOpts+'</select></div>';
  html+='<div><label class="lbl">Asignatura</label><select id="asistCIdSel" onchange="asistCId=this.value;actualizarEstadosAsist()">'+cargaOpts+'</select></div>';
  html+='</div><div class="grid2" style="margin-bottom:12px">';
  html+='<div><label class="lbl">Período académico</label><select id="asistPeriodoSel" onchange="actualizarEstadosAsist()"><option value="1">Período 1</option><option value="2">Período 2</option><option value="3">Período 3</option><option value="4">Período 4</option></select></div>';
  html+='<div style="display:flex;align-items:end"><div class="info-box" style="margin:0;font-size:0.8rem">El período se puede seleccionar independientemente de la fecha.</div></div>';
  html+='</div><div style="margin-bottom:12px"><label class="lbl">Actividad realizada</label>';
  html+='<textarea id="asistActividad" rows="2" placeholder="Ej: Evaluacion escrita, taller, exposicion...">'+(existingReg&&existingReg.actividad?existingReg.actividad.replace(/</g,'&lt;'):'')+'</textarea></div>';
  if(existingReg){
    html+='<div class="warn-box" style="background:#fffbe6;border-left-color:#f1c40f;color:#7d6608;margin-bottom:10px">✏️ <b>Editando registro existente</b> del '+existingReg.fecha+'. Al guardar se actualizará este registro con los estados y actividad actuales.</div>';
  }
  if(ests.length){
    html+='<div class="over"><table><thead><tr>'+
      '<th style="text-align:left;min-width:200px">Estudiante</th>'+
      '<th style="background:#27ae60;min-width:100px">&#x2705; Presente</th>'+
      '<th style="background:#c0392b;min-width:100px">&#x274C; Ausente</th>'+
      '<th style="background:#e67e22;min-width:110px">&#x26A0;&#xFE0F; Justificado</th>'+
    '</tr></thead><tbody>'+estRows+'</tbody></table></div>';
    html+='<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn btn-green" onclick="guardarAsistencia()">'+(existingReg?'✏️ ACTUALIZAR ASISTENCIA':'&#x1F4BE; GUARDAR ASISTENCIA')+'</button>'+
      '<button class="btn btn-gray" onclick="marcarTodosPresentes()">&#x2705; Todos Presentes</button>'+
    '</div>';
  } else {
    html+='<p class="empty">Seleccione grado y asignatura para ver los estudiantes.</p>';
  }
  html+='</div></div>';
  var dHist=asistTabActivo==='hist'?'':'display:none';
  html+='<div id="asist-hist" style="'+dHist+'"><div class="card"><h4 class="card-title">Historial de Asistencia</h4>';
  if(historial.length){
    html+='<div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">';
    html+='<label class="lbl" style="margin-right:4px">Filtrar por período:</label><select id="histAsistPer" onchange="_filtrarHistAsist()" style="padding:5px 10px;border-radius:6px;border:1px solid #ccc;font-size:0.82rem"><option value="">Todos</option><option value="1">Período 1</option><option value="2">Período 2</option><option value="3">Período 3</option><option value="4">Período 4</option></select>';
    html+='<button class="btn btn-navy" style="font-size:0.8rem;padding:6px 12px" onclick="descargarHistAsistenciaPDF()">📄 Descargar Historial PDF</button>';
    html+='<button class="btn" style="background:#16a085;color:#fff;font-size:0.8rem;padding:6px 12px" onclick="descargarHistAsistenciaExcel()">📊 Descargar Historial Excel</button>';
    html+='</div>';
    html+='<div class="over"><table id="histAsistTabla"><thead><tr>'+
      '<th>Fecha</th><th>Hora</th><th>Grado</th><th>Asignatura</th><th>Per.</th><th>Actividad</th>'+
      '<th style="background:#27ae60">Pres.</th><th style="background:#c0392b">Aus.</th>'+
      '<th style="background:#e67e22">Just.</th><th>%Asist.</th><th>Acciones</th>'+
    '</tr></thead><tbody>'+histRows+'</tbody></table></div>';
  } else {
    html+='<p class="empty">No hay registros de asistencia aun.</p>';
  }
  html+='</div></div>';
  // Tab descarga disponible para admin y docente
  var dDesc=asistTabActivo==='desc'?'':'display:none';
  var mesActual=new Date().getMonth()+1;
  var mesesOpts=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'].map(function(m,i){return '<option value="'+(i+1)+'"'+(i+1===mesActual?' selected':'')+'>'+m+'</option>';}).join('');
  var frecOpts='<option value="mensual">📅 Mensual (todo el mes)</option><option value="quincenal">📅 Quincenal (15 días)</option><option value="semanal">📅 Semanal (5 días)</option>';
  html+='<div id="asist-desc" style="'+dDesc+'"><div class="card"><h4 class="card-title">📥 Descargar / Cargar Planillas de Asistencia</h4>';
  html+='<div class="warn-box">Descargue la planilla vacía con los días hábiles (L,M,M,J,V) del período seleccionado. Diligénciela con P/A/J y cárguela de vuelta para registrar la asistencia en el sistema.</div>';
  // Fila 1: Grado + Mes + Periodo
  html+='<div class="grid3" style="margin-bottom:8px">';
  html+='<div><label class="lbl">Grado</label><select id="descAsistGrado" onchange="actualizarAsignaturasDesc(this.value)">'+gradoOpts+'</select></div>';
  html+='<div><label class="lbl">Mes</label><select id="descAsistMes">'+mesesOpts+'</select></div>';
  html+='<div><label class="lbl">Período</label><select id="descAsistPer"><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="4">P4</option></select></div>';
  html+='</div>';
  // Fila 2: Frecuencia + Semana/Quincena + Asignatura
  html+='<div class="grid3" style="margin-bottom:14px">';
  html+='<div><label class="lbl">Frecuencia</label><select id="descAsistFrec" onchange="_onFrecChange()">'+frecOpts+'</select></div>';
  html+='<div id="descAsistSubWrap"><label class="lbl" id="descAsistSubLbl">Semana</label>';
  html+='<select id="descAsistSub" style="display:none"><option value="1">Semana 1</option><option value="2">Semana 2</option><option value="3">Semana 3</option><option value="4">Semana 4</option><option value="5">Semana 5</option></select></div>';
  html+='<div><label class="lbl">Asignatura</label><select id="descAsistCId">'+cargaOpts+'</select></div>';
  html+='</div>';
  // Botones de descarga
  html+='<div style="background:#f0f4f8;border-radius:8px;padding:12px;margin-bottom:12px">';
  html+='<p style="font-size:0.82rem;color:#003366;font-weight:bold;margin-bottom:8px">📄 Descargar Planilla Vacía (para diligenciar)</p>';
  html+='<div class="flex-gap">';
  html+='<button class="btn btn-blue" onclick="descargarPlanillaAsistenciaPDF()">📄 Planilla PDF</button>';
  html+='<button class="btn btn-green" onclick="descargarPlanillaAsistenciaExcel()">📊 Planilla Excel</button>';
  html+='</div></div>';
  html+='<div style="background:#f0f8f4;border-radius:8px;padding:12px;margin-bottom:12px">';
  html+='<p style="font-size:0.82rem;color:#003366;font-weight:bold;margin-bottom:8px">📊 Descargar Reporte de Asistencia Registrada</p>';
  html+='<div class="flex-gap">';
  html+='<button class="btn btn-navy" onclick="descargarReporteAsistenciaPDF()">📥 Reporte PDF</button>';
  html+='<button class="btn" style="background:#16a085;color:#fff" onclick="descargarReporteAsistenciaExcel()">📊 Reporte Excel</button>';
  html+='</div></div>';
  html+='<div style="border-top:2px solid #003366;padding-top:14px"><h5 style="color:#003366;margin-bottom:8px">📤 Cargar Planilla Diligenciada → Importar al Sistema</h5>';
  html+='<div class="info-box">Seleccione el archivo Excel diligenciado (generado por este sistema). El sistema leerá las celdas P/A/J y registrará la asistencia automáticamente.</div>';
  html+='<input type="file" id="planillaAsistFile" accept=".xlsx,.xls" style="margin:8px 0 10px;display:block">';
  html+='<button class="btn btn-orange" onclick="cargarPlanillaAsistencia()">📂 Importar Planilla Excel al Sistema</button>';
  html+='</div></div></div>';

  if(isAdmin){
    var dRep=asistTabActivo==='rep'?'':'display:none';
    html+='<div id="asist-rep" style="'+dRep+'"><div class="card"><h4 class="card-title">Reporte de Asistencia por Estudiante</h4>';
    html+='<div class="grid2" style="margin-bottom:12px">';
    html+='<div><label class="lbl">Grado</label><select id="repAsistGrado" onchange="verReporteAsistencia()">'+gradoOpts+'</select></div>';
    html+='<div><label class="lbl">Asignatura</label><select id="repAsistCId" onchange="verReporteAsistencia()">'+cargaOpts+'</select></div>';
    html+='</div><div id="reporteAsistWrap"><p class="empty">Seleccione filtros.</p></div></div></div>';
  }
  // Sección cronograma para admin/rector
  html+=`<div class="card" style="margin-top:16px;border-left:4px solid #1a5276">
    <h4 class="card-title">📅 Cronograma de Ingreso de Notas</h4>
    <p style="font-size:0.85rem;color:#555;margin-bottom:10px">Configure las fechas de apertura y cierre del sistema para ingreso de notas por periodo. Los docentes solo podrán ingresar notas cuando el periodo esté habilitado.</p>
    <button class="btn btn-navy" onclick="pag='cronograma-notas';renderApp()">📅 Ir al Cronograma de Notas</button>
  </div>`;
  return html;
}

let asistTabActivo='reg';

function actualizarAsignaturasDesc(gradoSel){
  var isAdmin=sesion.r==='admin';
  var misCargas=isAdmin?db.carga:db.carga.filter(function(c){return c.d===sesion.u;});
  var cargasFiltradas=misCargas.filter(function(c){return c.g===gradoSel;});
  var opts=cargasFiltradas.map(function(c){return '<option value="'+c.id+'">'+c.m+' ('+c.a+')</option>';}).join('');
  var sel=document.getElementById('descAsistCId');
  if(sel) sel.innerHTML=opts;
  var selRep=document.getElementById('repAsistCId');
  if(selRep) selRep.innerHTML=opts;
}

function actualizarEstadosAsist(){
  // Se llama cuando cambia la asignatura — pre-carga estados desde registro existente
  var existReg=(db.asistencia||[]).find(function(a){
    return a.fecha===asistFecha&&String(a.cargaId)===String(asistCId)&&a.grado===asistGrado;
  });
  var actEl=document.getElementById('asistActividad');
  if(actEl) actEl.value=(existReg&&existReg.actividad)?existReg.actividad:'';
  var ests=db.ests.filter(function(e){return e.g===asistGrado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var tbody=document.querySelector('#asist-reg table tbody');
  if(tbody&&ests.length){
    tbody.innerHTML=ests.map(function(e){
      var eid=String(e.id);
      var st='P';
      if(existReg){
        if((existReg.ausentes||[]).some(function(x){return String(x)===eid;})) st='A';
        else if((existReg.justificados||[]).some(function(x){return String(x)===eid;})) st='J';
      }
      return '<tr>'+
        '<td style="text-align:left;font-size:0.82rem;padding:7px">'+e.n+'</td>'+
        '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="P"'+(st==='P'?' checked':'')+'> Presente</label></td>'+
        '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="A"'+(st==='A'?' checked':'')+'>  Ausente</label></td>'+
        '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="J"'+(st==='J'?' checked':'')+'>  Justificado</label></td>'+
      '</tr>';
    }).join('');
  }
}

function actualizarAsignaturasReg(gradoSel){
  var isAdmin=sesion.r==='admin';
  var misCargas=isAdmin?db.carga:db.carga.filter(function(c){return c.d===sesion.u;});
  var cargasFiltradas=misCargas.filter(function(c){return c.g===gradoSel;});
  if(cargasFiltradas.length) asistCId=String(cargasFiltradas[0].id);
  asistGrado=gradoSel;
  var opts=cargasFiltradas.map(function(c){return '<option value="'+c.id+'"'+(String(c.id)===String(asistCId)?' selected':'')+'>'+c.m+' ('+c.a+')</option>';}).join('');
  var sel=document.getElementById('asistCIdSel');
  if(sel){sel.innerHTML=opts;}
  // Buscar registro existente para pre-cargar estados
  var existReg=(db.asistencia||[]).find(function(a){
    return a.fecha===asistFecha&&String(a.cargaId)===String(asistCId)&&a.grado===gradoSel;
  });
  // Actualizar campo actividad si existe registro previo
  var actEl=document.getElementById('asistActividad');
  if(actEl&&existReg) actEl.value=existReg.actividad||'';
  else if(actEl&&!existReg) actEl.value='';
  // Actualizar lista de estudiantes
  var ests=db.ests.filter(function(e){return e.g===gradoSel;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var tbody=document.querySelector('#asist-reg table tbody');
  if(tbody){
    if(ests.length){
      tbody.innerHTML=ests.map(function(e){
        var eid=String(e.id);
        var st='P';
        if(existReg){
          if((existReg.ausentes||[]).some(function(x){return String(x)===eid;})) st='A';
          else if((existReg.justificados||[]).some(function(x){return String(x)===eid;})) st='J';
        }
        return '<tr>'+
          '<td style="text-align:left;font-size:0.82rem;padding:7px">'+e.n+'</td>'+
          '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="P"'+(st==='P'?' checked':'')+'> Presente</label></td>'+
          '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="A"'+(st==='A'?' checked':'')+'>  Ausente</label></td>'+
          '<td style="text-align:center;padding:4px"><label style="cursor:pointer"><input type="radio" name="as_'+e.id+'" value="J"'+(st==='J'?' checked':'')+'>  Justificado</label></td>'+
        '</tr>';
      }).join('');
    } else {
      tbody.innerHTML='<tr><td colspan="4" class="empty">No hay estudiantes en este grado.</td></tr>';
    }
  }
}

function cambiarTabAsist(tab){
  asistTabActivo=tab;
  var ids={reg:'asist-reg',hist:'asist-hist',rep:'asist-rep',desc:'asist-desc'};
  Object.keys(ids).forEach(function(k){var el=document.getElementById(ids[k]);if(el)el.style.display=k===tab?'':'none';});
  document.querySelectorAll('#contenido .tab-btn').forEach(function(b){
    var lbl=b.textContent||'';
    b.classList.toggle('active',
      (tab==='reg'&&lbl.includes('Registrar'))||(tab==='hist'&&lbl.includes('Historial'))||(tab==='rep'&&lbl.includes('Reporte'))||(tab==='desc'&&lbl.includes('Planillas')));
  });
  if(tab==='rep') verReporteAsistencia();
}

function marcarTodosPresentes(){
  document.querySelectorAll('[name^="as_"]').forEach(function(inp){if(inp.value==='P') inp.checked=true;});
}

function guardarAsistencia(){
  if(!asistGrado||!asistCId){alert('Seleccione grado y asignatura.');return;}
  if(!asistFecha){alert('Ingrese la fecha.');return;}
  var actEl=document.getElementById('asistActividad');
  var actividad=actEl?actEl.value.trim():'';
  var ests=db.ests.filter(function(e){return e.g===asistGrado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var presentes=[],ausentes=[],justificados=[];
  ests.forEach(function(e){
    var sel=document.querySelector('input[name="as_'+e.id+'"]:checked');
    var val=sel?sel.value:'P';
    if(val==='A') ausentes.push(e.id);
    else if(val==='J') justificados.push(e.id);
    else presentes.push(e.id);
  });
  updDB(function(d){
    if(!d.asistencia)d.asistencia=[];
    // Buscar si ya existe registro para esta fecha+cargaId+grado → actualizar en vez de duplicar
    var idx=d.asistencia.findIndex(function(a){
      return a.fecha===asistFecha&&String(a.cargaId)===String(asistCId)&&a.grado===asistGrado;
    });
    var _perEl=document.getElementById('asistPeriodoSel');
    var _periodo=_perEl?_perEl.value:'1';
    var reg={
      id:idx!==-1?d.asistencia[idx].id:('a'+Date.now()),
      fecha:asistFecha,hora:asistHora,grado:asistGrado,
      cargaId:Number(asistCId),docente:sesion.u,actividad:actividad,
      presentes:presentes,ausentes:ausentes,justificados:justificados,
      periodo:_periodo
    };
    if(idx!==-1){d.asistencia[idx]=reg;}
    else{d.asistencia.push(reg);}
    return d;
  });
  // ── NOTIFICACIONES AUTOMÁTICAS DE AUSENCIA A PADRES ──────────────────────
  if(ausentes.length>0){
    var cargaInfo=db.carga.find(function(c){return String(c.id)===String(asistCId);})||{m:'Asignatura',a:'Asignatura'};
    var asignaturaN=cargaInfo.m||cargaInfo.a||'Asignatura';
    ausentes.forEach(function(estId){
      var est=db.ests.find(function(e){return String(e.id)===String(estId);});
      if(!est) return;
      var nomEst=est.n||('Est.'+estId);
      var nomAcud=est.acudiente||'Acudiente';
      var msgNotif='📅 AUSENCIA REGISTRADA – '+nomEst+' estuvo AUSENTE el '+asistFecha+' en '+asignaturaN+' ('+asistGrado+'). Docente: '+sesion.n+'. Institución: '+(db.nombre||'Institución Educativa')+'.';
      // Registrar en el sistema de notificaciones del servidor (visible en tiempo real vía SSE)
      try{
        fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({kind:'ausencia',actor:sesion.n,message:msgNotif,
            meta:{estId:estId,estNombre:nomEst,acudiente:nomAcud,fecha:asistFecha,grado:asistGrado,asignatura:asignaturaN,docente:sesion.n,inst:db.nombre||''}})
        }).catch(function(){});
      }catch(ex){}
    });
    // Notificación visual del navegador (si el usuario la concedió)
    _solicitarYMostrarNotifNavegador(
      '📅 Ausencias registradas',
      ausentes.length+' estudiante(s) ausente(s) en '+asistGrado+' — '+asistFecha+'. Los padres han sido notificados en el sistema.'
    );
  }
  alert((presentes.length+ausentes.length+justificados.length>0?'✅ Asistencia guardada:\n':'✅ Registro actualizado:\n')+presentes.length+' presentes, '+ausentes.length+' ausentes, '+justificados.length+' justificados.'+(ausentes.length>0?'\n🔔 Notificación de ausencia enviada al sistema para '+ausentes.length+' acudiente(s).':''));
  asistTabActivo='hist';renderApp();
}

function eliminarAsistencia(id){
  if(!confirm('¿Eliminar este registro de asistencia? Esta acción no se puede deshacer.')) return;
  updDB(function(d){d.asistencia=(d.asistencia||[]).filter(function(a){return a.id!==id;});return d;});
  renderApp();
}

function editarAsistencia(id){
  var reg=(db.asistencia||[]).find(function(a){return a.id===id;});
  if(!reg) return;
  // Pre-cargar los campos con los valores del registro a editar
  asistFecha=reg.fecha;
  asistHora=reg.hora||asistHora;
  asistGrado=reg.grado;
  asistCId=String(reg.cargaId);
  asistTabActivo='reg';
  renderApp(); // El formulario se pre-llenará con los datos existentes gracias al existingReg lookup
}

function descargarAsistenciaRegistradaPDF(id){
  var reg=(db.asistencia||[]).find(function(a){return a.id===id;});
  if(!reg){alert('Registro no encontrado.');return;}
  var c=db.carga.find(function(x){return x.id===reg.cargaId;})||{m:'—',a:'—'};
  var gn=function(eid){var e=db.ests.find(function(x){return String(x.id)===String(eid);});return e?e.n:String(eid);};
  var inst=_cleanInstName(db.nombre||'Institución Educativa');
  var doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'letter'});
  var PW=215.9,PH=279.4,MX=14,MW=PW-MX*2;
  var y=14;
  // Encabezado: Colombia izquierda, institución derecha
  var _escColAsist=db.escudoColombia||window._ESCUDO_COL_B64||(typeof ESCUDO_COLOMBIA!=='undefined'?ESCUDO_COLOMBIA:null);
  if(_escColAsist){try{doc.addImage(_escColAsist,'JPEG',MX,y,18,18);}catch(e){try{doc.addImage(_escColAsist,'PNG',MX,y,18,18);}catch(e2){}}}
  if(db.logo){try{doc.addImage(db.logo,'PNG',PW-MX-18,y,18,18);}catch(e){}}
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(0,51,102);
  doc.text(inst,PW/2,y+5,{align:'center'});
  doc.setFontSize(10);doc.setFont('helvetica','normal');doc.setTextColor(80,80,80);
  doc.text(db.municipio||'',PW/2,y+11,{align:'center'});
  y+=22;
  doc.setDrawColor(0,51,102);doc.setLineWidth(0.5);doc.line(MX,y,PW-MX,y);y+=6;
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(0,51,102);
  doc.text('REGISTRO DE ASISTENCIA',PW/2,y,{align:'center'});y+=7;
  // Metadata
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(50,50,50);
  var meta=[
    ['Fecha:',reg.fecha,'Hora:',reg.hora||'—'],
    ['Grado:',reg.grado,'Asignatura:',c.m],
    ['Docente:',reg.docente||'—','Año:',db.anio||''],
    ['Actividad:',reg.actividad||'—','',''],
  ];
  meta.forEach(function(row){
    doc.setFont('helvetica','bold');doc.text(row[0],MX,y);doc.setFont('helvetica','normal');doc.text(String(row[1]),MX+22,y);
    if(row[2]){doc.setFont('helvetica','bold');doc.text(row[2],PW/2,y);doc.setFont('helvetica','normal');doc.text(String(row[3]),PW/2+22,y);}
    y+=5;
  });
  y+=2;doc.line(MX,y,PW-MX,y);y+=5;
  // Tabla de estudiantes
  var allEsts=db.ests.filter(function(e){return e.g===reg.grado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var COL=[MX,MX+8,MX+100,MX+128,MX+155]; // #, nombre, P, A, J
  var rH=6;
  // Header
  doc.setFillColor(0,51,102);doc.rect(MX,y,MW,rH,'F');
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(8);
  doc.text('#',COL[0]+1,y+4);
  doc.text('Estudiante',COL[1]+1,y+4);
  doc.text('Presente',COL[2],y+4,{align:'center'});
  doc.text('Ausente',COL[3],y+4,{align:'center'});
  doc.text('Justificado',COL[4],y+4,{align:'center'});
  y+=rH;
  doc.setFontSize(8);
  allEsts.forEach(function(e,i){
    if(y>PH-20){doc.addPage();y=14;}
    var bg=i%2===0?[245,248,255]:[255,255,255];
    doc.setFillColor.apply(doc,bg);doc.rect(MX,y,MW,rH,'F');
    doc.setTextColor(40,40,40);doc.setFont('helvetica','normal');
    var eid=String(e.id);
    var isP=(reg.presentes||[]).some(function(x){return String(x)===eid;});
    var isA=(reg.ausentes||[]).some(function(x){return String(x)===eid;});
    var isJ=(reg.justificados||[]).some(function(x){return String(x)===eid;});
    doc.text(String(i+1),COL[0]+1,y+4);
    doc.text(e.n.length>32?e.n.substring(0,30)+'…':e.n,COL[1]+1,y+4);
    if(isP){doc.setTextColor(30,130,76);doc.setFont('helvetica','bold');doc.text('P',COL[2],y+4,{align:'center'});}
    else if(isA){doc.setTextColor(192,57,43);doc.setFont('helvetica','bold');doc.text('A',COL[3],y+4,{align:'center'});}
    else if(isJ){doc.setTextColor(230,126,34);doc.setFont('helvetica','bold');doc.text('J',COL[4],y+4,{align:'center'});}
    doc.setTextColor(40,40,40);doc.setFont('helvetica','normal');
    y+=rH;
  });
  // Resumen
  y+=3;doc.setDrawColor(0,51,102);doc.line(MX,y,PW-MX,y);y+=5;
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(0,51,102);
  doc.text('RESUMEN: ',MX,y);doc.setFont('helvetica','normal');doc.setTextColor(40,40,40);
  var pct=allEsts.length>0?((reg.presentes||[]).length/allEsts.length*100).toFixed(1):0;
  doc.text('Presentes: '+(reg.presentes||[]).length+'   Ausentes: '+(reg.ausentes||[]).length+'   Justificados: '+(reg.justificados||[]).length+'   % Asistencia: '+pct+'%',MX+22,y);
  y+=8;
  // Firma
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(100,100,100);
  doc.line(MX,y,MX+55,y);doc.line(PW-MX-55,y,PW-MX,y);
  y+=4;
  doc.text('Firma Docente',MX+5,y);doc.text('Firma Coordinador',PW-MX-50,y);
  doc.save('Asistencia_'+reg.grado+'_'+reg.fecha+'.pdf');
}

function verDetalleAsistencia(id){
  var reg=(db.asistencia||[]).find(function(a){return a.id===id;});if(!reg) return;
  var c=db.carga.find(function(x){return x.id===reg.cargaId;});
  var gn=function(eid){var e=db.ests.find(function(x){return x.id===eid;});return e?e.n:String(eid);};
  alert('ASISTENCIA\nFecha: '+reg.fecha+' '+reg.hora+'\nGrado: '+reg.grado+' | Asignatura: '+(c?c.m:'?')+'\nActividad: '+(reg.actividad||'?')+'\n\nPRESENTES ('+reg.presentes.length+'):\n'+(reg.presentes.map(gn).join(', ')||'?')+'\n\nAUSENTES ('+reg.ausentes.length+'):\n'+(reg.ausentes.map(gn).join(', ')||'?')+'\n\nJUSTIFICADOS ('+reg.justificados.length+'):\n'+(reg.justificados.map(gn).join(', ')||'?'));
}

function verReporteAsistencia(){
  var gEl=document.getElementById('repAsistGrado');
  var cEl=document.getElementById('repAsistCId');
  var grado=(gEl?gEl.value:'')||asistGrado;
  var cId=Number((cEl?cEl.value:'')||asistCId);
  var wrap=document.getElementById('reporteAsistWrap');if(!wrap) return;
  var ests=db.ests.filter(function(e){return e.g===grado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var regs=(db.asistencia||[]).filter(function(a){return a.grado===grado&&a.cargaId===cId;});
  if(!ests.length||!regs.length){wrap.innerHTML='<p class="empty">No hay datos.</p>';return;}
  var total=regs.length;
  var c=db.carga.find(function(x){return x.id===cId;});
  var rows=ests.map(function(e){
    var pres=regs.filter(function(r){return r.presentes.includes(e.id);}).length;
    var aus=regs.filter(function(r){return r.ausentes.includes(e.id);}).length;
    var just=regs.filter(function(r){return r.justificados.includes(e.id);}).length;
    var pct=(pres/total*100).toFixed(1);
    var col=parseFloat(pct)>=90?'#27ae60':parseFloat(pct)>=70?'#e67e22':'#c0392b';
    return '<tr><td style="text-align:left">'+e.n+'</td><td style="color:#27ae60;font-weight:bold">'+pres+'</td><td style="color:#c0392b;font-weight:bold">'+aus+'</td><td style="color:#e67e22;font-weight:bold">'+just+'</td><td><span style="background:'+col+';color:#fff;border-radius:4px;padding:2px 8px;font-weight:bold">'+pct+'%</span></td></tr>';
  }).join('');
  wrap.innerHTML='<div class="info-box"><b>Grado: '+grado+'</b> | <b>Asignatura: '+(c?c.m:'?')+'</b> | Clases: '+total+'</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+
      '<button class="btn btn-sm" style="background:#c0392b;font-size:0.78rem;padding:5px 10px" onclick="descargarReporteAsistenciaCompleto(\'pdf\')">📄 PDF</button>'+
      '<button class="btn btn-sm" style="background:#27ae60;font-size:0.78rem;padding:5px 10px" onclick="descargarReporteAsistenciaCompleto(\'word\')">📝 Word</button>'+
      '<button class="btn btn-sm" style="background:#7f8c8d;font-size:0.78rem;padding:5px 10px" onclick="descargarReporteAsistenciaCompleto(\'txt\')">📄 TXT</button>'+
    '</div>'+
    '<div class="over"><table><thead><tr><th style="text-align:left">Estudiante</th><th style="background:#27ae60">Presencias</th><th style="background:#c0392b">Ausencias</th><th style="background:#e67e22">Justificados</th><th>% Asistencia</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

// ============================================================
// REPORTE DETALLADO DE ASISTENCIA CON ALERTAS (≥25% inasistencia)
// ============================================================
function _buildReporteAsistenciaCompleto(grado,cIdV){
  var ests=db.ests.filter(function(e){return e.g===grado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var regs=(db.asistencia||[]).filter(function(a){return a.grado===grado&&a.cargaId===cIdV;});
  var c=db.carga.find(function(x){return x.id===cIdV;});
  if(!ests.length||!regs.length) return null;
  var total=regs.length;
  var alertas=[];
  var datosEsts=ests.map(function(e){
    var pres=regs.filter(function(r){return r.presentes.includes(e.id);}).length;
    var aus=regs.filter(function(r){return r.ausentes.includes(e.id);}).length;
    var just=regs.filter(function(r){return r.justificados.includes(e.id);}).length;
    var inasisPct=((aus+just)/total*100);
    var pctAsis=(pres/total*100);
    var enRiesgo=inasisPct>=25;
    if(enRiesgo) alertas.push({est:e,aus:aus,just:just,pctInasis:inasisPct.toFixed(1),pctAsis:pctAsis.toFixed(1)});
    return {est:e,pres:pres,aus:aus,just:just,pctAsis:pctAsis.toFixed(1),pctInasis:inasisPct.toFixed(1),enRiesgo:enRiesgo};
  });
  return {ests:datosEsts,alertas:alertas,total:total,grado:grado,c:c,regs:regs};
}

function _generarTextoReporteAsistencia(r){
  var inst=_cleanInstName((db.nombre||'Institución Educativa').toUpperCase());
  var txt='REPORTE DETALLADO DE ASISTENCIA Y ALERTAS\n';
  txt+='═══════════════════════════════════════════════════\n';
  txt+='Institución: '+inst+'\n';
  txt+='Grado: '+r.grado+'   Asignatura: '+(r.c?r.c.m:'—')+'   Total clases: '+r.total+'\n';
  txt+='Generado: '+new Date().toLocaleDateString('es-CO')+'\n\n';
  txt+='───────────────────────────────────────────────────\n';
  txt+='RESUMEN POR ESTUDIANTE\n';
  txt+='───────────────────────────────────────────────────\n\n';
  r.ests.forEach(function(d,i){
    var flag=d.enRiesgo?' ⚠️ ALERTA':'';
    txt+=(i+1)+'. '+d.est.n+'\n';
    txt+='   Presencias: '+d.pres+' | Ausencias: '+d.aus+' | Justificados: '+d.just+'\n';
    txt+='   % Asistencia: '+d.pctAsis+'% | % Inasistencia: '+d.pctInasis+'%'+flag+'\n\n';
  });
  txt+='═══════════════════════════════════════════════════\n';
  txt+='ALERTAS — Estudiantes con ≥25% de inasistencia\n';
  txt+='═══════════════════════════════════════════════════\n\n';
  if(!r.alertas.length){
    txt+='No hay estudiantes con inasistencia igual o superior al 25%.\n\n';
  } else {
    r.alertas.forEach(function(a,i){
      txt+='['+(i+1)+'] '+a.est.n+'\n';
      txt+='    Ausencias: '+a.aus+' | Justificados: '+a.just+'\n';
      txt+='    % Inasistencia: '+a.pctInasis+'% | % Asistencia: '+a.pctAsis+'%\n';
      var acud=a.est.acudiente||'—';
      var tel=a.est.telAcud||a.est.tel||'—';
      txt+='    Acudiente: '+acud+' | Tel: '+tel+'\n\n';
      txt+='    PLAN DE ACCIÓN SUGERIDO:\n';
      txt+='    1. Contactar al acudiente vía telefónica o WhatsApp inmediatamente.\n';
      txt+='    2. Citación formal a entrevista con director(a) de grupo.\n';
      txt+='    3. Si las ausencias son injustificadas, iniciar proceso de seguimiento\n';
      txt+='       en el observador del estudiante.\n';
      txt+='    4. Si la inasistencia supera el 25%, reportar a coordinación académica\n';
      txt+='       para activar ruta de atención (Decreto 1290 de 2009).\n';
      txt+='    5. Verificar causas subyacentes (salud, familia, traslado) y remitir\n';
      txt+='       a psicoorientación si es necesario.\n\n';
      txt+='    ───────────────────────────────────────────────\n\n';
    });
  }
  txt+='═══════════════════════════════════════════════════\n';
  txt+='RECOMENDACIONES PARA DOCENTES Y DIRECTIVOS DOCENTES\n';
  txt+='═══════════════════════════════════════════════════\n\n';
  txt+='1. Docente: Realizar seguimiento semanal de asistencia y registrar\n';
  txt+='   observaciones en el observador del estudiante.\n';
  txt+='2. Director(a) de grupo: Coordinar citación de acudientes de estudiantes\n';
  txt+='   con alerta activa.\n';
  txt+='3. Coordinación académica: Llevar registro consolidado de alertas y\n';
  txt+='   verificar acciones correctivas implementadas.\n';
  txt+='4. Rectoría: Informar a la Secretaría de Educación si la inasistencia\n';
  txt+='   persistente supera los umbrales establecidos en la normatividad.\n\n';
  txt+='═══════════════════════════════════════════════════\n';
  txt+='  Generado por GESTOR ACADÉMICO YC\n';
  txt+='═══════════════════════════════════════════════════\n';
  return txt;
}

function descargarReporteAsistenciaCompleto(fmt){
  var grado=document.getElementById('repAsistGrado')?document.getElementById('repAsistGrado').value:(document.getElementById('descAsistGrado')?document.getElementById('descAsistGrado').value:asistGrado);
  var cIdV=document.getElementById('repAsistCId')?Number(document.getElementById('repAsistCId').value):(document.getElementById('descAsistCId')?Number(document.getElementById('descAsistCId').value):Number(asistCId));
  var r=_buildReporteAsistenciaCompleto(grado,cIdV);
  if(!r){alert('No hay datos de asistencia para los filtros seleccionados.');return;}
  var txt=_generarTextoReporteAsistencia(r);
  var fecha=new Date().toISOString().slice(0,10);
  var nomArch='Reporte_Asistencia_Detallado_'+grado.replace(/[^a-zA-Z0-9]/g,'_')+'_'+fecha;
  if(fmt==='txt'){
    var blob=new Blob([txt],{type:'text/plain;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nomArch+'.txt';a.click();URL.revokeObjectURL(a.href);
  } else if(fmt==='word'){
    var html='<html><head><meta charset="utf-8"><style>body{font-family:Calibri,sans-serif;font-size:11pt;line-height:1.5}h2{color:#003366}hr{border:1px solid #003366}h3{color:#c0392b}</style></head><body>';
    html+=txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>').replace(/═/g,'<hr>').replace(/─/g,'<hr style="border:0.5px solid #ccc">');
    html+='</body></html>';
    var blobW=new Blob(['\ufeff'+html],{type:'application/msword'});
    var aW=document.createElement('a');aW.href=URL.createObjectURL(blobW);aW.download=nomArch+'.doc';aW.click();URL.revokeObjectURL(aW.href);
  } else if(fmt==='pdf'){
    if(!window.jspdf||!window.jspdf.jsPDF){alert('Módulo PDF no disponible.');return;}
    var doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'letter'});
    var PW=215.9,PH=279.4,ML=16,MR=16,MT=18,lw=PW-ML-MR;
    var y=MT;
    var inst=_cleanInstName((db.nombre||'Institución Educativa').toUpperCase());
    doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(0,51,102);
    doc.text(inst,PW/2,y,{align:'center'});y+=6;
    doc.setFontSize(10);doc.text('REPORTE DETALLADO DE ASISTENCIA Y ALERTAS',PW/2,y,{align:'center'});y+=5;
    doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(80,80,80);
    doc.text('Grado: '+r.grado+' | Asignatura: '+(r.c?r.c.m:'—')+' | Clases: '+r.total+' | '+new Date().toLocaleDateString('es-CO'),PW/2,y,{align:'center'});y+=5;
    doc.setDrawColor(0,51,102);doc.setLineWidth(0.5);doc.line(ML,y,PW-MR,y);y+=5;
    doc.setFontSize(8.5);doc.setTextColor(50,50,50);
    doc.setFont('helvetica','bold');doc.text('RESUMEN POR ESTUDIANTE',ML,y);y+=5;
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);
    r.ests.forEach(function(d,i){
      if(y>PH-25){doc.addPage();y=MT;}
      var flag=d.enRiesgo?' ⚠ ALERTA':'';
      doc.setTextColor(d.enRiesgo?192:50,d.enRiesgo?57:50,d.enRiesgo?43:50);
      doc.setFont('helvetica','bold');
      doc.text((i+1)+'. '+d.est.n.substring(0,40),ML,y);
      doc.setFont('helvetica','normal');
      doc.text('P:'+d.pres+' A:'+d.aus+' J:'+d.just+' | Asis:'+d.pctAsis+'% Inasis:'+d.pctInasis+'%'+flag,ML+90,y);
      y+=4.5;
    });
    y+=3;doc.setDrawColor(0,51,102);doc.setLineWidth(0.3);doc.line(ML,y,PW-MR,y);y+=5;
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(192,57,43);
    doc.text('ALERTAS — Estudiantes con ≥25% de inasistencia ('+r.alertas.length+')',ML,y);y+=5;
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(50,50,50);
    if(!r.alertas.length){
      doc.text('No hay estudiantes con inasistencia igual o superior al 25%.',ML,y);y+=5;
    } else {
      r.alertas.forEach(function(a,i){
        if(y>PH-30){doc.addPage();y=MT;}
        doc.setFont('helvetica','bold');doc.setTextColor(192,57,43);
        var wrapped=doc.splitTextToSize('['+(i+1)+'] '+a.est.n,lw);
        doc.text(wrapped,ML,y);y+=wrapped.length*4+1;
        doc.setFont('helvetica','normal');doc.setTextColor(50,50,50);
        doc.text('Ausencias: '+a.aus+' | Justificados: '+a.just+' | % Inasistencia: '+a.pctInasis+'%',ML,y);y+=4;
        doc.text('Acudiente: '+(a.est.acudiente||'—')+' | Tel: '+(a.est.telAcud||a.est.tel||'—'),ML,y);y+=4;
        doc.setFont('helvetica','bold');doc.setTextColor(0,51,102);
        doc.text('Plan de acción:',ML,y);y+=4;
        doc.setFont('helvetica','normal');doc.setTextColor(50,50,50);
        var planes=[
          '1. Contactar al acudiente inmediatamente (teléfono/WhatsApp).',
          '2. Citación formal a entrevista con director(a) de grupo.',
          '3. Registrar seguimiento en el observador del estudiante.',
          '4. Reportar a coordinación académica (Decreto 1290 de 2009).',
          '5. Remitir a psicoorientación si hay causas subyacentes.'
        ];
        planes.forEach(function(p){
          if(y>PH-20){doc.addPage();y=MT;}
          var w=doc.splitTextToSize(p,lw-4);
          doc.text(w,ML+2,y);y+=w.length*4+1;
        });
        y+=2;doc.setDrawColor(200,200,200);doc.setLineWidth(0.2);doc.line(ML,y,PW-MR,y);y+=3;
      });
    }
    y+=3;doc.setFont('helvetica','bold');doc.setFontSize(8.5);doc.setTextColor(0,51,102);
    doc.text('RECOMENDACIONES',ML,y);y+=5;
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(50,50,50);
    var recs=[
      '1. Docente: seguimiento semanal y registro en observador.',
      '2. Director(a) de grupo: coordinar citación de acudientes con alerta.',
      '3. Coordinación: registro consolidado y verificación de acciones.',
      '4. Rectoría: informar a Secretaría de Educación si persiste.'
    ];
    recs.forEach(function(rc){
      if(y>PH-15){doc.addPage();y=MT;}
      var w=doc.splitTextToSize(rc,lw);
      doc.text(w,ML,y);y+=w.length*4+1;
    });
    doc.save(nomArch+'.pdf');
  }
}


// ============================================================
// ============================================================
// FUNCIONES DESCARGA ASISTENCIA PDF / EXCEL
// ============================================================

// Calcula días hábiles (lunes-viernes) según frecuencia
// frec: 'mensual' | 'quincenal' | 'semanal'
// sub:  quincenal -> '1'=primera quincena '2'=segunda ; semanal -> '1'-'5' número de semana
function _getWorkDays(anio,mes,frec,sub){
  var LETRA=['D','L','M','M','J','V','S'];
  var allDays=[];
  var d=new Date(anio,mes-1,1);
  while(d.getMonth()===mes-1){
    var dow=d.getDay();
    if(dow!==0&&dow!==6){
      allDays.push({date:d.getDate(),dow:dow,letter:LETRA[dow],iso:anio+'-'+String(mes).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')});
    }
    d.setDate(d.getDate()+1);
  }
  if(!frec||frec==='mensual') return allDays;
  if(frec==='quincenal'){
    var q=parseInt(sub||'1');
    return q===1?allDays.filter(function(x){return x.date<=15;}):allDays.filter(function(x){return x.date>15;});
  }
  if(frec==='semanal'){
    var semN=parseInt(sub||'1')-1; // índice 0-based
    // Agrupar días por semanas ISO (Mon=inicio)
    var semanas=[],cur=[];
    var prevMon=null;
    allDays.forEach(function(x){
      if(x.dow===1&&cur.length>0){semanas.push(cur);cur=[];}
      cur.push(x);
    });
    if(cur.length) semanas.push(cur);
    return semanas[semN]||[];
  }
  return allDays;
}

function _onFrecChange(){
  var frec=document.getElementById('descAsistFrec')?.value||'mensual';
  var sub=document.getElementById('descAsistSub');
  var subLbl=document.getElementById('descAsistSubLbl');
  if(!sub) return;
  if(frec==='mensual'){sub.style.display='none';if(subLbl)subLbl.textContent='—';}
  else if(frec==='quincenal'){
    sub.style.display='';
    if(subLbl)subLbl.textContent='Quincena';
    sub.innerHTML='<option value="1">1ª Quincena (días 1-15)</option><option value="2">2ª Quincena (días 16-fin)</option>';
  } else {
    sub.style.display='';
    if(subLbl)subLbl.textContent='Semana';
    sub.innerHTML='<option value="1">Semana 1</option><option value="2">Semana 2</option><option value="3">Semana 3</option><option value="4">Semana 4</option><option value="5">Semana 5</option>';
  }
}

var _MESES_NOM=['','ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function descargarPlanillaAsistenciaPDF(){
  var grado=document.getElementById('descAsistGrado')?.value||asistGrado;
  var per=document.getElementById('descAsistPer')?.value||'1';
  var mes=Number(document.getElementById('descAsistMes')?.value||(new Date().getMonth()+1));
  var cIdV=Number(document.getElementById('descAsistCId')?.value||asistCId);
  var frec=document.getElementById('descAsistFrec')?.value||'mensual';
  var sub=document.getElementById('descAsistSub')?.value||'1';
  var anio=db.anio||new Date().getFullYear();
  var ests=db.ests.filter(function(e){return e.g===grado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var c=db.carga.find(function(x){return x.id===cIdV;});
  if(!ests.length){alert('No hay estudiantes en el grado seleccionado.');return;}
  var workDays=_getWorkDays(anio,mes,frec,sub);
  if(!workDays.length){alert('No hay días hábiles en el período seleccionado.');return;}
  var{jsPDF}=window.jspdf;
  var doc=new jsPDF('l','mm','a4');
  var W=297,H=210,ML=10,MR=10;
  var TW=W-ML-MR;

  // ── ENCABEZADO AZUL ──
  doc.setFillColor(0,51,102);doc.rect(0,0,W,44,'F');
  doc.setTextColor(255,255,255);

  // ── ESCUDOS ──
  var escLogoAsist=db.logo||(window._currentPlatId?(gestorDB.platforms.find(function(x){return x.id===window._currentPlatId;})||{}).escudo:null)||null;
  var escColAsist=db.escudoColombia||window._ESCUDO_COL_B64||null;
  var escH=34,escW=28;
  // Escudo Colombia (izquierda)
  if(escColAsist){try{doc.addImage(escColAsist,'PNG',ML+1,3,escW,escH);}catch(e){}}
  // Escudo institución (derecha)
  if(escLogoAsist){try{doc.addImage(escLogoAsist,'PNG',W-MR-escW-1,3,escW,escH);}catch(e){}}

  // Texto centrado entre los dos escudos
  var textX1=ML+escW+3,textX2=W-MR-escW-3,textCX=(textX1+textX2)/2,textW=textX2-textX1;

  // REPÚBLICA DE COLOMBIA
  doc.setFontSize(7.5);doc.setFont('helvetica','normal');
  doc.text('REPÚBLICA DE COLOMBIA',textCX,8,{align:'center'});
  // Nombre institución
  var instNom=_cleanInstName((db.nombre||'INSTITUCIÓN EDUCATIVA').toUpperCase());
  var instLines=doc.splitTextToSize(instNom,textW-4);
  doc.setFontSize(instLines.length>1?8.5:11);doc.setFont('helvetica','bold');
  doc.text(instLines,textCX,16,{align:'center'});
  // DANE / NIT
  var daneNitArr=[];
  if(db.dane) daneNitArr.push('Dane: '+db.dane);
  if(db.nit) daneNitArr.push('Nit: '+db.nit);
  doc.setFontSize(7);doc.setFont('helvetica','normal');
  if(daneNitArr.length) doc.text(daneNitArr.join('     '),textCX,26,{align:'center'});
  // Título planilla
  doc.setFontSize(11);doc.setFont('helvetica','bold');
  doc.text('PLANILLA DE CONTROL DE ASISTENCIA',textCX,33,{align:'center'});
  // Subtítulo grado/periodo/año/mes/asignatura
  doc.setTextColor(255,255,0);
  doc.setFontSize(7);doc.setFont('helvetica','bold');
  var subLabel='GRADO: '+grado+' | PERÍODO: '+per+' | AÑO: '+anio+' | MES: '+(_MESES_NOM[mes]||'')+(c?' | ASIGNATURA: '+c.m.toUpperCase()+' | DOCENTE: '+(c.dn||''):'');
  var subLines=doc.splitTextToSize(subLabel,textW-4);
  doc.text(subLines,textCX,40,{align:'center'});

  // ── TABLA ──
  doc.setTextColor(0,0,0);
  var numDays=workDays.length;
  var colN=7;          // N°
  var colEst=50;       // Nombre estudiante
  var colSum=6;        // P A J %
  var colPct=8;        // % más ancho
  var availW=TW-colN-colEst-colSum*3-colPct;
  var colDayW=Math.max(4.8,Math.min(8,availW/numDays));
  var startY=48;

  // Dos filas de encabezado: letras + fechas
  var headRow1=['N°','NOMBRE COMPLETO DEL ESTUDIANTE'].concat(workDays.map(function(d){return d.letter;})).concat(['P','A','J','%']);
  var headRow2=['',''].concat(workDays.map(function(d){return String(d.date);})).concat(['','','','']);

  var body=ests.map(function(e,i){
    return [String(i+1),e.n].concat(workDays.map(function(){return '';})).concat(['','','','']);
  });

  // Estilos columnas día
  var colStyles={0:{cellWidth:colN},1:{cellWidth:colEst,halign:'left'}};
  for(var di=0;di<numDays;di++){colStyles[2+di]={cellWidth:colDayW};}
  colStyles[2+numDays]={cellWidth:colSum};
  colStyles[3+numDays]={cellWidth:colSum};
  colStyles[4+numDays]={cellWidth:colSum};
  colStyles[5+numDays]={cellWidth:colPct};

  doc.autoTable({
    startY:startY,
    head:[headRow1,headRow2],
    body:body,
    styles:{fontSize:6,cellPadding:{top:1.2,bottom:1.2,left:0.8,right:0.8},halign:'center',valign:'middle',lineColor:[180,180,180],lineWidth:0.2,overflow:'linebreak'},
    headStyles:{fillColor:[0,51,102],textColor:255,fontStyle:'bold',fontSize:6,halign:'center'},
    bodyStyles:{minCellHeight:5.5},
    columnStyles:colStyles,
    alternateRowStyles:{fillColor:[242,248,255]},
    margin:{left:ML,right:MR},
    didParseCell:function(dat){
      // Segunda fila de encabezado: azul más claro
      if(dat.section==='head'&&dat.row.index===1){
        dat.cell.styles.fillColor=[26,82,118];
        dat.cell.styles.fontSize=5.8;
      }
      // Columnas de suma con color
      if(dat.section==='head'&&dat.column.index>=2+numDays){
        var sumColors=[[39,174,96],[192,57,43],[230,126,34],[52,73,94]];
        dat.cell.styles.fillColor=sumColors[dat.column.index-(2+numDays)]||[52,73,94];
      }
    }
  });

  // ── LEYENDA + FIRMA ──
  var fy=doc.lastAutoTable.finalY+4;
  if(fy>H-22){doc.addPage();fy=12;}
  doc.setFontSize(6.5);doc.setFont('helvetica','italic');doc.setTextColor(80,80,80);
  doc.text('P = Presente   A = Ausente   J = Justificado   % = Porcentaje de asistencia',ML,fy);
  fy+=7;
  doc.setFont('helvetica','normal');doc.setTextColor(0,0,0);
  doc.setFontSize(7);
  doc.text('Docente: '+(c&&c.dn?c.dn:'________________________________'),ML,fy);
  doc.text('Firma: _______________________',ML+100,fy);
  doc.text('Fecha de elaboración: _______________',ML+185,fy);

  // ── PIE CONTACTO ──
  var pieArr=[];
  if(db.municipio) pieArr.push(db.municipio.toUpperCase());
  if(db.telInst) pieArr.push('Tel: '+db.telInst);
  if(db.emailInst) pieArr.push('Email: '+db.emailInst);
  if(pieArr.length){
    doc.setFontSize(6);doc.setTextColor(120,120,120);
    doc.text(pieArr.join(' \u2014 '),W/2,H-4,{align:'center'});
  }

  var nomMes=(_MESES_NOM[mes]||'mes'+mes);
  var frecSuf=frec==='semanal'?'_sem'+sub:frec==='quincenal'?'_q'+sub:'_mensual';
  doc.save('Planilla_Asistencia_'+grado.replace(/[/ ]/g,'_')+'_P'+per+'_'+nomMes+frecSuf+'_'+anio+'.pdf');
}

function descargarPlanillaAsistenciaExcel(){
  // ── ESTRUCTURA FIJA DEL EXCEL DE ASISTENCIA ──────────────────────────────
  // col 0 (A): N° correlativo
  // col 1 (B): NOMBRE COMPLETO DEL ESTUDIANTE
  // col 2 (C) en adelante: días hábiles del período (encabezado "L 1", "M 2"…)
  // últimas cols: P | A | J | %
  // ─────────────────────────────────────────────────────────────────────────
  var grado=document.getElementById('descAsistGrado')?.value||asistGrado;
  var per=document.getElementById('descAsistPer')?.value||'1';
  var mes=Number(document.getElementById('descAsistMes')?.value||(new Date().getMonth()+1));
  var cIdV=Number(document.getElementById('descAsistCId')?.value||asistCId);
  var frec=document.getElementById('descAsistFrec')?.value||'mensual';
  var sub=document.getElementById('descAsistSub')?.value||'1';
  var anio=db.anio||new Date().getFullYear();
  var ests=db.ests.filter(function(e){return e.g===grado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var c=db.carga.find(function(x){return x.id===cIdV;});
  if(!ests.length){alert('No hay estudiantes en el grado seleccionado.');return;}
  var workDays=_getWorkDays(anio,mes,frec,sub);
  if(!workDays.length){alert('No hay días hábiles en el período seleccionado.');return;}

  var inst=_cleanInstName((db.nombre||'INSTITUCIÓN EDUCATIVA').toUpperCase());
  var daneNit=[(db.dane?'Dane: '+db.dane:''),(db.nit?'Nit: '+db.nit:'')].filter(Boolean).join('   ');
  var frecLbl=frec==='mensual'?'MES: '+(_MESES_NOM[mes]||''):frec==='quincenal'?(_MESES_NOM[mes]||'')+' - '+(sub==='1'?'1ª Quincena (días 1-15)':'2ª Quincena (días 16-fin)'):(_MESES_NOM[mes]||'')+' - Semana '+sub;
  var subtitle='GRADO: '+grado+' | PERÍODO: '+per+' | AÑO: '+anio+' | '+frecLbl+(c?' | ASIGNATURA: '+c.m.toUpperCase()+' | DOCENTE: '+(c.dn||''):'');

  // Encabezado de días: "L 1", "M 2", "M 5" (letra del día + número de fecha)
  var dayHeaders=workDays.map(function(d){return d.letter+' '+d.date;});
  // ESTRUCTURA: [N°, NOMBRE, día1, día2, ..., díaN, P, A, J, %]
  var header=['N°','NOMBRE COMPLETO DEL ESTUDIANTE'].concat(dayHeaders).concat(['P','A','J','%']);
  var rows=[
    ['REPÚBLICA DE COLOMBIA'],
    [inst],
    daneNit?[daneNit]:[],
    [],
    ['PLANILLA DE CONTROL DE ASISTENCIA'],
    [subtitle],
    [],
    header
  ];
  ests.forEach(function(e,i){
    // col0=N°, col1=NOMBRE, col2..N=días vacíos, últimas=resumen vacío
    rows.push([i+1,e.n].concat(workDays.map(function(){return '';})).concat(['','','','']));
  });
  rows.push([]);
  rows.push(['P = Presente   A = Ausente   J = Justificado   % = Porcentaje de asistencia']);
  rows.push([]);
  rows.push(['Docente: '+(c&&c.dn?c.dn:''),'','','','Firma:','','','','Fecha de elaboración:']);

  var ws=XLSX.utils.aoa_to_sheet(rows);
  // Anchos: N°(5), NOMBRE(44), días(5 c/u), P/A/J(5), %(8)
  ws['!cols']=[{wch:5},{wch:44}].concat(workDays.map(function(){return{wch:5};})).concat([{wch:5},{wch:5},{wch:5},{wch:8}]);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Asistencia');
  var nomMes=(_MESES_NOM[mes]||'mes'+mes);
  var frecSuf=frec==='semanal'?'_sem'+sub:frec==='quincenal'?'_q'+sub:'_mensual';
  _xlsxDescargarBlob(wb,'Planilla_Asistencia_'+grado.replace(/[^a-zA-Z0-9]/g,'_')+'_P'+per+'_'+nomMes+frecSuf+'_'+anio+'.xlsx');
}

function descargarReporteAsistenciaPDF(){
  var grado=document.getElementById('descAsistGrado')?document.getElementById('descAsistGrado').value:asistGrado;
  var per=document.getElementById('descAsistPer')?Number(document.getElementById('descAsistPer').value):1;
  var cIdV=document.getElementById('descAsistCId')?Number(document.getElementById('descAsistCId').value):Number(asistCId);
  var ests=db.ests.filter(function(e){return e.g===grado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var regs=(db.asistencia||[]).filter(function(a){return a.grado===grado&&a.cargaId===cIdV;});
  var c=db.carga.find(function(x){return x.id===cIdV;});
  if(!ests.length||!regs.length){alert('No hay datos de asistencia para los filtros seleccionados.');return;}
  var total=regs.length;
  var{jsPDF}=window.jspdf;var doc=new jsPDF('p','mm','a4');
  doc.setFillColor(0,51,102);doc.rect(0,0,210,28,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(13);doc.setFont('helvetica','bold');
  doc.text(_cleanInstName(db.nombre||'INSTITUCIÓN EDUCATIVA'),105,10,{align:'center'});
  doc.setFontSize(10);doc.text('REPORTE DE ASISTENCIA — Grado: '+grado+' | P'+per+(c?' | '+c.m:''),105,17,{align:'center'});
  doc.setFontSize(9);doc.text('Total clases: '+total+' | Generado: '+new Date().toLocaleDateString('es-CO'),105,24,{align:'center'});
  doc.setTextColor(0,0,0);
  var tRows=ests.map(function(e){
    var pres=regs.filter(function(r){return r.presentes.includes(e.id);}).length;
    var aus=regs.filter(function(r){return r.ausentes.includes(e.id);}).length;
    var just=regs.filter(function(r){return r.justificados.includes(e.id);}).length;
    var pct=(pres/total*100).toFixed(1)+'%';
    return [e.n,String(pres),String(aus),String(just),pct];
  });
  doc.autoTable({startY:32,head:[['Estudiante','Presencias','Ausencias','Justificados','% Asistencia']],body:tRows,styles:{fontSize:8},headStyles:{fillColor:[0,51,102],textColor:255},alternateRowStyles:{fillColor:[245,247,250]}});
  doc.save('Reporte_Asistencia_'+grado+'_P'+per+'.pdf');
}

function descargarReporteAsistenciaExcel(){
  var grado=document.getElementById('descAsistGrado')?document.getElementById('descAsistGrado').value:asistGrado;
  var per=document.getElementById('descAsistPer')?Number(document.getElementById('descAsistPer').value):1;
  var cIdV=document.getElementById('descAsistCId')?Number(document.getElementById('descAsistCId').value):Number(asistCId);
  var ests=db.ests.filter(function(e){return e.g===grado;}).sort(function(a,b){return a.n.localeCompare(b.n);});
  var regs=(db.asistencia||[]).filter(function(a){return a.grado===grado&&a.cargaId===cIdV;});
  var c=db.carga.find(function(x){return x.id===cIdV;});
  if(!ests.length||!regs.length){alert('No hay datos de asistencia para los filtros seleccionados.');return;}
  var total=regs.length;
  var rows=ests.map(function(e,i){
    var pres=regs.filter(function(r){return r.presentes.includes(e.id);}).length;
    var aus=regs.filter(function(r){return r.ausentes.includes(e.id);}).length;
    var just=regs.filter(function(r){return r.justificados.includes(e.id);}).length;
    var pct=(pres/total*100).toFixed(1)+'%';
    return [i+1,e.n,e.g,pres,aus,just,pct];
  });
  var ws=XLSX.utils.aoa_to_sheet([
    [_cleanInstName(db.nombre||'INSTITUCIÓN EDUCATIVA')],
    ['REPORTE DE ASISTENCIA — Grado: '+grado+' | P'+per+(c?' | '+c.m:'')],
    ['Total clases: '+total],
    [],
    ['#','Estudiante','Grado','Presencias','Ausencias','Justificados','% Asistencia']
  ].concat(rows));
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Reporte');
  _xlsxDescargarBlob(wb,'Reporte_Asistencia_'+grado.replace(/[^a-zA-Z0-9]/g,'_')+'_P'+per+'.xlsx');
}

// ── HISTORIAL DE ASISTENCIA: DESCARGA PDF Y EXCEL ──
function _filtrarHistAsist(){
  var per=document.getElementById('histAsistPer')?document.getElementById('histAsistPer').value:'';
  var rows=document.querySelectorAll('#histAsistTabla tbody tr');
  rows.forEach(function(r){
    if(!per){r.style.display='';return;}
    r.style.display=(r.getAttribute('data-periodo')===per)?'':'none';
  });
}

function descargarHistAsistenciaPDF(){
  var isAdmin=sesion.r==='admin';
  var historial=(db.asistencia||[]).filter(function(a){
    if(isAdmin) return true;
    return a.docente===sesion.u;
  }).slice().sort(function(a,b){return (b.fecha||'').localeCompare(a.fecha||'');});
  if(!historial.length){alert('No hay registros de asistencia para descargar.');return;}
  var perFilt=document.getElementById('histAsistPer')?document.getElementById('histAsistPer').value:'';
  if(perFilt) historial=historial.filter(function(a){return (a.periodo||'')===perFilt;});
  var inst=_cleanInstName(db.nombre||'Institución Educativa');
  var doc=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  var PW=297,PH=210,MX=12,MW=PW-MX*2;
  var y=14;
  // Encabezado: Colombia izquierda, institución derecha
  var _escColHist=db.escudoColombia||window._ESCUDO_COL_B64||(typeof ESCUDO_COLOMBIA!=='undefined'?ESCUDO_COLOMBIA:null);
  if(_escColHist){try{doc.addImage(_escColHist,'JPEG',MX,y,16,16);}catch(e){try{doc.addImage(_escColHist,'PNG',MX,y,16,16);}catch(e2){}}}
  if(db.logo){try{doc.addImage(db.logo,'PNG',PW-MX-16,y,16,16);}catch(e){}}
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(0,51,102);
  doc.text(inst,PW/2,y+5,{align:'center'});
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(80,80,80);
  doc.text('HISTORIAL DE ASISTENCIA'+(perFilt?' — PERÍODO '+perFilt:''),PW/2,y+11,{align:'center'});
  y+=18;
  doc.setDrawColor(0,51,102);doc.setLineWidth(0.4);doc.line(MX,y,PW-MX,y);y+=5;
  doc.setFontSize(7.5);
  var headers=['Fecha','Hora','Grado','Asignatura','Per.','Actividad','P','A','J','%'];
  var colW=[24,16,20,50,12,55,10,10,10,15];
  var x=MX;
  doc.setFont('helvetica','bold');doc.setFillColor(0,51,102);doc.setTextColor(255,255,255);
  headers.forEach(function(h,i){doc.rect(x,y,colW[i],7,'F');doc.text(h,x+colW[i]/2,y+5,{align:'center'});x+=colW[i];});
  y+=7;
  doc.setTextColor(40,40,40);doc.setFont('helvetica','normal');
  historial.forEach(function(a){
    if(y>PH-15){doc.addPage();y=14;doc.setFont('helvetica','bold');doc.setFillColor(0,51,102);doc.setTextColor(255,255,255);var x2=MX;headers.forEach(function(h,i){doc.rect(x2,y,colW[i],7,'F');doc.text(h,x2+colW[i]/2,y+5,{align:'center'});x2+=colW[i];});y+=7;doc.setTextColor(40,40,40);doc.setFont('helvetica','normal');}
    var c=db.carga.find(function(x){return x.id===a.cargaId;})||{m:'—'};
    var tot=(a.presentes||[]).length+(a.ausentes||[]).length+(a.justificados||[]).length||1;
    var pct=((a.presentes||[]).length/tot*100).toFixed(0)+'%';
    var vals=[a.fecha||'',a.hora||'',a.grado||'',c.m||'',a.periodo?('P'+a.periodo):'—',(a.actividad||'').slice(0,40),String((a.presentes||[]).length),String((a.ausentes||[]).length),String((a.justificados||[]).length),pct];
    x=MX;
    vals.forEach(function(v,i){doc.text(String(v),x+1,y+5);x+=colW[i];});
    y+=6;
  });
  doc.save('Historial_Asistencia'+(perFilt?'_P'+perFilt:'')+'.pdf');
}

function descargarHistAsistenciaExcel(){
  var isAdmin=sesion.r==='admin';
  var historial=(db.asistencia||[]).filter(function(a){
    if(isAdmin) return true;
    return a.docente===sesion.u;
  }).slice().sort(function(a,b){return (b.fecha||'').localeCompare(a.fecha||'');});
  if(!historial.length){alert('No hay registros de asistencia para descargar.');return;}
  var perFilt=document.getElementById('histAsistPer')?document.getElementById('histAsistPer').value:'';
  if(perFilt) historial=historial.filter(function(a){return (a.periodo||'')===perFilt;});
  var rows=historial.map(function(a,i){
    var c=db.carga.find(function(x){return x.id===a.cargaId;})||{m:'—'};
    var tot=(a.presentes||[]).length+(a.ausentes||[]).length+(a.justificados||[]).length||1;
    var pct=((a.presentes||[]).length/tot*100).toFixed(1)+'%';
    return [i+1,a.fecha||'',a.hora||'',a.grado||'',c.m||'',a.periodo||'',a.actividad||'',(a.presentes||[]).length,(a.ausentes||[]).length,(a.justificados||[]).length,pct];
  });
  var ws=XLSX.utils.aoa_to_sheet([
    [_cleanInstName(db.nombre||'INSTITUCIÓN EDUCATIVA')],
    ['HISTORIAL DE ASISTENCIA'+(perFilt?' — PERÍODO '+perFilt:'')],
    ['Generado: '+new Date().toLocaleString()],
    [],
    ['#','Fecha','Hora','Grado','Asignatura','Período','Actividad','Presentes','Ausentes','Justificados','% Asistencia']
  ].concat(rows));
  var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Historial');
  _xlsxDescargarBlob(wb,'Historial_Asistencia'+(perFilt?'_P'+perFilt:'')+'.xlsx');
}

function cargarPlanillaAsistencia(){
  // ── LECTURA ESTRICTA — sincronizada con descargarPlanillaAsistenciaExcel ─
  // Estructura esperada del Excel:
  //   col 0 (A): N° correlativo  →  ignorado
  //   col 1 (B): NOMBRE COMPLETO DEL ESTUDIANTE  →  nameCol = 1 (FIJO)
  //   col 2 (C) en adelante: días hábiles con encabezado "L 1", "M 2"…
  //   últimas cols: P, A, J, %  →  ignoradas (son resumen)
  // ─────────────────────────────────────────────────────────────────────────
  var file=document.getElementById('planillaAsistFile');
  if(!file||!file.files||!file.files[0]){alert('Seleccione un archivo Excel primero.');return;}
  var gradoSel=document.getElementById('descAsistGrado')?.value||asistGrado;
  var cIdV=Number(document.getElementById('descAsistCId')?.value||asistCId);
  if(!gradoSel){alert('Seleccione un grado antes de importar.');return;}
  if(typeof XLSX==='undefined'){alert('Librería Excel no cargada. Recargue la página.');return;}

  var reader=new FileReader();
  reader.onload=function(ev){
    try{
      var data=new Uint8Array(ev.target.result);
      var wb=XLSX.read(data,{type:'array'});
      var ws=wb.Sheets[wb.SheetNames[0]];
      // raw:true (defecto) — lee cell.v directamente; evita undefined en nombres con raw:false
      var rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});

      // ── 1) Detectar AÑO y MES en las primeras 10 filas ─────────────────────
      var anioImport=db.anio||new Date().getFullYear();
      var mesImport=new Date().getMonth()+1;
      var mesesMap={ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,JULIO:7,
                    AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12};
      for(var ri=0;ri<Math.min(rows.length,10);ri++){
        var rowTxt=String(rows[ri].join(' ')).toUpperCase().replace(/\s+/g,' ');
        var mA=rowTxt.match(/A[ÑN]O[:\s]+(\d{4})/);
        if(mA) anioImport=Number(mA[1]);
        var foundMes=false;
        for(var mNom in mesesMap){
          if(rowTxt.includes(mNom)){mesImport=mesesMap[mNom];foundMes=true;break;}
        }
        if(foundMes) break;
      }

      // ── 2) Localizar la fila de encabezado ─────────────────────────────────
      // Es la primera fila que tiene "NOMBRE" en alguna celda
      var hIdx=rows.findIndex(function(r){
        return r.some(function(c){return String(c).toUpperCase().includes('NOMBRE');});
      });
      if(hIdx===-1){
        alert('❌ No se encontró la fila de encabezado con "NOMBRE".\nUse la planilla generada desde el botón "📊 Planilla Excel".');
        return;
      }
      var header=rows[hIdx];

      // ── 3) Detectar columnas de días (a partir de col 2, FIJO) ─────────────
      // nameCol = 1  →  FIJO, siempre col B (NOMBRE COMPLETO)
      // Días empiezan en col 2 (C) en adelante
      // Patrón: "L 1", "M 2", "M-3", "J15", "V 30" — letra + número de 1 a 31
      // Las columnas P, A, J, % del final se ignoran automáticamente
      var NAME_COL=1;
      var DAYS_START=2;
      var daysCols=[];
      for(var ci=DAYS_START;ci<header.length;ci++){
        var hv=String(header[ci]).trim().toUpperCase();
        if(!hv) continue;
        // Solo acepta "LETRA ESPACIO/GUIÓN NÚMERO" — nada más
        var m=hv.match(/^[A-ZÁÉÍÓÚ][\s\-]?(\d{1,2})$/);
        if(!m) continue;
        var diaNum=Number(m[1]);
        if(diaNum<1||diaNum>31) continue;
        var iso=String(anioImport)+'-'+String(mesImport).padStart(2,'0')+'-'+String(diaNum).padStart(2,'0');
        daysCols.push({col:ci,iso:iso,dia:diaNum});
      }
      if(!daysCols.length){
        var muestra=header.slice(DAYS_START,DAYS_START+6).map(function(v){return '"'+String(v)+'"';}).join(', ');
        alert('❌ No se encontraron columnas de días.\n\nEncabezados desde col C: '+muestra+
          '\n\nDescargue una nueva planilla con "📊 Planilla Excel", escriba P/A/J bajo cada día y vuelva a importar.');
        return;
      }

      // ── 4) Leer marcas fila a fila ──────────────────────────────────────────
      var diasMap={};            // iso → {presentes, ausentes, justificados}
      var noEncontrados=[];
      var totalMarcas=0;
      var estudiantesConMarcas=0;
      var estsGrado=db.ests.filter(function(e){return e.g===gradoSel;});

      rows.slice(hIdx+1).forEach(function(row){
        // Leer nombre de col 1 (FIJO); normalizar tabs/espacios
        var nombreEst=String(row[NAME_COL]===undefined||row[NAME_COL]===null?'':row[NAME_COL])
          .replace(/[\t\r\n]+/g,' ').replace(/\s{2,}/g,' ').trim().toUpperCase();
        if(!nombreEst) return;
        // Saltar filas de leyenda / pie de página
        if(/^(P\s*=|DOCENTE|FIRMA|REP[ÚU]BLICA|LEYENDA)/i.test(nombreEst)) return;
        // Saltar filas que son claramente números (resumen)
        if(/^\d+$/.test(nombreEst)) return;

        // Buscar estudiante: 1) exacto, 2) dos primeras palabras, 3) primer apellido
        var norm=nombreEst;
        var est=estsGrado.find(function(e){
          return e.n.replace(/[\t\r\n]+/g,' ').replace(/\s{2,}/g,' ').trim().toUpperCase()===norm;
        });
        if(!est){
          var nParts=norm.split(/\s+/);
          est=estsGrado.find(function(e){
            var ep=e.n.replace(/[\t\r\n]+/g,' ').trim().toUpperCase().split(/\s+/);
            return ep[0]===nParts[0]&&(ep[1]||'')===(nParts[1]||'');
          });
        }
        if(!est){
          var nParts2=norm.split(/\s+/);
          est=estsGrado.find(function(e){
            return e.n.replace(/[\t\r\n]+/g,' ').trim().toUpperCase().split(/\s+/)[0]===nParts2[0];
          });
        }
        if(!est){noEncontrados.push(nombreEst);return;}

        var tuveMarca=false;
        daysCols.forEach(function(dc){
          // Leer celda, convertir a mayúscula, tomar primera letra como marca
          var raw=String(row[dc.col]===undefined||row[dc.col]===null?'':row[dc.col]).trim().toUpperCase();
          var primera=raw.charAt(0);
          var marca='';
          if(primera==='P'&&raw!=='%') marca='P';
          else if(primera==='A') marca='A';
          else if(primera==='J') marca='J';
          if(!marca) return;

          if(!diasMap[dc.iso]) diasMap[dc.iso]={presentes:[],ausentes:[],justificados:[]};
          var dd=diasMap[dc.iso];
          dd.presentes=dd.presentes.filter(function(id){return id!==est.id;});
          dd.ausentes=dd.ausentes.filter(function(id){return id!==est.id;});
          dd.justificados=dd.justificados.filter(function(id){return id!==est.id;});
          if(marca==='P') dd.presentes.push(est.id);
          else if(marca==='A') dd.ausentes.push(est.id);
          else if(marca==='J') dd.justificados.push(est.id);
          totalMarcas++;
          tuveMarca=true;
        });
        if(tuveMarca) estudiantesConMarcas++;
      });

      if(!totalMarcas){
        alert('⚠️ No se encontraron marcas (P/A/J) en la planilla.\n\n'+
          'Días detectados en el encabezado: '+daysCols.length+
          ' (cols '+daysCols[0].col+'–'+daysCols[daysCols.length-1].col+')\n'+
          'Filas de estudiantes revisadas: '+(rows.length-hIdx-1)+'\n\n'+
          'Asegúrese de:\n'+
          '• Escribir P, A o J en cada celda de día (columnas C en adelante)\n'+
          '• No llenar las columnas de resumen (P, A, J, % al final)\n'+
          '• Usar la planilla descargada desde "📊 Planilla Excel"');
        return;
      }

      // ── 5) Persistir en un solo updDB ──────────────────────────────────────
      updDB(function(d){
        if(!d.asistencia) d.asistencia=[];
        Object.keys(diasMap).forEach(function(iso){
          var dd=diasMap[iso];
          var reg=d.asistencia.find(function(a){
            return a.grado===gradoSel&&a.cargaId===cIdV&&a.fecha===iso;
          });
          if(!reg){
            reg={
              id:'a'+Date.now()+'_'+Math.random().toString(36).slice(2)+'_'+iso.replace(/-/g,''),
              fecha:iso,hora:'08:00',grado:gradoSel,cargaId:cIdV,
              docente:sesion.u,actividad:'Importado desde Excel',
              presentes:[],ausentes:[],justificados:[]
            };
            d.asistencia.push(reg);
          }
          // _aplicar: limpia al estudiante de las 3 listas y lo agrega a la correcta.
          // IMPORTANTE: filter() crea un nuevo array — hay que usar el tipo ('P'/'A'/'J')
          // para saber en cuál de los nuevos arrays hacer push, no pasar 'lista' por referencia.
          function _aplicar(cual,estId){
            reg.presentes=reg.presentes.filter(function(x){return x!==estId;});
            reg.ausentes=reg.ausentes.filter(function(x){return x!==estId;});
            reg.justificados=reg.justificados.filter(function(x){return x!==estId;});
            if(cual==='P') reg.presentes.push(estId);
            else if(cual==='A') reg.ausentes.push(estId);
            else if(cual==='J') reg.justificados.push(estId);
          }
          dd.presentes.forEach(function(id){_aplicar('P',id);});
          dd.ausentes.forEach(function(id){_aplicar('A',id);});
          dd.justificados.forEach(function(id){_aplicar('J',id);});
        });
        return d;
      });

      var msg='✅ Importación completada.\n'+
        '• Días registrados: '+Object.keys(diasMap).length+'\n'+
        '• Marcas importadas: '+totalMarcas+'\n'+
        '• Estudiantes con marcas: '+estudiantesConMarcas;
      if(noEncontrados.length){
        msg+='\n\n⚠️ '+noEncontrados.length+' estudiante(s) no encontrados en grado "'+gradoSel+'":\n'+
          noEncontrados.slice(0,6).join('\n')+(noEncontrados.length>6?'\n…y '+(noEncontrados.length-6)+' más':'');
      }
      alert(msg);
      renderApp();
    }catch(err){
      console.error('[Asistencia Import]',err);
      alert('❌ Error al leer el archivo: '+err.message+'\nVerifique que sea un archivo .xlsx válido.');
    }
  };
  reader.readAsArrayBuffer(file.files[0]);
}

// ============================================================
// MÓDULO CENTROS DE INTERÉS
// ============================================================
function htmlCentrosInteres(){
  if(sesion.r!=='admin') return '<div class="card"><p class="empty">Solo el administrador puede gestionar Centros de Interes.</p></div>';
  var centros=db.centrosInteres||[];
  var cardsHtml=centros.map(function(c,i){
    var etapasHtml=c.etapas.map(function(et,ei){
      var bg=ei<c.etapaActual?'#27ae60':ei===c.etapaActual?'#e67e22':'#7f8c8d';
      return '<span class="badge" style="background:'+bg+';margin:2px">'+(ei+1)+'. '+et+'</span>';
    }).join(' ');
    var evidHtml=(c.evidencias||[]).map(function(ev){
      var ico=ev.tipo==='video'?'&#x1F3AC;':ev.tipo==='foto'?'&#x1F4F7;':'&#x1F4C4;';
      return '<a href="'+ev.link+'" target="_blank" style="color:#1a5276;font-size:0.8rem;display:block;margin:2px 0;word-break:break-all">'+ico+' '+ev.titulo+' <span style="color:#999;font-size:0.72rem">('+ev.fecha+')</span></a>';
    }).join('');
    var avBtn=c.etapaActual<c.etapas.length-1?
      ' <button class="btn-sm" style="background:#16a085;margin-left:6px" onclick="avanzarEtapaCI('+i+')">&#x25B6; Avanzar</button>':
      ' <span style="color:#27ae60;font-size:0.8rem;font-weight:bold"> &#x2705; Completado</span>';
    return '<div class="card" style="border-left:4px solid #003366;margin-bottom:14px">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">'+
        '<div><h4 style="color:#003366;margin:0 0 4px">'+c.nombre+'</h4>'+
        '<div style="font-size:0.82rem;color:#555"><b>Responsable:</b> '+c.responsable+'</div>'+
        '<div style="font-size:0.82rem;color:#555"><b>Creacion:</b> '+(c.fechaCreacion||'?')+' &nbsp;|&nbsp; <b>Entrega:</b> '+(c.fechaEntrega||'?')+'</div></div>'+
        '<div style="display:flex;gap:6px">'+
          '<button class="btn-sm" style="background:#e67e22" onclick="editarCI('+i+')">&#x270E; Editar</button>'+
          '<button class="btn-sm" style="background:#c0392b" onclick="eliminarCI('+i+')">&#x1F5D1; Eliminar</button>'+
        '</div></div>'+
      (c.descripcion?'<div style="font-size:0.82rem;color:#666;margin:8px 0;padding:6px;background:#f8f9fa;border-radius:4px">'+c.descripcion+'</div>':'')+
      '<div style="margin:10px 0 6px"><b style="font-size:0.8rem;color:#003366">Etapas:</b> '+etapasHtml+avBtn+'</div>'+
      (evidHtml?'<div style="background:#f0f4f8;border-radius:5px;padding:8px;margin-top:6px"><b style="font-size:0.79rem;color:#003366">&#x1F4CE; Evidencias:</b>'+evidHtml+'</div>':'')+
      '<div style="margin-top:10px;padding:10px;background:#f9f9f9;border-radius:6px">'+
        '<b style="font-size:0.8rem;color:#003366">+ Agregar Evidencia:</b>'+
        '<div class="grid3" style="margin-top:6px;gap:6px">'+
          '<select id="evTipo_'+i+'" style="padding:5px;font-size:0.8rem"><option value="video">&#x1F3AC; Video</option><option value="foto">&#x1F4F7; Fotografia</option><option value="documento">&#x1F4C4; Documento</option></select>'+
          '<input id="evTitulo_'+i+'" type="text" placeholder="Titulo..." style="padding:5px;font-size:0.8rem">'+
          '<input id="evLink_'+i+'" type="url" placeholder="https://..." style="padding:5px;font-size:0.8rem">'+
        '</div>'+
        '<button class="btn btn-teal" style="margin-top:6px;font-size:0.8rem;padding:6px 14px" onclick="agregarEvidenciaCI('+i+')">+ Agregar</button>'+
      '</div></div>';
  }).join('');
  return '<h3 class="sec-title">&#x1F3AF; Centros de Interes Institucional</h3>'+
    '<div class="card"><h4 class="card-title">Crear Nuevo Centro de Interes</h4>'+
    '<div class="grid2" style="margin-bottom:10px">'+
      '<div><label class="lbl">Nombre</label><input id="ciNombre" placeholder="Ej: Centro de Astronomia"></div>'+
      '<div><label class="lbl">Responsable(s)</label><input id="ciResponsable" placeholder="Docente o responsable"></div>'+
    '</div>'+
    '<div class="grid2" style="margin-bottom:10px">'+
      '<div><label class="lbl">Fecha de Creacion</label><input id="ciFechaCreacion" type="date" value="'+new Date().toISOString().slice(0,10)+'"></div>'+
      '<div><label class="lbl">Fecha de Entrega / Cierre</label><input id="ciFechaEntrega" type="date"></div>'+
    '</div>'+
    '<div style="margin-bottom:10px"><label class="lbl">Descripcion / Objetivo</label>'+
      '<textarea id="ciDescripcion" rows="2" placeholder="Descripcion y objetivos..."></textarea></div>'+
    '<div style="margin-bottom:10px"><label class="lbl">Etapas de Ejecucion (una por linea)</label>'+
      '<textarea id="ciEtapas" rows="3" placeholder="Planificacion&#10;Ejecucion&#10;Evaluacion y Cierre"></textarea></div>'+
    '<button class="btn btn-green" onclick="crearCI()">&#x1F4BE; CREAR CENTRO DE INTERES</button></div>'+
    (centros.length?('<h3 class="sec-title">Centros Registrados ('+centros.length+')</h3>'+cardsHtml):
      '<div class="card"><p class="empty">No hay centros de interes registrados aun.</p></div>');
}
function crearCI(){
  var n=(document.getElementById('ciNombre')||{value:''}).value.trim();
  var r=(document.getElementById('ciResponsable')||{value:''}).value.trim();
  if(!n||!r){alert('Complete nombre y responsable.');return;}
  var fc=(document.getElementById('ciFechaCreacion')||{value:''}).value;
  var fe=(document.getElementById('ciFechaEntrega')||{value:''}).value;
  var desc=(document.getElementById('ciDescripcion')||{value:''}).value.trim();
  var etRaw=(document.getElementById('ciEtapas')||{value:''}).value.trim();
  var ets=etRaw.split('\n').map(function(x){return x.trim();}).filter(Boolean);
  if(!ets.length) ets.push('Ejecucion');
  var ci={id:'ci'+Date.now(),nombre:n,responsable:r,fechaCreacion:fc,fechaEntrega:fe,descripcion:desc,etapas:ets,etapaActual:0,evidencias:[],creadoPor:sesion.u};
  updDB(function(d){if(!d.centrosInteres)d.centrosInteres=[];d.centrosInteres.push(ci);return d;});
  alert('Centro de Interes "'+n+'" creado.');renderApp();
}
function eliminarCI(i){
  var ci=(db.centrosInteres||[])[i];if(!ci) return;
  if(!confirm('Eliminar "'+ci.nombre+'" y todas sus evidencias?')) return;
  updDB(function(d){d.centrosInteres=(d.centrosInteres||[]).filter(function(_,idx){return idx!==i;});return d;});
  renderApp();
}
function avanzarEtapaCI(i){
  var ci=(db.centrosInteres||[])[i];if(!ci) return;
  if(ci.etapaActual>=ci.etapas.length-1){alert('Ya esta en la ultima etapa.');return;}
  updDB(function(d){d.centrosInteres[i].etapaActual++;return d;});
  alert('Etapa avanzada a: '+ci.etapas[ci.etapaActual+1]);renderApp();
}
function agregarEvidenciaCI(i){
  var tipo=(document.getElementById('evTipo_'+i)||{value:'video'}).value;
  var titulo=((document.getElementById('evTitulo_'+i)||{value:''}).value).trim();
  var link=((document.getElementById('evLink_'+i)||{value:''}).value).trim();
  if(!titulo||!link){alert('Complete titulo y enlace.');return;}
  if(!link.startsWith('http')){alert('El enlace debe comenzar con http');return;}
  updDB(function(d){
    if(!d.centrosInteres[i]) return d;
    if(!d.centrosInteres[i].evidencias) d.centrosInteres[i].evidencias=[];
    d.centrosInteres[i].evidencias.push({tipo:tipo,titulo:titulo,link:link,fecha:new Date().toISOString().slice(0,10)});
    return d;
  });
  alert('Evidencia "'+titulo+'" agregada.');renderApp();
}
function editarCI(i){
  var ci=(db.centrosInteres||[])[i];if(!ci) return;
  var nn=prompt('Nombre:',ci.nombre);if(nn===null) return;
  var nr=prompt('Responsable:',ci.responsable);if(nr===null) return;
  var nd=prompt('Descripcion:',ci.descripcion||'');
  var nfe=prompt('Fecha entrega (AAAA-MM-DD):',ci.fechaEntrega||'');
  updDB(function(d){
    d.centrosInteres[i].nombre=nn.trim()||ci.nombre;
    d.centrosInteres[i].responsable=nr.trim()||ci.responsable;
    if(nd!==null) d.centrosInteres[i].descripcion=nd;
    if(nfe!==null) d.centrosInteres[i].fechaEntrega=nfe;
    return d;
  });renderApp();
}

// ============================================================
// MÓDULO CONTACTO RECTORA — WhatsApp / Email + Notificaciones
// ============================================================
function htmlContacto(){
  const isAdmin=sesion.r==='admin';
  const rectora=db.users.find(u=>u.r==='admin'&&(u.cargo||'').toUpperCase().includes('RECTOR'))||{n:db.rectora||'RECTOR(A)',telefono:db.telInst||'',correo:db.emailInst||''};
  const telR=(rectora.telefono||db.telInst||'').replace(/\D/g,'');
  const emailR=rectora.correo||db.emailInst||'';
  if(isAdmin){
    return `<h3 class="sec-title">📬 Notificaciones y Mensajes de Docentes</h3>
    <div class="card">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <h4 class="card-title" style="margin:0">Bandeja de Notificaciones</h4>
        <div class="flex-gap">
          <button class="btn btn-blue" onclick="cargarNotificaciones()">🔄 Refrescar</button>
          <button class="btn btn-gray" onclick="marcarLeidasTodas()">✓ Marcar todas leídas</button>
        </div>
      </div>
      <div class="info-box">Aquí aparecen los avisos cada vez que un docente entra al sistema o le envía un mensaje. Use los datos de WhatsApp/correo de cada docente para responder directamente.</div>
      <div id="notifList" style="margin-top:10px">Cargando…</div>
    </div>
    <div class="card">
      <h4 class="card-title">📞 Directorio de Docentes</h4>
      <div class="over"><table><thead><tr><th>Docente</th><th>Teléfono</th><th>Correo</th><th>WhatsApp</th><th>Email</th></tr></thead><tbody>
      ${db.users.filter(u=>u.r==='docente').map(u=>{
        const tel=(u.telefono||'').replace(/\D/g,'');
        const wa=tel?'<a class="btn-sm" style="background:#25d366;text-decoration:none" target="_blank" href="https://wa.me/57'+tel+'?text='+encodeURIComponent('Saludo, soy el/la rector(a).')+'\">💬 WhatsApp</a>':'—';
        const em=u.correo?'<a class="btn-sm" style="background:#3498db;text-decoration:none" href="mailto:'+u.correo+'">✉️ Email</a>':'—';
        return '<tr><td style=text-align:left>'+u.n+'</td><td>'+(u.telefono||'—')+'</td><td>'+(u.correo||'—')+'</td><td>'+wa+'</td><td>'+em+'</td></tr>';
      }).join('')}
      </tbody></table></div>
    </div>`;
  }
  // Vista del docente: ver/contactar a la rectora
  const waLink=telR?'https://wa.me/57'+telR+'?text='+encodeURIComponent('Saludo Rector(a) '+(db.rectora||'')+', soy '+sesion.n+'.'):'';
  return `<h3 class="sec-title">💬 Contacto con Rector(a)</h3>
  <div class="card">
    <h4 class="card-title">Datos de Contacto</h4>
    <p><b>Rectora:</b> ${rectora.n||db.rectora}</p>
    <p><b>Teléfono institucional:</b> ${rectora.telefono||db.telInst||'—'}</p>
    <p><b>Correo institucional:</b> ${emailR||'—'}</p>
    <div class="flex-gap" style="margin-top:12px">
      ${waLink?'<a class="btn" style="background:#25d366;color:#fff;text-decoration:none" target="_blank" href="'+waLink+'">💬 Abrir WhatsApp</a>':''}
      ${emailR?'<a class="btn btn-blue" style="text-decoration:none" href="mailto:'+emailR+'?subject=Mensaje%20del%20docente%20'+encodeURIComponent(sesion.n)+'">✉️ Enviar Correo</a>':''}
    </div>
  </div>
  <div class="card">
    <h4 class="card-title">📨 Enviar Mensaje a Rectora (queda en su bandeja)</h4>
    <textarea id="msgRect" style="height:100px;resize:vertical" placeholder="Escriba el asunto/mensaje a la rectora..."></textarea>
    <button class="btn btn-green" style="margin-top:10px" onclick="enviarMensajeRectora()">📤 Enviar Mensaje</button>
    <div id="msgStatus" style="margin-top:8px;font-size:0.85rem;color:#27ae60"></div>
  </div>`;
}
function enviarMensajeRectora(){
  const txt=document.getElementById('msgRect').value.trim();
  if(!txt){alert('Escriba un mensaje');return;}
  fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'mensaje',actor:sesion.n,message:'Mensaje de '+sesion.n+': '+txt,meta:{u:sesion.u}})})
    .then(r=>r.json()).then(()=>{document.getElementById('msgStatus').textContent='✅ Mensaje enviado a rectora.';document.getElementById('msgRect').value='';})
    .catch(()=>{document.getElementById('msgStatus').textContent='⚠️ No hay conexión, intente nuevamente.';});
}
function cargarNotificaciones(){
  const wrap=document.getElementById('notifList');if(!wrap) return;
  wrap.innerHTML='Cargando…';
  fetch(API_BASE+'/api/inetis/notify?limit=100').then(r=>r.json()).then(list=>{
    if(!Array.isArray(list)||!list.length){wrap.innerHTML='<p class="empty">Sin notificaciones aún.</p>';return;}
    wrap.innerHTML='<div class="over"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>De</th><th>Mensaje</th><th>Estado</th></tr></thead><tbody>'+
      list.map(n=>{
        const f=new Date(n.created_at).toLocaleString('es-CO');
        const tipo=n.kind==='login'?'🔓 Ingreso':n.kind==='mensaje'?'✉️ Mensaje':'ℹ️ '+n.kind;
        const est=n.seen?'<span style=color:#888>leída</span>':'<b style=color:#c0392b>NUEVA</b>';
        return '<tr><td style=font-size:0.78rem>'+f+'</td><td>'+tipo+'</td><td>'+(n.actor||'—')+'</td><td style=text-align:left;font-size:0.82rem>'+n.message+'</td><td>'+est+'</td></tr>';
      }).join('')+'</tbody></table></div>';
  }).catch(()=>{wrap.innerHTML='<p class="empty">Sin conexión al servidor.</p>';});
}
function marcarLeidasTodas(){
  fetch(API_BASE+'/api/inetis/notify/seen',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    .then(()=>cargarNotificaciones());
}

// ============================================================
// VISTA PADRE / ACUDIENTE
// ============================================================
// ── Helpers tipo institución y bloqueo de pensión ──
function _getPlatTipo(){
  const pid=window._currentPlatId||(gestorEnPlataforma?gestorEnPlataforma:null);
  if(!pid||typeof gestorDB==='undefined') return 'publica';
  const p=(gestorDB.platforms||[]).find(function(x){return x.id===pid;});
  return (p&&p.tipo)||'publica';
}
function _esPensionBloqueada(est){
  // Admin y gestor nunca son bloqueados por pensión — pueden ver todo
  if(sesion&&(sesion.r==='admin'||(gestorSesion&&gestorEnPlataforma))) return false;
  if(_getPlatTipo()!=='privada') return false;
  return est.pensionAlDia!==true;
}
function descargarBoletinPadre(estId){
  estId=String(estId);
  const est=db.ests.find(function(e){return String(e.id)===estId;});
  if(!est){alert('❌ No se encontró el estudiante. Intente recargar la página.');return;}
  if(_esPensionBloqueada(est)){
    const vp=(gestorDB.platforms||[]).find(function(x){return x.id===window._currentPlatId;})||{};
    alert('⛔ Acceso bloqueado\n\nEl boletín de notas no está disponible porque la pensión se encuentra pendiente de pago.\n\nValor mensualidad: $'+(vp.valorPension?Number(vp.valorPension).toLocaleString('es-CO'):'—')+'\n\nContacte a la institución para regularizar su estado.');
    return;
  }
  if(!window.jspdf||!window.jspdf.jsPDF){alert('⚠️ El módulo de generación de PDF no está disponible. Por favor recargue la página e intente de nuevo.');return;}
  try{
    const _np=_getNumPer();
    window._boletinEstudiantesOverride=[est];
    _generarBoletinesPDF(est.g,_np,false);
  }catch(err){
    window._boletinEstudiantesOverride=null;
    alert('❌ Error al generar el boletín: '+(err&&err.message?err.message:String(err))+'\n\nContacte al administrador de la institución.');
  }
}
function togglePensionAlDia(estId){
  estId=String(estId);
  updDB(function(d){const e=d.ests.find(function(x){return String(x.id)===estId;});if(e) e.pensionAlDia=!e.pensionAlDia;return d;});
  renderEstTabla();
}

function pdfConsolidadoEst(estId){
  estId=String(estId);
  const est=db.ests.find(e=>String(e.id)===estId);
  if(!est){alert('No se encontró el estudiante.');return;}
  if(_esPensionBloqueada(est)){alert('⛔ Acceso bloqueado. Pensión pendiente de pago.');return;}
  const numPer=_getNumPer();
  const cargaGrado=db.carga.filter(c=>c.g===est.g);
  const doc=getPDF();
  const pw=doc.internal.pageSize.width;
  const startY=addHeaderRot(doc,'CONSOLIDADO DE CALIFICACIONES',`Estudiante: ${fmtNombreEst(est)} · Grado: ${est.g} · Año: ${db.anio}`,8);
  let y=startY+6;
  const colAsig=78;const colPer=17;const colProm=22;
  const totalW=colAsig+(colPer*numPer)+colProm;
  const x0=Math.max(10,(pw-totalW)/2);
  doc.setFillColor(0,51,102);doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(7.5);
  doc.rect(x0,y,colAsig,8,'F');doc.text('ASIGNATURA',x0+colAsig/2,y+5,{align:'center'});
  let cx=x0+colAsig;
  for(let p=1;p<=numPer;p++){doc.rect(cx,y,colPer,8,'F');doc.text('P'+p,cx+colPer/2,y+5,{align:'center'});cx+=colPer;}
  doc.rect(cx,y,colProm,8,'F');doc.text('PROM',cx+colProm/2,y+5,{align:'center'});
  y+=8;doc.setTextColor(0,0,0);
  let rowIdx=0;
  cargaGrado.forEach(c=>{
    const notas=[];
    for(let p=1;p<=numPer;p++){const n=calcNotaDef(est.nts,c.id,p);notas.push(n>0?n:null);}
    const withVals=notas.filter(n=>n!=null);
    const prom=withVals.length>0?parseFloat((withVals.reduce((a,b)=>a+b,0)/numPer).toFixed(1)):null;
    const bg=rowIdx%2===0?[248,249,250]:[255,255,255];
    doc.setFillColor(bg[0],bg[1],bg[2]);
    const rh=7;doc.rect(x0,y,totalW,rh,'F');
    doc.setFont('helvetica','normal');doc.setFontSize(6.5);
    const isRisk=prom!=null&&prom<3;
    doc.setTextColor(isRisk?192:0,isRisk?57:0,isRisk?43:0);
    doc.text((c.m||'—').substring(0,30),x0+2,y+4.5);
    cx=x0+colAsig;
    notas.forEach(n=>{
      const r=n!=null&&n<3?[192,57,43]:n!=null&&n>=4.5?[39,174,96]:[80,80,80];
      doc.setTextColor(r[0],r[1],r[2]);
      doc.text(n!=null?String(n):'—',cx+colPer/2,y+4.5,{align:'center'});
      cx+=colPer;
    });
    doc.setFont('helvetica','bold');
    const pr=prom!=null&&prom<3?[192,57,43]:[0,51,102];
    doc.setTextColor(pr[0],pr[1],pr[2]);
    doc.text(prom!=null?String(prom):'—',cx+colProm/2,y+4.5,{align:'center'});
    doc.setTextColor(0,0,0);
    doc.setDrawColor(220,220,220);doc.setLineWidth(0.2);doc.rect(x0,y,totalW,rh);
    y+=rh;rowIdx++;
    if(y>270){doc.addPage();y=20;}
  });
  const actEst=(db.actEntregas||[]).filter(e=>String(e.estId)===estId&&e.notaObtenida!=null);
  const qzEst=(db.evalRespuestas||[]).filter(e=>String(e.estId)===estId&&(e.notaEscala!=null||e.puntaje!=null));
  if(actEst.length||qzEst.length){
    y+=6;doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(0,51,102);
    doc.text('NOTAS DE ACTIVIDADES Y EVALUACIONES',x0,y);y+=5;
    doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(0,0,0);
    actEst.forEach(e=>{
      const act=(db.actividades||[]).find(a=>String(a.id)===String(e.actId))||{};
      doc.text(`• [P${act.periodo||'—'}] ${(act.titulo||'Actividad').substring(0,40)} (${act.asignatura||'—'}): ${e.notaObtenida}/${(db.config?.escalaS||5).toFixed(1)}`,x0+2,y);
      y+=4.5;if(y>270){doc.addPage();y=20;}
    });
    qzEst.forEach(e=>{
      const ev2=(db.evaluaciones||[]).find(v=>String(v.id)===String(e.evalId))||{};
      const _escMax2=(db.config?.escalaS||5).toFixed(1);const nota=e.notaEscala!=null?e.notaEscala+'/'+_escMax2:Math.round((e.puntaje||0)/100*(db.config?.escalaS||5)*10)/10+'/'+_escMax2;
      doc.text(`• [P${ev2.periodo||'—'}] Quiz: ${(ev2.titulo||'Evaluación').substring(0,35)} (${ev2.asignatura||'—'}): ${nota}`,x0+2,y);
      y+=4.5;if(y>270){doc.addPage();y=20;}
    });
  }
  addFooterPDF(doc);
  doc.save(`Consolidado_${fmtNombreEst(est).replace(/ /g,'_')}_${est.g}_${db.anio}.pdf`);
}
// ============================================================
// S12 · MÓDULOS DE ROLES ESPECIALES (PADRE / ESTUDIANTE)
// Vistas de solo lectura para padres/acudientes y estudiantes:
// horario, notas, observador, asistencia y evaluación docente.
// Estas funciones NO deben tener acceso a updDB().
// ============================================================
function renderPadre(){
  const est=db.ests.find(e=>e.id===sesion.estId);
  if(!est){
    document.getElementById('app').innerHTML=`
    <div class="login-wrap">
      <div class="login-box" style="text-align:center">
        <div style="font-size:3rem;margin-bottom:12px">⚠️</div>
        <h2 style="color:#c0392b">Estudiante no encontrado</h2>
        <p style="color:#666;margin-bottom:20px;font-size:0.9rem">No se encontró el estudiante asociado a su cuenta.<br>Contacte al administrador de la institución.</p>
        <button class="btn btn-navy" style="width:100%" onclick="cerrarSesion()">🚪 Volver al inicio</button>
      </div>
    </div>`;
    return;
  }
  const _privada=_getPlatTipo()==='privada';
  const _bloqueado=_esPensionBloqueada(est);
  const modalidad=est.modalidad||'presencial';
  const esOnline=modalidad==='online';

  // ── Calcular resumen académico ──
  const cargaEst=db.carga.filter(c=>c.g===est.g);
  const numPer=_getNumPer();
  const promsEst=cargaEst.map(c=>({mat:c.m,prom:parseFloat((Array.from({length:numPer},(_,i)=>calcNotaDef(est.nts,c.id,i+1)).reduce((a,b)=>a+b,0)/numPer).toFixed(2))}));
  const areasPerdidasEst=promsEst.filter(p=>p.prom<3&&p.prom>0);
  const promGenEst=promsEst.length?parseFloat((promsEst.reduce((s,p)=>s+p.prom,0)/promsEst.length).toFixed(2)):0;
  // Calcular ausencias usando el formato correcto (arrays presentes/ausentes/justificados)
  const todosRegistrosAsis=(db.asistencia||[]).filter(a=>
    (a.presentes&&a.presentes.some(x=>String(x)===String(est.id)))||
    (a.ausentes&&a.ausentes.some(x=>String(x)===String(est.id)))||
    (a.justificados&&a.justificados.some(x=>String(x)===String(est.id)))
  );
  const ausenciasCount=todosRegistrosAsis.filter(a=>(a.ausentes||[]).some(x=>String(x)===String(est.id))).length;
  const pctAsis=todosRegistrosAsis.length?Math.round((1-ausenciasCount/todosRegistrosAsis.length)*100):100;

  // ── Observador ──
  const obsEst=(est.observaciones||[]).slice(-5).reverse();
  const obsHtmlPadre=obsEst.length?obsEst.map(o=>{
    const col=o.tipo==='logro'||o.tipo==='positivo'?'#1e8449':o.tipo==='academico'?'#1a5276':'#c0392b';
    const bg=o.tipo==='logro'||o.tipo==='positivo'?'#d5f5e3':o.tipo==='academico'?'#eaf0fb':'#fde8e8';
    const ico=o.tipo==='logro'||o.tipo==='positivo'?'🌟':o.tipo==='academico'?'📚':'⚠️';
    return `<div style="border-left:4px solid ${col};background:${bg};padding:12px 16px;border-radius:0 10px 10px 0;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:6px">
        <span style="background:${col};color:#fff;border-radius:20px;padding:3px 10px;font-size:0.72rem;font-weight:bold">${ico} ${o.tipo||'General'} — Periodo ${o.per||'—'}</span>
        <span style="font-size:0.73rem;color:#888">${o.fecha||''} · ${o.doc||'Docente'}</span>
      </div>
      <p style="margin:0;font-size:0.88rem;color:#222;line-height:1.5">${o.txt||''}</p>
    </div>`;
  }).join(''):`<div style="text-align:center;padding:20px;color:#aaa"><div style="font-size:2rem;margin-bottom:6px">📒</div><p style="font-size:0.88rem">No hay anotaciones recientes en el observador.</p></div>`;

  // ── Pagos ──
  const pagos=(est.pagos||[]);
  const pagosHtml=pagos.length
    ?`<div class="over"><table><thead><tr><th>Concepto</th><th>Valor</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>
      ${pagos.map(p=>`<tr><td style="text-align:left">${p.concepto||'—'}</td><td>$${Number(p.valor||0).toLocaleString('es-CO')}</td><td>${p.fecha||'—'}</td>
      <td><span class="badge" style="background:${p.estado==='pagado'?'#27ae60':'#e67e22'}">${p.estado==='pagado'?'✅ Pagado':'⏳ Pendiente'}</span></td></tr>`).join('')}
      </tbody></table></div>`
    :`<div style="text-align:center;padding:16px;color:#aaa"><div style="font-size:1.8rem">💳</div><p style="font-size:0.85rem;margin-top:6px">Sin registros de pago. Contacte a la secretaría para consultas.</p></div>`;

  // ── Estado de alerta de promedio ──
  const estadoPromColor=promGenEst>=4.5?'#1e8449':promGenEst>=3?'#2980b9':'#c0392b';
  const estadoPromLabel=promGenEst>=4.5?'Excelente 🌟':promGenEst>=3?'Aprobado ✅':'En riesgo ⚠️';

  document.getElementById('app').innerHTML=`
  <!-- ENCABEZADO INSTITUCIONAL -->
  <div style="background:linear-gradient(135deg,#003366 0%,#0a4080 100%);border-bottom:4px solid #f1c40f;padding:16px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    ${db.logo?`<img src="${db.logo}" style="height:60px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">`:'<div style="font-size:2.5rem">🎓</div>'}
    <div style="flex:1;min-width:0">
      <div style="color:#f1c40f;font-weight:900;font-size:1rem;letter-spacing:1px">${db.nombre||'Institución Educativa'}</div>
      <div style="color:rgba(255,255,255,0.8);font-size:0.82rem;margin-top:2px">Portal del Acudiente — Año ${db.anio} ${esOnline?'· 💻 Online':'· 🏫 Presencial'}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${moduloActivo('pre-matricula')?`<button style="background:#27ae60;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:0.8rem;font-weight:bold;cursor:pointer" onclick="abrirPreMatriculaLogueado()">📝 Pre-Matrícula</button>`:''}
      <button style="background:#c0392b;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:0.8rem;font-weight:bold;cursor:pointer" onclick="cerrarSesion()">🚪 Salir</button>
    </div>
  </div>

  <!-- BIENVENIDA PERSONAL -->
  <div style="background:#f8f9fa;border-bottom:1px solid #e0e8f0;padding:10px 20px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <div style="width:36px;height:36px;border-radius:50%;background:#003366;display:flex;align-items:center;justify-content:center;color:#f1c40f;font-size:1.1rem;flex-shrink:0">👤</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;color:#003366;font-size:0.9rem">Bienvenido/a, <span style="color:#e67e22">${sesion.n}</span></div>
      <div style="font-size:0.78rem;color:#666">Acudiente de: <b>${est.n}</b> · <b>${est.g}</b></div>
    </div>
  </div>

  <div style="max-width:960px;margin:18px auto;padding:0 14px">

    <!-- TARJETAS DE RESUMEN (estilo amigable para padres) -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px">
      <div style="background:${estadoPromColor};color:#fff;border-radius:14px;padding:16px;text-align:center;box-shadow:0 3px 12px rgba(0,0,0,0.12)">
        <div style="font-size:2rem;font-weight:900;line-height:1">${promGenEst>0?promGenEst.toFixed(1):'—'}</div>
        <div style="font-size:0.7rem;opacity:0.9;margin-top:4px;font-weight:600">Promedio General</div>
        <div style="font-size:0.7rem;margin-top:2px;background:rgba(255,255,255,0.2);border-radius:8px;padding:2px 6px;display:inline-block">${estadoPromLabel}</div>
      </div>
      <div style="background:${pctAsis>=85?'#1e8449':pctAsis>=70?'#e67e22':'#c0392b'};color:#fff;border-radius:14px;padding:16px;text-align:center;box-shadow:0 3px 12px rgba(0,0,0,0.12)">
        <div style="font-size:2rem;font-weight:900;line-height:1">${pctAsis}%</div>
        <div style="font-size:0.7rem;opacity:0.9;margin-top:4px;font-weight:600">Asistencia</div>
        <div style="font-size:0.7rem;margin-top:2px;background:rgba(255,255,255,0.2);border-radius:8px;padding:2px 6px;display:inline-block">${pctAsis>=85?'Muy bien ✅':pctAsis>=70?'Regular ⚠️':'Crítica ❌'}</div>
      </div>
      <div style="background:${areasPerdidasEst.length===0?'#1e8449':areasPerdidasEst.length<=2?'#e67e22':'#c0392b'};color:#fff;border-radius:14px;padding:16px;text-align:center;box-shadow:0 3px 12px rgba(0,0,0,0.12)">
        <div style="font-size:2rem;font-weight:900;line-height:1">${areasPerdidasEst.length}</div>
        <div style="font-size:0.7rem;opacity:0.9;margin-top:4px;font-weight:600">Materias en riesgo</div>
        <div style="font-size:0.7rem;margin-top:2px;background:rgba(255,255,255,0.2);border-radius:8px;padding:2px 6px;display:inline-block">${areasPerdidasEst.length===0?'¡Sin riesgo! 🌟':'Requiere atención'}</div>
      </div>
      <div style="background:#1a5276;color:#fff;border-radius:14px;padding:16px;text-align:center;box-shadow:0 3px 12px rgba(0,0,0,0.12)">
        <div style="font-size:1.4rem;font-weight:900;line-height:1">${est.g}</div>
        <div style="font-size:0.7rem;opacity:0.9;margin-top:4px;font-weight:600">Grado</div>
        <div style="font-size:0.7rem;margin-top:2px;background:rgba(255,255,255,0.2);border-radius:8px;padding:2px 6px;display:inline-block">${est.jornada||'Jornada'}</div>
      </div>
    </div>

    <!-- ALERTAS IMPORTANTES (solo si hay problemas) -->
    ${areasPerdidasEst.length>0?`<div style="background:#fde8e8;border:1.5px solid #e74c3c;border-radius:12px;padding:14px 18px;margin-bottom:14px">
      <div style="font-weight:700;color:#c0392b;font-size:0.92rem;margin-bottom:8px">⚠️ Materias con calificación en riesgo de reprobación</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${areasPerdidasEst.map(a=>`<span style="background:#c0392b;color:#fff;border-radius:20px;padding:4px 12px;font-size:0.8rem;font-weight:bold">${a.mat}: ${a.prom.toFixed(1)}</span>`).join('')}</div>
      <p style="color:#7b241c;font-size:0.82rem;margin:8px 0 0">Comuníquese con los docentes de estas materias para apoyar a su hijo/a.</p>
    </div>`:''}
    ${ausenciasCount>=5?`<div style="background:#fff3cd;border:1.5px solid #f39c12;border-radius:12px;padding:14px 18px;margin-bottom:14px">
      <div style="font-weight:700;color:#856404;font-size:0.92rem">⚠️ Alerta de asistencia</div>
      <p style="color:#6d5004;font-size:0.85rem;margin:4px 0 0">${est.n} tiene <b>${ausenciasCount} ausencias</b> registradas este período. Comuníquese con la institución a la brevedad.</p>
    </div>`:''}

    ${(()=>{
      const _pazSalvo=_getPazSalvoEst(est);
      const _pzOk=!_privada||_pazSalvo.ok;
      const _pzMsg=_pazSalvo.pendientes.join(', ');
      if(_privada){
        return `<div style="background:#fff;border:1.5px solid ${_pzOk?'#27ae60':'#c0392b'};border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.06)">
          <div style="font-weight:700;color:${_pzOk?'#1e8449':'#c0392b'};font-size:0.95rem;margin-bottom:10px">${_pzOk?'✅ Paz y Salvo — Todo al día':'⛔ Pendiente de pago — No está a paz y salvo'}</div>
          ${!_pzOk?`<div style="background:#fde8e8;border-radius:8px;padding:10px 14px;font-size:0.85rem;color:#7b241c;margin-bottom:10px">Pendientes: <b>${_pzMsg}</b><br>No podrá recibir certificados ni boletines hasta regularizar su estado.</div>`:''}
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
            ${[['Económico',est.pensionAlDia],['Académico',est.pazSalvoAcad!==false],['Disciplinario',est.pazSalvoDisc!==false]].map(([lbl,ok])=>`
            <div style="background:${ok?'#d5f5e3':'#fde8e8'};border-radius:10px;padding:10px;text-align:center">
              <div style="font-size:1.4rem">${ok?'✅':'⛔'}</div>
              <div style="font-size:0.72rem;font-weight:700;margin-top:4px;color:${ok?'#1e8449':'#c0392b'}">${lbl}</div>
            </div>`).join('')}
          </div>
          ${_pzOk?`<div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-navy" onclick="solicitarCertificadoEmail('${String(est.id)}')">📧 Solicitar Certificado por Correo</button>
            ${db.emailInst?`<button class="btn" style="background:#25d366;color:#fff" onclick="solicitarCertificadoWsp('${String(est.id)}')">💬 Solicitar por WhatsApp</button>`:''}
          </div>`:`<p style="font-size:0.82rem;color:#c0392b;margin:0">Regularice su estado para acceder a certificados y documentos.</p>`}
        </div>`;
      } else {
        return (db.emailInst||db.telInst)?`<div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
          <div style="font-weight:700;color:#003366;font-size:0.92rem;margin-bottom:10px">📄 Solicitar Certificados y Documentos</div>
          <p style="font-size:0.85rem;color:#666;margin:0 0 10px">Para solicitar documentos académicos, use uno de los canales de la institución:</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${db.emailInst?`<button class="btn btn-navy" onclick="solicitarCertificadoEmail('${String(est.id)}')">📧 Correo Electrónico</button>`:''}
            ${db.telInst?`<button class="btn" style="background:#25d366;color:#fff" onclick="solicitarCertificadoWsp('${String(est.id)}')">💬 WhatsApp</button>`:''}
          </div>
        </div>`:'';
      }
    })()}

    <!-- CALIFICACIONES -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div style="font-weight:700;color:#003366;font-size:0.95rem">📊 Calificaciones de ${est.n}</div>
        <button class="btn btn-navy" style="font-size:0.79rem;padding:6px 14px" onclick="pdfConsolidadoEst('${String(est.id)}')">📥 Descargar PDF</button>
      </div>
      ${htmlNotasEstudiante(est)}
    </div>

    <!-- ACTIVIDADES -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="font-weight:700;color:#27ae60;font-size:0.92rem;margin-bottom:12px">📝 Actividades de ${fmtNombreEst(est)}</div>
      ${htmlActividadesEstudiante(est)}
    </div>

    <!-- QUIZZES -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="font-weight:700;color:#8e44ad;font-size:0.92rem;margin-bottom:6px">🧩 Quizzes y Evaluaciones</div>
      <p style="font-size:0.82rem;color:#777;margin:0 0 10px">Los quizzes son respondidos por el estudiante desde su panel personal.</p>
      ${htmlQuizzesEstudiante(est)}
    </div>

    ${moduloActivo('pre-matricula')?`<div style="background:linear-gradient(135deg,#eafaf1,#fff);border:1.5px solid #27ae60;border-radius:12px;padding:16px 18px;margin-bottom:14px">
      <div style="font-weight:700;color:#1e8449;font-size:0.92rem;margin-bottom:6px">📝 Pre-Matrícula Online — Año ${parseInt(db.anio)+1||2027}</div>
      <p style="font-size:0.85rem;color:#555;margin:0 0 12px">Renueve la matrícula de su hijo/a para el próximo año lectivo desde aquí.</p>
      <button class="btn btn-green" onclick="abrirPreMatriculaLogueado()">📝 Iniciar Formulario de Pre-Matrícula</button>
    </div>`:''}

    <!-- COMUNICADOS INSTITUCIONALES -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)" id="padre-notif-card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div style="font-weight:700;color:#003366;font-size:0.92rem">📬 Comunicados Institucionales
          <span id="padre-notif-badge" style="display:none;background:#c0392b;color:#fff;border-radius:20px;padding:2px 10px;font-size:0.7rem;font-weight:bold;margin-left:6px"></span>
        </div>
        <button style="background:#eaf0fb;color:#003366;border:1px solid #c5d8f0;border-radius:8px;padding:6px 14px;font-size:0.8rem;font-weight:bold;cursor:pointer" onclick="cargarNotifsPadre(${JSON.stringify(est.id)},'padre-notif-list','padre-notif-badge')">🔄 Actualizar</button>
      </div>
      <div id="padre-notif-list"><div style="text-align:center;padding:16px;color:#aaa;font-size:0.85rem">⏳ Cargando comunicados...</div></div>
    </div>

    <!-- OBSERVADOR DIGITAL -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div style="font-weight:700;color:#8e44ad;font-size:0.92rem">📓 Observador Digital de ${est.n}</div>
        ${obsEst.length?`<button style="background:#f5eef8;color:#6c3483;border:1px solid #d2b4de;border-radius:8px;padding:5px 12px;font-size:0.78rem;font-weight:bold;cursor:pointer" onclick="_verObservadorCompleto(${JSON.stringify(est.id)})">📋 Ver completo</button>`:''}
      </div>
      <p style="font-size:0.8rem;color:#999;margin:0 0 10px">Últimas 5 anotaciones del observador escolar.</p>
      ${obsHtmlPadre}
    </div>

    <!-- HORARIO -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <div style="font-weight:700;color:#003366;font-size:0.92rem">📅 Horario Semanal — Grado ${est.g}</div>
        <button style="background:#eaf0fb;color:#003366;border:1px solid #c5d8f0;border-radius:8px;padding:5px 12px;font-size:0.78rem;font-weight:bold;cursor:pointer" onclick="pdfHorarioGrado('${est.g}')">📥 PDF Horario</button>
      </div>
      ${htmlHorarioReadOnly(est.g)}
    </div>

    <!-- ASISTENCIA -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="font-weight:700;color:#003366;font-size:0.92rem;margin-bottom:12px">📋 Registro de Asistencia</div>
      ${htmlAsistEstudiante(est)}
    </div>

    <!-- PAGOS (solo colegios privados) -->
    ${_privada?`<div style="background:#fff;border:1.5px solid #2980b9;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="font-weight:700;color:#1a5276;font-size:0.92rem;margin-bottom:12px">💳 Estado Financiero y Pagos</div>
      ${pagosHtml}
      <div style="background:#eaf0fb;border-radius:8px;padding:10px 14px;margin-top:10px;font-size:0.82rem;color:#1a5276">
        Para consultar su estado de cuenta completo o realizar un pago, comuníquese con la secretaría.
        ${db.telInst?` 📞 ${db.telInst}`:''}${db.emailInst?` · 📧 ${db.emailInst}`:''}
      </div>
    </div>`:''}

    <!-- CLASES VIRTUALES (solo modalidad online) -->
    ${esOnline?(()=>{
      const _gl=(db.grados.find(g=>g.n===est.g)||{}).linkClase||est.linkClase||'';
      const _lm=(db.materialEstudiantes||[]).filter(t=>(t.gra===est.g||t.estId===est.id)&&t.categoria==='link');
      return `<div style="background:linear-gradient(135deg,#f5eef8,#fff);border:1.5px solid #9b59b6;border-radius:12px;padding:16px 18px;margin-bottom:14px">
        <div style="font-weight:700;color:#6c3483;font-size:0.92rem;margin-bottom:10px">💻 Clases Virtuales de ${est.n}</div>
        <div style="margin-bottom:10px">
          ${_gl?`<a href="${_gl}" target="_blank" style="background:#6c3483;color:#fff;border-radius:10px;padding:10px 18px;font-weight:bold;text-decoration:none;display:inline-block">🎥 Unirse a Clase Virtual</a>`
          :`<div style="background:#f0e6f8;border-radius:8px;padding:10px 14px;font-size:0.85rem;color:#6c3483">🎥 El enlace de clase virtual será publicado por el docente.</div>`}
        </div>
        ${_lm.length?`<div style="background:#f5eef8;border-radius:8px;padding:10px 14px">
          <div style="font-weight:700;color:#6c3483;font-size:0.82rem;margin-bottom:6px">🔗 Recursos del docente:</div>
          <ul style="padding-left:18px;margin:0">${_lm.map(t=>`<li style="margin-bottom:5px;font-size:0.85rem"><a href="${t.url}" target="_blank" style="color:#6c3483;font-weight:bold">${t.nombre||t.tipoLink||'Recurso'}</a> <span style="color:#888">— ${t.asig||'General'} · ${t.fecha||''}</span></li>`).join('')}</ul>
        </div>`:''}
      </div>`;
    })():''}

    <!-- CONTACTO INSTITUCIONAL -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <div style="font-weight:700;color:#003366;font-size:0.92rem;margin-bottom:12px">💬 Contacto Institucional</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;font-size:0.87rem;margin-bottom:12px">
        <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px"><div style="font-size:0.72rem;color:#888;margin-bottom:2px">DIRECTOR(A) DE GRUPO</div><b style="color:#003366">${(db.grados.find(g=>g.n===est.g)||{}).d||'Sin asignar'}</b></div>
        <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px"><div style="font-size:0.72rem;color:#888;margin-bottom:2px">RECTOR(A)</div><b style="color:#003366">${db.rectora||'—'}</b></div>
        <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px"><div style="font-size:0.72rem;color:#888;margin-bottom:2px">TELÉFONO</div><b style="color:#003366">${db.telInst||'—'}</b></div>
        <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px"><div style="font-size:0.72rem;color:#888;margin-bottom:2px">CORREO</div><b style="color:#003366">${db.emailInst||'—'}</b></div>
      </div>
      ${db.telInst?`<div style="display:flex;gap:8px;flex-wrap:wrap">
        <a style="background:#25d366;color:#fff;border-radius:8px;padding:9px 16px;font-size:0.85rem;font-weight:bold;text-decoration:none;display:inline-flex;align-items:center;gap:5px" target="_blank" href="https://wa.me/57${(db.telInst||'').replace(/\D/g,'')}?text=${encodeURIComponent('Hola, soy '+(sesion.n||'el acudiente')+' de '+(est.n||'mi hijo/a')+'. Institución: '+(db.nombre||'')+'.')}">💬 WhatsApp Institución</a>
        ${db.emailInst?`<a style="background:#1a5276;color:#fff;border-radius:8px;padding:9px 16px;font-size:0.85rem;font-weight:bold;text-decoration:none;display:inline-flex;align-items:center;gap:5px" href="mailto:${db.emailInst}?subject=Consulta Acudiente — ${est.n}">📧 Enviar Correo</a>`:''}
      </div>`:''}
    </div>

    <!-- AJUSTES DE CUENTA -->
    <div style="background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:16px 18px;margin-bottom:20px;box-shadow:0 1px 5px rgba(0,0,0,0.05)">
      <details>
        <summary style="color:#003366;font-size:0.9rem;font-weight:700;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px">
          <span>⚙️</span> <span>Mis Ajustes de Cuenta</span>
        </summary>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:16px;align-items:flex-start">
          <div style="text-align:center;flex-shrink:0">
            <div id="_fotoPadrePrev" style="width:80px;height:90px;border-radius:10px;border:2px solid #27ae60;overflow:hidden;background:#eee;display:flex;align-items:center;justify-content:center;margin-bottom:8px">
              ${sesion.foto?`<img src="${sesion.foto}" style="width:100%;height:100%;object-fit:cover">`:'<span style="font-size:2rem">👤</span>'}
            </div>
            <button style="background:#27ae60;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:0.72rem;cursor:pointer;margin-bottom:4px" onclick="document.getElementById('_filePadreFoto').click()">📁 Subir foto</button>
            <input type="file" id="_filePadreFoto" accept="image/*" style="display:none" onchange="cargarFotoPerfilPadre(this)">
          </div>
          <div style="flex:1;min-width:220px">
            <p style="font-size:0.82rem;color:#666;margin:0 0 12px">Actualice su usuario y contraseña de acceso al portal.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
              <input type="text" id="_padrePUser" value="${sesion.u}" placeholder="Nuevo Usuario" style="flex:1;min-width:130px;padding:9px;border:1.5px solid #ddd;border-radius:8px;font-size:0.88rem">
              <span style="position:relative;flex:1;min-width:130px;display:flex;align-items:center">
                <input type="password" id="_padrePPass" value="${sesion.p}" placeholder="Nueva Contraseña" style="flex:1;padding:9px;padding-right:36px;border:1.5px solid #ddd;border-radius:8px;font-size:0.88rem">
                <button type="button" onclick="(function(b){var i=document.getElementById('_padrePPass');i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'👁️':'🙈'}).call(this,this)" style="position:absolute;right:8px;background:none;border:none;cursor:pointer;font-size:0.9rem">👁️</button>
              </span>
              <button class="btn btn-green" style="white-space:nowrap" onclick="actualizarPerfilPadre()">💾 Guardar</button>
            </div>
            <div style="font-size:0.78rem;color:#999">Acudiente de: <b>${est.n}</b> (${est.g})</div>
          </div>
        </div>
      </details>
    </div>

  </div>`;
  setTimeout(()=>cargarNotifsPadre(est.id,'padre-notif-list','padre-notif-badge'),120);
}
function htmlNotasEstudiante(est){
  // Buscar asignaturas por grado — tolerante a variaciones de formato (11° vs 11)
  const normG=g=>String(g||'').replace(/[°º\s]/g,'').toLowerCase();
  const estGN=normG(est.g);
  const carga=db.carga.filter(c=>normG(c.g)===estGN);
  const nts=est.nts||{};
  if(!carga.length) return '<div class="info-box" style="color:#c0392b">⚠️ Sin asignaturas registradas para el grado <b>'+est.g+'</b>. Consulte al administrador.</div>';
  const _npNE=_getNumPer();
  const eb=(db.config&&db.config.escalaB)||3.0;
  const _pHdrs=Array.from({length:_npNE},(_,i)=>`<th style="text-align:center;min-width:44px">P${i+1}</th>`).join('');
  let html='<div class="over"><table style="width:100%;border-collapse:collapse"><thead><tr>';
  html+='<th style="text-align:left;padding:6px 8px;background:#003366;color:#fff;font-size:0.8rem">Asignatura</th>';
  html+=_pHdrs.replace(/<th /g,'<th style="text-align:center;padding:6px 4px;background:#003366;color:#fff;font-size:0.8rem" ');
  html+='<th style="text-align:center;padding:6px 8px;background:#003366;color:#fff;font-size:0.8rem">Prom.</th>';
  html+='<th style="text-align:center;padding:6px 8px;background:#003366;color:#fff;font-size:0.8rem">Estado</th>';
  html+='</tr></thead><tbody>';
  let totalProm=0,countMats=0;
  carga.forEach((c,ci)=>{
    // Buscar notas usando String(c.id) para tolerar tipos numérico/string en nts
    const cIdKey=String(c.id);
    const calcPer=(per)=>{
      const raw=(nts[c.id]||nts[cIdKey]||{})[per]||{};
      const cfg=db.config||{};
      const base=_baseNota(raw,cfg);
      const def=(base<3&&(raw.rec||0)>0)?raw.rec:base;
      return(per===_getNumPer()&&(raw.niv||0)>0)?raw.niv:def;
    };
    const ps=Array.from({length:_npNE},(_,i)=>calcPer(i+1));
    const hasAny=ps.some(p=>p>0);
    const prom=_npNE>0?ps.reduce((a,b)=>a+b,0)/_npNE:0;
    if(hasAny){totalProm+=prom;countMats++;}
    const promStr=hasAny?prom.toFixed(2):'—';
    const aprueba=prom>=eb;
    const bg=ci%2===0?'#f9f9f9':'#fff';
    const pCells=ps.map(p=>p>0?`<td style="text-align:center;color:${colorNota(p)};font-weight:bold;padding:5px 4px">${p.toFixed(1)}</td>`
      :`<td style="text-align:center;color:#bbb;padding:5px 4px">—</td>`).join('');
    const estadoColor=!hasAny?'#aaa':aprueba?'#1e8449':'#c0392b';
    const estadoTxt=!hasAny?'Sin notas':aprueba?'✅ Aprobado':'❌ En riesgo';
    html+=`<tr style="background:${bg}">`;
    html+=`<td style="text-align:left;padding:5px 8px;font-size:0.82rem;font-weight:bold">${c.m}</td>`;
    html+=pCells;
    html+=`<td style="text-align:center;font-weight:bold;padding:5px 4px;color:${hasAny?colorNota(prom):'#bbb'}">${promStr}</td>`;
    html+=`<td style="text-align:center;font-size:0.75rem;font-weight:bold;color:${estadoColor};padding:5px 4px">${estadoTxt}</td>`;
    html+='</tr>';
  });
  // Fila de promedio general
  const promGen=countMats>0?(totalProm/countMats):0;
  html+='<tr style="background:#e8f0fe;border-top:2px solid #003366">';
  html+=`<td style="font-weight:bold;padding:6px 8px;font-size:0.82rem;color:#003366">PROMEDIO GENERAL</td>`;
  html+=Array.from({length:_npNE},()=>'<td></td>').join('');
  html+=`<td style="text-align:center;font-weight:bold;font-size:0.9rem;color:${countMats?colorNota(promGen):'#bbb'}">${countMats?promGen.toFixed(2):'—'}</td>`;
  html+=`<td style="text-align:center;font-weight:bold;font-size:0.78rem;color:${countMats?(promGen>=eb?'#1e8449':'#c0392b'):'#aaa'}">${countMats?(promGen>=eb?'✅ APRUEBA':'❌ EN RIESGO'):'—'}</td>`;
  html+='</tr>';
  html+='</tbody></table></div>';
  if(countMats===0) html+='<div class="info-box" style="margin-top:8px;font-size:0.8rem">ℹ️ Las calificaciones aparecerán aquí cuando el docente ingrese y guarde las notas en la planilla.</div>';
  return html;
}
function htmlAsistEstudiante(est){
  // Los registros de asistencia usan arrays presentes[]/ausentes[]/justificados[]
  // (formato correcto del módulo de asistencia del docente)
  const eId=est.id;
  const regs=(db.asistencia||[]).filter(a=>
    (a.presentes&&a.presentes.some(x=>String(x)===String(eId)))||
    (a.ausentes&&a.ausentes.some(x=>String(x)===String(eId)))||
    (a.justificados&&a.justificados.some(x=>String(x)===String(eId)))
  ).slice().sort((a,b)=>b.fecha.localeCompare(a.fecha));
  if(!regs.length) return '<p class="empty">Sin registros de asistencia registrados por el docente aún.</p>';
  const co=v=>v==='P'?'#27ae60':v==='A'?'#c0392b':'#e67e22';
  const lbl=v=>v==='P'?'✅ Presente':v==='A'?'❌ Ausente':'⚠️ Justificado';
  const rows=regs.slice(0,60).map(a=>{
    const c=(db.carga||[]).find(x=>String(x.id)===String(a.cargaId))||{m:'—'};
    const st=(a.ausentes||[]).some(x=>String(x)===String(eId))?'A':(a.justificados||[]).some(x=>String(x)===String(eId))?'J':'P';
    return `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:5px 8px">${a.fecha}</td>
      <td style="padding:5px 4px;font-size:0.78rem">${a.hora||'—'}</td>
      <td style="padding:5px 8px;text-align:left;font-size:0.82rem">${c.m}</td>
      <td style="padding:5px 6px;color:${co(st)};font-weight:bold;font-size:0.82rem">${lbl(st)}</td>
      <td style="padding:5px 8px;font-size:0.78rem;color:#555">${a.actividad||'—'}</td>
    </tr>`;
  }).join('');
  const pres=regs.filter(a=>(a.presentes||[]).some(x=>String(x)===String(eId))).length;
  const aus=regs.filter(a=>(a.ausentes||[]).some(x=>String(x)===String(eId))).length;
  const just=regs.filter(a=>(a.justificados||[]).some(x=>String(x)===String(eId))).length;
  const pct=regs.length>0?Math.round(pres/regs.length*100):0;
  const statColor=pct>=90?'#27ae60':pct>=70?'#e67e22':'#c0392b';
  let html=`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
    <div style="background:#e8f8e8;border-radius:8px;padding:8px 14px;text-align:center;min-width:70px"><div style="font-size:1.2rem;font-weight:bold;color:#27ae60">${pres}</div><div style="font-size:0.72rem;color:#555">Presencias</div></div>
    <div style="background:#fde8e8;border-radius:8px;padding:8px 14px;text-align:center;min-width:70px"><div style="font-size:1.2rem;font-weight:bold;color:#c0392b">${aus}</div><div style="font-size:0.72rem;color:#555">Ausencias</div></div>
    <div style="background:#fef3e2;border-radius:8px;padding:8px 14px;text-align:center;min-width:70px"><div style="font-size:1.2rem;font-weight:bold;color:#e67e22">${just}</div><div style="font-size:0.72rem;color:#555">Justificados</div></div>
    <div style="background:#e8f0fe;border-radius:8px;padding:8px 14px;text-align:center;min-width:70px"><div style="font-size:1.2rem;font-weight:bold;color:${statColor}">${pct}%</div><div style="font-size:0.72rem;color:#555">% Asistencia</div></div>
  </div>`;
  html+=`<div class="over"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#003366;color:#fff">
    <th style="padding:6px 8px">Fecha</th><th style="padding:6px 4px">Hora</th><th style="padding:6px 8px;text-align:left">Asignatura</th>
    <th style="padding:6px 6px">Estado</th><th style="padding:6px 8px;text-align:left">Actividad</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
  if(regs.length>60) html+=`<div style="margin-top:6px;font-size:0.78rem;color:#888">Mostrando 60 de ${regs.length} registros.</div>`;
  return html;
}

// ============================================================
// MÓDULO COMUNICADOS — ACUDIENTE Y ESTUDIANTE
// ============================================================
async function cargarNotifsPadre(estId, listId, badgeId){
  const cont=document.getElementById(listId);
  const badge=document.getElementById(badgeId);
  if(!cont) return;
  cont.innerHTML='<div style="text-align:center;padding:14px;color:#aaa;font-size:0.85rem">⏳ Cargando comunicados...</div>';
  try{
    const r=await fetch(API_BASE+'/api/inetis/notifications');
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    const all=(j.notifications||[]);
    const estObj=(db.ests||[]).find(e=>e.id===estId);
    const estGrado=estObj?estObj.g:null;
    // Filtra: alertas/ausencias para este estudiante + comunicados generales
    const related=all.filter(n=>{
      const m=n.meta||{};
      if(n.kind==='alerta-academica'&&m.estId===estId) return true;
      // Ausencias: mostrar al padre del estudiante ausente
      if(n.kind==='ausencia'&&String(m.estId)===String(estId)) return true;
      if(n.kind==='aviso-docente'&&!m.estId){
        if(m.grado&&estGrado&&m.grado!==estGrado) return false;
        return true;
      }
      if(!m.estId&&['aviso','comunicado','rector-message'].includes(n.kind)){
        if(m.grado&&estGrado&&m.grado!==estGrado) return false;
        return true;
      }
      return false;
    }).reverse();
    const unread=related.filter(n=>!n.seen).length;
    if(badge){
      badge.textContent=unread>0?unread:'';
      badge.style.display=unread>0?'inline-flex':'none';
    }
    if(!related.length){
      cont.innerHTML='<div style="text-align:center;padding:20px"><span style="font-size:2rem">📭</span><p style="color:#aaa;font-size:0.85rem;margin-top:6px">Sin comunicados ni alertas registradas para este estudiante.</p></div>';
      return;
    }
    const kindInfo={
      'alerta-academica':{label:'⚠️ Alerta Académica',color:'#c0392b',bg:'#fde8e8'},
      'ausencia':        {label:'📅 Ausencia Registrada',color:'#e67e22',bg:'#fef3e2'},
      'aviso':           {label:'📢 Aviso',           color:'#1a5276',bg:'#eaf4fe'},
      'comunicado':      {label:'📋 Comunicado',      color:'#1a5276',bg:'#eaf4fe'},
      'rector-message':  {label:'🏫 Mensaje Rectoría',color:'#6c3483',bg:'#f5eef8'},
      'aviso-docente':   {label:'👨‍🏫 Aviso Docente',   color:'#1e8449',bg:'#eafaf1'},
    };
    cont.innerHTML=related.slice(0,40).map(n=>{
      const ts=n.createdAt?new Date(n.createdAt).toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
      const ki=kindInfo[n.kind]||{label:'📬 Notificación',color:'#555',bg:'#f9f9f9'};
      const meta=n.meta||{};
      return `<div style="border-left:4px solid ${ki.color};background:${n.seen?'#fafafa':ki.bg};padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:10px;transition:background 0.3s">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          <span style="background:${ki.color};color:#fff;border-radius:5px;padding:2px 9px;font-size:0.7rem;font-weight:bold">${ki.label}</span>
          ${!n.seen?'<span style="background:#e74c3c;color:#fff;border-radius:10px;padding:1px 8px;font-size:0.68rem;font-weight:bold">● NUEVO</span>':''}
          <span style="font-size:0.72rem;color:#aaa;margin-left:auto">${ts}</span>
        </div>
        <p style="margin:0 0 4px;font-size:0.87rem;color:#222;line-height:1.55">${n.message||''}</p>
        ${meta.areasP?`<p style="margin:4px 0 0;font-size:0.79rem;color:#c0392b;font-weight:600">📚 Áreas perdidas: <b>${meta.areasP}</b> · Período: <b>${meta.periodo||'—'}</b></p>`:''}
        ${meta.umbral?`<p style="margin:2px 0 0;font-size:0.74rem;color:#888">Umbral evaluado: ${meta.umbral} área(s)</p>`:''}
        <p style="margin:4px 0 0;font-size:0.72rem;color:#aaa">Enviado por: <b>${n.actor||'Sistema'}</b></p>
      </div>`;
    }).join('');
  } catch(e){
    cont.innerHTML='<div style="padding:14px;color:#c0392b;font-size:0.85rem;text-align:center">❌ No se pudieron cargar los comunicados. Verifique su conexión e intente de nuevo.</div>';
  }
}

// ============================================================
// VISTA ESTUDIANTE
// ============================================================
function renderEstudiante(){
  const est=db.ests.find(e=>e.id===sesion.estId);
  if(!est){document.getElementById('app').innerHTML='<div class="login-wrap"><div class="login-box"><p>Estudiante no encontrado.</p><button class="btn btn-navy" onclick="cerrarSesion()">Volver</button></div></div>';return;}
  const trabsEst=(db.materialEstudiantes||[]).filter(t=>t.gra===est.g||t.estId===est.id);
  const _privadaE=_getPlatTipo()==='privada';
  const _bloqueadoE=_esPensionBloqueada(est);
  const modalidad=est.modalidad||'presencial';
  const esOnline=modalidad==='online';

  // Observador del estudiante (sus propias anotaciones)
  const obsEst=(est.observaciones||[]).slice().reverse();
  const obsHtml=obsEst.length?obsEst.map(o=>{
    const col=o.tipo==='logro'||o.tipo==='positivo'?'#1e8449':o.tipo==='academico'?'#1a5276':'#c0392b';
    const bg=o.tipo==='logro'||o.tipo==='positivo'?'#d5f5e3':o.tipo==='academico'?'#eaf0fb':'#fde8e8';
    const ico=o.tipo==='logro'||o.tipo==='positivo'?'🌟':o.tipo==='academico'?'📚':'⚠️';
    return `<div style="border-left:4px solid ${col};background:${bg};padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:4px">
        <span style="background:${col};color:#fff;border-radius:5px;padding:2px 8px;font-size:0.7rem;font-weight:bold">${ico} ${o.tipo||'General'}</span>
        <span style="font-size:0.72rem;color:#888">P${o.per||'—'} · ${o.fecha||''} · ${o.doc||'Docente'}</span>
      </div>
      <p style="margin:4px 0;font-size:0.86rem;color:#222">${o.txt||''}</p>
    </div>`;
  }).join(''):`<p class="empty">No hay anotaciones en el observador hasta el momento.</p>`;

  // Panel diferenciado por modalidad
  const _gradoObjEst=db.grados.find(g=>g.n===est.g)||{};
  const _linkVirtual=est.linkClase||_gradoObjEst.linkClase||'';
  const _linksMatEst=(db.materialEstudiantes||[]).filter(t=>(t.gra===est.g||t.estId===est.id)&&t.categoria==='link');
  const panelModalidad=esOnline?`<div class="card" style="border-left:4px solid #9b59b6;background:linear-gradient(135deg,#f5eef8,#fff)">
    <h4 class="card-title" style="color:#6c3483">💻 Mi Espacio Virtual — Modalidad Online</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:12px">
      ${_linkVirtual?`<a href="${_linkVirtual}" target="_blank" class="btn" style="background:#6c3483;color:#fff;text-decoration:none;display:flex;align-items:center;gap:8px;justify-content:center;padding:12px 16px;border-radius:10px;font-weight:bold">🎥 Unirse a Clase Virtual</a>`:'<div class="info-box">🎥 El enlace de clase virtual será publicado por el docente o administrador.</div>'}
      <div style="background:#f0e6fa;border-radius:8px;padding:12px;font-size:0.84rem">
        <b style="color:#6c3483">📋 Tu información</b><br>
        Modalidad: <b>Online/Virtual</b><br>
        Grado: <b>${est.g}</b><br>
        Jornada: <b>${est.jornada||'—'}</b>
      </div>
    </div>
    ${_linksMatEst.length?`<div style="margin-top:10px;padding:10px 14px;background:#f5eef8;border-radius:8px"><b style="color:#6c3483;font-size:0.85rem">🔗 Recursos del docente:</b><ul style="padding-left:18px;margin:6px 0 0">${_linksMatEst.map(t=>`<li style="margin-bottom:5px"><a href="${t.url}" target="_blank" style="color:#6c3483;font-weight:bold">${t.nombre||t.tipoLink||'Recurso'}</a><span style="font-size:0.75rem;color:#888"> — ${t.asig||'General'} · ${t.fecha||''}</span></li>`).join('')}</ul></div>`:''}
    <div class="info-box" style="background:#f5eef8;border-left-color:#9b59b6;color:#6c3483;font-size:0.83rem;margin-top:10px">📌 <b>Recuerde:</b> Conectarse puntualmente a las clases virtuales, mantener la cámara encendida y participar activamente.</div>
  </div>`:`<div class="card" style="border-left:4px solid #1a5276;background:linear-gradient(135deg,#eaf4fe,#fff)">
    <h4 class="card-title" style="color:#1a5276">🏫 Mi Información — Modalidad Presencial</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px">
      <div style="background:#e8f4fc;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:1.4rem">🏫</div><div style="font-size:0.75rem;color:#555;margin-top:4px">Sede</div>
        <div style="font-weight:bold;color:#1a5276">${est.sede||'Principal'}</div>
      </div>
      <div style="background:#e8f4fc;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:1.4rem">⏰</div><div style="font-size:0.75rem;color:#555;margin-top:4px">Jornada</div>
        <div style="font-weight:bold;color:#1a5276">${est.jornada||'Mañana'}</div>
      </div>
      <div style="background:#e8f4fc;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:1.4rem">🎒</div><div style="font-size:0.75rem;color:#555;margin-top:4px">Grado</div>
        <div style="font-weight:bold;color:#1a5276">${est.g}</div>
      </div>
      <div style="background:#e8f4fc;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:1.4rem">👨‍🏫</div><div style="font-size:0.75rem;color:#555;margin-top:4px">Dir. Grupo</div>
        <div style="font-weight:bold;color:#1a5276;font-size:0.8rem">${(db.grados.find(g=>g.n===est.g)||{}).d||'—'}</div>
      </div>
    </div>
  </div>`;

  document.getElementById('app').innerHTML=`
  <div class="header">${db.logo?`<img src="${db.logo}" style="max-height:80px;border-radius:6px">`:""}<h1>Portal del Estudiante — ${db.nombre||'Institución'} ${db.anio}</h1><p>${est.n} · ${est.g} · ${esOnline?'💻 Online':'🏫 Presencial'}</p></div>
  <div class="topbar"><span><b>Estudiante:</b> ${est.n}</span><div class="topbar-btns">
    ${moduloActivo('pre-matricula')?'<button class="tbtn" style="background:#27ae60" onclick="abrirPreMatriculaLogueado()">📝 Pre-Matrícula</button>':''}
    <button class="tbtn" style="background:#c0392b" onclick="cerrarSesion()">🚪 Salir</button></div></div>
  <div class="main">
    ${panelModalidad}
    ${_privadaE?`<div class="card" style="border-left:4px solid ${_bloqueadoE?'#c0392b':'#27ae60'}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:1.4rem">${_bloqueadoE?'⛔':'✅'}</span>
        <div>
          <b style="color:${_bloqueadoE?'#c0392b':'#27ae60'};font-size:0.95rem">Pensión: ${_bloqueadoE?'PENDIENTE DE PAGO':'AL DÍA'}</b><br>
          <small style="color:#555">${_bloqueadoE?'El consolidado de notas estará disponible una vez se regularice el pago.':'Consolidado de notas disponible.'}</small>
        </div>
        <button class="btn" style="margin-left:auto;background:${_bloqueadoE?'#c0392b':'#003366'};color:#fff;font-size:0.82rem;padding:7px 14px" ${_bloqueadoE?'disabled':'onclick="pdfConsolidadoEst(\''+String(est.id)+'\')"'}>${_bloqueadoE?'⛔ Bloqueado':'📊 Descargar Consolidado de Notas'}</button>
      </div>
    </div>`:`<div class="card" style="border-left:4px solid #003366;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div><b>📊 Consolidado de Notas</b><br><small style="color:#555">Vea y descargue sus calificaciones por período</small></div>
      <button class="btn btn-navy" onclick="pdfConsolidadoEst('${String(est.id)}')">📊 Descargar Consolidado</button>
    </div>`}
    ${moduloActivo('pre-matricula')?`<div class="card" style="border-left:4px solid #27ae60">
      <h4 class="card-title" style="color:#27ae60">📝 Pre-Matrícula Online — Año ${parseInt(db.anio)+1||2027}</h4>
      <p style="font-size:0.88rem;color:#555;margin-bottom:12px">Realice aquí el proceso de pre-matrícula para el próximo año lectivo.</p>
      <button class="btn btn-green" onclick="abrirPreMatriculaLogueado()">📝 Iniciar Formulario de Pre-Matrícula</button>
    </div>`:''}
    ${htmlEleccionEstudiante(est)}
    <div class="card" id="est-notif-card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <h4 class="card-title" style="margin:0">
          📬 Mis Comunicados
          <span id="est-notif-badge" style="display:none;background:#c0392b;color:#fff;border-radius:20px;padding:1px 8px;font-size:0.72rem;font-weight:bold;vertical-align:middle;margin-left:6px"></span>
        </h4>
        <button class="btn" style="background:#1a3a5c;color:#fff;font-size:0.78rem;padding:5px 12px" onclick="cargarNotifsPadre(${JSON.stringify(est.id)},'est-notif-list','est-notif-badge')">🔄 Actualizar</button>
      </div>
      <div id="est-notif-list"><div style="text-align:center;padding:14px;color:#aaa;font-size:0.85rem">⏳ Cargando comunicados...</div></div>
    </div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px"><h4 class="card-title" style="margin:0">📊 Mis Calificaciones por Período</h4><button class="btn btn-navy" style="font-size:0.8rem;padding:6px 14px" onclick="pdfConsolidadoEst('${String(est.id)}')">📊 Descargar Consolidado</button></div>${htmlNotasEstudiante(est)}</div>
    <div class="card">
      <h4 class="card-title" style="color:#8e44ad">📓 Mi Observador Digital</h4>
      <p style="font-size:0.82rem;color:#888;margin-bottom:12px">Anotaciones de convivencia y académicas registradas por docentes y directivos.</p>
      ${obsHtml}
      ${obsEst.length?`<div style="margin-top:10px"><button class="btn btn-sm" style="background:#6c3483" onclick="_verObservadorCompleto(${JSON.stringify(est.id)})">📋 Ver Observador Completo</button></div>`:''}
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <h4 class="card-title" style="margin:0">📅 Mi Horario Semanal — Grado ${est.g}</h4>
        <button class="btn btn-navy" style="font-size:0.8rem;padding:6px 14px" onclick="pdfHorarioGrado('${est.g}')">📥 PDF Horario</button>
      </div>
      ${htmlHorarioReadOnly(est.g)}
    </div>
    <div class="card"><h4 class="card-title">📅 Mi Asistencia</h4>${htmlAsistEstudiante(est)}</div>
    <div class="card" style="border-left:4px solid #27ae60">
      <h4 class="card-title">📤 Entrega de Actividades</h4>
      ${htmlActividadesEstudiante(est)}
    </div>
    <div class="card" style="border-left:4px solid #8e44ad">
      <h4 class="card-title">🧩 Mis Quiz y Evaluaciones</h4>
      ${htmlQuizzesEstudiante(est)}
    </div>
    ${htmlEvalDocenteEstudiante(est)}
    <div class="card"><h4 class="card-title">📚 Material y Tareas Recibidas</h4>
      ${trabsEst.length?'<ul style="padding-left:16px">'+trabsEst.map(t=>'<li style="margin-bottom:6px"><b>'+(t.titulo||t.nombre||'Material')+'</b> <span style="color:#888;font-size:0.8rem">· '+(t.fecha||'')+'</span>'+(t.url?' <a href="'+t.url+'" target="_blank" style="color:#1a5276">📎 Ver archivo</a>':'')+'</li>').join('')+'</ul>':'<p class="empty">Sin material recibido aún.</p>'}
    </div>
    <div class="card"><h4 class="card-title">💬 Contacto Institucional</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><b>Director(a) de grupo:</b><br>${(db.grados.find(g=>g.n===est.g)||{}).d||'—'}</div>
        <div><b>Rector(a):</b><br>${db.rectora}</div>
        <div><b>Teléfono:</b><br>${db.telInst||'—'}</div>
        <div><b>Correo:</b><br>${db.emailInst||'—'}</div>
      </div>
      ${db.telInst?`<div style="margin-top:10px"><a class="btn" style="background:#25d366;color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px" target="_blank" href="https://wa.me/57${(db.telInst||'').replace(/\D/g,'')}">💬 WhatsApp Institución</a></div>`:''}
    </div>
    <div class="card" style="border-left:4px solid #1a3a5c">
      <details>
        <summary class="perfil-title" style="color:#1a3a5c;font-size:0.93rem">⚙️ Mis Ajustes de Cuenta — ${est.n}</summary>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;align-items:flex-start">
          <div style="text-align:center;flex-shrink:0">
            <div id="_fotoEstPrev" style="width:80px;height:90px;border-radius:8px;border:2px solid #003366;overflow:hidden;background:#eee;display:flex;align-items:center;justify-content:center;margin-bottom:8px">
              ${sesion.foto?`<img src="${sesion.foto}" style="width:100%;height:100%;object-fit:cover">`:'<span style="font-size:2rem">👤</span>'}
            </div>
            <button class="btn-sm" style="background:#1a5276;margin-bottom:4px;font-size:0.72rem" onclick="document.getElementById('_fileEstFoto').click()">📁 Subir foto</button>
            <input type="file" id="_fileEstFoto" accept="image/*" style="display:none" onchange="cargarFotoPerfilEst(this)">
          </div>
          <div style="flex:1;min-width:220px">
            <p style="font-size:0.82rem;color:#555;margin-bottom:10px">Personalice su usuario y contraseña de acceso al portal estudiantil.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
              <input type="text" id="_estPUser" value="${sesion.u}" placeholder="Nuevo Usuario" style="flex:1;min-width:130px;padding:8px;border:1.5px solid #ddd;border-radius:7px;font-size:0.88rem">
              <span style="position:relative;flex:1;min-width:130px;display:flex;align-items:center">
                <input type="password" id="_estPPass" value="${sesion.p}" placeholder="Nueva Contraseña" style="flex:1;padding:8px;padding-right:34px;border:1.5px solid #ddd;border-radius:7px;font-size:0.88rem">
                <button type="button" onclick="(function(b){var i=document.getElementById('_estPPass');i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'👁️':'🙈'}).call(this,this)" style="position:absolute;right:6px;background:none;border:none;cursor:pointer;font-size:0.9rem">👁️</button>
              </span>
              <button class="btn btn-green" style="white-space:nowrap" onclick="actualizarPerfilEst()">💾 Actualizar</button>
            </div>
            <div style="font-size:0.78rem;color:#888">📄 Documento: <b>${est.numDoc||sesion.u}</b> · 🎓 Grado: <b>${est.g}</b></div>
          </div>
        </div>
      </details>
    </div>
  </div>`;
  setTimeout(()=>cargarNotifsPadre(est.id,'est-notif-list','est-notif-badge'),120);
}

function _verObservadorCompleto(estId){
  const est=db.ests.find(e=>e.id===estId);if(!est) return;
  const obs=(est.observaciones||[]).slice().reverse();
  const ov=document.createElement('div');
  ov.id='_obsCompOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9800;overflow-y:auto;padding:16px;display:flex;align-items:flex-start;justify-content:center';
  let h=`<div style="background:#fff;border-radius:12px;max-width:680px;width:100%;margin:auto;box-shadow:0 8px 40px rgba(0,0,0,0.35)">
    <div style="background:#6c3483;color:#fff;padding:14px 20px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center">
      <h3 style="margin:0;font-size:0.95rem">📓 Observador Digital — ${est.n}</h3>
      <button onclick="document.getElementById('_obsCompOv').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:1.1rem">✕</button>
    </div>
    <div style="padding:20px">`;
  if(!obs.length){h+='<p class="empty">No hay anotaciones registradas.</p>';}
  else{
    const periodos=[...(new Set(obs.map(o=>o.per||'S/P')))];
    periodos.forEach(per=>{
      const del=obs.filter(o=>(o.per||'S/P')===per);
      h+=`<div style="margin-bottom:16px"><div style="background:#f3e5f5;padding:8px 14px;border-radius:6px;font-weight:bold;color:#6c3483;margin-bottom:8px">📌 Período ${per} — ${del.length} anotación(es)</div>`;
      del.forEach(o=>{
        const col=o.tipo==='logro'||o.tipo==='positivo'?'#1e8449':o.tipo==='academico'?'#1a5276':'#c0392b';
        const bg=o.tipo==='logro'||o.tipo==='positivo'?'#d5f5e3':o.tipo==='academico'?'#eaf0fb':'#fde8e8';
        const ico=o.tipo==='logro'||o.tipo==='positivo'?'🌟':o.tipo==='academico'?'📚':'⚠️';
        h+=`<div style="border-left:4px solid ${col};background:${bg};padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:4px">
            <span style="background:${col};color:#fff;border-radius:5px;padding:2px 8px;font-size:0.7rem;font-weight:bold">${ico} ${o.tipo||'General'}</span>
            <span style="font-size:0.72rem;color:#888">${o.fecha||''} · Por: <b>${o.doc||'Docente'}</b></span>
          </div>
          <p style="margin:4px 0;font-size:0.87rem">${o.txt||''}</p>
          ${o.descargo?`<div style="margin-top:6px;padding:6px 10px;background:rgba(255,255,255,0.6);border-radius:6px;font-size:0.8rem"><b>💬 Descargo:</b> ${o.descargo}</div>`:''}
        </div>`;
      });
      h+='</div>';
    });
  }
  h+='</div></div>';
  ov.innerHTML=h;
  document.body.appendChild(ov);
}
function subirActividadEst(){
  const f=document.getElementById('actEstFile').files[0];
  const desc=document.getElementById('actEstDesc').value.trim();
  if(!f||!desc){alert('Seleccione archivo y escriba descripción.');return;}
  const r=new FileReader();
  r.onload=ev=>{
    updDB(d=>{d.materialEstudiantes=d.materialEstudiantes||[];
      d.materialEstudiantes.push({id:Date.now(),estId:sesion.estId,estNom:sesion.n,gra:(db.ests.find(e=>e.id===sesion.estId)||{}).g,titulo:desc,nombre:f.name,url:ev.target.result,fecha:new Date().toLocaleString('es-CO'),tipo:'entrega'});
      return d;});
    document.getElementById('actEstStatus').textContent='✅ Actividad enviada al docente.';
    document.getElementById('actEstFile').value='';document.getElementById('actEstDesc').value='';
  };
  r.readAsDataURL(f);
}

// ============================================================
// CARGA MASIVA CSV DE ESTUDIANTES (con tipo y número de documento)
// ============================================================
function descargarPlantillaXLSX(){
  if(typeof XLSX==='undefined'){alert('Librería Excel no cargada. Recargue la página.');return;}
  const encab=['GRADO','TIPO_DOC','NUM_DOC','APELLIDOS','NOMBRES','FECHA_NAC','TEL_ACUDIENTE','ACUDIENTE','TIPO_DOC_ACU','NUM_DOC_ACU','EMAIL'];
  const ejemplos=[
    ['6°1','T.I.','1098765432','PÉREZ MENDOZA','JUAN CARLOS','2012-05-14','3001234567','MARÍA MENDOZA','C.C.','45678912','acudiente@correo.com'],
    ['6°1','R.C.','1099887766','GARCÍA LÓPEZ','LUISA FERNANDA','2013-03-22','3009998888','PEDRO GARCÍA','C.C.','12345678',''],
    ['7°1','T.I.','1234567890','MARTÍNEZ RUIZ','CARLOS ANDRÉS','2011-08-10','3151234567','ANA RUIZ','C.C.','98765432',''],
  ];
  const instrucciones=[
    ['⚠️ INSTRUCCIONES — NO BORRAR ESTA HOJA'],
    [''],
    ['• Diligencie los datos en la hoja "Estudiantes" (pestaña izquierda).'],
    ['• La primera fila es el encabezado — NO la modifique.'],
    ['• GRADO: escriba exactamente como aparece en el sistema (ej: 6°1, 7°2, 11°).'],
    ['• TIPO_DOC válidos: T.I., C.C., R.C., C.E., Pasaporte, PEP, SIN'],
    ['• FECHA_NAC formato: AAAA-MM-DD (ej: 2012-05-14)'],
    ['• Columnas opcionales pueden dejarse en blanco (TEL, ACUDIENTE, EMAIL…)'],
    ['• El NUM_DOC se usará como contraseña de acceso del estudiante al portal.'],
    ['• Si ya existe un estudiante con el mismo NUM_DOC y grado, se saltará (no duplica).'],
  ];
  const wsEst=XLSX.utils.aoa_to_sheet([encab,...ejemplos]);
  wsEst['!cols']=[{wch:7},{wch:10},{wch:14},{wch:22},{wch:22},{wch:12},{wch:13},{wch:22},{wch:13},{wch:14},{wch:28}];
  const wsInst=XLSX.utils.aoa_to_sheet(instrucciones);
  wsInst['!cols']=[{wch:70}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,wsEst,'Estudiantes');
  XLSX.utils.book_append_sheet(wb,wsInst,'Instrucciones');
  _xlsxDescargarBlob(wb,'PLANTILLA_ESTUDIANTES_'+(db.nombre||'INETIS').replace(/[^a-zA-Z0-9]/g,'_')+'.xlsx');
}
function descargarPlantillaCSV(){
  const ej='grado,tipo_documento,numero_documento,apellidos,nombres,fecha_nac,telefono_acudiente,nombre_acudiente,tipo_doc_acudiente,num_doc_acudiente,email\n'+
           '6°1,T.I.,1098765432,PÉREZ MENDOZA,JUAN CARLOS,2012-05-14,3001234567,MARÍA MENDOZA,C.C.,45678912,acudiente@correo.com\n'+
           '6°1,R.C.,1099887766,GARCÍA LÓPEZ,LUISA,2013-03-22,3009998888,PEDRO GARCÍA,C.C.,12345678,\n';
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(ej);a.download='PLANTILLA_ESTUDIANTES_INETIS.csv';a.click();
}
function exportarEstudiantesXLSX(){
  if(typeof XLSX==='undefined'){alert('Librería Excel no cargada. Recargue la página.');return;}
  const ests=[...db.ests].sort((a,b)=>{
    const gc=String(a.g).localeCompare(String(b.g),undefined,{numeric:true});
    return gc!==0?gc:a.n.localeCompare(b.n);
  });
  if(!ests.length){alert('No hay estudiantes registrados.');return;}
  const encab=['#','GRADO','APELLIDOS','NOMBRES','NOMBRE COMPLETO','TIPO DOC','NUM DOC','FECHA NAC','TEL ACUDIENTE','ACUDIENTE','TIPO DOC ACU','NUM DOC ACU','EMAIL'];
  const filas=ests.map((e,i)=>[
    i+1,
    e.g||'',
    e.apellidos||e.n.split(' ').slice(0,2).join(' ')||'',
    e.nombres||e.n.split(' ').slice(2).join(' ')||'',
    e.n||'',
    e.tipoDoc||'',
    e.numDoc||'',
    e.fechaNac||'',
    e.telAcud||'',
    e.acudiente||'',
    e.tipoDocAcud||'',
    e.numDocAcud||'',
    e.email||''
  ]);
  // Agrupar también por grado en hojas separadas
  const grados=[...new Set(ests.map(e=>e.g))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}));
  const inst=(db.nombre||getROT3());
  const anio=db.anio||new Date().getFullYear();
  const wb=XLSX.utils.book_new();
  // Hoja principal: todos los estudiantes
  const wsAll=XLSX.utils.aoa_to_sheet([
    [inst+' — Directorio Completo de Estudiantes — Año '+anio],
    ['Total: '+ests.length+' estudiantes | Generado: '+new Date().toLocaleDateString('es-CO')],
    [],
    encab,
    ...filas
  ]);
  wsAll['!cols']=[{wch:4},{wch:7},{wch:24},{wch:24},{wch:40},{wch:10},{wch:14},{wch:12},{wch:14},{wch:26},{wch:12},{wch:14},{wch:28}];
  XLSX.utils.book_append_sheet(wb,wsAll,'Todos');
  // Una hoja por grado
  grados.forEach(g=>{
    const estG=ests.filter(e=>e.g===g);
    const wsG=XLSX.utils.aoa_to_sheet([
      [inst+' — Grado '+g+' — Año '+anio],
      ['Total: '+estG.length+' estudiantes'],
      [],
      encab,
      ...estG.map((e,i)=>[i+1,e.g||'',e.apellidos||'',e.nombres||'',e.n||'',e.tipoDoc||'',e.numDoc||'',e.fechaNac||'',e.telAcud||'',e.acudiente||'',e.tipoDocAcud||'',e.numDocAcud||'',e.email||''])
    ]);
    wsG['!cols']=[{wch:4},{wch:7},{wch:24},{wch:24},{wch:40},{wch:10},{wch:14},{wch:12},{wch:14},{wch:26},{wch:12},{wch:14},{wch:28}];
    // Nombre de hoja: máx 31 caracteres, sin caracteres inválidos
    const shName=String(g).replace(/[:\\/\?*\[\]]/g,'').substring(0,31);
    XLSX.utils.book_append_sheet(wb,wsG,shName||'Grado');
  });
  _xlsxDescargarBlob(wb,'Estudiantes_'+inst.replace(/[^a-zA-Z0-9]/g,'_')+'_'+anio+'.xlsx');
}

function exportarDocentesXLSX(){
  if(typeof XLSX==='undefined'){alert('Librería Excel no cargada. Recargue la página.');return;}
  const docentes=db.users.filter(u=>u.r==='docente');
  if(!docentes.length){alert('No hay docentes registrados.');return;}
  const inst=db.nombre||getROT3();
  const anio=db.anio||new Date().getFullYear();
  const encab=['#','NOMBRE','CÉDULA','USUARIO','CARGO','DECRETO','GRADO ESCALAFÓN','MODALIDAD','TIPO PREGRADO','TÍTULO PREGRADO','NIVEL POSGRADO','TÍTULO POSGRADO','ÁREA BASE','TELÉFONO','CORREO'];
  const filas=docentes.map((u,i)=>[
    i+1, u.n||'', u.cedula||'', u.u||'', u.cargo||'DOCENTE',
    u.decreto||'', u.gradoEscalafon?`Grado ${u.gradoEscalafon}`:'',
    u.decreto==='1278'?(u.modalidadDecre||''):'N/A',
    u.tipoPregrado||'', u.nivelFormacion||'',
    u.nivelPosgrado||'', u.tituloPosgrado||'',
    u.areaBase||'', u.telefono||'', u.correo||''
  ]);
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([
    [inst+' — Reporte Formación Académica Docentes — Año '+anio],
    ['Total: '+docentes.length+' docentes | Generado: '+new Date().toLocaleDateString('es-CO')],
    [],
    encab,
    ...filas
  ]);
  ws['!cols']=[{wch:4},{wch:36},{wch:14},{wch:12},{wch:14},{wch:9},{wch:14},{wch:26},{wch:26},{wch:30},{wch:18},{wch:30},{wch:20},{wch:16},{wch:30}];
  XLSX.utils.book_append_sheet(wb,ws,'Docentes');
  // Hoja resumen por decreto
  const d1278=docentes.filter(d=>d.decreto==='1278');
  const d2277=docentes.filter(d=>d.decreto==='2277');
  const dSin=docentes.filter(d=>!d.decreto);
  const resumen=[
    ['RESUMEN ESCALAFÓN DOCENTE',''],
    ['',''],
    ['Categoría','Cantidad'],
    ['Total docentes',docentes.length],
    ['',''],
    ['Decreto 1278',d1278.length],
    ['  — En Propiedad',d1278.filter(d=>d.modalidadDecre==='Propiedad').length],
    ['  — Periodo de Prueba',d1278.filter(d=>d.modalidadDecre==='Periodo de Prueba').length],
    ['  — Provisional Vacancia Definitiva',d1278.filter(d=>d.modalidadDecre==='Provisional - Vacancia Definitiva').length],
    ['  — Provisional Vacancia Temporal',d1278.filter(d=>d.modalidadDecre==='Provisional - Vacancia Temporal').length],
    ['',''],
    ['Decreto 2277',d2277.length],
    ['Sin decreto asignado',dSin.length],
    ['',''],
    ['Formación académica',''],
    ['Licenciados',docentes.filter(d=>d.tipoPregrado==='Licenciado').length],
    ['Profesionales No Licenciados',docentes.filter(d=>d.tipoPregrado==='Profesional No Licenciado').length],
    ['Con Especialización',docentes.filter(d=>d.nivelPosgrado==='Especialización').length],
    ['Con Maestría',docentes.filter(d=>d.nivelPosgrado==='Maestría').length],
    ['Con Doctorado',docentes.filter(d=>d.nivelPosgrado==='Doctorado').length],
  ];
  const wsR=XLSX.utils.aoa_to_sheet(resumen);
  wsR['!cols']=[{wch:36},{wch:12}];
  XLSX.utils.book_append_sheet(wb,wsR,'Resumen');
  _xlsxDescargarBlob(wb,'Docentes_Formacion_'+inst.replace(/[^a-zA-Z0-9]/g,'_')+'_'+anio+'.xlsx');
}

function exportarDocentesPDF(){
  if(typeof window.jspdf==='undefined'){alert('Librería PDF no cargada. Recargue la página.');return;}
  const docentes=db.users.filter(u=>u.r==='docente');
  if(!docentes.length){alert('No hay docentes registrados.');return;}
  const inst=db.nombre||getROT3();
  const anio=db.anio||new Date().getFullYear();
  const doc=getPDF('l');
  addHeaderRot(doc,'REPORTE DE FORMACIÓN ACADÉMICA DOCENTE','Escalafón y nivel de formación — Año '+anio);
  const startY=34;
  const cols=[
    {header:'N°',dataKey:'num'},
    {header:'Nombre',dataKey:'nombre'},
    {header:'Cédula',dataKey:'cedula'},
    {header:'Decreto',dataKey:'decreto'},
    {header:'Grado Esc.',dataKey:'escala'},
    {header:'Modalidad',dataKey:'modalidad'},
    {header:'Tipo Pregrado',dataKey:'tipoPre'},
    {header:'Título Pregrado',dataKey:'nivForm'},
    {header:'Posgrado',dataKey:'posgrad'},
    {header:'Área',dataKey:'area'},
  ];
  const rows=docentes.map((u,i)=>({
    num:i+1,
    nombre:u.n||'',
    cedula:u.cedula||'',
    decreto:u.decreto||'—',
    escala:u.gradoEscalafon?`Gdo. ${u.gradoEscalafon}`:'—',
    modalidad:u.decreto==='1278'?(u.modalidadDecre||'—'):'N/A',
    tipoPre:u.tipoPregrado||'—',
    nivForm:u.nivelFormacion||'—',
    posgrad:u.nivelPosgrado?(u.nivelPosgrado+(u.tituloPosgrado?' — '+u.tituloPosgrado:'')):'—',
    area:u.areaBase||'—'
  }));
  doc.autoTable({
    startY,
    columns:cols,
    body:rows,
    styles:{fontSize:7,cellPadding:2},
    headStyles:{fillColor:[26,82,118],textColor:255,fontStyle:'bold',fontSize:7.5},
    alternateRowStyles:{fillColor:[240,248,255]},
    columnStyles:{
      num:{cellWidth:8},nombre:{cellWidth:36},cedula:{cellWidth:18},
      decreto:{cellWidth:12},escala:{cellWidth:14},modalidad:{cellWidth:26},tipoPre:{cellWidth:26},
      nivForm:{cellWidth:28},posgrad:{cellWidth:28},area:{cellWidth:18}
    },
    margin:{left:10,right:10},
    didDrawPage:(data)=>{
      const pw=doc.internal.pageSize.width;
      doc.setFontSize(7);doc.setTextColor(120);
      doc.text(`Pág. ${doc.internal.getCurrentPageInfo().pageNumber}`,pw-12,doc.internal.pageSize.height-5,{align:'right'});
      doc.text(new Date().toLocaleDateString('es-CO'),12,doc.internal.pageSize.height-5);
    }
  });
  // Resumen al final
  const finalY=(doc.lastAutoTable?.finalY||startY)+10;
  const pw=doc.internal.pageSize.width;
  doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(26,82,118);
  doc.text('RESUMEN ESCALAFÓN',10,finalY);
  doc.setFont('helvetica','normal');doc.setTextColor(50);
  const d1278=docentes.filter(d=>d.decreto==='1278');
  const items=[
    `Total docentes: ${docentes.length}`,
    `Decreto 1278: ${d1278.length} (Propiedad: ${d1278.filter(d=>d.modalidadDecre==='Propiedad').length} | Periodo de Prueba: ${d1278.filter(d=>d.modalidadDecre==='Periodo de Prueba').length} | Provisionales: ${d1278.filter(d=>d.modalidadDecre&&d.modalidadDecre.includes('Provisional')).length})`,
    `Decreto 2277: ${docentes.filter(d=>d.decreto==='2277').length}`,
    `Licenciados: ${docentes.filter(d=>d.tipoPregrado==='Licenciado').length} | Prof. No Lic.: ${docentes.filter(d=>d.tipoPregrado==='Profesional No Licenciado').length}`,
    `Con Posgrado: Esp. ${docentes.filter(d=>d.nivelPosgrado==='Especialización').length} | Maest. ${docentes.filter(d=>d.nivelPosgrado==='Maestría').length} | Doct. ${docentes.filter(d=>d.nivelPosgrado==='Doctorado').length}`,
  ];
  items.forEach((txt,i)=>{doc.setFontSize(7.5);doc.text(txt,10,finalY+6+(i*5));});
  doc.save('Docentes_Formacion_'+inst.replace(/ /g,'_')+'_'+anio+'.pdf');
}

function cargarEstMasivoArchivo(inp){
  const f=inp.files[0];if(!f) return;
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(ext==='xlsx'||ext==='xls'){cargarEstMasivoExcel(inp);return;}
  cargarEstMasivo(inp);
}
function cargarEstMasivoExcel(inp){
  const f=inp.files[0];if(!f) return;
  if(typeof XLSX==='undefined'){alert('Librería Excel no disponible. Recargue la página.');return;}
  const st=document.getElementById('masivoStatus');
  if(st) st.innerHTML='⏳ Procesando archivo Excel...';
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'binary'});
      // Buscar la hoja de datos (no instrucciones)
      let sheetName=wb.SheetNames[0];
      for(const sn of wb.SheetNames){if(/estud|datos|list|plan/i.test(sn)){sheetName=sn;break;}}
      const ws=wb.Sheets[sheetName];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      if(!rows.length){alert('Hoja de Excel vacía.');return;}
      // Encontrar fila de encabezado
      let hdrIdx=0;
      for(let i=0;i<Math.min(rows.length,5);i++){
        const ru=rows[i].map(c=>String(c||'').toUpperCase());
        if(ru.some(c=>c.includes('GRADO'))&&ru.some(c=>c.includes('NOMBRE')||c.includes('APELLIDO'))){hdrIdx=i;break;}
      }
      const hdr=rows[hdrIdx].map(c=>String(c||'').toUpperCase().replace(/_/g,' ').trim());
      // Mapa de columnas por nombre
      const cm={};
      hdr.forEach((h,i)=>{
        if(h==='GRADO') cm.grado=i;
        else if(h==='TIPO DOC'||h==='TIPO DOCUMENTO'||h==='TIPODOC'||h==='TIPO DOC') cm.tipoDoc=i;
        else if(h==='NUM DOC'||h==='NUMERO DOCUMENTO'||h==='NUM DOCUMENTO'||h==='NUMDOC'||h==='DOCUMENTO') cm.numDoc=i;
        else if(h==='APELLIDOS') cm.ape=i;
        else if(h==='NOMBRES') cm.nom=i;
        else if(h==='FECHA NAC'||h==='FECHA NACIMIENTO'||h==='NACIMIENTO') cm.fnac=i;
        else if(h==='TEL ACUDIENTE'||h==='TELEFONO'||h==='TEL') cm.tel=i;
        else if(h==='ACUDIENTE'||h==='NOMBRE ACUDIENTE'||h==='NOM ACUD') cm.acud=i;
        else if(h==='TIPO DOC ACU'||h==='TIPO DOCUMENTO ACUDIENTE') cm.tipoDocAcud=i;
        else if(h==='NUM DOC ACU'||h==='NUM DOCUMENTO ACUDIENTE') cm.numDocAcud=i;
        else if(h==='EMAIL'||h==='CORREO') cm.email=i;
      });
      if(!('grado' in cm)||!('nom' in cm)||!('ape' in cm)){
        alert('No se encontraron las columnas GRADO, APELLIDOS y NOMBRES. Verifique que usa la plantilla descargada del sistema.');return;
      }
      const rv=v=>String(v||'').trim();
      let creados=0,omitidos=0,errores=[];
      updDB(d=>{
        for(let i=hdrIdx+1;i<rows.length;i++){
          const row=rows[i];
          if(!row||!row.some(c=>c!=='')) continue;
          const grado=rv(row[cm.grado]);const ape=rv(row[cm.ape]).toUpperCase();const nom=rv(row[cm.nom]).toUpperCase();
          if(!grado||!ape||!nom){errores.push('Fila '+(i+1)+': faltan datos obligatorios (grado/apellidos/nombres)');continue;}
          const tipoDoc=rv(row[cm.tipoDoc])||'T.I.';
          const numDoc=rv(row[cm.numDoc])||'';
          const fnac=rv(row[cm.fnac]);const tel=rv(row[cm.tel]);const acud=rv(row[cm.acud]).toUpperCase();
          const tipoDocAcud=rv(row[cm.tipoDocAcud])||'C.C.';const numDocAcud=rv(row[cm.numDocAcud]);const email=rv(row[cm.email]);
          // Evitar duplicados: mismo numDoc+grado o mismo nombre+grado
          const existe=d.ests.some(e=>e.g===grado&&((numDoc&&e.numDoc===numDoc)||(e.n===(ape+' '+nom).trim())));
          if(existe){omitidos++;continue;}
          if(!d.grados.some(g=>g.n===grado)) d.grados.push({n:grado,d:''});
          d.ests.push({id:Date.now()+i+Math.random(),n:(ape+' '+nom).trim(),apellidos:ape,nombres:nom,g:grado,tipoDoc,numDoc,fechaNac:fnac,telAcud:tel,acudiente:acud,tipoDocAcud,numDocAcud,email,nts:{},obs:'',observaciones:[]});
          creados++;
        }
        return d;
      });
      inp.value='';
      const msg='✅ '+creados+' estudiante(s) creados'+(omitidos?' | ⏭️ '+omitidos+' ya existían (omitidos)':'')+(errores.length?' | ⚠️ '+errores.length+' error(es): '+errores.slice(0,3).join(' · '):'');
      if(st) st.innerHTML=msg;
      setTimeout(renderApp,1200);
    }catch(ex){if(st) st.innerHTML='❌ Error: '+ex.message;alert('Error al procesar el archivo Excel: '+ex.message);}
  };
  r.readAsBinaryString(f);
}
function cargarEstMasivo(inp){
  const f=inp.files[0];if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    const txt=String(ev.target.result||'');
    const lines=txt.split(/\r?\n/).filter(l=>l.trim());
    if(!lines.length){alert('Archivo vacío');return;}
    // Quitar BOM
    if(lines[0].charCodeAt(0)===0xFEFF) lines[0]=lines[0].slice(1);
    let start=0;
    if(/grado/i.test(lines[0])&&/documento/i.test(lines[0])) start=1;
    let creados=0,errores=[];
    updDB(d=>{
      for(let i=start;i<lines.length;i++){
        const c=parseCSVLine(lines[i]);
        const grado=(c[0]||'').trim();
        const tipoDoc=(c[1]||'T.I.').trim();
        const numDoc=(c[2]||'').trim();
        const ape=(c[3]||'').trim().toUpperCase();
        const nom=(c[4]||'').trim().toUpperCase();
        const fnac=(c[5]||'').trim();
        const telAcud=(c[6]||'').trim();
        const nomAcud=(c[7]||'').trim().toUpperCase();
        const tipoDocAcud=(c[8]||'C.C.').trim();
        const numDocAcud=(c[9]||'').trim();
        const email=(c[10]||'').trim();
        if(!grado||!nom||!ape){errores.push('Línea '+(i+1)+': falta grado/nombre/apellido');continue;}
        if(!d.grados.some(g=>g.n===grado)){d.grados.push({n:grado,d:''});}
        d.ests.push({id:Date.now()+i,n:(ape+' '+nom).trim(),apellidos:ape,nombres:nom,g:grado,tipoDoc,numDoc,fechaNac:fnac,telAcud,acudiente:nomAcud,tipoDocAcud,numDocAcud,email,nts:{},obs:'',observaciones:[]});
        creados++;
      }
      return d;
    });
    const st=document.getElementById('masivoStatus');
    if(st){st.innerHTML='✅ '+creados+' estudiantes creados.'+(errores.length?'<br><span style=color:#c0392b>⚠ '+errores.length+' errores: '+errores.slice(0,5).join(' · ')+'</span>':'');}
    setTimeout(renderApp,1500);
  };
  r.readAsText(f,'UTF-8');
}
function parseCSVLine(line){
  const out=[];let cur='';let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(inQ){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else inQ=false;}else cur+=ch;}
    else{if(ch===','){out.push(cur);cur='';}else if(ch==='"'&&!cur)inQ=true;else cur+=ch;}
  }
  out.push(cur);return out;
}

// ============================================================
// PROMOCIÓN AUTOMÁTICA / CIERRE DE AÑO
// ============================================================
function gradoSiguiente(g){
  // Heurística: extrae el número (6, 7, 8…) y suma 1 conservando el sufijo (°1, °2…)
  const m=String(g).match(/^(\d+)(.*)$/);
  if(!m) return null;
  const n=parseInt(m[1],10);if(n>=11) return 'EGRESADO';
  return (n+1)+m[2];
}
function evaluarPromocion(est){
  const areasP=getAreasPerdidas(est.id,est.g);
  const np=areasP.length;
  if(np<=1) return {decision:'PROMOVIDO',areasPerd:areasP,nuevoGrado:gradoSiguiente(est.g)};
  if(np>=3) return {decision:'REPROBADO',areasPerd:areasP,nuevoGrado:est.g};
  // 2 áreas perdidas: depende de promedio nivelado P4
  const prom=calcPromedioEst(est.id,est.g);
  return {decision:prom>=3.0?'PROMOVIDO':'REPROBADO',areasPerd:areasP,nuevoGrado:prom>=3.0?gradoSiguiente(est.g):est.g};
}
function vistaPreviaPromocion(){
  const wrap=document.getElementById('promoVista');if(!wrap) return;
  const ests=db.ests.slice().sort((a,b)=>(a.g||'').localeCompare(b.g||'')||a.n.localeCompare(b.n));
  if(!ests.length){wrap.innerHTML='<p class="empty">No hay estudiantes registrados.</p>';return;}
  let rows='';
  ests.forEach(e=>{
    const r=evaluarPromocion(e);
    const col=r.decision==='PROMOVIDO'?'#27ae60':'#c0392b';
    rows+=`<tr><td style=text-align:left>${e.n}</td><td>${e.g}</td><td>${r.areasPerd.length}</td>
      <td style="color:${col};font-weight:bold">${r.decision}</td><td>${r.nuevoGrado}</td></tr>`;
  });
  wrap.innerHTML='<div class="over"><table><thead><tr><th>Estudiante</th><th>Grado actual</th><th>Áreas perd.</th><th>Decisión</th><th>Grado nuevo</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function ejecutarPromocion(){
  const auto=db.autoPromocion!==false;
  if(!confirm('¿Ejecutar cierre de año? '+(auto?'Los estudiantes promovidos serán movidos al grado siguiente automáticamente.':'En modo manual solo se calcularán los resultados — luego deberá moverlos uno a uno.'))) return;
  const decisiones=[];
  updDB(d=>{
    d.historiales=d.historiales||{};
    d.ests.forEach(e=>{
      const r=evaluarPromocion(e);
      decisiones.push({id:e.id,n:e.n,g:e.g,...r});
      // Guardar histórico del año actual
      d.historiales[d.anio]=d.historiales[d.anio]||[];
      d.historiales[d.anio].push({id:e.id,n:e.n,grado:e.g,decision:r.decision,fecha:new Date().toISOString(),areasPerd:r.areasPerd});
    });
    if(auto){
      d.ests=d.ests.map(e=>{
        const dec=decisiones.find(x=>x.id===e.id);
        if(!dec) return e;
        if(dec.decision==='PROMOVIDO'&&dec.nuevoGrado&&dec.nuevoGrado!=='EGRESADO') return {...e,g:dec.nuevoGrado,nts:{}};
        if(dec.decision==='PROMOVIDO'&&dec.nuevoGrado==='EGRESADO') return {...e,g:'EGRESADO',nts:e.nts};
        return e; // reprobados se quedan en mismo grado, mantienen nts para revisión
      });
    }
    return d;
  });
  const prom=decisiones.filter(d=>d.decision==='PROMOVIDO').length;
  const rep=decisiones.filter(d=>d.decision==='REPROBADO').length;
  alert('Cierre de año ejecutado.\n✅ Promovidos: '+prom+'\n❌ Reprobados: '+rep+(auto?'\n\nEstudiantes promovidos movidos al grado siguiente.':'\n\nModo manual: vea la vista previa para decidir.'));
  vistaPreviaPromocion();
}

// ============================================================
// SELECTOR DE PLANTILLA DE BOLETÍN (Oficio - 1 página)
// ============================================================
window.boletinPlantilla=window.boletinPlantilla||'clasico';
function seleccionarPlantillaBoletin(){
  const sel=document.getElementById('boletinPlantillaSel');
  if(sel){window.boletinPlantilla=sel.value;localStorage.setItem('inetis_boletin_plantilla',sel.value);}
}
try{const _bp=localStorage.getItem('inetis_boletin_plantilla');if(_bp) window.boletinPlantilla=_bp;}catch(e){}

// Descarga del HTML completo (versión offline) usando el código que se está ejecutando.
function descargarHTMLOffline(){
  try{
    const html='<!DOCTYPE html>\n'+document.documentElement.outerHTML;
    _descargarTextoComoArchivo(html,'INETIS_Sistema_Academico_2026.html','text/html;charset=utf-8');
  }catch(e){alert('No se pudo descargar el HTML: '+e.message);}
}

// ── Helper robusto de descarga ──
// Usa URL.createObjectURL con revocación diferida para evitar archivos corruptos o expirados.
// Funciona en Replit y cualquier entorno donde el proxy intercepte el blob inmediatamente.
function _descargarTextoComoArchivo(texto,nombre,tipo){
  try{
    const blob=new Blob([texto],{type:tipo||'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=nombre; a.style.display='none';
    document.body.appendChild(a);
    a.click();
    // Revocar después de 30 segundos — suficiente para que el navegador procese la descarga
    setTimeout(function(){
      try{URL.revokeObjectURL(url);}catch(ex){}
      try{document.body.removeChild(a);}catch(ex){}
    },30000);
  }catch(e){
    // Fallback: intentar con FileReader → data URL (máxima compatibilidad)
    try{
      const blob=new Blob([texto],{type:tipo||'text/plain;charset=utf-8'});
      const reader=new FileReader();
      reader.onload=function(ev){
        const a=document.createElement('a');
        a.href=ev.target.result; a.download=nombre; a.style.display='none';
        document.body.appendChild(a); a.click();
        setTimeout(function(){try{document.body.removeChild(a);}catch(ex){}},5000);
      };
      reader.readAsDataURL(blob);
    }catch(e2){alert('No se pudo descargar el archivo: '+e2.message);}
  }
}


// ============================================================
// TABLERO DE ESTADÍSTICAS INSTITUCIONAL
// ============================================================
function htmlTablero(){
  const ests=db.ests||[];
  const grados=db.grados||[];
  const carga=db.carga||[];
  const asistencia=db.asistencia||[];

  // ── Calcular estadísticas por estudiante ──
  const estStats=ests.map(e=>{
    const mats=carga.filter(c=>c.g===e.g);
    if(!mats.length) return {e,prom:0,tieneNotas:false};
    const tieneNotas=mats.some(m=>{for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,m.id,p)>0) return true;return false;});
    const prom=tieneNotas?calcPromedioEst(e.id,e.g):0;
    return {e,prom,tieneNotas};
  });

  // KPIs globales
  const conNotas=estStats.filter(s=>s.tieneNotas);
  const aprobados=conNotas.filter(s=>s.prom>=3.0).length;
  const reprobados=conNotas.filter(s=>s.prom<3.0).length;
  const promInst=conNotas.length?parseFloat((conNotas.reduce((s,x)=>s+x.prom,0)/conNotas.length).toFixed(2)):0;
  const pctAprobados=conNotas.length?Math.round(aprobados/conNotas.length*100):0;
  const pctReprobados=conNotas.length?Math.round(reprobados/conNotas.length*100):0;
  const enRiesgo=conNotas.filter(s=>s.prom<3.0).sort((a,b)=>a.prom-b.prom);

  // Asistencia
  const totalReg=asistencia.length;
  const ausentes=asistencia.filter(a=>/ausente|falta/i.test(a.estado||a.tipo||'')).length;
  const pctAsist=totalReg?Math.round((1-ausentes/totalReg)*100):0;

  // Evolución por período (promedio institucional)
  const perData=[1,2,3,4].map(per=>{
    let sum=0,cnt=0;
    ests.forEach(e=>{
      const mats=carga.filter(c=>c.g===e.g);
      if(!mats.length) return;
      const hasPer=mats.some(m=>calcNotaDef(e.nts,m.id,per)>0);
      if(!hasPer) return;
      sum+=calcPromedioEstPer(e.id,e.g,per);cnt++;
    });
    return cnt?parseFloat((sum/cnt).toFixed(2)):0;
  });

  // Por grado
  const porGrado=grados.map(g=>{
    const estsG=ests.filter(e=>e.g===g.n);
    const matsG=carga.filter(c=>c.g===g.n);
    if(!matsG.length||!estsG.length) return {g:g.n,prom:0,pct:0,pctRep:0,total:estsG.length,apr:0,rep:0,conN:0};
    let ap=0,re=0,sp=0,cn=0;
    estsG.forEach(e=>{
      const hasMat=matsG.some(m=>{for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,m.id,p)>0) return true;return false;});
      if(!hasMat) return;
      cn++;const pr=calcPromedioEst(e.id,g.n);sp+=pr;
      if(pr>=3.0)ap++;else re++;
    });
    return {g:g.n,prom:cn?parseFloat((sp/cn).toFixed(2)):0,pct:cn?Math.round(ap/cn*100):0,pctRep:cn?Math.round(re/cn*100):0,total:estsG.length,apr:ap,rep:re,conN:cn};
  });

  // ── TARJETAS KPI ──
  const kpis=[
    {ico:'👥',val:ests.length,lbl:'Estudiantes',col:'#1a3a5c'},
    {ico:'✅',val:pctAprobados+'%',lbl:'Aprobados',col:'#1e8449'},
    {ico:'❌',val:pctReprobados+'%',lbl:'Reprobados',col:'#922b21'},
    {ico:'📊',val:promInst.toFixed(2),lbl:'Prom. Inst.',col:promInst>=4?'#1a5276':promInst>=3?'#b7770d':'#922b21'},
    {ico:'📅',val:pctAsist+'%',lbl:'Asistencia',col:pctAsist>=90?'#1e8449':pctAsist>=75?'#b7770d':'#922b21'},
    {ico:'⚠️',val:enRiesgo.length,lbl:'En Riesgo',col:enRiesgo.length?'#c0392b':'#1e8449'},
  ];
  const tarjetas=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px">
    ${kpis.map(k=>`<div style="background:${k.col};color:#fff;border-radius:12px;padding:16px 10px;text-align:center;box-shadow:0 3px 10px rgba(0,0,0,.18)">
      <div style="font-size:1.8rem;line-height:1">${k.ico}</div>
      <div style="font-size:1.65rem;font-weight:900;margin:5px 0;letter-spacing:-1px">${k.val}</div>
      <div style="font-size:0.72rem;opacity:.9;letter-spacing:.3px">${k.lbl}</div>
    </div>`).join('')}
  </div>`;

  // ── GRÁFICA SVG BARRAS POR GRADO ──
  const CA='#1e8449',CR='#c0392b';
  const BW=28,GAP=10,PL=34,SH=120;
  const svgW=PL+(BW*2+GAP+10)*porGrado.length+GAP+8;
  const guias=[25,50,75,100].map(v=>{
    const y=SH+10-Math.round(v/100*SH);
    return `<line x1="${PL}" y1="${y}" x2="${svgW}" y2="${y}" stroke="#ececec" stroke-dasharray="3,3"/><text x="${PL-3}" y="${y+3}" text-anchor="end" font-size="7.5" fill="#bbb">${v}%</text>`;
  }).join('');
  const barras=porGrado.map((g,i)=>{
    const x=PL+i*(BW*2+GAP+10)+GAP;
    const hA=Math.round(g.pct/100*SH)||0;
    const hR=Math.round(g.pctRep/100*SH)||0;
    const xR=x+BW+4;
    const nom=g.g.length>9?g.g.substring(0,8)+'…':g.g;
    return `<rect x="${x}" y="${SH+10-hA}" width="${BW}" height="${hA}" fill="${CA}" rx="3"><title>Aprobados: ${g.pct}% (${g.apr}/${g.conN})</title></rect>
      <text x="${x+BW/2}" y="${SH+10-hA-3}" text-anchor="middle" font-size="8.5" fill="${CA}" font-weight="bold">${g.pct?g.pct+'%':''}</text>
      <rect x="${xR}" y="${SH+10-hR}" width="${BW}" height="${hR}" fill="${CR}" rx="3"><title>Reprobados: ${g.pctRep}% (${g.rep}/${g.conN})</title></rect>
      <text x="${xR+BW/2}" y="${SH+10-hR-3}" text-anchor="middle" font-size="8.5" fill="${CR}" font-weight="bold">${g.pctRep?g.pctRep+'%':''}</text>
      <text x="${x+BW}" y="${SH+23}" text-anchor="middle" font-size="8" fill="#444">${nom}</text>
      <text x="${x+BW}" y="${SH+33}" text-anchor="middle" font-size="7" fill="#999">${g.conN}/${g.total}</text>`;
  }).join('');
  const leyG=`<g><rect x="${PL}" y="1" width="9" height="9" fill="${CA}" rx="2"/><text x="${PL+12}" y="9" font-size="9" fill="#333">Aprobados</text>
    <rect x="${PL+75}" y="1" width="9" height="9" fill="${CR}" rx="2"/><text x="${PL+87}" y="9" font-size="9" fill="#333">Reprobados</text></g>`;
  const grafGrado=porGrado.length?`<div style="overflow-x:auto"><svg width="${Math.max(svgW,340)}" height="${SH+50+16}" style="display:block">
    ${leyG}${guias}${barras}
    <line x1="${PL}" y1="10" x2="${PL}" y2="${SH+10}" stroke="#ccc"/>
    <line x1="${PL}" y1="${SH+10}" x2="${svgW}" y2="${SH+10}" stroke="#ccc"/>
  </svg></div>`:`<p style="color:#aaa;text-align:center;padding:20px">Sin datos de notas.</p>`;

  // ── GRÁFICA SVG LÍNEA POR PERÍODO ──
  const SPW=320,SPH=110,SPL=30,SPB=28;
  const validPer=perData.filter(v=>v>0);
  const mnY=validPer.length?Math.max(0,Math.min(...validPer)-0.4):0;
  const mxY=validPer.length?Math.min(5,Math.max(...validPer)+0.3):5;
  const mY=v=>SPH+10-Math.round(((v-mnY)/(mxY-mnY||1))*SPH);
  const stepX=(SPW-SPL-16)/3;
  const pts=perData.map((v,i)=>({x:SPL+16+i*stepX,y:v>0?mY(v):null,v}));
  const poly=pts.filter(p=>p.y!==null).map(p=>`${p.x},${p.y}`).join(' ');
  const guiasL=[3,3.5,4,4.5].filter(v=>v>=mnY&&v<=mxY).map(v=>{
    const y=mY(v);
    return `<line x1="${SPL}" y1="${y}" x2="${SPW}" y2="${y}" stroke="#efefef" stroke-dasharray="3,2"/><text x="${SPL-3}" y="${y+3}" text-anchor="end" font-size="7.5" fill="#bbb">${v.toFixed(1)}</text>`;
  }).join('');
  const circulos=pts.map((p,i)=>{
    if(p.y===null) return '';
    const col=p.v>=3?'#1e8449':'#c0392b';
    return `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${col}" stroke="#fff" stroke-width="1.5"/>
      <text x="${p.x}" y="${p.y-9}" text-anchor="middle" font-size="10" font-weight="bold" fill="${col}">${p.v.toFixed(2)}</text>
      <text x="${p.x}" y="${SPH+22}" text-anchor="middle" font-size="10" fill="#555">P${i+1}</text>`;
  }).join('');
  const grafPer=`<svg width="${SPW}" height="${SPH+SPB+16}" style="display:block;margin:0 auto">
    ${guiasL}
    ${poly?`<polyline points="${poly}" fill="none" stroke="#2980b9" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`:''}
    ${circulos}
    <line x1="${SPL}" y1="10" x2="${SPL}" y2="${SPH+10}" stroke="#ccc"/>
    <line x1="${SPL}" y1="${SPH+10}" x2="${SPW}" y2="${SPH+10}" stroke="#ccc"/>
    ${validPer.length===0?`<text x="${SPW/2}" y="${SPH/2+10}" text-anchor="middle" font-size="11" fill="#bbb">Sin datos de períodos</text>`:''}
  </svg>`;

  // ── TABLA RIESGO ──
  const filasRiesgo=enRiesgo.length?enRiesgo.slice(0,25).map((s,i)=>{
    const areasP=calcAreasPerd(s.e.id,s.e.g);
    const nivel=s.prom<2?'🔴 Crítico':s.prom<2.5?'🟠 Alto':s.prom<2.8?'🟡 Moderado':'🟡 Leve';
    return `<tr style="${i%2===0?'background:#fffafa':'background:#fff'}">
      <td style="padding:7px 10px;font-weight:500">${s.e.n}</td>
      <td style="padding:6px 8px;text-align:center;color:#666;font-size:0.82rem">${s.e.g}</td>
      <td style="padding:6px 8px;text-align:center;font-weight:bold;color:${colorNota(s.prom)}">${s.prom.toFixed(2)}</td>
      <td style="padding:6px 8px;text-align:center;color:#c0392b;font-weight:bold">${areasP}</td>
      <td style="padding:6px 8px;text-align:center;font-size:0.8rem">${nivel}</td>
      <td style="padding:6px 8px;text-align:center"><button class="btn-sm" style="background:#1a5276" onclick="verHistorialEstudiante('${String(s.e.id).replace(/'/g,"\\'")}')">👁 Historial</button></td>
    </tr>`;
  }).join(''):`<tr><td colspan="6" style="padding:18px;text-align:center;color:#1e8449;font-weight:bold">✅ Ningún estudiante en riesgo académico actualmente.</td></tr>`;

  // ── TOP PERFORMERS ──
  const top5=conNotas.slice().sort((a,b)=>b.prom-a.prom).slice(0,5);
  const topHtml=top5.length?top5.map((s,i)=>{
    const med=i===0?'🥇':i===1?'🥈':i===2?'🥉':'⭐';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;background:${i%2===0?'#f7fbff':'#fff'};margin-bottom:4px">
      <span style="font-size:1.25rem">${med}</span>
      <div style="flex:1"><div style="font-weight:600;font-size:0.88rem">${s.e.n}</div><div style="font-size:0.74rem;color:#888">${s.e.g}</div></div>
      <span style="font-weight:bold;font-size:1rem;color:${colorNota(s.prom)}">${s.prom.toFixed(2)}</span>
    </div>`;
  }).join(''):`<p style="color:#aaa;text-align:center;font-size:0.85rem;padding:14px">Sin datos de notas aún.</p>`;

  // ── COMPARATIVO POR DOCENTE ──
  const docenteMap={};
  (carga).forEach(c=>{
    if(!c.d) return;
    const docUser=(db.users||[]).find(u=>u.u===c.d);
    const docNombre=docUser?.n||c.d;
    if(!docenteMap[c.d]) docenteMap[c.d]={nombre:docNombre,asigs:[]};
    const estsG=ests.filter(e=>e.g===c.g);
    let sum=0,cnt=0;
    estsG.forEach(e=>{
      let ok=false;for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,c.id,p)>0){ok=true;break;}
      if(!ok) return;
      sum+=calcPromedioMat(e.id,c.id);cnt++;
    });
    if(cnt>0) docenteMap[c.d].asigs.push({mat:c.m,grado:c.g,prom:parseFloat((sum/cnt).toFixed(2)),cnt});
  });
  const docenteList=Object.values(docenteMap).sort((a,b)=>a.nombre.localeCompare(b.nombre));

  // Promedio global por docente (ponderado por asignatura)
  docenteList.forEach(d=>{
    if(!d.asigs.length){d.promGlobal=0;return;}
    d.promGlobal=parseFloat((d.asigs.reduce((s,a)=>s+a.prom,0)/d.asigs.length).toFixed(2));
  });

  // Asignatura con mayor y menor promedio (global)
  const todasAsigs=docenteList.flatMap(d=>d.asigs.map(a=>({...a,docNombre:d.nombre})));
  const mejorAsig=todasAsigs.length?todasAsigs.slice().sort((a,b)=>b.prom-a.prom)[0]:null;
  const peorAsig=todasAsigs.length?todasAsigs.slice().sort((a,b)=>a.prom-b.prom)[0]:null;

  // HTML: minibarras horizontales por docente
  const filasDocente=docenteList.length?docenteList.map((d,i)=>{
    const asigsSorted=d.asigs.slice().sort((a,b)=>a.prom-b.prom);
    const colProm=d.promGlobal>=4?'#1e8449':d.promGlobal>=3?'#1a5276':'#c0392b';
    const pills=asigsSorted.map(a=>{
      const bg=a.prom>=4?'#1e8449':a.prom>=3?'#1a5276':'#c0392b';
      return `<span title="${a.mat} — Grado ${a.grado} — ${a.cnt} est." style="display:inline-block;background:${bg};color:#fff;border-radius:6px;padding:2px 7px;font-size:0.7rem;margin:2px 3px 2px 0;white-space:nowrap;cursor:default">${a.mat}: <b>${a.prom.toFixed(2)}</b></span>`;
    }).join('');
    const barW=Math.min(100,Math.round(d.promGlobal/5*100));
    return `<tr style="${i%2===0?'background:#f9fbff':'background:#fff'}">
      <td style="padding:8px 10px;font-weight:600;white-space:nowrap;font-size:0.85rem;color:#1a3a5c">${d.nombre}</td>
      <td style="padding:6px 10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;min-width:60px;max-width:120px;background:#e9ecef;border-radius:20px;height:12px;overflow:hidden">
            <div style="background:${colProm};width:${barW}%;height:100%;border-radius:20px;transition:width .6s"></div>
          </div>
          <span style="font-weight:bold;font-size:0.92rem;color:${colProm};min-width:30px">${d.promGlobal.toFixed(2)}</span>
        </div>
      </td>
      <td style="padding:6px 10px;font-size:0.78rem">${pills}</td>
      <td style="padding:6px 10px;text-align:center;color:#888;font-size:0.8rem">${d.asigs.length}</td>
    </tr>`;
  }).join(''):`<tr><td colspan="4" style="padding:18px;text-align:center;color:#aaa">Sin carga académica asignada a docentes.</td></tr>`;

  // ── TABLA RESUMEN POR GRADO ──
  const filasGrado=porGrado.map((g,i)=>`<tr style="${i%2===0?'background:#f7fbff':''}">
    <td style="padding:7px 10px;font-weight:600">${g.g}</td>
    <td style="padding:6px 8px;text-align:center">${g.total}</td>
    <td style="padding:6px 8px;text-align:center;color:#666">${g.conN}</td>
    <td style="padding:6px 8px;text-align:center;font-weight:bold;color:${colorNota(g.prom)}">${g.prom.toFixed(2)}</td>
    <td style="padding:6px 8px;text-align:center;color:#1e8449;font-weight:bold">${g.apr}</td>
    <td style="padding:6px 8px;text-align:center;color:#c0392b;font-weight:bold">${g.rep}</td>
    <td style="padding:6px 8px">
      <div style="position:relative;background:#f0f0f0;border-radius:20px;height:16px;overflow:hidden;min-width:70px">
        <div style="background:${g.pct>=70?'#1e8449':'#c0392b'};height:100%;width:${g.pct}%;border-radius:20px"></div>
        <span style="position:absolute;left:50%;top:0;transform:translateX(-50%);font-size:0.7rem;font-weight:bold;line-height:16px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.4);white-space:nowrap">${g.pct}%</span>
      </div>
    </td>
    <td style="padding:6px 8px;text-align:center"><button class="btn-sm" style="background:#1a3a5c" onclick="verEstudiantesPorGrado('${g.g.replace(/'/g,"\\'")}')">👥 Ver</button></td>
  </tr>`).join('');

  return `<h3 class="sec-title">📊 Tablero de Estadísticas Institucional</h3>
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px">
    <span style="font-size:0.78rem;color:#888">📅 ${new Date().toLocaleDateString('es-CO',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} &nbsp;·&nbsp; Año académico: ${db.anio||'—'}</span>
    <button class="btn btn-navy" style="font-size:0.82rem" onclick="pdfTablero()">🖨️ Exportar Informe PDF</button>
  </div>

  ${tarjetas}

  <div style="display:grid;grid-template-columns:3fr 2fr;gap:14px;margin-bottom:14px;flex-wrap:wrap">
    <div class="card">
      <h4 style="color:#1a3a5c;margin:0 0 12px;font-size:0.93rem">📈 Aprobados vs Reprobados por Grado</h4>
      ${grafGrado}
    </div>
    <div class="card">
      <h4 style="color:#1a3a5c;margin:0 0 12px;font-size:0.93rem">📉 Evolución del Promedio por Período</h4>
      ${grafPer}
      <p style="text-align:center;font-size:0.72rem;color:#aaa;margin:4px 0 0">Promedio institucional general</p>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:3fr 2fr;gap:14px;margin-bottom:14px">
    <div class="card">
      <h4 style="color:#922b21;margin:0 0 10px;font-size:0.93rem">⚠️ Estudiantes en Riesgo Académico ${enRiesgo.length?`<span style="background:#c0392b;color:#fff;border-radius:20px;padding:2px 8px;font-size:0.75rem">${enRiesgo.length}</span>`:''}</h4>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
          <thead><tr style="background:#922b21;color:#fff">
            <th style="padding:7px 10px;text-align:left">Estudiante</th>
            <th style="padding:7px 8px;text-align:center">Grado</th>
            <th style="padding:7px 8px;text-align:center">Promedio</th>
            <th style="padding:7px 8px;text-align:center">Áreas Perd.</th>
            <th style="padding:7px 8px;text-align:center">Nivel</th>
            <th style="padding:7px 8px">Acción</th>
          </tr></thead>
          <tbody>${filasRiesgo}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h4 style="color:#b7770d;margin:0 0 10px;font-size:0.93rem">🏅 Mejores Promedios</h4>
      ${topHtml}
    </div>
  </div>

  <div class="card">
    <h4 style="color:#1a3a5c;margin:0 0 10px;font-size:0.93rem">📋 Resumen Académico por Grado</h4>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;text-align:left">Grado</th>
          <th style="padding:8px;text-align:center">Total</th>
          <th style="padding:8px;text-align:center">Con Notas</th>
          <th style="padding:8px;text-align:center">Promedio</th>
          <th style="padding:8px;text-align:center">✅ Aprobados</th>
          <th style="padding:8px;text-align:center">❌ Reprobados</th>
          <th style="padding:8px;text-align:center;min-width:90px">% Aprobación</th>
          <th style="padding:8px;text-align:center">Detalle</th>
        </tr></thead>
        <tbody>${filasGrado}</tbody>
      </table>
    </div>
  </div>

  <div class="card" style="margin-top:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <h4 style="color:#1a3a5c;margin:0;font-size:0.93rem">👨‍🏫 Rendimiento por Docente — Promedios por Asignatura</h4>
      ${mejorAsig?`<div style="display:flex;gap:8px;flex-wrap:wrap">
        <span style="background:#d5f5e3;color:#1e8449;border-radius:8px;padding:4px 10px;font-size:0.75rem;font-weight:600">🏆 Mayor: ${mejorAsig.mat} (${mejorAsig.docNombre}) — ${mejorAsig.prom.toFixed(2)}</span>
        <span style="background:#fde8e8;color:#c0392b;border-radius:8px;padding:4px 10px;font-size:0.75rem;font-weight:600">⚠️ Menor: ${peorAsig.mat} (${peorAsig.docNombre}) — ${peorAsig.prom.toFixed(2)}</span>
      </div>`:''}
    </div>
    <p style="font-size:0.76rem;color:#888;margin:0 0 10px">Promedio de los estudiantes en cada asignatura. Color: 🟢 ≥4.0 · 🔵 3.0–3.9 · 🔴 &lt;3.0. Pase el cursor sobre cada pastilla para ver el grado y cantidad de estudiantes.</p>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
        <thead><tr style="background:#1a3a5c;color:#fff">
          <th style="padding:8px 10px;text-align:left;min-width:140px">Docente</th>
          <th style="padding:8px 10px;min-width:140px">Prom. Global</th>
          <th style="padding:8px 10px;text-align:left">Asignaturas</th>
          <th style="padding:8px;text-align:center">Mat.</th>
        </tr></thead>
        <tbody>${filasDocente}</tbody>
      </table>
    </div>
  </div>

  ${_htmlBIDirectivo(ests,grados,carga,asistencia)}`;
}

function _htmlBIDirectivo(ests,grados,carga,asistencia){
  // ── PRE-MATRÍCULAS: conversión aspirantes → matriculados ──
  const pms=db.preMatriculas||[];
  const pmPend=pms.filter(p=>p.estado==='PENDIENTE').length;
  const pmApro=pms.filter(p=>p.estado==='APROBADA').length;
  const pmRech=pms.filter(p=>p.estado==='RECHAZADA').length;
  const pmTotal=pms.length;
  const tasaConv=pmTotal?Math.round(pmApro/pmTotal*100):0;

  // ── MODALIDADES: presencial vs online ──
  const presencial=ests.filter(e=>(e.modalidad||'presencial')==='presencial').length;
  const online=ests.filter(e=>e.modalidad==='online').length;
  const pctOnline=ests.length?Math.round(online/ests.length*100):0;
  const pctPres=ests.length?Math.round(presencial/ests.length*100):0;

  // ── DESERCIÓN: alta inasistencia o muchas materias perdidas ──
  const alertasDesercion=[];
  ests.forEach(e=>{
    const misAsist=(asistencia||[]).filter(a=>a.estId===e.id);
    const ausen=misAsist.filter(a=>/ausente|falta/i.test(a.estado||a.tipo||'')).length;
    const pctA=misAsist.length?Math.round((1-ausen/misAsist.length)*100):100;
    const matsG=carga.filter(c=>c.g===e.g);
    const numPer=_getNumPer();
    // Solo se cuentan materias que tengan al menos una nota real;
    // el promedio se calcula únicamente sobre los períodos con nota (evita falsos positivos)
    const areasP=matsG.filter(c=>{
      const ps=Array.from({length:numPer},(_,i)=>calcNotaDef(e.nts,c.id,i+1)).filter(v=>v>0);
      if(!ps.length) return false;
      return (ps.reduce((a,b)=>a+b,0)/ps.length)<3;
    }).length;
    if(pctA<70||areasP>=3){
      alertasDesercion.push({e,pctA,areasP,nivel:pctA<50||areasP>=5?'🔴 Crítico':pctA<70||areasP>=3?'🟠 Alto':'🟡 Moderado'});
    }
  });
  alertasDesercion.sort((a,b)=>(a.pctA-b.pctA)+(b.areasP-a.areasP));

  // ── FINANCIERO (instituciones privadas) ──
  const esPrivada=_getPlatTipo()==='privada';
  const platInfo=(gestorDB&&gestorDB.platforms||[]).find(x=>x.id===window._currentPlatId)||{};
  const valorPension=Number(platInfo.valorPension||0);
  const totalEstPriv=ests.length;
  const alDia=ests.filter(e=>e.pensionAlDia===true).length;
  const pendPago=ests.filter(e=>e.pensionAlDia!==true).length;
  const recaudoEsperado=valorPension*totalEstPriv;
  const recaudoEst=valorPension*alDia;
  const pctRecaudo=recaudoEsperado?Math.round(recaudoEst/recaudoEsperado*100):0;

  // ── TOP 10 MEJORES POR GRADO ──
  const topGradoHtml=grados.map(g=>{
    const estsG=ests.filter(e=>e.g===g.n);
    if(!estsG.length) return '';
    const con=estsG.map(e=>{
      const ms=carga.filter(c=>c.g===e.g);
      if(!ms.length) return {e,prom:0};
      const tieneN=ms.some(m=>{for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,m.id,p)>0) return true;return false;});
      return {e,prom:tieneN?calcPromedioEst(e.id,e.g):0};
    }).filter(s=>s.prom>0).sort((a,b)=>b.prom-a.prom).slice(0,3);
    if(!con.length) return '';
    return `<div style="margin-bottom:8px"><div style="background:#1a3a5c;color:#fff;padding:4px 10px;border-radius:5px;font-size:0.78rem;font-weight:bold;margin-bottom:4px">${g.n}</div>
      ${con.map((s,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:5px;background:${i===0?'#fffde7':'#fff'}">
        <span style="font-size:0.9rem">${i===0?'🥇':i===1?'🥈':'🥉'}</span>
        <span style="flex:1;font-size:0.8rem;font-weight:${i===0?'700':'500'}">${s.e.n}</span>
        <span style="font-weight:bold;color:${colorNota(s.prom)}">${s.prom.toFixed(2)}</span>
      </div>`).join('')}
    </div>`;
  }).filter(Boolean).join('');

  // ── ASIGNATURAS CON MAYOR REPROBACIÓN ──
  const asigRep=carga.map(c=>{
    const estsG=ests.filter(e=>e.g===c.g);
    if(!estsG.length) return null;
    const conN=estsG.filter(e=>{for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,c.id,p)>0) return true;return false;});
    if(!conN.length) return null;
    const rep=conN.filter(e=>{const ps=Array.from({length:_getNumPer()},(_,i)=>calcNotaDef(e.nts,c.id,i+1)).filter(v=>v>0);if(!ps.length)return false;return (ps.reduce((a,b)=>a+b,0)/ps.length)<3;}).length;
    return {mat:c.m,grado:c.g,total:conN.length,rep,pctRep:Math.round(rep/conN.length*100)};
  }).filter(Boolean).filter(a=>a.pctRep>0).sort((a,b)=>b.pctRep-a.pctRep).slice(0,10);

  const filasAsigRep=asigRep.length?asigRep.map((a,i)=>`<tr style="${i%2===0?'background:#fffafa':''}">
    <td style="padding:6px 10px;font-size:0.83rem">${a.mat}</td>
    <td style="padding:6px 8px;text-align:center;font-size:0.8rem;color:#555">${a.grado}</td>
    <td style="padding:6px 8px;text-align:center;font-weight:bold;color:#c0392b">${a.pctRep}%</td>
    <td style="padding:6px 8px;text-align:center;color:#c0392b">${a.rep}/${a.total}</td>
    <td style="padding:6px 10px">
      <div style="background:#eee;border-radius:10px;height:10px;overflow:hidden"><div style="background:#c0392b;width:${a.pctRep}%;height:100%"></div></div>
    </td>
  </tr>`).join(''):`<tr><td colspan="5" style="padding:16px;text-align:center;color:#1e8449;font-weight:bold">✅ Ninguna asignatura con reprobación significativa.</td></tr>`;

  // ── ALERTAS DE DESERCIÓN HTML ──
  const filasDesercion=alertasDesercion.length?alertasDesercion.slice(0,20).map((s,i)=>`<tr style="${i%2===0?'background:#fffafa':''}">
    <td style="padding:7px 10px;font-weight:500;font-size:0.83rem">${s.e.n}</td>
    <td style="padding:6px 8px;text-align:center;color:#555;font-size:0.8rem">${s.e.g}</td>
    <td style="padding:6px 8px;text-align:center;font-weight:bold;color:${s.pctA<70?'#c0392b':'#e67e22'}">${s.pctA}%</td>
    <td style="padding:6px 8px;text-align:center;font-weight:bold;color:#c0392b">${s.areasP}</td>
    <td style="padding:6px 8px;text-align:center;font-size:0.8rem">${s.nivel}</td>
    <td style="padding:6px 8px;text-align:center"><button class="btn-sm" style="background:#c0392b" onclick="verHistorialEstudiante('${String(s.e.id).replace(/'/g,"\\'")}')">👁 Ver</button></td>
  </tr>`).join(''):`<tr><td colspan="6" style="padding:16px;text-align:center;color:#1e8449;font-weight:bold">✅ Sin estudiantes en riesgo de deserción.</td></tr>`;

  return `
  <div style="background:linear-gradient(135deg,#1a3a5c,#2c5f8a);color:#fff;padding:16px 20px;border-radius:12px;margin-top:20px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <div><h3 style="margin:0;font-size:1rem">🔭 Inteligencia Directiva — Dashboard Rector</h3><p style="margin:4px 0 0;font-size:0.78rem;opacity:.8">Análisis avanzado de gestión, conversión, deserción y desempeño institucional</p></div>
    <span style="font-size:0.74rem;background:rgba(255,255,255,0.15);padding:4px 10px;border-radius:10px">${new Date().toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})}</span>
  </div>

  <!-- KPIs BI -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
    <div style="background:#2c3e50;color:#fff;border-radius:12px;padding:16px 12px;text-align:center">
      <div style="font-size:1.6rem;font-weight:900">${pmTotal}</div>
      <div style="font-size:0.72rem;opacity:.85">Total Solicitudes PM</div>
      <div style="font-size:0.68rem;margin-top:4px;opacity:.7">✅ ${pmApro} apr · ⏳ ${pmPend} pend · ❌ ${pmRech} rech</div>
    </div>
    <div style="background:${tasaConv>=70?'#1e8449':tasaConv>=50?'#b7770d':'#922b21'};color:#fff;border-radius:12px;padding:16px 12px;text-align:center">
      <div style="font-size:1.6rem;font-weight:900">${tasaConv}%</div>
      <div style="font-size:0.72rem;opacity:.85">Tasa de Conversión</div>
      <div style="font-size:0.68rem;margin-top:4px;opacity:.7">Aspirantes → Matriculados</div>
    </div>
    <div style="background:#1a5276;color:#fff;border-radius:12px;padding:16px 12px;text-align:center">
      <div style="font-size:1.6rem;font-weight:900">${online}</div>
      <div style="font-size:0.72rem;opacity:.85">Estudiantes Online</div>
      <div style="font-size:0.68rem;margin-top:4px;opacity:.7">${pctOnline}% virtual · ${pctPres}% presencial</div>
    </div>
    <div style="background:${alertasDesercion.length===0?'#1e8449':alertasDesercion.length<5?'#b7770d':'#922b21'};color:#fff;border-radius:12px;padding:16px 12px;text-align:center">
      <div style="font-size:1.6rem;font-weight:900">${alertasDesercion.length}</div>
      <div style="font-size:0.72rem;opacity:.85">Alertas Deserción</div>
      <div style="font-size:0.68rem;margin-top:4px;opacity:.7">Inasist. &lt;70% o ≥3 áreas perd.</div>
    </div>
    ${esPrivada?`<div style="background:${pctRecaudo>=80?'#1e8449':pctRecaudo>=50?'#b7770d':'#922b21'};color:#fff;border-radius:12px;padding:16px 12px;text-align:center">
      <div style="font-size:1.6rem;font-weight:900">${pctRecaudo}%</div>
      <div style="font-size:0.72rem;opacity:.85">Recaudo Pensiones</div>
      <div style="font-size:0.68rem;margin-top:4px;opacity:.7">${alDia} al día · ${pendPago} pendiente</div>
    </div>`:''}
  </div>

  <!-- CONVERSIÓN PRE-MATRÍCULAS -->
  <div style="display:grid;grid-template-columns:3fr 2fr;gap:14px;margin-bottom:14px;flex-wrap:wrap">
    <div class="card">
      <h4 style="color:#2c3e50;margin:0 0 12px;font-size:0.93rem">📋 Embudo de Conversión — Pre-Matrículas</h4>
      ${pmTotal===0?`<p class="empty">Sin solicitudes de pre-matrícula registradas.</p>`:`
      <div style="padding:10px 0">
        ${[{label:'📥 Total solicitudes recibidas',val:pmTotal,pct:100,col:'#2c3e50'},
           {label:'⏳ En revisión (Pendientes)',val:pmPend,pct:pmTotal?Math.round(pmPend/pmTotal*100):0,col:'#e67e22'},
           {label:'✅ Aprobadas / Matriculados',val:pmApro,pct:pmTotal?Math.round(pmApro/pmTotal*100):0,col:'#1e8449'},
           {label:'❌ Rechazadas',val:pmRech,pct:pmTotal?Math.round(pmRech/pmTotal*100):0,col:'#c0392b'}
        ].map(r=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="flex:1"><div style="font-size:0.8rem;color:#333;margin-bottom:3px">${r.label}</div>
          <div style="background:#eee;border-radius:10px;height:16px;overflow:hidden">
            <div style="background:${r.col};width:${r.pct}%;height:100%;border-radius:10px;transition:width .6s"></div>
          </div></div>
          <span style="font-weight:bold;color:${r.col};min-width:36px;text-align:right">${r.val}</span>
          <span style="font-size:0.75rem;color:#aaa;min-width:32px">${r.pct}%</span>
        </div>`).join('')}
      </div>`}
    </div>
    <div class="card">
      <h4 style="color:#1a5276;margin:0 0 12px;font-size:0.93rem">🏫 Modalidades de Estudio</h4>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:#1a5276;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">🏫</div>
          <div style="flex:1"><div style="font-size:0.8rem;color:#333;margin-bottom:3px">Presencial — ${presencial} estudiantes</div>
          <div style="background:#eee;border-radius:10px;height:14px;overflow:hidden"><div style="background:#1a5276;width:${pctPres}%;height:100%;border-radius:10px"></div></div></div>
          <b style="color:#1a5276">${pctPres}%</b>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:#8e44ad;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">💻</div>
          <div style="flex:1"><div style="font-size:0.8rem;color:#333;margin-bottom:3px">Online/Virtual — ${online} estudiantes</div>
          <div style="background:#eee;border-radius:10px;height:14px;overflow:hidden"><div style="background:#8e44ad;width:${pctOnline}%;height:100%;border-radius:10px"></div></div></div>
          <b style="color:#8e44ad">${pctOnline}%</b>
        </div>
      </div>
      ${esPrivada?`<div style="background:#f8f9fa;border-radius:8px;padding:12px;margin-top:6px">
        <div style="font-size:0.78rem;font-weight:bold;color:#2c3e50;margin-bottom:6px">💳 Recaudo de Pensiones</div>
        <div style="background:#eee;border-radius:10px;height:18px;overflow:hidden;margin-bottom:4px">
          <div style="background:${pctRecaudo>=80?'#1e8449':pctRecaudo>=50?'#e67e22':'#c0392b'};width:${pctRecaudo}%;height:100%;border-radius:10px"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:#888">
          <span>✅ ${alDia} al día</span><span>⚠️ ${pendPago} pendientes</span>
        </div>
        ${valorPension?`<div style="font-size:0.75rem;color:#888;margin-top:4px">Recaudo est.: $${recaudoEst.toLocaleString('es-CO')} / $${recaudoEsperado.toLocaleString('es-CO')}</div>`:''}
      </div>`:''}
    </div>
  </div>

  <!-- ALERTAS DE DESERCIÓN -->
  <div style="display:grid;grid-template-columns:3fr 2fr;gap:14px;margin-bottom:14px">
    <div class="card">
      <h4 style="color:#922b21;margin:0 0 10px;font-size:0.93rem">🚨 Alertas de Deserción Escolar ${alertasDesercion.length?`<span style="background:#c0392b;color:#fff;border-radius:20px;padding:2px 8px;font-size:0.75rem">${alertasDesercion.length}</span>`:''}</h4>
      <p style="font-size:0.76rem;color:#888;margin:0 0 10px">Estudiantes con asistencia &lt;70% <b>o</b> 3+ áreas con promedio en riesgo.</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
          <thead><tr style="background:#922b21;color:#fff">
            <th style="padding:7px 10px;text-align:left">Estudiante</th>
            <th style="padding:7px 8px">Grado</th>
            <th style="padding:7px 8px">Asist.</th>
            <th style="padding:7px 8px">Áreas</th>
            <th style="padding:7px 8px">Nivel</th>
            <th style="padding:7px 8px">Acción</th>
          </tr></thead>
          <tbody>${filasDesercion}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h4 style="color:#1e8449;margin:0 0 10px;font-size:0.93rem">🏅 Top 3 por Grado</h4>
      <div style="max-height:320px;overflow-y:auto">${topGradoHtml||'<p class="empty">Sin datos de notas aún.</p>'}</div>
    </div>
  </div>

  <!-- ASIGNATURAS CON MAYOR REPROBACIÓN -->
  <div class="card" style="margin-bottom:14px">
    <h4 style="color:#922b21;margin:0 0 10px;font-size:0.93rem">📉 Asignaturas con Mayor Índice de Reprobación</h4>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead><tr style="background:#922b21;color:#fff">
          <th style="padding:7px 10px;text-align:left">Asignatura</th>
          <th style="padding:7px 8px;text-align:center">Grado</th>
          <th style="padding:7px 8px;text-align:center">% Reprobación</th>
          <th style="padding:7px 8px;text-align:center">Reprobados</th>
          <th style="padding:7px 8px;min-width:100px">Indicador</th>
        </tr></thead>
        <tbody>${filasAsigRep}</tbody>
      </table>
    </div>
  </div>`;
}

function pdfTablero(){
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF('l','mm','a4');
  const W=297,H=210;
  const ests=db.ests||[];const grados=db.grados||[];const carga=db.carga||[];
  const asistencia=db.asistencia||[];

  const estStats=ests.map(e=>{
    const mats=carga.filter(c=>c.g===e.g);
    if(!mats.length) return {e,prom:0,tieneNotas:false};
    const tieneNotas=mats.some(m=>{for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,m.id,p)>0) return true;return false;});
    const prom=tieneNotas?calcPromedioEst(e.id,e.g):0;
    return {e,prom,tieneNotas};
  });
  const conNotas=estStats.filter(s=>s.tieneNotas);
  const aprobados=conNotas.filter(s=>s.prom>=3.0).length;
  const enRiesgo=conNotas.filter(s=>s.prom<3.0);
  const promInst=conNotas.length?parseFloat((conNotas.reduce((s,x)=>s+x.prom,0)/conNotas.length).toFixed(2)):0;
  const pctApr=conNotas.length?Math.round(aprobados/conNotas.length*100):0;
  const totalReg=asistencia.length;
  const ausentes=asistencia.filter(a=>/ausente|falta/i.test(a.estado||a.tipo||'')).length;
  const pctAsist=totalReg?Math.round((1-ausentes/totalReg)*100):0;

  const porGrado=grados.map(g=>{
    const estsG=ests.filter(e=>e.g===g.n);const matsG=carga.filter(c=>c.g===g.n);
    if(!matsG.length||!estsG.length) return {g:g.n,prom:0,pct:0,total:estsG.length,apr:0,rep:0,conN:0};
    let ap=0,re=0,sp=0,cn=0;
    estsG.forEach(e=>{
      const hasMat=matsG.some(m=>{for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,m.id,p)>0) return true;return false;});
      if(!hasMat) return;cn++;
      const pr=calcPromedioEst(e.id,g.n);sp+=pr;
      if(pr>=3.0)ap++;else re++;
    });
    return {g:g.n,prom:cn?parseFloat((sp/cn).toFixed(2)):0,pct:cn?Math.round(ap/cn*100):0,total:estsG.length,apr:ap,rep:re,conN:cn};
  });

  // Cabecera
  doc.setFillColor(26,58,92);doc.rect(0,0,W,20,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(255,255,255);
  doc.text('TABLERO DE ESTADÍSTICAS INSTITUCIONAL',W/2,9,{align:'center'});
  doc.setFontSize(7.5);doc.setFont('helvetica','normal');
  doc.text((db.nombre||'Institución').toUpperCase()+'  ·  Rector(a): '+(db.rectora||'')+'  ·  Año: '+(db.anio||''),W/2,15,{align:'center'});
  doc.setFontSize(7);doc.text('Generado: '+new Date().toLocaleString('es-CO'),W/2,19.5,{align:'center'});

  // KPI cards
  let y=24;
  const kpis=[
    ['👥 Total Est.',ests.length,'#1a3a5c'],
    ['✅ Aprobados',pctApr+'%','#1e8449'],
    ['❌ Reprobados',(100-pctApr)+'%','#922b21'],
    ['📊 Prom. Inst.',promInst.toFixed(2),promInst>=4?'#1a5276':promInst>=3?'#b7770d':'#922b21'],
    ['📅 Asistencia',pctAsist+'%',pctAsist>=90?'#1e8449':pctAsist>=75?'#b7770d':'#922b21'],
    ['⚠️ En Riesgo',enRiesgo.length,enRiesgo.length?'#c0392b':'#1e8449'],
  ];
  const cardW=44;
  kpis.forEach((k,i)=>{
    const hex=k[2].replace('#','');
    const r=parseInt(hex.substring(0,2),16),g2=parseInt(hex.substring(2,4),16),b=parseInt(hex.substring(4,6),16);
    doc.setFillColor(r,g2,b);doc.roundedRect(10+i*cardW,y,40,13,2,2,'F');
    doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(11);
    doc.text(String(k[1]),10+i*cardW+20,y+8.5,{align:'center'});
    doc.setFontSize(6);doc.setFont('helvetica','normal');doc.text(k[0],10+i*cardW+20,y+12,{align:'center'});
  });
  y+=18;

  // Tabla resumen por grado
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(26,58,92);
  doc.text('Resumen Académico por Grado',10,y);y+=3;
  const cols=[{t:'Grado',w:35},{t:'Total',w:22},{t:'Con Notas',w:28},{t:'Promedio',w:28},{t:'✅ Aprobados',w:34},{t:'❌ Reprobados',w:34},{t:'% Aprob.',w:28}];
  doc.setFillColor(26,58,92);doc.rect(10,y,W-20,7,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(7.5);doc.setFont('helvetica','bold');
  let cx=10;cols.forEach(c=>{doc.text(c.t,cx+c.w/2,y+5,{align:'center'});cx+=c.w;});
  y+=7;
  porGrado.forEach((g,i)=>{
    if(y>H-30){doc.addPage('l');y=14;}
    if(i%2===0)doc.setFillColor(240,247,255);else doc.setFillColor(255,255,255);
    doc.rect(10,y,W-20,7,'F');
    doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(7.5);
    const row=[g.g,g.total,g.conN,g.prom.toFixed(2),g.apr,g.rep,g.pct+'%'];
    cx=10;cols.forEach((c,ci)=>{
      if(ci===0)doc.text(String(row[ci]),cx+2,y+5);
      else doc.text(String(row[ci]),cx+c.w/2,y+5,{align:'center'});
      cx+=c.w;
    });
    y+=7;
  });

  // Sección riesgo
  if(enRiesgo.length){
    if(y<H-25){y+=8;}else{doc.addPage('l');y=14;}
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(146,43,33);
    doc.text('Estudiantes en Riesgo Académico ('+enRiesgo.length+')',10,y);y+=3;
    const rCols=[{t:'Estudiante',w:80},{t:'Grado',w:24},{t:'Promedio',w:28},{t:'Áreas Perd.',w:30},{t:'Nivel',w:30}];
    doc.setFillColor(146,43,33);doc.rect(10,y,W-20,6,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(7);doc.setFont('helvetica','bold');
    cx=10;rCols.forEach(c=>{doc.text(c.t,cx+2,y+4);cx+=c.w;});y+=6;
    enRiesgo.slice(0,30).forEach((s,i)=>{
      if(y>H-8){doc.addPage('l');y=14;}
      if(i%2===0)doc.setFillColor(255,250,250);else doc.setFillColor(255,255,255);
      doc.rect(10,y,W-20,6,'F');
      doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(7);
      const nivel=s.prom<2?'Crítico':s.prom<2.5?'Alto':s.prom<2.8?'Moderado':'Leve';
      const row=[s.e.n,s.e.g,s.prom.toFixed(2),calcAreasPerd(s.e.id,s.e.g),nivel];
      cx=10;rCols.forEach((c,ci)=>{
        if(ci===0)doc.text(String(row[ci]).substring(0,28),cx+2,y+4);
        else doc.text(String(row[ci]),cx+c.w/2,y+4,{align:'center'});
        cx+=c.w;
      });y+=6;
    });
  }

  // Top performers
  const top5=conNotas.slice().sort((a,b)=>b.prom-a.prom).slice(0,5);
  if(top5.length){
    if(y<H-20){y+=8;}else{doc.addPage('l');y=14;}
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(183,119,13);
    doc.text('Mejores Promedios Institucionales',10,y);y+=3;
    doc.setFillColor(183,119,13);doc.rect(10,y,80,6,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(7);doc.setFont('helvetica','bold');
    doc.text('Puesto',12,y+4);doc.text('Estudiante',22,y+4);doc.text('Grado',62,y+4);doc.text('Promedio',75,y+4);y+=6;
    top5.forEach((s,i)=>{
      if(y>H-8) return;
      if(i%2===0)doc.setFillColor(255,252,235);else doc.setFillColor(255,255,255);
      doc.rect(10,y,80,6,'F');
      doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(7);
      const puesto=i===0?'🥇 1°':i===1?'🥈 2°':i===2?'🥉 3°':'  '+(i+1)+'°';
      doc.text(puesto,12,y+4);doc.text(String(s.e.n).substring(0,20),22,y+4);
      doc.text(String(s.e.g),62,y+4);doc.text(String(s.prom.toFixed(2)),78,y+4);
      y+=6;
    });
  }

  // ── Rendimiento por Docente
  const dMap2={};
  (db.carga||[]).forEach(c=>{
    if(!c.d) return;
    const dU=(db.users||[]).find(u=>u.u===c.d);
    const dN=dU?.n||c.d;
    if(!dMap2[c.d]) dMap2[c.d]={nombre:dN,asigs:[]};
    const esG=(db.ests||[]).filter(e=>e.g===c.g);
    let sm=0,cn2=0;
    esG.forEach(e=>{
      let ok=false;for(let p=1;p<=_getNumPer();p++) if(calcNotaDef(e.nts,c.id,p)>0){ok=true;break;}
      if(!ok) return;sm+=calcPromedioMat(e.id,c.id);cn2++;
    });
    if(cn2>0) dMap2[c.d].asigs.push({mat:c.m,grado:c.g,prom:parseFloat((sm/cn2).toFixed(2)),cnt:cn2});
  });
  const dList2=Object.values(dMap2).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  dList2.forEach(d=>{d.promG=d.asigs.length?parseFloat((d.asigs.reduce((s,a)=>s+a.prom,0)/d.asigs.length).toFixed(2)):0;});

  if(dList2.length){
    if(y>H-30){doc.addPage('l');y=14;}else{y+=10;}
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(26,58,92);
    doc.text('Rendimiento por Docente — Promedios por Asignatura',10,y);y+=3;
    const dCols=[{t:'Docente',w:55},{t:'Prom.Global',w:30},{t:'Asignatura',w:55},{t:'Grado',w:22},{t:'Promedio',w:28},{t:'Est.',w:18}];
    doc.setFillColor(26,58,92);doc.rect(10,y,W-20,6,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(7);doc.setFont('helvetica','bold');
    let cx2=10;dCols.forEach(c=>{doc.text(c.t,cx2+2,y+4);cx2+=c.w;});y+=6;
    dList2.forEach((d,di)=>{
      const asigsSorted=d.asigs.slice().sort((a,b)=>a.prom-b.prom);
      const rowspan=Math.max(1,asigsSorted.length);
      asigsSorted.forEach((a,ai)=>{
        if(y>H-8){doc.addPage('l');y=14;
          doc.setFillColor(26,58,92);doc.rect(10,y,W-20,6,'F');
          doc.setTextColor(255,255,255);doc.setFontSize(7);doc.setFont('helvetica','bold');
          cx2=10;dCols.forEach(c=>{doc.text(c.t,cx2+2,y+4);cx2+=c.w;});y+=6;
        }
        if((di+ai)%2===0)doc.setFillColor(247,251,255);else doc.setFillColor(255,255,255);
        doc.rect(10,y,W-20,6,'F');
        doc.setTextColor(0,0,0);doc.setFont(ai===0?'helvetica':'helvetica','normal');doc.setFontSize(7);
        cx2=10;
        doc.text(ai===0?String(d.nombre).substring(0,18):'',cx2+2,y+4);cx2+=55;
        if(ai===0){
          const colG=[d.promG>=4?[30,132,73]:d.promG>=3?[26,82,118]:[192,57,43]];
          doc.setTextColor(...colG[0]);doc.setFont('helvetica','bold');
          doc.text(String(d.promG.toFixed(2)),cx2+2,y+4);
          doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');
        }
        cx2+=30;
        doc.text(String(a.mat).substring(0,20),cx2+2,y+4);cx2+=55;
        doc.text(String(a.grado),cx2+2,y+4);cx2+=22;
        const colA=a.prom>=4?[30,132,73]:a.prom>=3?[26,82,118]:[192,57,43];
        doc.setTextColor(...colA);doc.setFont('helvetica','bold');
        doc.text(String(a.prom.toFixed(2)),cx2+2,y+4);cx2+=28;
        doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');
        doc.text(String(a.cnt),cx2+2,y+4);
        y+=6;
      });
      if(!asigsSorted.length){
        if((di)%2===0)doc.setFillColor(247,251,255);else doc.setFillColor(255,255,255);
        doc.rect(10,y,W-20,6,'F');
        doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(7);
        doc.text(String(d.nombre).substring(0,18),12,y+4);
        doc.setTextColor(150,150,150);doc.text('Sin asignaturas con notas registradas',67,y+4);
        y+=6;
      }
    });
  }

  // Pie
  const totalP=doc.getNumberOfPages();
  doc.setFontSize(6);doc.setTextColor(160,160,160);doc.setFont('helvetica','normal');
  for(let i=1;i<=totalP;i++){
    doc.setPage(i);
    doc.text('Gestor Académico YC  ·  '+new Date().toLocaleString('es-CO')+'  ·  Pág. '+i+'/'+totalP,W/2,H-3,{align:'center'});
  }
  doc.save('Tablero_Estadisticas_'+(db.anio||'')+'.pdf');
}

// ============================================================
// COMUNICADO GENERAL — RECTOR A PADRES Y ESTUDIANTES
// ============================================================
function htmlComunicadoGeneral(){
  const grados=(db.grados||[]).map(g=>g.n);
  const gradOpts='<option value="">— Todos los grados —</option>'+grados.map(g=>`<option value="${g}">${g}</option>`).join('');
  return `<h3 class="sec-title">📢 Enviar Comunicado General</h3>
  <div class="info-box" style="margin-bottom:14px">
    <b>¿Qué hace este módulo?</b> Permite enviar un comunicado institucional (aviso, circular o mensaje de rectoría) a todos los acudientes y estudiantes. El comunicado aparecerá en la sección <b>"📬 Mis Comunicados"</b> del portal del acudiente y del estudiante en tiempo real. También puede enviarse por correo electrónico a los acudientes con email registrado.
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div>
      <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Tipo de comunicado</label>
      <select id="comTipo" style="width:100%;padding:9px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem">
        <option value="aviso">📢 Aviso General</option>
        <option value="comunicado">📋 Circular / Comunicado Oficial</option>
        <option value="rector-message">🏫 Mensaje de Rectoría</option>
      </select>
    </div>
    <div>
      <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Dirigido a grado (opcional)</label>
      <select id="comGrado" style="width:100%;padding:9px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem">${gradOpts}</select>
    </div>
  </div>
  <div style="margin-bottom:14px">
    <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Asunto / Título del comunicado</label>
    <input id="comAsunto" type="text" placeholder="Ej: Reunión de padres de familia – Viernes 23 de mayo" maxlength="120"
      style="width:100%;padding:9px 12px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem;box-sizing:border-box">
  </div>
  <div style="margin-bottom:14px">
    <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Mensaje del comunicado</label>
    <textarea id="comMensaje" rows="6" placeholder="Redacte aquí el comunicado. Sé claro, cordial y conciso. El mensaje será visible para todos los acudientes y estudiantes en su portal..."
      style="width:100%;padding:10px 12px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem;resize:vertical;box-sizing:border-box"></textarea>
  </div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
    <label style="display:flex;align-items:center;gap:7px;font-size:0.88rem;color:#1a3a5c;cursor:pointer;user-select:none">
      <input type="checkbox" id="comEnviarEmail" style="width:16px;height:16px">
      <span>Enviar también por correo electrónico a acudientes</span>
    </label>
    <span style="font-size:0.78rem;color:#999">(requiere EMAIL_USER y EMAIL_PASS configurados)</span>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <button class="btn" style="background:#1a5276;color:#fff;padding:10px 26px;font-size:0.92rem" onclick="enviarComunicadoGeneral()">📨 Publicar Comunicado</button>
    <button class="btn" style="background:#ecf0f1;color:#555;padding:10px 18px;font-size:0.88rem" onclick="document.getElementById('comPreview').style.display=document.getElementById('comPreview').style.display==='none'?'block':'none'">👁 Vista Previa</button>
  </div>
  <div id="comPreview" style="display:none;border:2px dashed #3498db;border-radius:9px;padding:14px;margin-bottom:18px;background:#f0f7ff">
    <p style="margin:0 0 6px;font-size:0.75rem;font-weight:700;color:#3498db;text-transform:uppercase;letter-spacing:1px">Vista previa del comunicado</p>
    <div id="comPreviewContent" style="font-size:0.88rem;color:#222;line-height:1.6"></div>
  </div>
  <div id="comProgreso" style="display:none;background:#fff;border:1px solid #dce;border-radius:9px;padding:16px;margin-bottom:16px">
    <h4 style="color:#1a5276;margin:0 0 12px;font-size:0.93rem">📤 Publicando comunicado...</h4>
    <div id="comBarraWrap" style="background:#eee;border-radius:6px;height:8px;overflow:hidden;margin-bottom:10px">
      <div id="comBarra" style="height:8px;background:#3498db;border-radius:6px;width:0%;transition:width 0.4s ease"></div>
    </div>
    <div id="comLogItems" style="font-size:0.82rem;max-height:220px;overflow-y:auto;color:#444"></div>
  </div>
  <div id="comHistorial" style="display:none;background:#fafbff;border:1px solid #e0e6f0;border-radius:9px;padding:14px">
    <h4 style="color:#1a3a5c;margin:0 0 10px;font-size:0.93rem">📋 Comunicados enviados (esta sesión)</h4>
    <div id="comHistItems"><p style="color:#bbb;text-align:center;padding:14px">Ningún comunicado enviado aún.</p></div>
  </div>
  <script>
    (function(){
      const preview=document.getElementById('comPreview');
      const previewContent=document.getElementById('comPreviewContent');
      function actualizarPreview(){
        if(preview.style.display==='none') return;
        const tipo=document.getElementById('comTipo').value;
        const asunto=document.getElementById('comAsunto').value||'(sin asunto)';
        const msg=document.getElementById('comMensaje').value||'(sin mensaje)';
        const grado=document.getElementById('comGrado').value;
        const tipoLabel={'aviso':'📢 Aviso General','comunicado':'📋 Circular / Comunicado Oficial','rector-message':'🏫 Mensaje de Rectoría'}[tipo]||'📬 Notificación';
        previewContent.innerHTML='<b>'+tipoLabel+'</b>'+(grado?' · Grado '+grado:' · Todos los grados')+'<br><br><b>'+asunto+'</b><br><br>'+msg.replace(/\\n/g,'<br>')+'<br><br><em style="color:#aaa;font-size:0.78rem">Enviado por: '+sesion.n+'</em>';
      }
      document.getElementById('comTipo').addEventListener('change',actualizarPreview);
      document.getElementById('comAsunto').addEventListener('input',actualizarPreview);
      document.getElementById('comMensaje').addEventListener('input',actualizarPreview);
      document.getElementById('comGrado').addEventListener('change',actualizarPreview);
    })();
  <\/script>`;
}

let _comHistorial=[];
async function enviarComunicadoGeneral(){
  const tipo=document.getElementById('comTipo').value;
  const asunto=(document.getElementById('comAsunto').value||'').trim();
  const msg=(document.getElementById('comMensaje').value||'').trim();
  const grado=document.getElementById('comGrado').value;
  const envEmail=document.getElementById('comEnviarEmail').checked;
  if(!asunto){alert('Escriba un asunto para el comunicado.');document.getElementById('comAsunto').focus();return;}
  if(!msg){alert('Escriba el contenido del comunicado.');document.getElementById('comMensaje').focus();return;}
  const tipoLabel={'aviso':'📢 Aviso General','comunicado':'📋 Circular','rector-message':'🏫 Mensaje Rectoría'}[tipo]||'📬 Comunicado';
  const gradoSufijo=grado?` · Grado ${grado}`:'';
  const mensajeCompleto=`${asunto}\n\n${msg}`;
  const actor=`${sesion.n} (${db.rectora||'Rector(a)'}), ${db.nombre||'Institución'}`;
  const progreso=document.getElementById('comProgreso');
  const barra=document.getElementById('comBarra');
  const logItems=document.getElementById('comLogItems');
  progreso.style.display='block';
  logItems.innerHTML='';
  barra.style.width='10%';
  function log(html){const d=document.createElement('div');d.innerHTML=html;logItems.prepend(d);}
  log('⏳ Registrando comunicado en el sistema...');
  let ok=false;
  try{
    const meta={tipo,grado:grado||null,asunto,fechaEnvio:new Date().toISOString()};
    const r=await fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:tipo,actor,message:mensajeCompleto,meta})});
    ok=r.ok;
    if(ok){log('✅ Comunicado registrado en el sistema');}
    else{log('⚠️ Error al registrar en el sistema: HTTP '+r.status);}
  } catch(e){log('❌ Error de red al registrar: '+e.message);}
  barra.style.width='40%';
  if(envEmail&&ok){
    log('📧 Enviando correos a acudientes con email registrado...');
    const ests=grado?db.ests.filter(e=>e.g===grado):db.ests;
    const conEmail=ests.filter(e=>e.email&&e.email.trim());
    let enviados=0,errores=0;
    for(let i=0;i<conEmail.length;i++){
      const e=conEmail[i];
      barra.style.width=(40+Math.round(55*((i+1)/conEmail.length)))+'%';
      try{
        const bodyEmail=`Estimado(a) ${e.acudiente||e.n}:\n\n${tipoLabel}${gradoSufijo}\n\n${mensajeCompleto}\n\n—\n${db.nombre||'Institución'}\n${db.rectora||''}\nTeléfono: ${db.telInst||'—'} | Correo: ${db.emailInst||'—'}`;
        const r2=await fetch(API_BASE+'/api/inetis/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:e.email,subject:`[${db.nombre||'Institución'}] ${tipoLabel}${gradoSufijo}: ${asunto}`,text:bodyEmail})});
        if(r2.ok){enviados++;log(`✅ Email enviado a <b>${e.email}</b> (${e.n})`);}
        else{errores++;log(`📬 No se pudo enviar a <b>${e.email}</b> (${e.n})`);}
      } catch(err){errores++;log(`❌ Error red: ${e.email}`);}
    }
    log(`<b>Resumen emails: ${enviados} enviados, ${errores} con error, de ${conEmail.length} acudientes con correo.</b>`);
  }
  barra.style.width='100%';
  const ahora=new Date().toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  _comHistorial.unshift({tipo:tipoLabel,asunto,grado:grado||'Todos',ok,ahora,email:envEmail});
  const histDiv=document.getElementById('comHistorial');
  const histItems=document.getElementById('comHistItems');
  histDiv.style.display='block';
  histItems.innerHTML=_comHistorial.map(h=>`<div style="border-left:3px solid ${h.ok?'#27ae60':'#e74c3c'};padding:7px 12px;margin-bottom:8px;background:#fff;border-radius:0 6px 6px 0">
    <span style="font-size:0.78rem;font-weight:700;color:${h.ok?'#27ae60':'#e74c3c'}">${h.ok?'✅':'⚠️'} ${h.tipo}</span>
    <span style="font-size:0.75rem;color:#888;margin-left:10px">${h.ahora}</span>
    ${h.grado!=='Todos'?`<span style="font-size:0.72rem;background:#e8f4fd;color:#1a5276;border-radius:4px;padding:1px 6px;margin-left:6px">Grado ${h.grado}</span>`:''}
    ${h.email?'<span style="font-size:0.72rem;background:#e8f6f3;color:#27ae60;border-radius:4px;padding:1px 6px;margin-left:4px">+ Email</span>':''}
    <p style="margin:4px 0 0;font-size:0.83rem;color:#333;font-weight:600">${h.asunto}</p>
  </div>`).join('');
  if(ok){
    document.getElementById('comAsunto').value='';
    document.getElementById('comMensaje').value='';
    setTimeout(()=>{progreso.style.display='none';barra.style.width='0%';},4000);
    alert('✅ Comunicado publicado correctamente. Los acudientes y estudiantes lo verán en su portal al actualizar.');
  }
}

// ============================================================
// OBSERVACIONES DE AULA — DOCENTE (entrada rápida)
// ============================================================
function htmlObsAula(){
  const misGrados=[...new Set((db.carga||[]).filter(c=>c.d===sesion.u).map(c=>c.g))].sort();
  if(!misGrados.length){
    return `<h3 class="sec-title">📓 Observaciones de Aula</h3>
    <div class="info-box">No tiene grados asignados en la carga académica. Contacte al rector para asignarle cursos.</div>`;
  }
  const _numPerOA2=(db.config&&db.config.numPeriodos)||4;
  const perA=db.periodosActivos||Array(_numPerOA2).fill(true);
  const perActual=String(perA.lastIndexOf(true)+1||1);
  const gradOpts=misGrados.map((g,i)=>`<option value="${g}"${i===0?' selected':''}>${g}</option>`).join('');
  const _numPerOA=(db.config&&db.config.numPeriodos)||4;
  const perOpts=Array.from({length:_numPerOA},(_,i)=>i+1).map(p=>`<option value="${p}"${String(p)===perActual?' selected':''}>P${p}</option>`).join('');
  return `<h3 class="sec-title">📓 Observaciones de Aula</h3>
  <div class="info-box" style="margin-bottom:14px">
    Registre observaciones rápidas de comportamiento, rendimiento, logros o inasistencias para sus estudiantes. Quedan vinculadas al <b>Observador del Estudiante</b> y son visibles para el rector y director de grupo.
  </div>
  <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px">
    <div>
      <label style="font-size:0.82rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:4px">Grado</label>
      <select id="obsAulaGrado" onchange="renderObsAulaLista()" style="padding:8px 12px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem">${gradOpts}</select>
    </div>
    <div>
      <label style="font-size:0.82rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:4px">Período</label>
      <select id="obsAulaPer" onchange="renderObsAulaLista()" style="padding:8px 12px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem">${perOpts}</select>
    </div>
    <button class="btn" style="background:#1a3a5c;color:#fff;padding:8px 18px;font-size:0.88rem" onclick="renderObsAulaLista()">🔄 Cargar</button>
    <span id="obsAulaContador" style="font-size:0.78rem;color:#888;align-self:center"></span>
  </div>
  <div id="obsAulaLista"></div>
  <script>setTimeout(renderObsAulaLista,80);<\/script>`;
}

function renderObsAulaLista(){
  const grado=document.getElementById('obsAulaGrado')?.value||'';
  const per=document.getElementById('obsAulaPer')?.value||'1';
  const wrap=document.getElementById('obsAulaLista');
  const cnt=document.getElementById('obsAulaContador');
  if(!wrap) return;
  const ests=(db.ests||[]).filter(e=>e.g===grado).sort((a,b)=>a.n.localeCompare(b.n));
  if(cnt) cnt.textContent=ests.length+' estudiante(s)';
  if(!ests.length){wrap.innerHTML='<div class="card"><p class="empty">Sin estudiantes en este grado.</p></div>';return;}
  const tiposObs=[
    {v:'Comportamental',label:'😤 Comportamental',color:'#e67e22'},
    {v:'Académica',label:'📚 Académica',color:'#2980b9'},
    {v:'Logro',label:'🏅 Logro / Reconocimiento',color:'#27ae60'},
    {v:'Asistencia',label:'📅 Asistencia',color:'#8e44ad'},
    {v:'Otro',label:'📝 Otro',color:'#7f8c8d'},
  ];
  const tipoOpts=tiposObs.map(t=>`<option value="${t.v}">${t.label}</option>`).join('');
  const colorTipo=v=>(tiposObs.find(t=>t.v===v)||{color:'#555'}).color;
  wrap.innerHTML=ests.map((e,idx)=>{
    const obsDelPer=(e.observaciones||[]).filter(o=>String(o.per)===String(per));
    const obsHoy=obsDelPer.filter(o=>o.doc===sesion.n);
    const totalHtml=obsDelPer.length
      ?obsDelPer.slice(-10).reverse().map((o,oi)=>{
          const realIdx=(e.observaciones||[]).length-1-(obsDelPer.length-1-obsDelPer.indexOf(o));
          const isMine=o.doc===sesion.n||sesion.r==='admin';
          return `<div style="border-left:3px solid ${colorTipo(o.tipo||'Otro')};padding:4px 8px;margin-bottom:5px;background:#fafafa;border-radius:0 5px 5px 0" id="obsItem_${e.id}_${oi}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
              <div style="flex:1">
                ${o.tipo?`<span style="font-size:0.68rem;font-weight:700;color:${colorTipo(o.tipo)};text-transform:uppercase">${o.tipo}</span> · `:''}
                <span style="font-size:0.82rem;color:#333">${o.txt}</span>
                <span style="font-size:0.7rem;color:#aaa;display:block;margin-top:1px">${o.doc} · ${o.fecha||''}</span>
              </div>
              ${isMine?`<div style="display:flex;gap:4px;flex-shrink:0">
                <button title="Editar observación" style="background:#e67e22;color:#fff;border:none;border-radius:5px;padding:3px 8px;font-size:0.72rem;cursor:pointer;display:flex;align-items:center;gap:3px" onclick="editarObsAula('${e.id}','${per}',${oi})">✏️ Editar</button>
                <button title="Eliminar observación" style="background:#c0392b;color:#fff;border:none;border-radius:5px;padding:3px 8px;font-size:0.72rem;cursor:pointer;display:flex;align-items:center;gap:3px" onclick="eliminarObsAula('${e.id}','${per}',${oi})">🗑 Borrar</button>
              </div>`:''}
            </div>
          </div>`;
      }).join('')
      :`<p style="color:#ccc;font-size:0.8rem;margin:6px 0">Sin observaciones en P${per}</p>`;
    return `<div class="card" style="margin-bottom:10px;padding:14px 16px" id="obsCard_${e.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        <div>
          <b style="font-size:0.95rem;color:#1a3a5c">${e.n}</b>
          <span style="font-size:0.75rem;color:#888;margin-left:8px">${obsDelPer.length} obs. en P${per}${obsHoy.length?' · '+obsHoy.length+' tuyas':''}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button style="background:#1a3a5c;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:0.75rem;cursor:pointer;display:flex;align-items:center;gap:4px" onclick="toggleObsAulaForm('${e.id}')">✏️ Agregar observación</button>
          ${obsDelPer.length?`<button style="background:linear-gradient(135deg,#8e24aa,#6a1b9a);color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:0.75rem;cursor:pointer;display:flex;align-items:center;gap:4px" onclick="diagnosticoObsAulaIA('${e.id}','${per}')">🤖 Diagnóstico IA</button>`:''}
        </div>
      </div>
      <div id="obsAulaForm_${e.id}" style="display:none;border-top:1px solid #eee;padding-top:10px;margin-bottom:10px">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <select id="obsAulaTipo_${e.id}" style="padding:7px 10px;border:1px solid #ccd;border-radius:6px;font-size:0.83rem;flex:1;min-width:180px">${tipoOpts}</select>
          <input id="obsAulaFechaObs_${e.id}" type="text" placeholder="Fecha (ej: hoy)" value="${new Date().toLocaleDateString('es-CO')}" style="padding:7px 10px;border:1px solid #ccd;border-radius:6px;font-size:0.83rem;width:130px">
        </div>
        <input type="hidden" id="obsAulaEditIdx_${e.id}" value="-1">
        <textarea id="obsAulaTxt_${e.id}" rows="3" placeholder="Describa la observación con detalle..."
          style="width:100%;padding:8px 10px;border:1px solid #ccd;border-radius:6px;font-size:0.85rem;resize:vertical;box-sizing:border-box;margin-bottom:8px"></textarea>
        <div style="display:flex;gap:8px">
          <button style="background:#27ae60;color:#fff;border:none;border-radius:6px;padding:7px 18px;font-size:0.83rem;cursor:pointer" onclick="guardarObsAula('${e.id}','${per}')">💾 Guardar</button>
          <button style="background:#ecf0f1;color:#555;border:none;border-radius:6px;padding:7px 14px;font-size:0.83rem;cursor:pointer" onclick="toggleObsAulaForm('${e.id}')">❌ Cancelar</button>
        </div>
      </div>
      <div id="obsAulaDiag_${e.id}" style="display:none;background:#f8f0ff;border:1px solid #ce93d8;border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.85rem;line-height:1.6"></div>
      <div id="obsAulaHistorial_${e.id}">${totalHtml}</div>
    </div>`;
  }).join('');
}

function toggleObsAulaForm(estId){
  const f=document.getElementById('obsAulaForm_'+estId);
  if(!f) return;
  const visible=f.style.display!=='none';
  f.style.display=visible?'none':'block';
  if(!visible) document.getElementById('obsAulaTxt_'+estId)?.focus();
}

function guardarObsAula(estId,per){
  const tipo=document.getElementById('obsAulaTipo_'+estId)?.value||'Otro';
  const txt=(document.getElementById('obsAulaTxt_'+estId)?.value||'').trim();
  const fecha=document.getElementById('obsAulaFechaObs_'+estId)?.value||new Date().toLocaleDateString('es-CO');
  if(!txt){alert('Escriba el texto de la observación.');return;}
  const estIdNum=isNaN(Number(estId))?estId:Number(estId);
  const editIdxEl=document.getElementById('obsAulaEditIdx_'+estId);
  const editIdx=editIdxEl?parseInt(editIdxEl.value):-1;
  updDB(d=>{
    const idx=d.ests.findIndex(x=>x.id==estIdNum);
    if(idx===-1) return d;
    if(!d.ests[idx].observaciones) d.ests[idx].observaciones=[];
    if(editIdx>=0){
      // Editar observación existente
      var perObs=(d.ests[idx].observaciones||[]).filter(function(o){return String(o.per)===String(per);});
      var targetObs=perObs[editIdx];
      if(targetObs){
        var realIdx=d.ests[idx].observaciones.indexOf(targetObs);
        d.ests[idx].observaciones[realIdx].txt=txt;
        d.ests[idx].observaciones[realIdx].tipo=tipo;
        d.ests[idx].observaciones[realIdx].fecha=fecha;
      }
    } else {
      d.ests[idx].observaciones.push({per:String(per),txt,tipo,doc:sesion.n,fecha,anio:d.anio});
    }
    return d;
  });
  if(editIdxEl) editIdxEl.value='-1';
  // Feedback visual inmediato
  const colorTipo={'Comportamental':'#e67e22','Académica':'#2980b9','Logro':'#27ae60','Asistencia':'#8e44ad','Otro':'#7f8c8d'}[tipo]||'#555';
  const hist=document.getElementById('obsAulaHistorial_'+estId);
  if(hist && editIdx<0){
    const div=document.createElement('div');
    div.style.cssText=`border-left:3px solid ${colorTipo};padding:4px 8px;margin-bottom:5px;background:#f0faf4;border-radius:0 5px 5px 0;animation:fadeIn 0.3s ease`;
    div.innerHTML=`<span style="font-size:0.68rem;font-weight:700;color:${colorTipo};text-transform:uppercase">${tipo}</span> · <span style="font-size:0.82rem;color:#333">${txt}</span><span style="font-size:0.7rem;color:#aaa;display:block;margin-top:1px">${sesion.n} · ${fecha}</span>`;
    hist.insertBefore(div,hist.firstChild);
  }
  // Actualizar contador
  const eAct=db.ests.find(e=>e.id==estIdNum);
  const card=document.getElementById('obsCard_'+estId);
  if(card&&eAct){
    const perObs=(eAct.observaciones||[]).filter(o=>String(o.per)===String(per));
    const mias=perObs.filter(o=>o.doc===sesion.n);
    const span=card.querySelector('span[style*="0.75rem"]');
    if(span) span.textContent=perObs.length+' obs. en P'+per+(mias.length?' · '+mias.length+' tuyas':'');
  }
  // Limpiar y cerrar form
  document.getElementById('obsAulaTxt_'+estId).value='';
  toggleObsAulaForm(estId);
}

function editarObsAula(estId,per,oi){
  var estIdNum=isNaN(Number(estId))?estId:Number(estId);
  var est=db.ests.find(function(e){return e.id==estIdNum;});
  if(!est||!est.observaciones) return;
  var perObs=(est.observaciones||[]).filter(function(o){return String(o.per)===String(per);});
  var obs=perObs[oi];
  if(!obs) return;
  var form=document.getElementById('obsAulaForm_'+estId);
  if(form) form.style.display='block';
  var tipoEl=document.getElementById('obsAulaTipo_'+estId);
  if(tipoEl&&obs.tipo) tipoEl.value=obs.tipo;
  var txtEl=document.getElementById('obsAulaTxt_'+estId);
  if(txtEl) txtEl.value=obs.txt||'';
  var fechaEl=document.getElementById('obsAulaFechaObs_'+estId);
  if(fechaEl) fechaEl.value=obs.fecha||new Date().toLocaleDateString('es-CO');
  var editIdxEl=document.getElementById('obsAulaEditIdx_'+estId);
  if(editIdxEl) editIdxEl.value=String(oi);
  if(txtEl) txtEl.focus();
}

function eliminarObsAula(estId,per,oi){
  if(!confirm('¿Eliminar esta observación? Esta acción no se puede deshacer.')) return;
  var estIdNum=isNaN(Number(estId))?estId:Number(estId);
  updDB(function(d){
    var idx=d.ests.findIndex(function(e){return e.id==estIdNum;});
    if(idx===-1) return d;
    var obs=d.ests[idx].observaciones||[];
    var perObs=obs.filter(function(o){return String(o.per)===String(per);});
    var targetObs=perObs[oi];
    if(!targetObs) return d;
    var realIdx=obs.indexOf(targetObs);
    obs.splice(realIdx,1);
    d.ests[idx].observaciones=obs;
    return d;
  });
  var item=document.getElementById('obsItem_'+estId+'_'+oi);
  if(item) item.remove();
  var card=document.getElementById('obsCard_'+estId);
  if(card){
    var eAct=db.ests.find(function(e){return e.id==estIdNum;});
    if(eAct){
      var perObs=(eAct.observaciones||[]).filter(function(o){return String(o.per)===String(per);});
      var span=card.querySelector('span[style*="0.75rem"]');
      if(span) span.textContent=perObs.length+' obs. en P'+per;
    }
  }
}

function diagnosticoObsAulaIA(estId,per){
  var estIdNum=isNaN(Number(estId))?estId:Number(estId);
  var est=db.ests.find(function(e){return e.id==estIdNum;});
  if(!est) return;
  var diagDiv=document.getElementById('obsAulaDiag_'+estId);
  if(!diagDiv) return;
  diagDiv.style.display='block';
  diagDiv.innerHTML='<div style="text-align:center;padding:14px;color:#8e24aa">🤖 <b>Adán</b> está analizando las observaciones del estudiante...</div>';
  var obsPer=(est.observaciones||[]).filter(function(o){return String(o.per)===String(per);});
  var obsAll=(est.observaciones||[]).slice();
  // Recopilar notas del estudiante
  var notasEst=est.n1||est.notas||[];
  var asistEst=(db.asistencia||[]).filter(function(a){return (a.presentes||[]).includes(String(estIdNum))||(a.ausentes||[]).includes(String(estIdNum));});
  var ausenciasCount=asistEst.filter(function(a){return (a.ausentes||[]).includes(String(estIdNum));}).length;
  var justificadosCount=asistEst.filter(function(a){return (a.justificados||[]).includes(String(estIdNum));}).length;
  // Recopilar observador del estudiante
  var obsEst=(db.observadores||[]).filter(function(o){return String(o.estId)===String(estIdNum);});
  // Construir prompt para IA
  var promptText='Eres un psicoorientador escolar experto. Analiza el siguiente perfil del estudiante y genera un DIAGNÓSTICO DETALLADO con recomendaciones pedagógicas y psicológicas.\n\n';
  promptText+='ESTUDIANTE: '+est.n+' · Grado: '+est.g+'\n';
  promptText+='PERÍODO ANALIZADO: '+per+'\n\n';
  promptText+='OBSERVACIONES DE AULA (Período '+per+'):\n';
  obsPer.forEach(function(o,i){promptText+=(i+1)+'. ['+(o.tipo||'Otro')+'] '+(o.fecha||'')+' — '+(o.txt||'')+'\n';});
  if(obsAll.length>obsPer.length){promptText+='\nOBSERVACIONES DE OTROS PERÍODOS:\n';obsAll.filter(function(o){return String(o.per)!==String(per);}).forEach(function(o,i){promptText+=(i+1)+'. ['+(o.tipo||'Otro')+'] P'+(o.per||'?')+' '+(o.fecha||'')+' — '+(o.txt||'')+'\n';});}
  promptText+='\nREGISTRO DE OBSERVADOR (disciplinario):\n';
  obsEst.forEach(function(o,i){promptText+=(i+1)+'. ['+(o.causa||o.tipo||'N/A')+'] '+(o.fecha||'')+' — '+(o.desc||o.txt||'')+'\n';});
  promptText+='\nASISTENCIA: '+ausenciasCount+' ausencias, '+justificadosCount+' justificadas en total.\n';
  promptText+='\nGenera el diagnóstico con esta estructura:\n1. DIAGNÓSTICO GENERAL\n2. FACTORES DE RIESGO IDENTIFICADOS\n3. FORTALEZAS DEL ESTUDIANTE\n4. RECOMENDACIONES PEDAGÓGICAS\n5. RECOMENDACIONES PSICOLÓGICAS / DE ACOMPAÑAMIENTO\n6. PLAN DE ACCIÓN SUGERIDO\n\nUsa lenguaje profesional, empático y técnico apropiado para docentes y psicoorientadores.';
  // Llamar a la IA
  fetch(API_BASE+'/api/ia/generar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:promptText,max_tokens:1500})})
  .then(function(r){return r.json();})
  .then(function(data){
    var txt=data.text||data.response||data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content||'No se pudo generar el diagnóstico.';
    diagDiv.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="color:#8e24aa;font-size:0.9rem">🤖 Diagnóstico de Adán — '+est.n+' (P'+per+')</b><button style="background:#8e24aa;color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:0.75rem;cursor:pointer" onclick="descargarDiagnosticoObsAulaPDF(\''+estId+'\',\''+per+'\')">📄 Descargar PDF</button></div><div style="white-space:pre-wrap;line-height:1.7;font-size:0.85rem;color:#333">'+txt+'</div>';
  })
  .catch(function(e){
    // Fallback: generar diagnóstico local
    var txtLocal=_generarDiagnosticoLocal(est,obsPer,obsAll,obsEst,ausenciasCount,justificadosCount,per);
    diagDiv.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="color:#8e24aa;font-size:0.9rem">🤖 Diagnóstico de Adán — '+est.n+' (P'+per+')</b><button style="background:#8e24aa;color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:0.75rem;cursor:pointer" onclick="descargarDiagnosticoObsAulaPDF(\''+estId+'\',\''+per+'\')">📄 Descargar PDF</button></div><div style="white-space:pre-wrap;line-height:1.7;font-size:0.85rem;color:#333">'+txtLocal+'</div>';
  });
}

function _generarDiagnosticoLocal(est,obsPer,obsAll,obsEst,ausencias,justif,per){
  var tComport=obsPer.filter(function(o){return o.tipo==='Comportamental';}).length;
  var tAcad=obsPer.filter(function(o){return o.tipo==='Académica';}).length;
  var tAsist=obsPer.filter(function(o){return o.tipo==='Asistencia';}).length;
  var tLogro=obsPer.filter(function(o){return o.tipo==='Logro';}).length;
  var d='DIAGNÓSTICO GENERAL\n';
  d+='El estudiante '+est.n+' presenta '+obsPer.length+' observación(es) registrada(s) en el Período '+per+'. ';
  if(tComport>2) d+='Se evidencian múltiples observaciones de tipo comportamental, lo que sugiere la necesidad de intervención disciplinaria y de acompañamiento. ';
  if(tAcad>1) d+='Se registran observaciones académicas que indican dificultades en el proceso de aprendizaje. ';
  if(tLogro>0) d+='Es importante destacar la presencia de logros, lo que demuestra potencial del estudiante. ';
  d+='\n\nFACTORES DE RIESGO IDENTIFICADOS\n';
  if(tComport>1) d+='• Comportamiento disruptivo recurrente ('+tComport+' observaciones). Puede afectar el clima del aula y el aprendizaje colectivo.\n';
  if(tAcad>0) d+='• Dificultades académicas ('+tAcad+' observaciones). Requiere apoyo pedagógico adicional.\n';
  if(ausencias>3) d+='• Inasistencias frecuentes ('+ausencias+' ausencias). Riesgo de desvinculación escolar.\n';
  if(obsEst.length>2) d+='• Múltiples anotaciones en el observador disciplinario ('+obsEst.length+' registros). Patrón de conducta que requiere atención.\n';
  if(tComport===0&&tAcad===0&&ausencias<3) d+='• No se identifican factores de riesgo significativos en este período.\n';
  d+='\nFORTALEZAS DEL ESTUDIANTE\n';
  if(tLogro>0) d+='• Demuestra logros y capacidades destacables ('+tLogro+' observaciones positivas).\n';
  if(tComport===0&&tAcad===0) d+='• Comportamiento adecuado sin observaciones negativas en el período.\n';
  d+='• Participa del proceso educativo y está presente en el sistema.\n';
  d+='\nRECOMENDACIONES PEDAGÓGICAS\n';
  d+='• Implementar estrategias de aprendizaje diferenciado adaptadas al ritmo del estudiante.\n';
  if(tAcad>0) d+='• Brindar tutorías o apoyo académico adicional en las áreas de mayor dificultad.\n';
  d+='• Establecer metas de aprendizaje claras y alcanzables, con seguimiento semanal.\n';
  d+='• Fomentar la participación activa mediante actividades que aprovechen sus fortalezas.\n';
  d+='\nRECOMENDACIONES PSICOLÓGICAS / DE ACOMPAÑAMIENTO\n';
  if(tComport>1) d+='• Realar entrevista con psicoorientador para evaluar causas subyacentes del comportamiento.\n';
  d+='• Promover un clima de confianza y comunicación abierta con el estudiante.\n';
  if(ausencias>3) d+='• Investigar causas de inasistencias y establecer contacto con la familia.\n';
  d+='• Fortalecer el vínculo familia-escuela mediante reuniones periódicas.\n';
  d+='\nPLAN DE ACCIÓN SUGERIDO\n';
  d+='1. Reunión con acudiente para compartir observaciones y establecer compromisos.\n';
  d+='2. Seguimiento semanal del comportamiento y rendimiento académico.\n';
  if(tComport>1) d+='3. Remisión a psicoorientación para evaluación y acompañamiento.\n';
  else d+='3. Monitoreo del progreso y ajuste de estrategias según evolución.\n';
  d+='4. Evaluación de resultados al final del Período '+(parseInt(per)+1)+' y ajuste del plan si es necesario.\n';
  return d;
}

function descargarDiagnosticoObsAulaPDF(estId,per){
  var estIdNum=isNaN(Number(estId))?estId:Number(estId);
  var est=db.ests.find(function(e){return e.id==estIdNum;});
  if(!est) return;
  var diagDiv=document.getElementById('obsAulaDiag_'+estId);
  if(!diagDiv) return;
  var txt=diagDiv.innerText||diagDiv.textContent||'';
  var doc=new window.jspdf.jsPDF({unit:'mm',format:'a4'});
  var PW=210,PH=297,MX=15,MW=PW-MX*2;
  var y=18;
  // Encabezado: Colombia izquierda, institución derecha
  var _escColDiag=db.escudoColombia||window._ESCUDO_COL_B64||(typeof ESCUDO_COLOMBIA!=='undefined'?ESCUDO_COLOMBIA:null);
  if(_escColDiag){try{doc.addImage(_escColDiag,'JPEG',MX,y,18,18);}catch(e){try{doc.addImage(_escColDiag,'PNG',MX,y,18,18);}catch(e2){}}}
  if(db.logo){try{doc.addImage(db.logo,'PNG',PW-MX-18,y,18,18);}catch(e){}}
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(0,51,102);
  doc.text((db.nombre||'Institución Educativa').toUpperCase(),PW/2,y+5,{align:'center'});
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(80,80,80);
  doc.text('DIAGNÓSTICO DE OBSERVACIONES DE AULA',PW/2,y+11,{align:'center'});
  doc.text('Estudiante: '+est.n+' · Grado: '+est.g+' · Período: '+per,PW/2,y+16,{align:'center'});
  doc.text('Generado: '+new Date().toLocaleString('es-CO'),PW/2,y+21,{align:'center'});
  y+=28;
  doc.setDrawColor(0,51,102);doc.setLineWidth(0.3);doc.line(MX,y,PW-MX,y);y+=6;
  doc.setFontSize(9);doc.setTextColor(40,40,40);
  var lines=doc.splitTextToSize(txt,MW);
  lines.forEach(function(ln){
    if(y>PH-15){doc.addPage();y=18;}
    doc.text(ln,MX,y);y+=5;
  });
  doc.save('Diagnostico_'+est.n.replace(/[^a-zA-Z0-9]/g,'_')+'_P'+per+'.pdf');
}

// ============================================================
// AVISO DOCENTE A ESTUDIANTES
// ============================================================
function htmlAvisoDocente(){
  // Grados que dicta este docente
  const misGrados=[...new Set((db.carga||[]).filter(c=>c.d===sesion.u).map(c=>c.g))].sort();
  const misAsigs=[...new Set((db.carga||[]).filter(c=>c.d===sesion.u).map(c=>c.m))].sort();
  if(!misGrados.length){
    return `<h3 class="sec-title">📢 Avisos a Estudiantes</h3>
    <div class="info-box">No tiene grados asignados en la carga académica. Contacte al rector para que le asigne cursos.</div>`;
  }
  const gradOpts='<option value="">— Todos mis grados —</option>'+misGrados.map(g=>`<option value="${g}">${g}</option>`).join('');
  const asigOpts='<option value="">— Sin especificar —</option>'+misAsigs.map(a=>`<option value="${a}">${a}</option>`).join('');
  const conteoEsts=grado=>grado?(db.ests||[]).filter(e=>e.g===grado).length:(db.ests||[]).filter(e=>misGrados.includes(e.g)).length;
  return `<h3 class="sec-title">📢 Avisos a Estudiantes</h3>
  <div class="info-box" style="margin-bottom:14px">
    <b>Sus grados asignados:</b> ${misGrados.join(', ')} · <b>Puede enviar avisos, tareas o recordatorios</b> que aparecerán en la sección <b>"📬 Mis Comunicados"</b> del portal del estudiante y del acudiente.
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
    <div>
      <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Tipo de aviso</label>
      <select id="docComTipo" style="width:100%;padding:9px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem">
        <option value="aviso-docente">📢 Aviso General</option>
        <option value="aviso-docente">📚 Tarea / Actividad</option>
        <option value="aviso-docente">📅 Recordatorio</option>
        <option value="aviso-docente">📋 Circular de Aula</option>
      </select>
    </div>
    <div>
      <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Dirigido a grado</label>
      <select id="docComGrado" onchange="document.getElementById('docComConteo').textContent=
        (this.value?(db.ests||[]).filter(e=>e.g===this.value).length:(db.ests||[]).filter(e=>[${misGrados.map(g=>`'${g}'`).join(',')}].includes(e.g)).length)+' estudiante(s)'"
        style="width:100%;padding:9px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem">${gradOpts}</select>
      <p id="docComConteo" style="font-size:0.75rem;color:#888;margin:3px 0 0">${conteoEsts('')} estudiante(s)</p>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
    <div>
      <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Asignatura relacionada (opcional)</label>
      <select id="docComAsig" style="width:100%;padding:9px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem">${asigOpts}</select>
    </div>
    <div>
      <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Fecha límite / entrega (opcional)</label>
      <input type="date" id="docComFecha" style="width:100%;padding:9px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem;box-sizing:border-box">
    </div>
  </div>
  <div style="margin-bottom:12px">
    <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Asunto / Título</label>
    <input id="docComAsunto" type="text" placeholder="Ej: Tarea de matemáticas para el viernes" maxlength="120"
      style="width:100%;padding:9px 12px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem;box-sizing:border-box">
  </div>
  <div style="margin-bottom:16px">
    <label style="font-size:0.83rem;font-weight:600;color:#1a3a5c;display:block;margin-bottom:5px">Mensaje / Instrucciones</label>
    <textarea id="docComMensaje" rows="5" placeholder="Describa la tarea, aviso o recordatorio con instrucciones claras..."
      style="width:100%;padding:10px 12px;border:1px solid #ccd;border-radius:7px;font-size:0.9rem;resize:vertical;box-sizing:border-box"></textarea>
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
    <button class="btn" style="background:#1e8449;color:#fff;padding:10px 26px;font-size:0.92rem" onclick="enviarAvisoDocente()">📨 Publicar Aviso</button>
    <button class="btn" style="background:#ecf0f1;color:#555;padding:10px 18px;font-size:0.88rem" onclick="(function(){
      const pre=document.getElementById('docComPrev');
      pre.style.display=pre.style.display==='none'?'block':'none';
      if(pre.style.display==='block'){
        const asunto=document.getElementById('docComAsunto').value||'(sin asunto)';
        const msg=document.getElementById('docComMensaje').value||'(sin mensaje)';
        const grado=document.getElementById('docComGrado').value;
        const asig=document.getElementById('docComAsig').value;
        const fecha=document.getElementById('docComFecha').value;
        pre.innerHTML='<p style=margin:0_0_6px;font-size:0.75rem;font-weight:700;color:#1e8449;text-transform:uppercase;letter-spacing:1px>Vista previa</p>'
          +'<b>👨‍🏫 Aviso de '+sesion.n+'</b>'+(asig?' · '+asig:'')+(grado?' · Grado '+grado:' · Todos mis grados')+'<br><br>'
          +'<b>'+asunto+'</b><br><br>'+msg.replace(/\\n/g,'<br>')
          +(fecha?'<br><br><b style=color:#c0392b>📅 Fecha límite: '+fecha+'</b>':'')
          +'<br><br><em style=color:#aaa;font-size:0.78rem>Docente: '+sesion.n+'</em>';
      }
    })()">👁 Vista Previa</button>
  </div>
  <div id="docComPrev" style="display:none;border:2px dashed #1e8449;border-radius:9px;padding:14px;margin-bottom:18px;background:#f0faf4;font-size:0.88rem;color:#222;line-height:1.6"></div>
  <div id="docComProgreso" style="display:none;background:#fff;border:1px solid #dce;border-radius:9px;padding:14px;margin-bottom:14px">
    <h4 style="color:#1e8449;margin:0 0 8px;font-size:0.9rem">📤 Publicando aviso...</h4>
    <div style="background:#eee;border-radius:6px;height:8px;overflow:hidden;margin-bottom:8px"><div id="docComBarra" style="height:8px;background:#1e8449;border-radius:6px;width:0%;transition:width 0.4s ease"></div></div>
    <div id="docComLog" style="font-size:0.82rem;color:#444"></div>
  </div>
  <div id="docComHistorial" style="display:none;background:#f8fdf9;border:1px solid #d5ead8;border-radius:9px;padding:14px">
    <h4 style="color:#1e8449;margin:0 0 10px;font-size:0.9rem">📋 Avisos publicados (esta sesión)</h4>
    <div id="docComHistItems"></div>
  </div>`;
}

let _docAvisoHist=[];
async function enviarAvisoDocente(){
  const tipo='aviso-docente';
  const asunto=(document.getElementById('docComAsunto').value||'').trim();
  const msg=(document.getElementById('docComMensaje').value||'').trim();
  const grado=document.getElementById('docComGrado').value;
  const asig=document.getElementById('docComAsig').value;
  const fecha=document.getElementById('docComFecha').value;
  if(!asunto){alert('Escriba un asunto para el aviso.');document.getElementById('docComAsunto').focus();return;}
  if(!msg){alert('Escriba el contenido del aviso.');document.getElementById('docComMensaje').focus();return;}
  const gradoLabel=grado||'Todos mis grados';
  const actor=`${sesion.n}, ${db.nombre||'Institución'}`;
  let mensajeCompleto=asunto+'\n\n'+msg;
  if(asig) mensajeCompleto+='\n\nAsignatura: '+asig;
  if(fecha) mensajeCompleto+='\n📅 Fecha límite: '+fecha;
  const progreso=document.getElementById('docComProgreso');
  const barra=document.getElementById('docComBarra');
  const logDiv=document.getElementById('docComLog');
  progreso.style.display='block';
  barra.style.width='15%';
  logDiv.innerHTML='⏳ Registrando aviso en el sistema...';
  let ok=false;
  try{
    const meta={grado:grado||null,asunto,asig:asig||null,fechaLimite:fecha||null,docente:sesion.n,docenteU:sesion.u};
    const r=await fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:tipo,actor,message:mensajeCompleto,meta})});
    ok=r.ok;
    barra.style.width='100%';
    if(ok){
      logDiv.innerHTML='✅ Aviso publicado correctamente. Los estudiantes del grado <b>'+gradoLabel+'</b> lo verán en "📬 Mis Comunicados" al actualizar su portal.';
    } else {
      logDiv.innerHTML='❌ Error al publicar: HTTP '+r.status;
    }
  } catch(e){
    barra.style.width='100%';
    logDiv.innerHTML='❌ Error de red: '+e.message;
  }
  const ahora=new Date().toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  _docAvisoHist.unshift({asunto,grado:gradoLabel,asig:asig||'—',ok,ahora,fecha});
  const histDiv=document.getElementById('docComHistorial');
  const histItems=document.getElementById('docComHistItems');
  histDiv.style.display='block';
  histItems.innerHTML=_docAvisoHist.map(h=>`<div style="border-left:3px solid ${h.ok?'#27ae60':'#e74c3c'};padding:7px 12px;margin-bottom:8px;background:#fff;border-radius:0 6px 6px 0">
    <span style="font-size:0.78rem;font-weight:700;color:${h.ok?'#27ae60':'#e74c3c'}">${h.ok?'✅ Publicado':'❌ Error'}</span>
    <span style="font-size:0.74rem;color:#aaa;margin-left:10px">${h.ahora}</span>
    <span style="font-size:0.72rem;background:#e8f8f5;color:#1e8449;border-radius:4px;padding:1px 7px;margin-left:6px">Grado ${h.grado}</span>
    ${h.asig&&h.asig!=='—'?`<span style="font-size:0.72rem;background:#eaf4fe;color:#1a5276;border-radius:4px;padding:1px 7px;margin-left:4px">${h.asig}</span>`:''}
    ${h.fecha?`<span style="font-size:0.72rem;background:#fde8e8;color:#c0392b;border-radius:4px;padding:1px 7px;margin-left:4px">📅 ${h.fecha}</span>`:''}
    <p style="margin:4px 0 0;font-size:0.84rem;color:#333;font-weight:600">${h.asunto}</p>
  </div>`).join('');
  if(ok){
    document.getElementById('docComAsunto').value='';
    document.getElementById('docComMensaje').value='';
    document.getElementById('docComFecha').value='';
    document.getElementById('docComPrev').style.display='none';
    setTimeout(()=>{progreso.style.display='none';barra.style.width='0%';},4000);
  }
}

// ============================================================
// ALERTA TEMPRANA ACADÉMICA
// ============================================================
function htmlAlertaTemprana(){
  const _numPerAT=(db.config&&db.config.numPeriodos)||4;
  const perA=db.periodosActivos||Array(_numPerAT).fill(true);
  const perActual=perA.lastIndexOf(true)+1||1;
  const gradOpts=(db.grados||[]).map(g=>`<option value="${g.n}">${g.n}</option>`).join('');
  return `<h3 class="sec-title">🔔 Alertas Académicas Tempranas</h3>
  <div class="info-box" style="margin-bottom:14px">
    <b>¿Qué hace este módulo?</b> Detecta estudiantes con áreas perdidas en un período determinado, registra una notificación interna en el sistema y envía correo electrónico de alerta al acudiente si tiene email registrado.
  </div>

  <div class="card" style="margin-bottom:14px">
    <h4 style="color:#1a3a5c;margin:0 0 14px;font-size:0.93rem">⚙️ Configurar y Analizar</h4>
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">
      <div>
        <label class="lbl">Período a evaluar</label>
        <select id="at-periodo" style="font-size:0.9rem;padding:7px 14px;border-radius:7px;border:1px solid #ccd;background:#fff">
          ${Array.from({length:(db.config&&db.config.numPeriodos)||4},(_,i)=>i+1).map(p=>`<option value="${p}"${p===perActual?' selected':''}>Período ${p}${perA[p-1]!==false?' (activo)':' (cerrado)'}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="lbl">Mínimo de áreas perdidas</label>
        <select id="at-umbral" style="font-size:0.9rem;padding:7px 14px;border-radius:7px;border:1px solid #ccd;background:#fff">
          <option value="1">1 o más áreas</option>
          <option value="2" selected>2 o más áreas</option>
          <option value="3">3 o más áreas</option>
          <option value="4">4 o más áreas</option>
        </select>
      </div>
      <div>
        <label class="lbl">Filtrar por grado (opcional)</label>
        <select id="at-grado" style="font-size:0.9rem;padding:7px 14px;border-radius:7px;border:1px solid #ccd;background:#fff">
          <option value="">— Todos los grados —</option>
          ${gradOpts}
        </select>
      </div>
      <button class="btn" style="background:#1a3a5c;color:#fff;font-size:0.88rem;padding:9px 20px" onclick="analizarAlertas()">🔍 Analizar</button>
    </div>
  </div>

  <div id="at-resultados" style="display:none">
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <h4 style="color:#922b21;margin:0;font-size:0.93rem" id="at-titulo-res">⚠️ Estudiantes en Riesgo</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" style="background:#666;color:#fff;font-size:0.8rem;padding:6px 12px" onclick="toggleAllAlertas(true)">☑ Todo</button>
          <button class="btn" style="background:#999;color:#fff;font-size:0.8rem;padding:6px 12px" onclick="toggleAllAlertas(false)">☐ Ninguno</button>
          <button class="btn" style="background:#c0392b;color:#fff;font-size:0.88rem;padding:8px 20px" onclick="enviarAlertasSeleccionadas()">📨 Enviar Alertas</button>
        </div>
      </div>
      <p style="font-size:0.76rem;color:#888;margin:0 0 10px">Marque los estudiantes a alertar. Los sin email solo recibirán notificación interna del sistema.</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
          <thead><tr style="background:#922b21;color:#fff">
            <th style="padding:7px;text-align:center;width:32px"><input type="checkbox" onchange="toggleAllAlertas(this.checked)"></th>
            <th style="padding:7px 10px;text-align:left">Estudiante</th>
            <th style="padding:7px 8px;text-align:center">Grado</th>
            <th style="padding:7px 8px;text-align:center">Áreas Perdidas</th>
            <th style="padding:7px 10px;text-align:left">Acudiente</th>
            <th style="padding:7px 10px;text-align:left">Correo Acudiente</th>
            <th style="padding:7px 8px;text-align:center;min-width:90px">Estado</th>
          </tr></thead>
          <tbody id="at-tabla-body"></tbody>
        </table>
      </div>
    </div>
  </div>

  <div id="at-progress" style="display:none" class="card" style="margin-bottom:14px">
    <h4 style="color:#1a5276;margin:0 0 10px;font-size:0.93rem">📨 Enviando alertas...</h4>
    <div style="background:#e9ecef;border-radius:20px;height:18px;overflow:hidden;margin-bottom:8px">
      <div id="at-progress-bar" style="background:#1a5276;height:100%;width:0%;border-radius:20px;transition:width .4s"></div>
    </div>
    <p id="at-progress-txt" style="font-size:0.83rem;color:#555;text-align:center;margin:0"></p>
  </div>

  <div id="at-historial" class="card">
    <h4 style="color:#1a3a5c;margin:0 0 10px;font-size:0.93rem">📋 Historial de Alertas (esta sesión)</h4>
    <div id="at-log" style="font-size:0.82rem;color:#555;max-height:240px;overflow-y:auto">
      <p style="color:#bbb;text-align:center;padding:14px">Aún no se han enviado alertas en esta sesión.</p>
    </div>
  </div>`;
}

function analizarAlertas(){
  const periodo=parseInt(document.getElementById('at-periodo')?.value||1);
  const umbral=parseInt(document.getElementById('at-umbral')?.value||2);
  const gradoF=document.getElementById('at-grado')?.value||'';
  const candidatos=(db.ests||[]).filter(e=>{
    if(gradoF&&e.g!==gradoF) return false;
    return calcAreasPerdPeriodo(e.id,e.g,periodo)>=umbral;
  }).map(e=>({
    e,
    areasP:calcAreasPerdPeriodo(e.id,e.g,periodo),
    acudiente:e.acudiente||'—',
    email:e.email||'',
    tel:e.telAcud||''
  })).sort((a,b)=>b.areasP-a.areasP);
  _alertasAnalizadas=candidatos;
  const tbody=document.getElementById('at-tabla-body');
  const resDiv=document.getElementById('at-resultados');
  const tit=document.getElementById('at-titulo-res');
  if(!tbody||!resDiv) return;
  if(tit) tit.textContent=`⚠️ Estudiantes en Riesgo — Período ${periodo} (${candidatos.length} encontrado${candidatos.length!==1?'s':''})`;
  if(!candidatos.length){
    tbody.innerHTML=`<tr><td colspan="7" style="padding:20px;text-align:center;color:#1e8449;font-weight:bold">✅ Ningún estudiante tiene ${umbral} o más área(s) perdida(s) en el Período ${periodo}.</td></tr>`;
    resDiv.style.display='block';return;
  }
  tbody.innerHTML=candidatos.map((c,i)=>{
    const nivel=c.areasP>=4?'🔴 Crítico':c.areasP===3?'🟠 Alto':'🟡 Moderado';
    const tieneEmail=!!c.email;
    return `<tr id="at-row-${i}" style="${i%2===0?'background:#fffafa':'background:#fff'}">
      <td style="padding:7px;text-align:center"><input type="checkbox" class="at-chk" data-idx="${i}" checked></td>
      <td style="padding:7px 10px;font-weight:500">${c.e.n}</td>
      <td style="padding:6px 8px;text-align:center;font-size:0.82rem">${c.e.g}</td>
      <td style="padding:6px 8px;text-align:center">
        <span style="font-weight:bold;color:#c0392b;font-size:1rem">${c.areasP}</span>
        <small style="font-size:0.7rem;display:block;color:#888">${nivel}</small>
      </td>
      <td style="padding:6px 10px;font-size:0.82rem">${c.acudiente}</td>
      <td style="padding:6px 10px;font-size:0.8rem;color:${tieneEmail?'#1a5276':'#bbb'}">${tieneEmail?c.email:'⚠️ Sin email registrado'}</td>
      <td id="at-estado-${i}" style="padding:6px 8px;text-align:center;font-size:0.78rem;color:#aaa">🕐 Pendiente</td>
    </tr>`;
  }).join('');
  resDiv.style.display='block';
}

function toggleAllAlertas(val){
  document.querySelectorAll('.at-chk').forEach(chk=>chk.checked=val);
}

async function enviarAlertasSeleccionadas(){
  const periodo=parseInt(document.getElementById('at-periodo')?.value||1);
  const selIdxs=Array.from(document.querySelectorAll('.at-chk:checked')).map(chk=>parseInt(chk.dataset.idx));
  if(!selIdxs.length){alert('No hay estudiantes seleccionados.');return;}
  const progDiv=document.getElementById('at-progress');
  const progBar=document.getElementById('at-progress-bar');
  const progTxt=document.getElementById('at-progress-txt');
  const logDiv=document.getElementById('at-log');
  if(progDiv) progDiv.style.display='block';
  let enviados=0,conEmail=0,sinEmail=0,errores=0;
  const total=selIdxs.length;
  const logEntries=[];
  for(const idx of selIdxs){
    const c=_alertasAnalizadas[idx];if(!c) continue;
    if(progBar) progBar.style.width=Math.round((enviados/total)*100)+'%';
    if(progTxt) progTxt.textContent=`Procesando ${enviados+1} de ${total}: ${c.e.n}...`;
    const estadoCell=document.getElementById('at-estado-'+idx);
    let estadoHTML='',logMsg='';
    try{
      // 1. Notificación interna
      const msgN=`⚠️ Alerta Académica P${periodo}: ${c.e.n} (${c.e.g}) tiene ${c.areasP} área(s) perdida(s). Acudiente: ${c.acudiente}.`;
      await fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:'alerta-academica',actor:sesion.n||'Sistema',message:msgN,
          meta:{estId:c.e.id,estNombre:c.e.n,grado:c.e.g,areasP:c.areasP,periodo,acudiente:c.acudiente,fecha:new Date().toISOString()}})});
      // 2. Email al acudiente (si tiene)
      if(c.email){
        const areasList=getAreasPerdidasPeriodo(c.e.id,c.e.g,periodo);
        const cuerpo=`Estimado/a ${c.acudiente},\n\nLe informamos que su acudido/a ${c.e.n}, estudiante del grado ${c.e.g} de ${db.nombre||'nuestra institución'}, presenta ${c.areasP} área(s) con desempeño BAJO en el Período ${periodo} del año ${db.anio||''}.\n\nÁreas en riesgo: ${areasList.join(', ')||'(ver planilla)'}\n\nLe invitamos a comunicarse con el director(a) de grupo o con rectoría para acordar un plan de mejoramiento.\n\nAtentamente,\n${db.rectora||'La Rectoría'}\n${db.nombre||'Institución Educativa'}\nTeléfono: ${db.telInst||'—'}   ·   Correo: ${db.emailInst||'—'}`;
        const resp=await fetch(API_BASE+'/api/inetis/send-email',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({to:c.email,subject:`⚠️ Alerta Académica Período ${periodo} — ${c.e.n} — ${db.nombre||''}`,text:cuerpo})});
        if(resp.ok){
          conEmail++;
          estadoHTML='<span style="color:#1e8449;font-weight:bold">✅ Alertado</span><br><span style="font-size:0.68rem;color:#1e8449">+ Email enviado</span>';
          logMsg=`✅ ${c.e.n} — Notif. interna ✓ · Email → ${c.email} ✓`;
        } else {
          const errD=await resp.json().catch(()=>({}));
          sinEmail++;
          estadoHTML='<span style="color:#b7770d;font-weight:bold">📬 Notificado</span><br><span style="font-size:0.68rem;color:#b7770d">Email no enviado</span>';
          logMsg=`⚠️ ${c.e.n} — Notif. interna ✓ · Email falló (${errD.hint||resp.status})`;
        }
      } else {
        sinEmail++;
        estadoHTML='<span style="color:#1a5276;font-weight:bold">📬 Notificado</span><br><span style="font-size:0.68rem;color:#bbb">Sin email</span>';
        logMsg=`📬 ${c.e.n} — Notif. interna ✓ · Sin email registrado`;
      }
    } catch(err){
      errores++;
      estadoHTML='<span style="color:#c0392b">❌ Error</span>';
      logMsg=`❌ ${c.e.n} — Error: ${err.message}`;
    }
    if(estadoCell) estadoCell.innerHTML=estadoHTML;
    logEntries.push({ts:new Date().toLocaleTimeString('es-CO'),msg:logMsg});
    enviados++;
  }
  if(progBar) progBar.style.width='100%';
  if(progTxt) progTxt.innerHTML=`<b>✅ Proceso completado</b> — ${enviados} alertas · ${conEmail} emails enviados · ${sinEmail} sin email · ${errores} errores`;
  // Log
  if(logDiv){
    const ts=new Date().toLocaleString('es-CO');
    const bloque=`<div style="background:#eaf4fe;border-radius:8px;padding:10px 12px;margin-bottom:8px;border-left:4px solid #1a5276">
      <b style="color:#1a5276">📋 Envío — ${ts} — Período ${periodo} — ${enviados} alerta(s):</b>
      <ul style="margin:6px 0 0;padding-left:18px">
        ${logEntries.map(l=>`<li style="margin:3px 0;color:#444">${l.ts} · ${l.msg}</li>`).join('')}
      </ul>
      <div style="margin-top:6px;font-size:0.78rem;color:#555">Total: ${conEmail} con email · ${sinEmail} sin email · ${errores} errores</div>
    </div>`;
    if(logDiv.querySelector('p')) logDiv.innerHTML='';
    logDiv.insertAdjacentHTML('afterbegin',bloque);
  }
}

// ============================================================
// VISTA ESTADO DE NOTAS PARA DOCENTES
// ============================================================
function htmlEstadoNotas(){
  const isAdmin=sesion.r==='admin';
  const misCargas=isAdmin?db.carga:db.carga.filter(c=>c.d===sesion.u);
  if(!misCargas.length) return '<h3 class="sec-title">🔍 Estado de Notas</h3><div class="card"><p class="empty">No tiene asignaturas asignadas.</p></div>';
  const _numPerEN=(db.config&&db.config.numPeriodos)||4;
  const periodos=Array.from({length:_numPerEN},(_,i)=>i+1);
  const perActivos=db.periodosActivos||Array(_numPerEN).fill(true);
  let html='<h3 class="sec-title">🔍 Estado de Notas — Resumen de Pendientes</h3>';
  html+='<div class="info-box" style="margin-bottom:12px">📋 Aquí puede ver cuáles estudiantes aún tienen notas sin ingresar (en cero o vacías) por asignatura y periodo.</div>';
  // Agrupar por grado
  const gradosEnCargas=[...new Set(misCargas.map(c=>c.g))].sort();
  gradosEnCargas.forEach(grado=>{
    const cargasGrado=misCargas.filter(c=>c.g===grado);
    const estsGrado=db.ests.filter(e=>e.g===grado).sort((a,b)=>a.n.localeCompare(b.n));
    if(!estsGrado.length) return;
    html+=`<div class="card" style="margin-bottom:16px"><h4 class="card-title">📚 Grado: ${grado} <small style="color:#888;font-size:0.78rem">(${estsGrado.length} estudiantes)</small></h4>`;
    html+='<div class="over"><table style="width:100%;font-size:0.8rem"><thead><tr style="background:#003366;color:#fff">';
    html+='<th style="text-align:left;padding:6px 8px;min-width:180px">Asignatura</th>';
    periodos.forEach(p=>{
      const abierto=perActivos[p-1]!==false;
      html+=`<th style="padding:6px 8px;text-align:center">P${p}<br><span style="font-size:0.65rem;font-weight:normal;color:${abierto?'#a8f0a8':'#ffaaaa'}">${abierto?'Abierto':'Cerrado'}</span></th>`;
    });
    html+='</tr></thead><tbody>';
    cargasGrado.forEach((carga,ci)=>{
      const bg=ci%2===0?'#f8f9fa':'#fff';
      html+=`<tr style="background:${bg}"><td style="text-align:left;padding:5px 8px;font-weight:bold">${carga.m}<br><small style="color:#888;font-weight:normal">${carga.dn||''}</small></td>`;
      periodos.forEach(p=>{
        // Contar estudiantes con TODAS las notas en cero en este periodo
        let sinNota=0,conNota=0;
        estsGrado.forEach(est=>{
          const nts=(est.nts||{});
          const nd=(nts[carga.id]||{})[p]||null;
          if(!nd||((nd.s||0)===0&&(nd.sb||0)===0&&(nd.h||0)===0)){
            sinNota++;
          } else {
            conNota++;
          }
        });
        const total=estsGrado.length;
        const pct=total>0?Math.round(conNota/total*100):0;
        const col=pct===100?'#27ae60':pct>=50?'#e67e22':'#c0392b';
        const bgCell=pct===100?'#eafaf1':pct>=50?'#fef9e7':'#fdecea';
        html+=`<td style="text-align:center;padding:5px 4px;background:${bgCell}">
          <span style="font-weight:bold;color:${col};font-size:0.85rem">${pct}%</span><br>
          <span style="font-size:0.65rem;color:#555">${conNota}/${total}</span>
          ${sinNota>0?`<br><button class="btn-sm" style="background:#c0392b;font-size:0.6rem;padding:2px 5px;margin-top:2px" onclick="verPendientesNotas(${carga.id},${p},'${grado}')">Ver ${sinNota} pend.</button>`:'<br><span style="font-size:0.65rem;color:#27ae60">✅ Completo</span>'}
        </td>`;
      });
      html+='</tr>';
    });
    html+='</tbody></table></div>';
    html+='</div>';
  });
  html+='<div id="pendientesWrap"></div>';
  return html;
}
function verPendientesNotas(cargaId,per,grado){
  const carga=db.carga.find(c=>c.id===cargaId);
  if(!carga) return;
  const ests=db.ests.filter(e=>e.g===grado).sort((a,b)=>a.n.localeCompare(b.n));
  const pendientes=ests.filter(est=>{
    const nd=((est.nts||{})[cargaId]||{})[per]||null;
    return !nd||((nd.s||0)===0&&(nd.sb||0)===0&&(nd.h||0)===0);
  });
  const wrap=document.getElementById('pendientesWrap');
  if(!wrap) return;
  if(!pendientes.length){wrap.innerHTML='<div class="card" style="border-left:4px solid #27ae60"><p style="color:#27ae60;font-weight:bold">✅ Todos los estudiantes tienen notas en P'+per+' para '+carga.m+'</p></div>';return;}
  const rows=pendientes.map(e=>'<tr><td style="text-align:left;padding:5px 8px">'+e.n+'</td><td style="padding:5px 8px;color:#c0392b">Sin notas</td></tr>').join('');
  wrap.innerHTML=`<div class="card" style="border-left:4px solid #c0392b;margin-top:10px">
    <h4 class="card-title">⚠️ Estudiantes sin notas — ${carga.m} | P${per} | ${grado}</h4>
    <div class="over"><table><thead><tr><th style="text-align:left">Estudiante</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn btn-gray" style="margin-top:10px" onclick="document.getElementById('pendientesWrap').innerHTML=''">✕ Cerrar</button>
  </div>`;
  wrap.scrollIntoView({behavior:'smooth'});
}

// ============================================================
// CRONOGRAMA DE APERTURA/CIERRE DE NOTAS POR PERIODO
// ============================================================
function htmlCronogramaNotas(){
  const _numPerCR=(db.config&&db.config.numPeriodos)||4;
  const _crDefault={};for(let i=1;i<=_numPerCR;i++) _crDefault['p'+i]={desde:'',hasta:''};
  const cr=db.cronograma||_crDefault;
  const perActivos=db.periodosActivos||Array(_numPerCR).fill(true);
  const hoy=new Date().toISOString().slice(0,10);
  let html='<h3 class="sec-title">📅 Cronograma de Ingreso de Notas</h3>';
  html+='<div class="info-box" style="margin-bottom:14px">⏰ Configure las fechas de apertura y cierre para el ingreso de notas por periodo. Fuera de estas fechas los docentes no podrán modificar calificaciones. Los administradores siempre pueden ingresar notas.</div>';
  html+='<div class="card"><h4 class="card-title">📆 Fechas por Periodo ('+_numPerCR+' periodos configurados)</h4>';
  html+='<div class="over"><table style="width:100%"><thead><tr style="background:#003366;color:#fff"><th style="padding:8px">Periodo</th><th style="padding:8px">Fecha de Apertura</th><th style="padding:8px">Fecha de Cierre</th><th style="padding:8px">Estado Actual</th><th style="padding:8px">Acceso Docentes</th></tr></thead><tbody>';
  Array.from({length:_numPerCR},(_,i)=>i+1).forEach(p=>{
    const key='p'+p;
    const desde=cr[key]?.desde||'';
    const hasta=cr[key]?.hasta||'';
    const activo=perActivos[p-1]!==false;
    let estadoFecha='Sin configurar';
    let colEstado='#888';
    if(desde&&hasta){
      if(hoy<desde){estadoFecha='Apertura próxima';colEstado='#8e44ad';}
      else if(hoy>=desde&&hoy<=hasta){estadoFecha='✅ Abierto';colEstado='#27ae60';}
      else{estadoFecha='Cerrado (venció)';colEstado='#c0392b';}
    }
    html+=`<tr>
      <td style="text-align:center;font-weight:bold;font-size:1.1rem">P${p}</td>
      <td style="text-align:center"><input type="date" id="crDesde${p}" value="${desde}" style="padding:5px;border-radius:5px;border:1.5px solid #ccc"></td>
      <td style="text-align:center"><input type="date" id="crHasta${p}" value="${hasta}" style="padding:5px;border-radius:5px;border:1.5px solid #ccc"></td>
      <td style="text-align:center;color:${colEstado};font-weight:bold">${estadoFecha}</td>
      <td style="text-align:center">
        <label class="toggle-sw" title="Abrir/Cerrar acceso docentes a P${p}"><input type="checkbox" ${activo?'checked':''} onchange="togglePeriodoCronograma(${p-1},this.checked)"><span class="slider"></span></label>
        <span style="font-size:0.75rem;display:block;margin-top:2px;color:${activo?'#27ae60':'#c0392b'}">${activo?'Abierto':'Cerrado'}</span>
      </td>
    </tr>`;
  });
  html+='</tbody></table></div>';
  html+='<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">';
  html+='<button class="btn btn-green" onclick="guardarCronograma()">💾 Guardar Cronograma</button>';
  html+='<button class="btn btn-blue" onclick="aplicarCronogramaAuto()">🔄 Aplicar Automáticamente según Fechas</button>';
  html+='</div>';
  html+='<div id="crStatus" style="margin-top:10px;font-size:0.85rem"></div>';
  html+='</div>';
  html+='<div class="card" style="margin-top:16px"><h4 class="card-title">ℹ️ Instrucciones</h4>';
  html+='<ul style="font-size:0.85rem;line-height:1.8;color:#555">';
  html+='<li><b>Fecha Apertura</b>: desde cuándo los docentes pueden ingresar notas del periodo.</li>';
  html+='<li><b>Fecha Cierre</b>: hasta cuándo pueden ingresar notas. Después de esta fecha el periodo queda cerrado automáticamente.</li>';
  html+='<li>El botón <b>"Aplicar Automáticamente"</b> revisa la fecha de hoy y abre/cierra los periodos según el cronograma.</li>';
  html+='<li>El toggle <b>"Acceso Docentes"</b> permite abrir o cerrar un periodo de forma manual, sin importar las fechas.</li>';
  html+='</ul></div>';
  return html;
}
function guardarCronograma(){
  const cr={};
  const _npCr=(db.config&&db.config.numPeriodos)||4;
  Array.from({length:_npCr},(_,i)=>i+1).forEach(p=>{
    const desde=document.getElementById('crDesde'+p)?.value||'';
    const hasta=document.getElementById('crHasta'+p)?.value||'';
    cr['p'+p]={desde,hasta};
  });
  updDB(d=>{d.cronograma=cr;return d;});
  const st=document.getElementById('crStatus');
  if(st){st.style.color='#27ae60';st.textContent='✅ Cronograma guardado correctamente.';}
  setTimeout(()=>renderApp(),1200);
}
function togglePeriodoCronograma(idx,val){
  updDB(d=>{
    const np=(d.config&&d.config.numPeriodos)||4;
    if(!d.periodosActivos||d.periodosActivos.length!==np){
      const prev=d.periodosActivos||[];
      d.periodosActivos=Array.from({length:np},(_,i)=>prev[i]!==false);
    }
    d.periodosActivos[idx]=val;
    return d;
  });
}
function aplicarCronogramaAuto(){
  const hoy=new Date().toISOString().slice(0,10);
  const cr=db.cronograma||{};
  const _npAuto=(db.config&&db.config.numPeriodos)||4;
  let cambios=[];
  updDB(d=>{
    const np=(d.config&&d.config.numPeriodos)||4;
    if(!d.periodosActivos||d.periodosActivos.length!==np){
      const prev=d.periodosActivos||[];
      d.periodosActivos=Array.from({length:np},(_,i)=>prev[i]!==false);
    }
    Array.from({length:_npAuto},(_,i)=>i+1).forEach(p=>{
      const key='p'+p;
      const desde=(cr[key]||{}).desde||'';
      const hasta=(cr[key]||{}).hasta||'';
      if(desde&&hasta){
        const abierto=hoy>=desde&&hoy<=hasta;
        if(d.periodosActivos[p-1]!==abierto){
          cambios.push('P'+p+': '+(abierto?'Abierto':'Cerrado'));
          d.periodosActivos[p-1]=abierto;
        }
      }
    });
    return d;
  });
  const st=document.getElementById('crStatus');
  if(st){
    st.style.color='#1a5276';
    st.textContent=cambios.length?'🔄 Aplicado: '+cambios.join(', '):'ℹ️ No hay cambios necesarios (los periodos ya están en el estado correcto según las fechas).';
  }
  setTimeout(()=>renderApp(),1500);
}

// Cargar notificaciones automáticamente al entrar a la sección
const _origNavTo=typeof navTo==='function'?navTo:null;
if(_origNavTo){
  window.navTo=function(id){_origNavTo(id);if(id==='contacto'&&sesion&&sesion.r==='admin') setTimeout(cargarNotificaciones,200);};
}

// ============================================================
// FOTO DE PERFIL CON CÁMARA
// ============================================================
function cargarFotoPerfil(inp){
  if(!inp.files[0]) return;
  fileToB64(inp.files[0],b64=>{
    updDB(d=>{d.users=d.users.map(u=>u.u===sesion.u?{...u,foto:b64}:u);return d;});
    sesion={...sesion,foto:b64};
    const prev=document.getElementById('fotoPerfilPreview');
    if(prev) prev.innerHTML=`<img src="${b64}" style="width:100%;height:100%;object-fit:cover">`;
  });
}
function abrirCamaraPerfil(){
  const wrap=document.getElementById('camaraPerfilWrap');
  const video=document.getElementById('camaraVideo');
  if(!wrap||!video) return;
  wrap.style.display='block';
  navigator.mediaDevices.getUserMedia({video:true}).then(stream=>{
    video.srcObject=stream;window._camaraStream=stream;
  }).catch(()=>alert('No se pudo acceder a la cámara. Verifique los permisos del navegador.'));
}
function cerrarCamaraPerfil(){
  if(window._camaraStream) window._camaraStream.getTracks().forEach(t=>t.stop());
  const wrap=document.getElementById('camaraPerfilWrap');
  if(wrap) wrap.style.display='none';
}
function tomarFotoCamara(){
  const video=document.getElementById('camaraVideo');
  const canvas=document.getElementById('camaraCanvas');
  if(!video||!canvas) return;
  canvas.width=video.videoWidth||320;canvas.height=video.videoHeight||240;
  canvas.getContext('2d').drawImage(video,0,0);
  const b64=canvas.toDataURL('image/jpeg',0.8);
  updDB(d=>{d.users=d.users.map(u=>u.u===sesion.u?{...u,foto:b64}:u);return d;});
  sesion={...sesion,foto:b64};
  const prev=document.getElementById('fotoPerfilPreview');
  if(prev) prev.innerHTML=`<img src="${b64}" style="width:100%;height:100%;object-fit:cover">`;
  cerrarCamaraPerfil();
}

// ============================================================
// PERFIL / CREDENCIALES — ESTUDIANTE
// ============================================================
function actualizarPerfilEst(){
  const u=(document.getElementById('_estPUser')||{}).value||'';
  const p=(document.getElementById('_estPPass')||{}).value||'';
  if(!u.trim()||!p.trim()){alert('Complete el usuario y la contraseña.');return;}
  updDB(d=>{
    const idx=d.ests.findIndex(x=>x.id==sesion.estId);
    if(idx>=0){d.ests[idx].u=u.trim();d.ests[idx].p=p.trim();}
    return d;
  });
  sesion={...sesion,u:u.trim(),p:p.trim()};
  alert('✅ Credenciales actualizadas correctamente.\n\nUse el nuevo usuario y contraseña en su próximo inicio de sesión.');
  renderEstudiante();
}
function cargarFotoPerfilEst(inp){
  if(!inp||!inp.files||!inp.files[0]) return;
  fileToB64(inp.files[0],b64=>{
    updDB(d=>{const idx=d.ests.findIndex(x=>x.id==sesion.estId);if(idx>=0) d.ests[idx].foto=b64;return d;});
    sesion={...sesion,foto:b64};
    const prev=document.getElementById('_fotoEstPrev');
    if(prev) prev.innerHTML=`<img src="${b64}" style="width:100%;height:100%;object-fit:cover">`;
  });
}

// ============================================================
// PERFIL / CREDENCIALES — ACUDIENTE/PADRE
// ============================================================
function actualizarPerfilPadre(){
  const u=(document.getElementById('_padrePUser')||{}).value||'';
  const p=(document.getElementById('_padrePPass')||{}).value||'';
  if(!u.trim()||!p.trim()){alert('Complete el usuario y la contraseña.');return;}
  updDB(d=>{
    const idx=d.ests.findIndex(x=>x.id==sesion.estId);
    if(idx>=0){d.ests[idx].uAcud=u.trim();d.ests[idx].pAcud=p.trim();}
    return d;
  });
  sesion={...sesion,u:u.trim(),p:p.trim()};
  alert('✅ Credenciales de acudiente actualizadas correctamente.\n\nUse el nuevo usuario y contraseña en su próximo inicio de sesión.');
  renderPadre();
}
function cargarFotoPerfilPadre(inp){
  if(!inp||!inp.files||!inp.files[0]) return;
  fileToB64(inp.files[0],b64=>{
    updDB(d=>{const idx=d.ests.findIndex(x=>x.id==sesion.estId);if(idx>=0) d.ests[idx].fotoAcud=b64;return d;});
    sesion={...sesion,foto:b64};
    const prev=document.getElementById('_fotoPadrePrev');
    if(prev) prev.innerHTML=`<img src="${b64}" style="width:100%;height:100%;object-fit:cover">`;
  });
}

// ============================================================
// SOLICITUD DE PERMISO DE AUSENTISMO (DOCENTE → RECTOR)
// ============================================================
// ── TIPOS DE PERMISO H03.03.F01 ──
const TIPOS_PERMISO=[
  'Adopción','Arresto Correccional','Calamidad Doméstica','Capacitación',
  'Cita Médica','Cita Médica Familiar','Comisión de Estudios','Comisión de Servicios',
  'Desaparición','Diligencias Administrativas','Enfermedad Hijos o Familiar',
  'Evento Deportivo','Huelga Autorizada','Huelga No Autorizada','Lactancia',
  'Matrimonio','No Justificada','Otros','Permisos Sindicales','Secuestro','Tratamiento Médico'
];
function htmlAusentismo(){
  const solicitudes=db.ausentismos||[];
  const misSols=solicitudes.filter(s=>s.doc===sesion.u);
  const hoy=new Date().toISOString().slice(0,10);
  const docUser=db.users.find(u=>u.u===sesion.u)||{};
  const tiposGrid=TIPOS_PERMISO.map(t=>`
    <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #eee">
      <input type="checkbox" id="tp_${t.replace(/\s/g,'_')}" value="${t}" style="width:16px;height:16px;cursor:pointer">
      <label for="tp_${t.replace(/\s/g,'_')}" style="flex:1;font-size:0.8rem;cursor:pointer">${t}</label>
      <input type="number" id="nd_${t.replace(/\s/g,'_')}" min="0" max="30" step="0.5" placeholder="Días" style="width:55px;font-size:0.78rem;padding:2px 4px;text-align:center">
    </div>`).join('');
  const estadoColor=s=>s==='Aprobado'?'#27ae60':s==='Rechazado'?'#c0392b':'#e67e22';
  const rowsSols=misSols.slice().reverse().map(s=>`<tr>
    <td>${s.fechaSol||s.fecha||''}</td>
    <td style="text-align:left;font-size:0.78rem">${s.tipos?.join(', ')||s.motivo1||''}</td>
    <td>${s.desde||s.fInicio||''}</td><td>${s.hasta||s.fFin||''}</td><td>${s.diasTotal||s.dias||''}</td>
    <td><b style="color:${estadoColor(s.estado||'Pendiente')}">${s.estado||'Pendiente'}</b></td>
    <td style="text-align:left;font-size:0.78rem">${s.respuesta||'—'}</td>
    <td><button class="btn-sm" style="background:#1a5276" onclick="imprimirPermisoH03(${s.id})">🖨️</button></td>
  </tr>`).join('');
  return `<h3 class="sec-title">📋 H03.03.F01 — Permiso Laboral</h3>
  <div class="info-box" style="margin-bottom:12px">Formulario oficial — Gobernación de Córdoba / Secretaría de Educación del Departamento de Córdoba.</div>
  <div class="card">
    <h4 class="card-title" style="text-align:center;font-size:0.85rem">Código: H03.03.F01 &nbsp;|&nbsp; Versión: 7 &nbsp;|&nbsp; Fecha: 1/07/2021</h4>
    <div class="grid2" style="margin-bottom:10px">
      <div><label class="lbl">MUNICIPIO</label><input id="aus_municipio" value="${db.municipio||''}"></div>
      <div><label class="lbl">NOMBRE EE / OFICINA</label><input id="aus_ee" value="${db.nombre||getROT3()||''}"></div>
    </div>
    <div style="background:#f0f4f8;border-radius:6px;padding:10px 12px;margin-bottom:12px">
      <b style="color:#003366;font-size:0.82rem">DATOS DEL SOLICITANTE</b>
      <div class="grid2" style="margin-top:8px">
        <div><label class="lbl">NOMBRES Y APELLIDOS</label><input id="aus_nombre" value="${sesion.n||''}"></div>
        <div><label class="lbl">CARGO</label><input id="aus_cargo" value="${docUser.cargo||'DOCENTE'}"></div>
        <div><label class="lbl">CORREO ELECTRÓNICO</label><input id="aus_email" type="email" value="${docUser.email||sesion.email||''}"></div>
        <div><label class="lbl">CÉDULA</label><input id="aus_cedula" value="${docUser.cedula||''}"></div>
        <div><label class="lbl">SEDE / OFICINA DONDE LABORA</label><input id="aus_sede" value="${db.corregimiento||db.sede||''}"></div>
        <div><label class="lbl">CELULAR</label><input id="aus_celular" value="${docUser.telefono||sesion.telefono||''}"></div>
      </div>
    </div>
    <div style="background:#f9f0e0;border-radius:6px;padding:10px 12px;margin-bottom:12px">
      <b style="color:#856404;font-size:0.82rem">DATOS DEL PERMISO &nbsp;<small style="font-weight:normal">(Máx 3 días hábiles consecutivos — Ley 734/2002 — Dec.1083/2015 — Dec.648/2017)</small></b>
      <div class="grid2" style="margin-top:8px">
        <div style="max-height:280px;overflow-y:auto;border:1px solid #ddd;border-radius:6px;padding:6px 10px;background:#fff">${tiposGrid}</div>
        <div>
          <div class="grid2" style="margin-bottom:8px">
            <div><label class="lbl">FECHA SOLICITUD (dd/mm/aa)</label><input id="aus_fechaSol" type="date" value="${hoy}"></div>
            <div><label class="lbl">TOTAL DÍAS (HORAS)</label><input id="aus_diasTotal" type="number" min="0" step="0.5" placeholder="Ej: 1.5"></div>
          </div>
          <div class="grid2" style="margin-bottom:8px">
            <div><label class="lbl">DESDE (dd/mm/aa)</label><input id="aus_desde" type="date" value="${hoy}"></div>
            <div><label class="lbl">HASTA (dd/mm/aa)</label><input id="aus_hasta" type="date" value="${hoy}"></div>
          </div>
          <div><label class="lbl">OBSERVACIONES</label><textarea id="aus_obs" style="height:60px" placeholder="Observaciones del solicitante..."></textarea></div>
          <div style="margin-top:8px"><label class="lbl">SOPORTE ANEXO (descripción)</label><input id="aus_soporte" placeholder="Descripción del soporte adjunto..."></div>
        </div>
      </div>
    </div>
    <button class="btn btn-green" onclick="enviarAusentismo()">📤 Enviar al Rector(a) — Jefe Inmediato</button>
  </div>
  ${misSols.length?`<div class="card" style="margin-top:14px">
    <h4 class="card-title">📋 Mis Solicitudes de Permiso (${misSols.length})</h4>
    <div class="over"><table><thead><tr><th>F.Solicitud</th><th>Tipos</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Estado</th><th>Respuesta Rector</th><th>PDF</th></tr></thead><tbody>${rowsSols}</tbody></table></div>
  </div>`:''}`;
}
function enviarAusentismo(){
  const nombre=document.getElementById('aus_nombre')?.value.trim();
  if(!nombre){alert('Complete su nombre.');return;}
  const tipos=TIPOS_PERMISO.filter(t=>{
    const cb=document.getElementById('tp_'+t.replace(/\s/g,'_'));
    return cb&&cb.checked;
  });
  const diasPorTipo={};
  tipos.forEach(t=>{
    const nd=document.getElementById('nd_'+t.replace(/\s/g,'_'));
    diasPorTipo[t]=nd?parseFloat(nd.value)||0:0;
  });
  if(!tipos.length){alert('Seleccione al menos un tipo de permiso.');return;}
  const solicitud={
    id:Date.now(),doc:sesion.u,docNombre:sesion.n,
    municipio:document.getElementById('aus_municipio')?.value||'',
    ee:document.getElementById('aus_ee')?.value||'',
    nombre,cargo:document.getElementById('aus_cargo')?.value||'',
    email:document.getElementById('aus_email')?.value||'',
    cedula:document.getElementById('aus_cedula')?.value||'',
    sede:document.getElementById('aus_sede')?.value||'',
    celular:document.getElementById('aus_celular')?.value||'',
    tipos,diasPorTipo,
    fechaSol:document.getElementById('aus_fechaSol')?.value||new Date().toISOString().slice(0,10),
    desde:document.getElementById('aus_desde')?.value||'',
    hasta:document.getElementById('aus_hasta')?.value||'',
    diasTotal:document.getElementById('aus_diasTotal')?.value||'',
    obs:document.getElementById('aus_obs')?.value||'',
    soporte:document.getElementById('aus_soporte')?.value||'',
    estado:'Pendiente',respuesta:'',fechaAprobacion:''
  };
  updDB(d=>{if(!d.ausentismos)d.ausentismos=[];d.ausentismos.push(solicitud);return d;});
  // Notificación sistema
  try{fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'permiso-laboral',actor:sesion.n,message:sesion.n+' envió una solicitud de permiso laboral (H03.03.F01). Tipos: '+tipos.join(', ')+'.',meta:solicitud})}).catch(()=>{});}catch(e){}
  // Notificación por correo al rector (si tiene email registrado)
  (async()=>{
    try{
      const rectorUser=(db.users||[]).find(u=>u.r==='admin'||u.r==='rector');
      const emailRector=rectorUser?.email||db.emailInst||'';
      if(emailRector){
        const htmlEmail=`<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
          <div style="background:#003366;color:#fff;padding:18px;border-radius:10px 10px 0 0;text-align:center">
            <h2 style="margin:0;font-size:1.1rem">📋 Nueva Solicitud de Permiso Laboral</h2>
            <p style="margin:4px 0 0;font-size:0.85rem;opacity:0.8">H03.03.F01 — Gestor Académico YC</p>
          </div>
          <div style="background:#fff;padding:20px;border:1px solid #e0e0e0;border-radius:0 0 10px 10px">
            <p>Estimado(a) Rector(a),</p>
            <p>El/La docente <b>${sesion.n}</b> ha enviado una solicitud de permiso laboral que requiere su gestión.</p>
            <table style="width:100%;border-collapse:collapse;font-size:0.88rem;margin:16px 0">
              <tr style="background:#f0f4f8"><td style="padding:8px;font-weight:bold">Docente:</td><td style="padding:8px">${sesion.n}</td></tr>
              <tr><td style="padding:8px;font-weight:bold">Tipo(s):</td><td style="padding:8px">${tipos.join(', ')}</td></tr>
              <tr style="background:#f0f4f8"><td style="padding:8px;font-weight:bold">Desde:</td><td style="padding:8px">${solicitud.desde||'—'}</td></tr>
              <tr><td style="padding:8px;font-weight:bold">Hasta:</td><td style="padding:8px">${solicitud.hasta||'—'}</td></tr>
              <tr style="background:#f0f4f8"><td style="padding:8px;font-weight:bold">Días:</td><td style="padding:8px">${solicitud.diasTotal||'—'}</td></tr>
              ${solicitud.obs?`<tr><td style="padding:8px;font-weight:bold">Observaciones:</td><td style="padding:8px">${solicitud.obs}</td></tr>`:''}
            </table>
            <p style="font-size:0.85rem;color:#555">Ingrese al sistema para aprobar o rechazar esta solicitud.</p>
          </div>
        </div>`;
        await fetch(API_BASE+'/api/inetis/send-email',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({to:emailRector,subject:`📋 Nueva solicitud de permiso de ${sesion.n} — ${db.nombre||'Institución'}`,html:htmlEmail})
        });
      }
    }catch(e){}
  })();
  alert('✅ Solicitud enviada al Rector(a). El rector recibirá notificación.\nRecibirá respuesta de aprobación/rechazo en esta sección.');
  pag='ausentismo';renderApp();
}
function imprimirPermisoH03(id){
  const sol=(db.ausentismos||[]).find(s=>s.id===id);
  if(!sol){alert('Solicitud no encontrada');return;}
  const{jsPDF}=window.jspdf;const doc=new jsPDF('p','mm','a4');
  const W=210,CX=W/2;
  let y=14;
  // Encabezado institucional
  doc.setFillColor(0,51,102);doc.rect(0,0,W,18,'F');
  doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);
  doc.text('Gobernación de Córdoba',CX,6,{align:'center'});
  doc.text('Secretaria de Educación del Departamento de Córdoba',CX,10,{align:'center'});
  doc.text('"H03.03.F01 PERMISO LABORAL"',CX,14,{align:'center'});
  doc.setFontSize(6);doc.text('Código: H03.03.F01  |  Versión: 7  |  Fecha: 1/07/2021',W-14,8,{align:'right'});
  y=24;
  doc.setTextColor(0);
  doc.setFontSize(7);doc.setFont('helvetica','normal');
  doc.text('MUNICIPIO: '+sol.municipio,14,y);doc.text('NOMBRE EE / OFICINA: '+sol.ee,W/2+4,y);y+=8;
  doc.setFillColor(220,232,255);doc.rect(14,y-4,W-28,6,'F');
  doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(0,51,102);
  doc.text('DATOS DEL SOLICITANTE',CX,y+0.5,{align:'center'});y+=8;
  doc.setFont('helvetica','normal');doc.setTextColor(0);
  doc.text('NOMBRES Y APELLIDOS: '+sol.nombre,14,y);doc.text('CARGO: '+sol.cargo,W/2+4,y);y+=6;
  doc.text('CORREO ELECTRÓNICO: '+sol.email,14,y);doc.text('CÉDULA: '+sol.cedula,W/2+4,y);y+=6;
  doc.text('SEDE / OFICINA: '+sol.sede,14,y);doc.text('CELULAR: '+sol.celular,W/2+4,y);y+=8;
  doc.setFillColor(255,243,205);doc.rect(14,y-4,W-28,6,'F');
  doc.setFont('helvetica','bold');doc.setTextColor(133,100,4);
  var _permH=doc.splitTextToSize('DATOS DEL PERMISO (Máx 3 días hábiles consecutivos — Ley 734/2002 — Dec.1083/2015 — Dec.648/2017)',W-28);doc.text(_permH,CX,y+0.5,{align:'center'});y+=8;
  // Tipos en grid 3 columnas
  const tipos=TIPOS_PERMISO;const cols=3;const colW=(W-28)/cols;
  doc.setFont('helvetica','normal');doc.setTextColor(0);doc.setFontSize(6.5);
  tipos.forEach((t,i)=>{
    const col=i%cols;const row=Math.floor(i/cols);const tx=14+col*colW;const ty=y+row*7;
    const tiene=sol.tipos&&sol.tipos.includes(t);
    doc.setDrawColor(180);doc.rect(tx+0.5,ty-3.5,4,4);
    if(tiene){doc.setFillColor(0,51,102);doc.rect(tx+0.5,ty-3.5,4,4,'F');}
    doc.setTextColor(0);doc.text(t,tx+6,ty);
    if(tiene){const nd=(sol.diasPorTipo||{})[t];doc.text(nd?nd+'d':'',tx+colW-10,ty);}
  });
  y+=Math.ceil(tipos.length/cols)*7+4;
  doc.setFontSize(7);
  doc.text('Fecha Solicitud del Permiso (dd/mm/aa): '+sol.fechaSol,14,y);
  doc.text('DESDE: '+sol.desde,80,y);doc.text('HASTA: '+sol.hasta,130,y);doc.text('TOTAL DÍAS/HORAS: '+sol.diasTotal,170,y);y+=8;
  var _obsH=doc.splitTextToSize('Observaciones: '+sol.obs,W-28);doc.text(_obsH,14,y);y+=10;
  var _sopH=doc.splitTextToSize('Soporte Anexo: '+sol.soporte,W-28);doc.text(_sopH,14,y);y+=16;
  // Firmas
  doc.setLineWidth(0.4);
  doc.line(14,y,90,y);doc.line(W/2+10,y,W-14,y);
  doc.setFontSize(6.5);
  doc.text('Firma solicitante:',14,y+4);doc.text('Firma de Aprobación del Jefe Inmediato:',W/2+10,y+4);
  y+=10;
  doc.text('Nombre: '+sol.nombre,14,y);doc.text('Nombre: '+db.rectora,W/2+10,y);y+=8;
  doc.text('Fecha diligenciamiento: '+sol.fechaSol,14,y);
  doc.text('Fecha de recibido: '+sol.fechaRecibido||'',90,y);
  doc.text('Fecha aprobación: '+sol.fechaAprobacion||'',160,y);y+=12;
  if(sol.estado==='Aprobado'){
    doc.setFillColor(240,255,240);doc.rect(14,y-4,W-28,40,'F');
    doc.setLineWidth(0.3);doc.rect(14,y-4,W-28,40);
    doc.setFontSize(6.5);doc.setFont('helvetica','normal');
    var _entH=doc.splitTextToSize('ESTA SECCIÓN DEBE SER ENTREGADA AL SOLICITANTE DEL PERMISO EN CASO DE SER APROBADO.',W-28);doc.text(_entH,CX,y+2,{align:'center'});y+=8;
    const texto=`"Yo ${db.rectora}, como jefe inmediato del servidor ${sol.nombre}, lo autorizó para ausentarse del establecimiento u oficina por ${sol.diasTotal} día(s) desde ${sol.desde} hasta ${sol.hasta}; tiempo en el cual solicitó permiso para ${sol.tipos?.join(', ')||''}. En constancia de lo anterior se firma esta autorización."`;
    const lines=doc.splitTextToSize(texto,W-32);doc.text(lines,16,y);y+=lines.length*3.5+6;
    doc.line(14,y,90,y);
    doc.text('Firma: '+db.rectora,14,y+4);doc.text('Cargo: Rector(a)',14,y+8);
  }
  doc.save('Permiso_H03_'+sol.nombre.replace(/ /g,'_')+'_'+sol.fechaSol+'.pdf');
}

// Ver/gestionar ausentismos desde admin
function htmlGestorAusentismos(){
  const sols=db.ausentismos||[];
  if(!sols.length) return '<div class="card"><p class="empty">No hay solicitudes de ausentismo.</p></div>';
  const rows=sols.map(s=>`<tr>
    <td style="text-align:left">${s.docNombre}</td>
    <td style="text-align:left">${s.motivo1||''}</td>
    <td>${s.fInicio}</td><td>${s.fFin}</td><td>${s.dias}</td>
    <td><span style="font-weight:bold;color:${s.estado==='Aprobado'?'#27ae60':s.estado==='Rechazado'?'#c0392b':'#e67e22'}">${s.estado}</span></td>
    <td><button class="btn-sm" style="background:#27ae60" onclick="responderAusentismo(${s.id},'Aprobado')">✓ Aprobar</button>
        <button class="btn-sm" style="background:#c0392b" onclick="responderAusentismo(${s.id},'Rechazado')">✗ Rechazar</button></td>
  </tr>`).join('');
  return `<div class="card"><h4 class="card-title">📋 Solicitudes de Ausentismo Docentes (${sols.length})</h4>
    <div class="over"><table><thead><tr><th>Docente</th><th>Motivo</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}
function responderAusentismo(id,estado){
  const resp=prompt(`Respuesta del Rector(a) para ${estado}:`)||estado;
  updDB(d=>{
    if(!d.ausentismos) return d;
    const idx=d.ausentismos.findIndex(s=>s.id===id);
    if(idx>=0){d.ausentismos[idx].estado=estado;d.ausentismos[idx].respuesta=resp;}
    return d;
  });
  renderApp();
}

// ============================================================
// MENCIONES DE HONOR
// ============================================================
const CATEGORIAS_MENCIONES={
  academica:{label:'🏆 Excelencia Académica',tipos:[
    {id:'alto-rendimiento',label:'Alto Rendimiento',texto:'Por su excepcional desempeño académico y la obtención del promedio más alto durante el periodo escolar.'},
    {id:'dedicacion',label:'Dedicación',texto:'Por su disciplina, constancia y compromiso con la búsqueda de la excelencia en todas las áreas del saber.'},
    {id:'espirito-investigador',label:'Espíritu Investigador',texto:'Por su curiosidad insaciable y su capacidad para profundizar en el conocimiento más allá de las aulas.'},
    {id:'superacion',label:'Superación',texto:'Por demostrar que con esfuerzo y determinación no hay meta inalcanzable, logrando un crecimiento académico notable.'}
  ]},
  comportamental:{label:'🎖️ Excelencia Comportamental',tipos:[
    {id:'liderazgo',label:'Liderazgo Positivo',texto:'Por ser un referente de integridad y guiar a sus compañeros con el ejemplo, fomentando un ambiente de orden y respeto.'},
    {id:'pertenencia',label:'Sentido de Pertenencia',texto:'Por su impecable trayectoria institucional, demostrando amor y respeto por los valores y símbolos de nuestra comunidad.'},
    {id:'responsabilidad',label:'Responsabilidad y Autonomía',texto:'Por la madurez demostrada en el cumplimiento de sus deberes y su capacidad para gestionar su propio camino hacia el éxito.'},
    {id:'etica',label:'Ética y Valores',texto:'Por destacar como un estudiante de principios inquebrantables, cuya conducta refleja honestidad y rectitud.'}
  ]},
  convivencia:{label:'🤝 Excelencia en Convivencia',tipos:[
    {id:'mediacion',label:'Mediación de Conflictos',texto:'Por su valiosa contribución a la paz escolar, utilizando el diálogo y la empatía como herramientas para resolver diferencias.'},
    {id:'companerismo',label:'Compañerismo y Solidaridad',texto:'Por su espíritu generoso y su disposición constante para apoyar a quienes lo necesitan, fortaleciendo los lazos de nuestra comunidad.'},
    {id:'inclusion',label:'Inclusión y Respeto',texto:'Por promover un ambiente de aceptación y respeto por la diversidad, haciendo del aula un espacio seguro para todos.'},
    {id:'ciudadania',label:'Ciudadanía Ejemplar',texto:'Por su excepcional calidad humana y su compromiso con la construcción de una convivencia armónica y fraterna.'}
  ]}
};
function htmlMencionesHonor(){
  const menciones=db.menciones||[];
  const gradOpts=db.grados.map(g=>`<option value="${g.n}">${g.n}</option>`).join('');
  const estOpts=db.ests.map(e=>`<option value="${e.id}">${e.n} (${e.g})</option>`).join('');
  const catOpts=Object.entries(CATEGORIAS_MENCIONES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
  const rowsMenciones=menciones.map(m=>`<tr>
    <td style="text-align:left">${m.estNombre||''}</td><td>${m.grado||''}</td><td>${m.periodo||''}</td>
    <td style="text-align:left">${m.categoria||''}</td><td style="text-align:left">${m.tipo||''}</td>
    <td><button class="btn-sm" style="background:#1a5276" onclick="generarDiplomaPDF(${m.id})">📄 Diploma</button>
    <button class="btn-sm" style="background:#c0392b" onclick="eliminarMencion(${m.id})">🗑</button></td>
  </tr>`).join('');
  return `<h3 class="sec-title">🏅 Menciones de Honor</h3>
  <div class="card">
    <h4 class="card-title">➕ Crear Mención de Honor</h4>
    <div class="grid3" style="margin-bottom:10px">
      <div><label class="lbl">Estudiante</label><select id="mencEst">${estOpts}</select></div>
      <div><label class="lbl">Periodo</label><select id="mencPer"><option value="1">Periodo 1</option><option value="2">Periodo 2</option><option value="3">Periodo 3</option><option value="4">Periodo 4</option><option value="Anual">Anual</option></select></div>
      <div><label class="lbl">Categoría</label><select id="mencCat" onchange="actualizarTiposMencion()">${catOpts}</select></div>
      <div><label class="lbl">Tipo de Mención</label><select id="mencTipo" onchange="actualizarTextoDiploma()"></select></div>
    </div>
    <div><label class="lbl">Texto del Diploma (editable)</label>
      <textarea id="mencTexto" style="height:80px;resize:vertical" placeholder="Texto personalizado del diploma..."></textarea></div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-green" onclick="guardarMencion()">💾 Guardar Mención</button>
    </div>
  </div>
  ${menciones.length?`<div class="card"><h4 class="card-title">📋 Menciones Registradas (${menciones.length})</h4>
    <div class="over"><table><thead><tr><th>Estudiante</th><th>Grado</th><th>Periodo</th><th>Categoría</th><th>Tipo</th><th>Acción</th></tr></thead><tbody>${rowsMenciones}</tbody></table></div>
  </div>`:''}`;
}
function actualizarTiposMencion(){
  const cat=document.getElementById('mencCat')?.value;
  const tipos=CATEGORIAS_MENCIONES[cat]?.tipos||[];
  const sel=document.getElementById('mencTipo');
  if(sel){sel.innerHTML=tipos.map(t=>`<option value="${t.id}">${t.label}</option>`).join('');}
  actualizarTextoDiploma();
}
function actualizarTextoDiploma(){
  const cat=document.getElementById('mencCat')?.value;
  const tipoId=document.getElementById('mencTipo')?.value;
  const tipo=CATEGORIAS_MENCIONES[cat]?.tipos.find(t=>t.id===tipoId);
  const txt=document.getElementById('mencTexto');
  if(txt&&tipo) txt.value=tipo.texto;
}
function guardarMencion(){
  const estId=document.getElementById('mencEst')?.value;
  const per=document.getElementById('mencPer')?.value;
  const cat=document.getElementById('mencCat')?.value;
  const tipoId=document.getElementById('mencTipo')?.value;
  const texto=document.getElementById('mencTexto')?.value.trim();
  if(!estId||!texto){alert('Seleccione un estudiante y complete el texto del diploma.');return;}
  const est=db.ests.find(e=>String(e.id)===String(estId));
  const tipo=CATEGORIAS_MENCIONES[cat]?.tipos.find(t=>t.id===tipoId);
  updDB(d=>{
    if(!d.menciones) d.menciones=[];
    d.menciones.push({id:Date.now(),estId,estNombre:est?.n||'',grado:est?.g||'',periodo:per,
      categoria:CATEGORIAS_MENCIONES[cat]?.label||cat,tipo:tipo?.label||tipoId,texto,creadoPor:sesion.n,fecha:new Date().toISOString().slice(0,10)});
    return d;
  });
  renderApp();
  setTimeout(()=>actualizarTiposMencion(),100);
}
function eliminarMencion(id){
  if(!confirm('¿Eliminar esta mención?')) return;
  updDB(d=>{d.menciones=(d.menciones||[]).filter(m=>m.id!==id);return d;});renderApp();
}
function generarDiplomaPDF(id){
  const mencion=(db.menciones||[]).find(m=>m.id===id);
  if(!mencion){alert('Mención no encontrada.');return;}
  const{jsPDF}=window.jspdf;const doc=new jsPDF('l','mm','a4');
  const W=297,H=210,CX=W/2,CY=H/2;
  // Fondo
  doc.setFillColor(240,245,255);doc.rect(0,0,W,H,'F');
  // Marco decorativo
  doc.setDrawColor(0,51,102);doc.setLineWidth(3);doc.rect(8,8,W-16,H-16);
  doc.setLineWidth(1);doc.rect(12,12,W-24,H-24);
  // Banda superior
  doc.setFillColor(0,51,102);doc.rect(0,0,W,22,'F');
  doc.setFillColor(241,196,15);doc.rect(0,22,W,4,'F');
  // Título
  doc.setTextColor(255,255,255);doc.setFontSize(14);doc.setFont('helvetica','bold');
  doc.text('INSTITUCIÓN EDUCATIVA',CX,10,{align:'center'});
  doc.text(getROT3(),CX,17,{align:'center'});
  // Escudo institución
  const logoSrc=db.logo||'';
  if(logoSrc){try{doc.addImage(logoSrc,'JPEG',20,28,25,28);}catch(e){}}
  // Diploma
  doc.setTextColor(0,51,102);doc.setFontSize(28);doc.setFont('helvetica','bold');
  doc.text('DIPLOMA DE MENCIÓN DE HONOR',CX,48,{align:'center'});
  doc.setFontSize(12);doc.setFont('helvetica','normal');doc.setTextColor(80);
  doc.text(mencion.categoria,CX,57,{align:'center'});
  // Separador
  doc.setDrawColor(241,196,15);doc.setLineWidth(2);doc.line(60,62,W-60,62);
  // Nombre estudiante
  doc.setFontSize(10);doc.setTextColor(100);doc.setFont('helvetica','italic');
  doc.text('Se concede esta mención a:',CX,72,{align:'center'});
  doc.setFontSize(22);doc.setFont('helvetica','bold');doc.setTextColor(0,51,102);
  doc.text((mencion.estNombre||'').toUpperCase(),CX,84,{align:'center'});
  doc.setFontSize(11);doc.setFont('helvetica','normal');doc.setTextColor(80);
  doc.text(`Grado: ${mencion.grado}   |   Período: ${mencion.periodo}   |   Año: ${db.anio}`,CX,92,{align:'center'});
  // Texto del diploma
  doc.setFontSize(11);doc.setTextColor(50);doc.setFont('helvetica','italic');
  const txtLines=doc.splitTextToSize('"'+mencion.texto+'"',W-80);
  doc.text(txtLines,CX,106,{align:'center'});
  // Firmas
  const fy=H-32;
  doc.setLineWidth(0.5);doc.setDrawColor(100);
  doc.line(CX-70,fy,CX-10,fy);doc.line(CX+10,fy,CX+70,fy);
  doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(0,51,102);
  doc.text(db.rectora||'Rector(a)',CX-40,fy+5,{align:'center'});
  doc.text(mencion.creadoPor||sesion.n,CX+40,fy+5,{align:'center'});
  doc.setFont('helvetica','normal');doc.setTextColor(100);
  doc.text('Rector(a)',CX-40,fy+10,{align:'center'});
  doc.text('Docente / Coordinador',CX+40,fy+10,{align:'center'});
  // Firma rectora en PDF
  if(db.firmaRectora){try{doc.addImage(db.firmaRectora,'PNG',CX-75,fy-14,50,12);}catch(e){}}
  // Pie
  doc.setFontSize(7);doc.setTextColor(150);doc.setFont('helvetica','normal');
  doc.text(`Expedido el ${new Date().toLocaleDateString('es-CO')} | ${db.municipio||db.corregimiento||''}`,CX,H-10,{align:'center'});
  doc.save(`Diploma_${mencion.estNombre.replace(/\s/g,'_')}_${mencion.tipo}.pdf`);
}

// ============================================================
// VER CREDENCIALES (ADMIN / RECTOR)
// ============================================================
function htmlVerCredenciales(){
  const docentes=db.users.filter(u=>u.r==='docente');
  const ests=(db.ests||[]).slice().sort((a,b)=>fmtNombreEst(a).localeCompare(fmtNombreEst(b)));
  const rowsDoc=docentes.map(u=>`<tr>
    <td style="text-align:left">${u.n}</td><td>${u.u}</td>
    <td><span style="cursor:pointer;color:#1a5276;font-family:monospace" onclick="this.textContent=this.textContent==='***'?'${u.p.replace(/'/g,"\\'")}':'***'">${'***'}</span></td>
    <td>${u.email||'—'}</td><td>${u.telefono||'—'}</td>
  </tr>`).join('');
  const sinCred=ests.filter(e=>!e.numDoc&&!e.u);
  const rowsEst=ests.map(e=>{
    const tieneUser=!!(e.numDoc||e.u);
    const userEst=e.u||e.numDoc||'—';
    const passEst=e.p||e.numDoc||'—';
    const userAcud=e.numDocAcud||'—';
    const passAcud=e.numDoc||e.p||'—';
    return `<tr>
      <td style="text-align:left;font-size:0.83rem"><b>${fmtNombreEst(e)}</b></td>
      <td>${e.g}</td>
      <td style="font-size:0.8rem">${e.acudiente||'—'}</td>
      <td style="text-align:center">
        ${tieneUser?`<code style="font-size:0.78rem;background:#e8f0fe;padding:2px 5px;border-radius:3px">${userEst}</code>`:'<span style="color:#c0392b;font-size:0.78rem">Sin doc.</span>'}
      </td>
      <td style="text-align:center">
        ${tieneUser?`<code style="font-size:0.78rem;background:#e8f8f0;padding:2px 5px;border-radius:3px">${passEst}</code>`:'<span style="color:#c0392b;font-size:0.78rem">—</span>'}
      </td>
      <td style="text-align:center">
        ${e.numDocAcud?`<code style="font-size:0.78rem;background:#fef9e7;padding:2px 5px;border-radius:3px">${userAcud}</code>`:'<span style="color:#888;font-size:0.78rem">—</span>'}
      </td>
      <td>
        <button class="btn-sm" style="background:#003366;font-size:0.72rem" onclick="_abrirModalCred('${String(e.id)}')" title="Asignar / editar credenciales">🔑 Credenciales</button>
      </td>
    </tr>`;
  }).join('');
  return `<h3 class="sec-title">🔑 Credenciales del Sistema</h3>
  <div class="warn-box">⚠️ Esta información es confidencial. Solo el administrador y rector pueden verla.</div>
  ${sinCred.length?`<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:7px;padding:10px 14px;margin-bottom:12px;font-size:0.84rem">
    ⚠️ <b>${sinCred.length}</b> estudiante(s) no tienen número de documento asignado. Use el botón <b>🔑 Credenciales</b> para asignarles acceso manual.
    <button class="btn-sm" style="background:#e67e22;margin-left:8px" onclick="_asignarCredTodos()">⚡ Generar para todos los que tengan doc.</button>
  </div>`:''}
  <div class="card">
    <h4 class="card-title">👨‍🏫 Docentes (${docentes.length})</h4>
    ${docentes.length?`<div class="over"><table><thead><tr><th>Nombre</th><th>Usuario</th><th>Contraseña</th><th>Email</th><th>Teléfono</th></tr></thead><tbody>${rowsDoc}</tbody></table></div>
    <p style="font-size:0.75rem;color:#888;margin-top:6px">👁️ Haga clic sobre "***" para ver/ocultar la contraseña.</p>`:'<p class="empty">Sin docentes registrados.</p>'}
  </div>
  <div class="card" style="margin-top:14px">
    <h4 class="card-title">👥 Estudiantes y Acudientes (${ests.length})</h4>
    <div class="info-box" style="margin-bottom:10px">📋 El usuario del <b>estudiante</b> y contraseña inicial es su <b>Nº de documento</b>. El <b>acudiente</b> usa su propio Nº de documento como usuario y el Nº del estudiante como contraseña. Use el botón <b>🔑 Credenciales</b> para asignar o cambiar credenciales de forma manual.</div>
    ${ests.length?`<div class="over" style="max-height:500px;overflow-y:auto"><table><thead><tr><th>Estudiante</th><th>Grado</th><th>Acudiente</th><th>Usuario Est.</th><th>Contraseña Est.</th><th>Usuario Acud.</th><th>Acción</th></tr></thead><tbody>${rowsEst}</tbody></table></div>`:'<p class="empty">Sin estudiantes registrados.</p>'}
  </div>`;
}
function _abrirModalCred(estId){
  estId=String(estId);
  const e=db.ests.find(x=>String(x.id)===estId);if(!e) return;
  const ov=document.createElement('div');
  ov.id='_credOv';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;padding:26px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.35)">
    <h3 style="color:#003366;margin-bottom:4px;font-size:1rem">🔑 Credenciales de Acceso</h3>
    <p style="font-size:0.82rem;color:#555;margin-bottom:16px"><b>${fmtNombreEst(e)}</b> — Grado ${e.g}</p>
    <div style="background:#e8f0fe;border-left:4px solid #003366;padding:12px;border-radius:0 8px 8px 0;margin-bottom:14px">
      <div style="font-size:0.75rem;font-weight:bold;color:#003366;margin-bottom:8px">🎒 ESTUDIANTE</div>
      <div class="grid2" style="gap:8px">
        <div><label class="lbl">Usuario (Nº documento)</label><input id="_crUEst" value="${e.u||e.numDoc||''}" placeholder="Ej: 1001234567" style="padding:8px;border:1.5px solid #ddd;border-radius:6px;width:100%"></div>
        <div><label class="lbl">Contraseña</label>
          <div style="position:relative">
            <input type="password" id="_crPEst" value="${e.p||e.numDoc||''}" placeholder="Contraseña" style="padding:8px;border:1.5px solid #ddd;border-radius:6px;width:100%;padding-right:34px">
            <button type="button" onclick="(function(b){var i=document.getElementById('_crPEst');i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'👁️':'🙈'}).call(this,this)" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:0.9rem">👁️</button>
          </div>
        </div>
      </div>
      <button onclick="_autoCredEst('${estId}')" style="margin-top:8px;background:#1a5276;color:#fff;border:none;border-radius:5px;padding:5px 10px;font-size:0.75rem;cursor:pointer">⚡ Auto-rellenar desde doc.</button>
    </div>
    <div style="background:#e8f8f0;border-left:4px solid #27ae60;padding:12px;border-radius:0 8px 8px 0;margin-bottom:16px">
      <div style="font-size:0.75rem;font-weight:bold;color:#27ae60;margin-bottom:8px">👨‍👩‍👦 ACUDIENTE / PADRE</div>
      <div class="grid2" style="gap:8px">
        <div><label class="lbl">Nombre acudiente</label><input id="_crNomAcud" value="${e.acudiente||''}" placeholder="Nombre del acudiente" style="padding:8px;border:1.5px solid #ddd;border-radius:6px;width:100%"></div>
        <div><label class="lbl">Usuario acudiente (Nº doc.)</label><input id="_crUAcud" value="${e.numDocAcud||''}" placeholder="Ej: 45678912" style="padding:8px;border:1.5px solid #ddd;border-radius:6px;width:100%"></div>
        <div><label class="lbl">Teléfono</label><input id="_crTelAcud" value="${e.tel||''}" placeholder="Ej: 3001234567" style="padding:8px;border:1.5px solid #ddd;border-radius:6px;width:100%"></div>
        <div><label class="lbl">Correo</label><input id="_crEmailAcud" value="${e.email||''}" placeholder="correo@email.com" style="padding:8px;border:1.5px solid #ddd;border-radius:6px;width:100%"></div>
      </div>
      <small style="color:#555;display:block;margin-top:6px">La contraseña del acudiente es automáticamente el Nº documento del estudiante.</small>
    </div>
    <div style="background:#fff3cd;border-radius:6px;padding:8px 12px;font-size:0.78rem;color:#856404;margin-bottom:14px">⚠️ La contraseña inicial puede ser el Nº de documento. Recomiende cambiarla en el primer inicio de sesión.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('_credOv').remove()" style="background:#eee;border:none;border-radius:7px;padding:10px 18px;cursor:pointer">Cancelar</button>
      <button onclick="_guardarCred('${estId}')" style="background:#003366;color:#fff;border:none;border-radius:7px;padding:10px 22px;cursor:pointer;font-weight:bold">💾 Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function _autoCredEst(estId){
  estId=String(estId);
  const e=db.ests.find(x=>String(x.id)===estId);
  if(!e||!e.numDoc){alert('El estudiante no tiene número de documento. Ingrese el usuario manualmente.');return;}
  const u=document.getElementById('_crUEst');const p=document.getElementById('_crPEst');
  if(u) u.value=e.numDoc;if(p) p.value=e.numDoc;
}
function _guardarCred(estId){
  estId=String(estId);
  const uEst=(document.getElementById('_crUEst')?.value||'').trim();
  const pEst=(document.getElementById('_crPEst')?.value||'').trim();
  const nomAcud=(document.getElementById('_crNomAcud')?.value||'').trim();
  const uAcud=(document.getElementById('_crUAcud')?.value||'').trim();
  const telAcud=(document.getElementById('_crTelAcud')?.value||'').trim();
  const emailAcud=(document.getElementById('_crEmailAcud')?.value||'').trim();
  if(!uEst||!pEst){alert('Ingrese el usuario y contraseña del estudiante.');return;}
  updDB(db=>{
    const e=db.ests.find(x=>String(x.id)===estId);
    if(e){
      e.u=uEst;e.p=pEst;e.numDoc=uEst;
      if(nomAcud) e.acudiente=nomAcud;
      if(uAcud){e.numDocAcud=uAcud;}
      if(telAcud) e.tel=telAcud;
      if(emailAcud) e.email=emailAcud;
    }
    return db;
  });
  document.getElementById('_credOv')?.remove();
  alert('✅ Credenciales guardadas.\n\n👤 Estudiante: Usuario = '+uEst+'\n👨‍👩‍👦 Acudiente: Usuario = '+(uAcud||'—')+' | Contraseña = '+uEst);
  navTo('ver-credenciales');
}
function _asignarCredTodos(){
  if(!confirm('¿Asignar automáticamente las credenciales a todos los estudiantes que tengan número de documento registrado?\n\nSolo se actualizarán quienes tengan número de documento.')) return;
  let count=0;
  updDB(db=>{
    db.ests.forEach(e=>{
      if(e.numDoc&&(!e.u||!e.p)){e.u=e.numDoc;e.p=e.numDoc;count++;}
    });
    return db;
  });
  alert('✅ Credenciales asignadas a '+count+' estudiante(s).\n\nEl usuario y contraseña inicial es el número de documento de cada estudiante.');
  navTo('ver-credenciales');
}

// ============================================================
// MANUAL DE USUARIO POR ROL (PDF)
// ============================================================
function htmlManualUsuario(){
  const isAdmin=sesion&&sesion.r==='admin';
  const isDocente=sesion&&sesion.r==='docente';
  const isPadre=sesion&&sesion.r==='padre';
  const isEst=sesion&&sesion.r==='estudiante';
  const rolActual=sesion?.r||'docente';

  const tabs=[
    {id:'admin',label:'🎓 Rector / Admin',show:isAdmin},
    {id:'docente',label:'👨‍🏫 Docente',show:isAdmin||isDocente},
    {id:'padre',label:'👪 Padre/Acudiente',show:isAdmin||isPadre},
    {id:'estudiante',label:'🎒 Estudiante',show:isAdmin||isEst},
  ].filter(t=>t.show);

  if(!window._manualTab||!tabs.find(t=>t.id===window._manualTab)){
    window._manualTab=isAdmin?'admin':isDocente?'docente':isPadre?'padre':'estudiante';
  }
  const activeTab=window._manualTab;

  // ── Constructor de tarjeta de módulo ──────────────────────────────────────
  const card=(emoji,titulo,ubicacion,pasos,tip,color)=>{
    const bg=color||'linear-gradient(135deg,#003366 0%,#1a5276 100%)';
    const pasosHtml=pasos.map((p,i)=>`
      <div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start">
        <span style="min-width:22px;height:22px;background:#003366;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;margin-top:1px">${i+1}</span>
        <span style="font-size:0.83rem;color:#2c3e50;line-height:1.5">${p}</span>
      </div>`).join('');
    return `
    <div style="background:#fff;border-radius:12px;margin-bottom:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);border:1px solid #eaecee">
      <div style="background:${bg};padding:11px 16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:1.6rem;line-height:1">${emoji}</span>
        <div style="flex:1">
          <div style="color:#fff;font-weight:700;font-size:0.96rem;letter-spacing:.2px">${titulo}</div>
          ${ubicacion?`<div style="color:#aed6f1;font-size:0.74rem;margin-top:1px">📍 ${ubicacion}</div>`:''}
        </div>
      </div>
      <div style="padding:14px 16px">
        ${pasosHtml}
        ${tip?`<div style="margin-top:10px;background:#eaf4fb;border-left:3px solid #2980b9;padding:8px 12px;border-radius:0 8px 8px 0;font-size:0.79rem;color:#1a5276;line-height:1.5">💡 <b>Tip:</b> ${tip}</div>`:''}
      </div>
    </div>`;
  };

  const section=(titulo,color,html)=>`
    <div style="margin-bottom:6px;margin-top:18px">
      <div style="font-size:0.8rem;font-weight:700;color:${color||'#003366'};letter-spacing:.5px;text-transform:uppercase;border-bottom:2px solid ${color||'#003366'};padding-bottom:4px;margin-bottom:12px">${titulo}</div>
      ${html}
    </div>`;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTENIDO POR ROL
  // ═══════════════════════════════════════════════════════════════════════════
  const contenidos={

    // ── ADMIN / RECTOR ────────────────────────────────────────────────────────
    admin:`
      <div style="background:linear-gradient(135deg,#003366,#1a5276);border-radius:10px;padding:14px 18px;color:#fff;margin-bottom:16px;display:flex;gap:14px;align-items:center">
        <span style="font-size:2.4rem">🎓</span>
        <div>
          <div style="font-weight:700;font-size:1rem">Panel de Rector / Administrador</div>
          <div style="font-size:0.82rem;color:#aed6f1;margin-top:3px">Acceso completo a todos los módulos. Usuario: su número de documento o el asignado por el sistema gestor.</div>
        </div>
      </div>

      ${section('⚙️ Configuración Institucional','#8e44ad',`
        ${card('🏫','Configuración Base','Menú lateral → 🏫 Configuración Base',[
          'Ingrese el <b>nombre completo</b> de la institución, municipio y departamento (Córdoba).',
          'Registre el <b>DANE</b> (código de 12 dígitos) y el <b>NIT</b> institucional.',
          'Suba el <b>logo institucional</b> (imagen PNG/JPG, máx. 2 MB) — aparecerá en boletines y PDF.',
          'Ingrese el nombre del <b>rector(a)</b>, cargo, email institucional y teléfono.',
          'Configure el <b>año lectivo activo</b> y el número de periodos (generalmente 4).',
          'Haga clic en <b>💾 Guardar Configuración</b>. Los cambios se sincronizan en la nube.',
        ],'El logo y la firma del rector se imprimen automáticamente en todos los boletines, diplomas y certificados PDF.')}

        ${card('📅','Cronograma de Notas','Menú lateral → 📅 Cronograma de Notas',[
          'Para cada periodo, defina la <b>fecha de apertura</b> y la <b>fecha de cierre</b>.',
          'Use el toggle <b>Acceso Abierto ✅</b> para abrir o cerrar un periodo manualmente en cualquier momento.',
          'Cuando un periodo está <b>cerrado</b>, los docentes NO pueden editar calificaciones — aparece candado 🔒.',
          'Cuando está <b>abierto</b>, la planilla del docente muestra borde verde en ese periodo.',
          'Guarde los cambios con el botón correspondiente.',
        ],'Recomendamos cerrar periodos anteriores al abrir el siguiente, para evitar modificaciones accidentales en notas ya reportadas.')}

        ${card('🗓️','Años Lectivos','Menú lateral → ⚙️ Configuración Base → Año Lectivo',[
          'Al inicio de cada año escolar, seleccione <b>Iniciar Nuevo Año Lectivo</b>.',
          'El sistema archiva los datos del año anterior (notas, asistencia, observaciones) en el histórico.',
          'Puede consultar años anteriores usando el selector de año en la barra superior.',
          'Los datos históricos son de solo lectura — no se pueden editar.',
        ],'Los históricos se almacenan en la nube con la clave del año correspondiente. No se pierden al iniciar un nuevo año.')}
      `)}

      ${section('👥 Gestión Académica','#1a5276',`
        ${card('📚','Carga Académica','Menú lateral → 📚 Carga Académica',[
          'Haga clic en <b>+ Nueva Carga</b>.',
          'Seleccione el <b>grado</b>, el <b>área</b> (Ciencias, Matemáticas, etc.) e ingrese el nombre de la asignatura.',
          'Asigne el <b>docente responsable</b> de la lista de docentes registrados.',
          'Configure los porcentajes: <b>SER + SABER + HACER = 100%</b>.',
          'Guarde — la carga se crea automáticamente para los 4 periodos.',
          'Para editar: ícono ✏️ junto a la asignatura. Para eliminar: ícono 🗑️.',
        ],'Una sola carga cubre todos los periodos del año. El docente asignado verá esa asignatura en su planilla automáticamente.')}

        ${card('👥','Gestión de Estudiantes','Menú lateral → 👥 Gestión de Estudiantes',[
          'Para agregar uno: <b>+ Nuevo Estudiante</b> → complete apellidos, nombres, documento, fecha de nacimiento y grado.',
          'Para importar masivamente: descargue la <b>📥 Plantilla Excel</b>, llénela con los datos de todos los estudiantes y cárguela.',
          'Para editar: clic en el nombre del estudiante → ✏️ Editar perfil.',
          'Para trasladar de grado individualmente: botón <b>↔ Trasladar</b> en el perfil.',
          'Para traslado masivo de grado: seleccione varios y use <b>Traslado Masivo</b>.',
          'Las contraseñas de estudiantes y sus padres son el <b>número de documento</b> del estudiante.',
        ],'Al importar desde Excel, el sistema no duplica estudiantes que ya existen — valida por número de documento.')}

        ${card('🔑','Ver Credenciales','Menú lateral → 🔑 Ver Credenciales',[
          'Filtre por <b>rol</b> (Docente, Estudiante, Padre/Acudiente) y grado.',
          'Vea el <b>usuario</b> y <b>contraseña</b> de cada persona registrada.',
          'Use esta información para ayudar a usuarios con problemas de acceso.',
          'Los docentes tienen contraseña asignada por el rector; estudiantes y padres usan el documento del estudiante.',
        ],'Este módulo es exclusivo del rector. Nadie más puede ver las credenciales de otros usuarios.')}
      `)}

      ${section('📊 Notas y Evaluación','#27ae60',`
        ${card('📊','Planilla de Calificaciones','Menú lateral → 📊 Planilla de Calificaciones',[
          'Seleccione el <b>grado</b>, la <b>asignatura</b> y el <b>periodo</b>.',
          'Ingrese o edite las notas <b>SER</b>, <b>SABER</b> y <b>HACER</b> de cada estudiante (escala 0.0 a 5.0).',
          'Las notas recién escritas se muestran con <b>borde amarillo</b> — son cambios pendientes.',
          'Haga clic en <b>💾 GUARDAR CAMBIOS</b> para confirmar. En ese momento se calcula NOTA y DEFINITIVA.',
          'Descargue la planilla en Excel, llénela offline y cárguela de vuelta con el botón de importar.',
        ],'El rector puede ver y editar notas de TODOS los grados y docentes. La DEFINITIVA se calcula solo al guardar.')}

        ${card('🔍','Estado de Notas','Menú lateral → 🔍 Estado de Notas',[
          'Seleccione el <b>periodo</b> y opcionalmente el <b>grado</b> o <b>docente</b>.',
          'El sistema muestra: ✅ notas completas, ⚠️ notas parciales, ❌ sin notas.',
          'Identifique qué docentes tienen asignaturas pendientes antes de cerrar el periodo.',
          'Descargue el reporte de estado en PDF o Excel.',
        ],'Use este módulo justo antes de cerrar cada periodo para asegurarse de que nadie tenga notas faltantes.')}

        ${card('📝','Descriptores','Menú lateral → 📝 Descriptores',[
          'Seleccione el <b>grado</b>, la <b>asignatura</b> y el <b>periodo</b>.',
          'Ingrese el descriptor/logro de aprendizaje para ese periodo.',
          'Use <b>Replicar a todos los grupos</b> para copiar el descriptor a todos los grupos del mismo grado.',
          'Filtre por docente, grado y área para revisar el estado de los descriptores pendientes.',
          'Los descriptores se imprimen automáticamente en los boletines de los estudiantes.',
        ],'')}

        ${card('📄','Informes y Boletines','Menú lateral → 📄 Informes / Boletines',[
          'Para <b>boletín individual</b>: seleccione grado → clic en el estudiante → 🖨️ Imprimir Boletín.',
          'Para <b>boletines masivos</b>: botón 📄 Boletines PDF (genera todos los del grado en un archivo).',
          'Para <b>consolidado de grado</b>: botón 📊 Consolidado PDF o 📊 Consolidado Excel.',
          'Para <b>informe final anual</b>: seleccione periodo "Final" e imprima el acta de resultados.',
          'Los boletines incluyen: logo, firma del rector, notas por periodo, descriptores y posición en el grado.',
        ],'El rector puede generar boletines de todos los grados. Los docentes solo ven los de sus asignaturas.')}
      `)}

      ${section('📋 Seguimiento Estudiantil','#e67e22',`
        ${card('📋','Observador del Estudiante','Menú lateral → 📋 Observador',[
          'Busque el estudiante por nombre o grado.',
          'Clic en <b>+ Nueva Anotación</b>.',
          'Seleccione el <b>tipo</b>: Académica, Comportamental, Convivencia, Reconocimiento o Compromiso.',
          'Ingrese la descripción detallada y el periodo al que corresponde.',
          'Use el botón <b>🤖 Analizar con Adán</b> para que la IA sugiera la redacción.',
          'El padre/acudiente puede ver todas las anotaciones desde su perfil.',
        ],'Las observaciones quedan vinculadas al año lectivo activo. Los históricos de años anteriores también son consultables.')}

        ${card('📆','Asistencia','Menú lateral → 📆 Asistencia',[
          'Seleccione el <b>grado</b>, la <b>asignatura</b>, el <b>mes</b> y la frecuencia (mensual/quincenal/semanal).',
          'En la pestaña <b>Registrar</b>: ingrese la fecha y marque cada estudiante como <b>P</b> (Presente), <b>A</b> (Ausente) o <b>J</b> (Justificado).',
          'Haga clic en <b>💾 Guardar Asistencia</b>.',
          'Para diligenciar múltiples días a la vez: descargue la <b>📊 Planilla Excel</b>, escriba P/A/J en cada celda de día y cárguela con <b>📂 Cargar Excel</b>.',
          'En la pestaña <b>Historial</b>: vea y edite registros de días anteriores.',
          'En la pestaña <b>Reporte</b>: estadísticas de asistencia por estudiante con % de presencia.',
        ],'Al marcar una ausencia y guardar, el sistema envía notificación automática al padre/acudiente (si tiene notificaciones activadas en su navegador).')}

        ${card('🏅','Menciones de Honor','Menú lateral → 🏅 Menciones de Honor',[
          'Haga clic en <b>+ Nueva Mención</b>.',
          'Seleccione el <b>tipo</b>: Excelencia Académica, Comportamiento, Convivencia, Deportiva u Otro.',
          'Seleccione el <b>estudiante</b> y el <b>periodo</b>.',
          'Opcionalmente, agregue una descripción personalizada.',
          'Genere el <b>🖨️ Diploma PDF</b> con logo institucional y firma del rector.',
        ],'')}

        ${card('🗳️','Elecciones / Democracia Escolar','Menú lateral → 🗳️ Elecciones',[
          'Cree la jornada electoral con <b>+ Nueva Jornada</b> (Personero, Contralor, Consejo, etc.).',
          'Registre los candidatos con nombre, grado y propuesta (foto opcional).',
          'Active la votación con el toggle <b>Votación Abierta ✅</b> — los estudiantes pueden votar desde su perfil.',
          'Cada estudiante vota <b>una sola vez</b>. El sistema bloquea el voto repetido.',
          'Consulte resultados en tiempo real en la pestaña <b>📊 Resultados</b>.',
          'Cierre la votación y exporte los resultados en PDF o Excel.',
        ],'')}
      `)}

      ${section('📩 Otros Módulos','#7f8c8d',`
        ${card('📩','Pre-Matrícula Online','Menú lateral → 📩 Pre-Matrícula',[
          'Active el módulo en Configuración → <b>Pre-matrícula habilitada ✅</b>.',
          'Comparta el enlace del portal con los padres interesados.',
          'Los padres diligencian el formulario de solicitud con datos del estudiante y documentos.',
          'Revise las solicitudes recibidas en la sección <b>Solicitudes Recibidas</b>.',
          'Apruebe ✅ o rechace ❌ cada solicitud. El padre/acudiente recibe notificación.',
        ],'')}

        ${card('⏰','Horarios','Menú lateral → ⏰ Horarios',[
          'Cree el horario de clases por grado: seleccione el grado y asigne asignaturas a cada bloque de tiempo.',
          'El horario es visible para docentes y estudiantes desde sus perfiles.',
          'Descargue el horario en PDF para imprimir y publicar.',
        ],'')}

        ${card('⚡','Créditos IA (Panel Admin)','Acceso: URL + ?_x=gestor-admin → ⚙️ icono discreto',[
          'Acceda al panel de administración con la URL secreta del gestor.',
          'En <b>⚡ Créditos IA</b>: configure el <b>límite global</b> de consultas mensuales al asistente Adán.',
          'Asigne <b>límites individuales</b> por usuario si alguno necesita más o menos acceso.',
          'Vea el <b>consumo actual</b> de cada usuario y el uso total del mes.',
        ],'Cuando un usuario agota sus créditos, Adán le informa y debe esperar al siguiente mes o que el rector le amplíe el límite.')}

        ${card('💾','Respaldo de Datos','Menú lateral → 💾 Respaldo / Configuración',[
          'Haga clic en <b>📥 Descargar Respaldo</b> para obtener un archivo JSON con todos los datos de la institución.',
          'Guarde este archivo en un lugar seguro (Google Drive, USB, etc.).',
          'Para restaurar: cargue el archivo JSON con <b>📤 Cargar Respaldo</b>.',
          'Se recomienda hacer respaldo al inicio y final de cada periodo.',
        ],'El sistema también sincroniza automáticamente con la nube. El respaldo JSON es una copia de seguridad local adicional.')}
      `)}`,

    // ── DOCENTE ───────────────────────────────────────────────────────────────
    docente:`
      <div style="background:linear-gradient(135deg,#1a5276,#2980b9);border-radius:10px;padding:14px 18px;color:#fff;margin-bottom:16px;display:flex;gap:14px;align-items:center">
        <span style="font-size:2.4rem">👨‍🏫</span>
        <div>
          <div style="font-weight:700;font-size:1rem">Manual del Docente</div>
          <div style="font-size:0.82rem;color:#aed6f1;margin-top:3px">Usuario: asignado por el rector | Contraseña: la que le indicó el rector (o puede cambiarla desde Mi Perfil).</div>
        </div>
      </div>

      ${section('📊 Calificaciones y Evaluación','#1a5276',`
        ${card('📊','Planilla de Calificaciones','Menú lateral → 📊 Planilla de Calificaciones',[
          'Seleccione su <b>asignatura</b> (solo aparecen las que le fueron asignadas) y el <b>periodo</b>.',
          'Ingrese la nota <b>SER</b>, <b>SABER</b> y <b>HACER</b> de cada estudiante (escala 0.0 a 5.0).',
          'Las notas recién escritas muestran <b>borde amarillo</b> — son cambios pendientes, aún no guardados.',
          '<b>⚠️ IMPORTANTE:</b> siempre haga clic en <b>💾 GUARDAR CAMBIOS</b> para confirmar. Sin guardar, los valores se pierden al salir.',
          'La columna <b>NOTA</b> y <b>DEFINITIVA</b> se calculan automáticamente al guardar.',
          'Si el botón de guardar aparece bloqueado 🔒, el periodo está cerrado — contacte al rector(a).',
        ],'Puede descargar la planilla en Excel, llenarla offline con sus notas y cargarla de vuelta con el botón de importar Excel. Las notas importadas requieren guardar también.')}

        ${card('📝','Descriptores / Logros','Menú lateral → 📝 Descriptores',[
          'Seleccione su <b>asignatura</b> y el <b>periodo</b>.',
          'Escriba el descriptor o logro de aprendizaje del periodo en el cuadro de texto.',
          'Haga clic en <b>💾 Guardar Descriptor</b>.',
          'Si dicta la misma asignatura en varios grupos, use <b>Replicar a todos los grupos</b> para ahorrar tiempo.',
          'El descriptor aparecerá impreso en los boletines de sus estudiantes.',
          'Puede ver el estado de sus descriptores pendientes en la pestaña de estado.',
        ],'El rector puede ver si sus descriptores están pendientes. Trate de completarlos antes del cierre de periodo.')}

        ${card('🔍','Estado de Mis Notas','Menú lateral → 🔍 Estado de Notas',[
          'Vea qué estudiantes tienen notas completas (✅), parciales (⚠️) o sin nota (❌) en cada asignatura.',
          'Filtre por grado y periodo para ubicar rápidamente dónde hay notas faltantes.',
          'Descargue el reporte para llevar un registro personal.',
        ],'')}
      `)}

      ${section('📋 Seguimiento Estudiantil','#e67e22',`
        ${card('📋','Observador del Estudiante','Menú lateral → 📋 Observador',[
          'Busque al estudiante por nombre en el campo de búsqueda.',
          'Haga clic en <b>+ Nueva Anotación</b>.',
          'Seleccione el <b>tipo</b> de observación: Académica, Comportamental, Convivencia, Reconocimiento o Compromiso.',
          'Ingrese la descripción detallada de la situación o logro.',
          'Opcionalmente, use el botón <b>🤖 Sugerencia Adán</b> para que la IA ayude a redactar la anotación.',
          'El padre/acudiente del estudiante puede ver las anotaciones desde su perfil.',
        ],'Las observaciones de tipo "Reconocimiento" son positivas y animan a los estudiantes. Úselas con frecuencia.')}

        ${card('📆','Asistencia','Menú lateral → 📆 Asistencia',[
          'Seleccione el <b>grado</b>, su <b>asignatura</b>, el <b>mes</b> y la frecuencia.',
          '<b>Para registrar un día:</b> pestaña Registrar → ingrese la fecha → marque P, A o J para cada estudiante → <b>💾 Guardar</b>.',
          '<b>Para múltiples días a la vez:</b> descargue la <b>📊 Planilla Excel mensual</b> → escriba P, A o J en cada celda de día → guarde el archivo → cárguelo con <b>📂 Cargar Excel</b>.',
          'En la pestaña <b>Historial</b>: consulte y edite registros de días anteriores.',
          'En la pestaña <b>Reporte</b>: vea el % de asistencia de cada estudiante.',
        ],'Al diligenciar la planilla Excel: use P (Presente), A (Ausente) o J (Justificado) en mayúscula o minúscula. El sistema también acepta "Presente", "Ausente" o "Justificado" completo.')}
      `)}

      ${section('📅 Organización Personal','#27ae60',`
        ${card('⏰','Mi Horario','Menú lateral → ⏰ Horarios',[
          'Consulte su horario de clases asignado por la institución.',
          'Vea la distribución de sus asignaturas por día y hora.',
          'Descargue o imprima su horario con el botón <b>🖨️ Imprimir</b>.',
        ],'')}

        ${card('📩','Permiso de Ausentismo','Menú lateral → 📩 Permisos de Ausencia',[
          'Haga clic en <b>+ Solicitar Permiso</b>.',
          'Ingrese las <b>fechas</b> de la ausencia, el <b>motivo</b> y la actividad que realizará.',
          'Adjunte documentos de soporte si es necesario (imagen/PDF).',
          'El rector recibirá la solicitud y le notificará la respuesta (Aprobado ✅ o Rechazado ❌).',
          'Puede consultar el historial de todas sus solicitudes y su estado.',
        ],'')}

        ${card('🔔','Contacto y Notificaciones','Menú lateral → 🔔 Contacto / Notificaciones',[
          'Reciba mensajes y comunicados del rector(a) y del sistema.',
          'Envíe mensajes directos al administrador desde esta sección.',
          'Active las <b>notificaciones del navegador</b> para recibir alertas en tiempo real incluso sin tener la página activa.',
          'Vea el historial de todas las notificaciones recibidas.',
        ],'')}

        ${card('🤖','Asistente IA Adán','Ícono flotante 🤖 (esquina inferior derecha de la pantalla)',[
          'Haga clic en el ícono <b>🤖</b> para abrir el asistente.',
          'Escriba su consulta o use el <b>🎤 micrófono</b> para dictarla.',
          'Adán puede ayudar a: redactar observaciones, planear clases, interpretar datos de notas, responder preguntas pedagógicas y más.',
          'Adjunte <b>imágenes</b> con el ícono 📎 para preguntas relacionadas con materiales visuales.',
          'El asistente responde en español y puede hablar en voz alta.',
        ],'Cada docente tiene un límite de consultas mensuales configurado por el rector. El contador se reinicia cada mes.')}
      `)}`,

    // ── PADRE / ACUDIENTE ─────────────────────────────────────────────────────
    padre:`
      <div style="background:linear-gradient(135deg,#1e8449,#27ae60);border-radius:10px;padding:14px 18px;color:#fff;margin-bottom:16px;display:flex;gap:14px;align-items:center">
        <span style="font-size:2.4rem">👪</span>
        <div>
          <div style="font-weight:700;font-size:1rem">Manual del Padre / Acudiente</div>
          <div style="font-size:0.82rem;color:#a9dfbf;margin-top:3px">Usuario: número de documento del <b>acudiente</b> | Contraseña: número de documento del <b>estudiante</b>.</div>
        </div>
      </div>

      <div style="background:#eafaf1;border:1px solid #a9dfbf;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.82rem;color:#1e8449">
        🔐 <b>¿Olvidó su contraseña?</b> Contacte al rector(a) de la institución. Las contraseñas de padres son el número de documento del estudiante.
      </div>

      ${section('📊 Información Académica de su Hijo(a)','#1a5276',`
        ${card('📊','Notas de Mi Hijo(a)','Menú lateral → 📊 Mis Notas / Calificaciones',[
          'Al ingresar, verá automáticamente las calificaciones del <b>periodo activo</b>.',
          'Use el selector de <b>periodo</b> (1, 2, 3 o 4) para consultar otros periodos.',
          'Cada asignatura muestra: <b>SER</b>, <b>SABER</b>, <b>HACER</b>, <b>NOTA BASE</b> y <b>DEFINITIVA</b>.',
          'La DEFINITIVA puede incluir recuperación o nivelación adicional si el docente la registró.',
          'Vea el <b>promedio general</b> y el <b>puesto</b> de su hijo(a) en el grado.',
          'Descargue el <b>🖨️ Boletín PDF</b> para tener una copia impresa.',
        ],'Las notas solo son visibles cuando el docente las ha guardado y el rector ha habilitado el acceso. Si no ve notas, el periodo puede estar en proceso.')}

        ${card('📆','Asistencia de Mi Hijo(a)','Menú lateral → 📆 Asistencia',[
          'Consulte el historial de asistencia por <b>mes</b> y <b>asignatura</b>.',
          'Cada día registrado muestra: <b>P</b> (Presente), <b>A</b> (Ausente) o <b>J</b> (Justificado).',
          'Recibirá una <b>notificación automática</b> en su dispositivo cuando se registre una ausencia de su hijo(a).',
          'Si hay una ausencia registrada que considera incorrecta, contacte directamente al docente o rector.',
        ],'Para recibir notificaciones de ausencias en su celular/computador, acepte los permisos de notificación cuando el sistema se los solicite.')}

        ${card('📋','Observador del Estudiante','Menú lateral → 📋 Observador',[
          'Consulte todas las anotaciones académicas y comportamentales registradas para su hijo(a).',
          'Vea el <b>tipo de observación</b>, el <b>periodo</b> y el <b>docente</b> que la registró.',
          'Los reconocimientos positivos también aparecen aquí.',
          'Si tiene preguntas sobre alguna anotación, contacte directamente al docente o rector.',
        ],'')}
      `)}

      ${section('📩 Trámites y Comunicación','#e67e22',`
        ${card('📩','Pre-Matrícula','Menú lateral → 📩 Pre-Matrícula (cuando esté activo)',[
          'Cuando el módulo esté habilitado por la institución, aparecerá en el menú.',
          'Complete el <b>formulario de solicitud</b> con los datos del estudiante y del acudiente.',
          'Adjunte los <b>documentos requeridos</b> (certificados, documentos de identidad, etc.).',
          'Recibirá una notificación con el resultado de la revisión (Aprobada ✅ o Rechazada ❌).',
        ],'La pre-matrícula no garantiza el cupo hasta que el rector la apruebe formalmente.')}

        ${card('🔔','Notificaciones','Menú lateral → 🔔 Contacto / Notificaciones',[
          'Reciba alertas de ausencias, notas nuevas y comunicados de la institución.',
          'Active las <b>notificaciones del navegador</b> cuando el sistema se lo solicite para recibir alertas en tiempo real.',
          'Consulte el historial de todas las notificaciones recibidas.',
          'Si tiene una consulta o inquietud, puede enviar un mensaje al administrador desde esta sección.',
        ],'')}
      `)}`,

    // ── ESTUDIANTE ────────────────────────────────────────────────────────────
    estudiante:`
      <div style="background:linear-gradient(135deg,#7d3c98,#9b59b6);border-radius:10px;padding:14px 18px;color:#fff;margin-bottom:16px;display:flex;gap:14px;align-items:center">
        <span style="font-size:2.4rem">🎒</span>
        <div>
          <div style="font-weight:700;font-size:1rem">Manual del Estudiante</div>
          <div style="font-size:0.82rem;color:#d7bde2;margin-top:3px">Usuario: tu número de documento | Contraseña: tu número de documento.</div>
        </div>
      </div>

      ${section('📊 Mi Información Académica','#1a5276',`
        ${card('📊','Mis Notas','Menú lateral → 📊 Mis Notas',[
          'Al ingresar, verás automáticamente tus calificaciones del periodo actual.',
          'Usa el selector de <b>periodo</b> para consultar otros periodos (1, 2, 3 o 4).',
          'Cada asignatura muestra: <b>SER</b> (actitud y valores), <b>SABER</b> (conocimiento), <b>HACER</b> (habilidades), <b>NOTA BASE</b> y <b>DEFINITIVA</b>.',
          'Puedes ver tu <b>promedio general</b> y tu <b>puesto</b> en el grado.',
        ],'Si no ves tus notas, es posible que el docente aún no las haya guardado o que el rector no haya habilitado el acceso a ese periodo.')}

        ${card('📆','Mi Asistencia','Menú lateral → 📆 Asistencia',[
          'Consulta tu historial de asistencia por mes y asignatura.',
          'Cada día muestra: <b>P</b> (Presente), <b>A</b> (Ausente) o <b>J</b> (Justificado).',
          'Si ves una ausencia que crees incorrecta, infórmale a tu docente o al rector.',
        ],'')}
      `)}

      ${section('🎯 Participación Escolar','#27ae60',`
        ${card('🗳️','Elecciones Escolares','Menú lateral → 🗳️ Elecciones (cuando esté activo)',[
          'Cuando la institución active las elecciones, verás los candidatos en este módulo.',
          'Lee la propuesta de cada candidato antes de votar.',
          'Haz clic en el candidato de tu preferencia y confirma tu voto.',
          'Solo puedes votar <b>una sola vez</b>. El sistema bloquea votos repetidos.',
          'Los resultados se publican cuando el rector cierre la votación.',
        ],'Tu voto es secreto. El sistema solo registra que votaste, no por quién.')}

        ${card('🎯','Centros de Interés','Menú lateral → 🎯 Centros de Interés',[
          'Consulta los centros de interés disponibles en tu institución.',
          'Haz clic en <b>Inscribirme</b> en el centro que te interese.',
          'Puedes estar inscrito en varios centros de interés al mismo tiempo.',
          'El rector gestiona los cupos y puede aprobar o rechazar inscripciones.',
        ],'')}
      `)}`,
  };

  // ── Botones de tabs ────────────────────────────────────────────────────────
  const tabBtns=tabs.map(t=>`
    <button onclick="window._manualTab='${t.id}';renderApp()"
      style="padding:8px 18px;border:2px solid ${activeTab===t.id?'#003366':'#d5d8dc'};border-radius:8px;cursor:pointer;font-size:0.84rem;font-weight:600;transition:all .2s;
      background:${activeTab===t.id?'linear-gradient(135deg,#003366,#1a5276)':'#f5f8ff'};
      color:${activeTab===t.id?'#fff':'#003366'};
      box-shadow:${activeTab===t.id?'0 2px 10px rgba(0,51,102,.25)':'none'}">
      ${t.label}
    </button>`).join('');

  // ── Botones PDF ────────────────────────────────────────────────────────────
  const pdfBtns=isAdmin
    ?`<button class="btn btn-navy" onclick="generarManualPDF('admin')" style="font-size:0.78rem;padding:6px 12px">📄 PDF Admin</button>
      <button class="btn btn-blue" onclick="generarManualPDF('docente')" style="font-size:0.78rem;padding:6px 12px">📄 PDF Docente</button>
      <button class="btn btn-teal" onclick="generarManualPDF('padre')" style="font-size:0.78rem;padding:6px 12px">📄 PDF Padre</button>
      <button class="btn btn-green" onclick="generarManualPDF('estudiante')" style="font-size:0.78rem;padding:6px 12px">📄 PDF Estudiante</button>`
    :`<button class="btn btn-blue" onclick="generarManualPDF('${rolActual}')" style="font-size:0.8rem">📄 Descargar Mi Manual PDF</button>`;

  return `<h3 class="sec-title">📖 Manual de Usuario — Gestor Académico YC</h3>
  <div class="card" style="padding:16px 20px">

    <!-- Cabecera con tabs y PDF -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">${tabBtns}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${pdfBtns}</div>
    </div>

    <!-- Aviso de acceso -->
    <div style="background:#eaf4fb;border-left:4px solid #2980b9;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:0.81rem;color:#1a5276;line-height:1.6">
      🌐 <b>Acceso al sistema:</b> Funciona desde cualquier dispositivo con internet (celular, tablet, computador).<br>
      🔑 <b>Credenciales por defecto:</b> Usuario y contraseña = número de documento (estudiantes y padres) | Docentes: credenciales asignadas por el rector.<br>
      💡 <b>¿Problemas de acceso?</b> Contacte al rector(a) o al administrador del sistema.
    </div>

    <!-- Contenido del tab activo -->
    <div style="max-height:72vh;overflow-y:auto;padding-right:6px;scrollbar-width:thin">
      ${contenidos[activeTab]||contenidos[tabs[0]?.id]||'<p class="empty">Seleccione un rol para ver el manual.</p>'}
    </div>
  </div>`;
}
function generarManualPDF(rol){
  const{jsPDF}=window.jspdf;const doc=new jsPDF('p','mm','a4');
  const manuales={
    admin:{titulo:'MANUAL DE USUARIO — ADMINISTRADOR / RECTOR',secciones:[
      {t:'1. ACCESO AL SISTEMA',c:'Ingrese al portal con su usuario y contraseña asignados. El rol Administrador tiene acceso completo a todos los módulos de la institución.'},
      {t:'2. MÓDULO INSTITUCIÓN',c:'Configure los datos básicos de la institución: nombre, municipio, DANE, NIT, logo, firma del rector, resolución y año lectivo.'},
      {t:'3. CARGA ACADÉMICA',c:'Registre las asignaturas por grado y asígnelas a los docentes. Defina el área a la que pertenece cada asignatura e intensidad horaria.'},
      {t:'4. ESTUDIANTES',c:'Registre, edite o elimine estudiantes. Puede importar desde CSV. Cada estudiante accede con su número de documento como usuario y contraseña.'},
      {t:'5. CRONOGRAMA DE NOTAS',c:'Configure las fechas de apertura y cierre de cada periodo. También puede abrir/cerrar periodos manualmente con el toggle de acceso.'},
      {t:'6. PLANILLA DE CALIFICACIONES',c:'Vea y edite todas las notas de todos los grados. Los valores se guardan automáticamente en la nube.'},
      {t:'7. ESTADO DE NOTAS',c:'Consulte cuáles docentes tienen notas pendientes por periodo, grado y asignatura.'},
      {t:'8. DESCRIPTORES',c:'Gestione los descriptores por periodo, grado y asignatura. Se replican automáticamente a los grupos del mismo grado.'},
      {t:'9. INFORMES Y BOLETINES',c:'Genere consolidados, boletines individuales e informes finales en PDF. Seleccione el grado y periodo.'},
      {t:'10. OBSERVADOR DEL ESTUDIANTE',c:'Registre anotaciones comportamentales de los estudiantes. Filtre por estudiante, grado o tipo de observación.'},
      {t:'11. ASISTENCIA',c:'Registre la asistencia diaria por grado. Consulte reportes de inasistencias.'},
      {t:'12. ELECCIONES',c:'Configure candidatos a Personero y Contralor. Active el módulo de votación para estudiantes y vea los resultados en tiempo real.'},
      {t:'13. PRE-MATRÍCULA',c:'Administre las solicitudes de pre-matrícula enviadas por acudientes. Apruebe o rechace con notas.'},
      {t:'14. MENCIONES DE HONOR',c:'Cree menciones de honor por excelencia académica, comportamental o convivencia. Genere diplomas en PDF.'},
      {t:'15. CREDENCIALES',c:'Consulte usuarios y contraseñas de docentes, estudiantes y acudientes para ayudar en recuperación de acceso.'},
      {t:'16. SOLICITUDES DE AUSENTISMO',c:'Revise y responda las solicitudes de permiso de ausentismo enviadas por los docentes.'},
      {t:'17. RESPALDO DE DATOS',c:'Descargue un respaldo completo de la institución en formato JSON. También puede cargar respaldos previos para restaurar datos.'},
    ]},
    docente:{titulo:'MANUAL DE USUARIO — DOCENTE',secciones:[
      {t:'1. ACCESO AL SISTEMA',c:'Ingrese con el usuario y contraseña que le asignó el administrador o rector. Si olvidó sus credenciales contacte al rector(a).'},
      {t:'2. MI PERFIL',c:'Actualice su usuario y contraseña. Suba una foto de perfil desde su galería o tómela con la cámara del dispositivo.'},
      {t:'3. PLANILLA DE CALIFICACIONES',c:'Ingrese las notas SER, SABER y HACER para cada estudiante. Las notas se guardan automáticamente. Si el periodo está cerrado, no podrá editar calificaciones.'},
      {t:'4. DESCRIPTORES',c:'Ingrese el descriptor logro para cada asignatura y periodo. Use la opción de auto-replicar para copiar a todos los grupos del mismo grado.'},
      {t:'5. ESTADO DE NOTAS',c:'Consulte qué estudiantes tienen notas pendientes en cada periodo y asignatura. Vea el porcentaje de avance por grado.'},
      {t:'6. PERMISO DE AUSENTISMO',c:'Solicite permisos de ausencia al rector(a) desde este módulo. Complete los motivos, fechas y adjunte documentos si es necesario.'},
      {t:'7. HORARIOS',c:'Consulte su horario de clases asignado por la institución.'},
      {t:'8. OBSERVADOR',c:'Registre anotaciones del comportamiento de sus estudiantes.'},
      {t:'9. ASISTENCIA',c:'Registre la asistencia de sus grupos por fecha.'},
      {t:'10. CONTACTO / NOTIFICACIONES',c:'Reciba notificaciones del rector(a) y envíe mensajes al administrador.'},
    ]},
    padre:{titulo:'MANUAL DE USUARIO — PADRE DE FAMILIA / ACUDIENTE',secciones:[
      {t:'1. ACCESO AL SISTEMA',c:'Ingrese con el número de documento del acudiente como usuario y el número de documento del estudiante como contraseña.'},
      {t:'2. NOTAS DE SU HIJO(A)',c:'Consulte las calificaciones de cada periodo, por asignatura. Vea el promedio general y el puesto en el grado.'},
      {t:'3. ASISTENCIA',c:'Consulte los registros de asistencia e inasistencias de su hijo(a).'},
      {t:'4. OBSERVADOR',c:'Consulte las anotaciones comportamentales registradas para su hijo(a).'},
      {t:'5. PRE-MATRÍCULA',c:'Si el módulo está activo, diligencie el formulario de pre-matrícula para el próximo año escolar.'},
    ]},
    estudiante:{titulo:'MANUAL DE USUARIO — ESTUDIANTE',secciones:[
      {t:'1. ACCESO AL SISTEMA',c:'Ingrese con su número de documento como usuario y contraseña.'},
      {t:'2. MIS NOTAS',c:'Consulte sus calificaciones por periodo y asignatura. Vea su promedio general.'},
      {t:'3. ASISTENCIA',c:'Consulte su historial de asistencia e inasistencias.'},
      {t:'4. CENTROS DE INTERÉS',c:'Inscríbase a los centros de interés disponibles en su institución.'},
      {t:'5. ELECCIONES',c:'Si el módulo está activo, vote por su candidato a Personero y Contralor.'},
    ]}
  };
  const manual=manuales[rol];if(!manual){alert('Manual no disponible.');return;}
  const instNombre=getROT3();
  // Portada
  doc.setFillColor(0,30,80);doc.rect(0,0,210,297,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(22);doc.setFont('helvetica','bold');
  doc.text('GESTOR ACADÉMICO YC',105,60,{align:'center'});
  doc.setFontSize(13);var _instH=doc.splitTextToSize(instNombre,170);doc.text(_instH,105,75,{align:'center'});
  doc.setFillColor(241,196,15);doc.rect(30,90,150,1,'F');
  doc.setFontSize(16);var _manH=doc.splitTextToSize(manual.titulo,170);doc.text(_manH,105,110,{align:'center'});
  const logoSrc=db.logo||'';if(logoSrc){try{doc.addImage(logoSrc,'JPEG',88,130,34,34);}catch(e){}}
  doc.setFontSize(10);doc.setFont('helvetica','normal');doc.setTextColor(180);
  doc.text(`Año ${db.anio} | ${db.municipio||db.corregimiento||''}`,105,200,{align:'center'});
  doc.text(`Generado: ${new Date().toLocaleDateString('es-CO')}`,105,210,{align:'center'});
  // Secciones
  let y=20;
  manual.secciones.forEach((sec,i)=>{
    if(i===0||y>260){doc.addPage();y=20;}
    doc.setFillColor(0,51,102);doc.rect(12,y-4,186,8,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text(sec.t,15,y+1);
    y+=10;doc.setTextColor(50);doc.setFont('helvetica','normal');doc.setFontSize(9);
    const lines=doc.splitTextToSize(sec.c,178);
    doc.text(lines,14,y);y+=lines.length*5+8;
  });
  doc.save(`Manual_${rol}_${instNombre.replace(/\s/g,'_')}.pdf`);
}

// ============================================================
// NOTIFICACIONES EN TIEMPO REAL (POLLING)
// ============================================================
let _notifPoll=null;let _lastNotifId=0;let _notifBadge=0;
function iniciarPollingNotificaciones(){
  if(_notifPoll) clearInterval(_notifPoll);
  _notifPoll=setInterval(async()=>{
    try{
      const r=await fetch(API_BASE+'/api/inetis/notifications');
      if(!r.ok) return;
      const j=await r.json();
      const nuevas=(j.notifications||[]).filter(n=>n.id>_lastNotifId);
      if(nuevas.length){
        _lastNotifId=Math.max(...nuevas.map(n=>n.id));
        _notifBadge+=nuevas.length;
        mostrarNotifBanner(nuevas);
      }
    }catch(e){}
  },15000); // cada 15 segundos
}
function mostrarNotifBanner(notifs){
  let banner=document.getElementById('_notifBanner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='_notifBanner';
    banner.style.cssText='position:fixed;bottom:20px;left:20px;z-index:9999;display:flex;flex-direction:column;gap:6px;max-width:320px';
    document.body.appendChild(banner);
  }
  notifs.forEach(n=>{
    const el=document.createElement('div');
    el.style.cssText='background:#003366;color:#fff;padding:12px 16px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.4);font-size:0.84rem;border-left:4px solid #f1c40f;animation:popFade .3s ease';
    el.innerHTML=`<b>🔔 ${n.actor||'Sistema'}</b><br>${n.message}<br><span style="font-size:0.7rem;color:#aaa">${new Date(n.createdAt).toLocaleTimeString('es-CO')}</span><button onclick="this.parentElement.remove()" style="float:right;background:none;border:none;color:#fff;cursor:pointer;font-size:1rem;margin-top:-18px">✕</button>`;
    banner.appendChild(el);
    setTimeout(()=>el.remove(),8000);
  });
}
// Iniciar polling al entrar a la plataforma
const _origEntrarPlataforma=entrarPlataforma;
entrarPlataforma=async function(platId){
  await _origEntrarPlataforma(platId);
  if(sesion) iniciarPollingNotificaciones();
};
// También iniciar cuando hay sesión directa (login institucional)
const _origDoLoginInstitucional=doLoginInstitucional;
doLoginInstitucional=async function(){
  await _origDoLoginInstitucional();
  if(sesion) setTimeout(iniciarPollingNotificaciones,1000);
};

// Ausentismos en el menú admin (bajo contacto)
const _origHtmlContacto=typeof htmlContacto==='function'?htmlContacto:null;
if(_origHtmlContacto){
  htmlContacto=function(){
    let h=_origHtmlContacto();
    if(sesion&&sesion.r==='admin'){
      h+='<div style="margin-top:20px">'+htmlGestorAusentismos()+'</div>';
    }
    return h;
  };
}

// ============================================================
// PROTECCIÓN DE CÓDIGO FUENTE
// ============================================================
(function(){
  // Bloquear menú contextual (clic derecho)
  document.addEventListener('contextmenu',function(e){e.preventDefault();return false;});
  // Bloquear atajos de teclado para ver código / guardar / copiar / imprimir
  document.addEventListener('keydown',function(e){
    if(e.key==='F12'){e.preventDefault();return false;}
    if(e.key==='F5'&&e.ctrlKey){e.preventDefault();return false;}
    if(e.ctrlKey&&(e.key==='u'||e.key==='U')){e.preventDefault();return false;}
    if(e.ctrlKey&&(e.key==='p'||e.key==='P')&&!e.shiftKey){e.preventDefault();return false;}
    if(e.ctrlKey&&(e.key==='s'||e.key==='S')){e.preventDefault();return false;}
    if(e.ctrlKey&&(e.key==='a'||e.key==='A')&&e.target.tagName!=='INPUT'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();return false;}
    if(e.ctrlKey&&e.shiftKey&&(e.key==='i'||e.key==='I'||e.key==='j'||e.key==='J'||e.key==='c'||e.key==='C')){e.preventDefault();return false;}
    // Bloquear F11 (pantalla completa DevTools) y F10
    if((e.key==='F10'||e.key==='F11')&&e.altKey){e.preventDefault();return false;}
  });
  // Bloquear arrastrar imágenes o elementos para guardarlos
  document.addEventListener('dragstart',function(e){if(e.target.tagName==='IMG'||e.target.tagName==='A'){e.preventDefault();}});
  // Detección básica de DevTools (cambia tamaño)
  let _devW=window.outerWidth-window.innerWidth;
  let _devH=window.outerHeight-window.innerHeight;
  setInterval(function(){
    const dW=window.outerWidth-window.innerWidth;
    const dH=window.outerHeight-window.innerHeight;
    if((dW>160||dH>160)&&!(sesion&&gestorSesion)){
      // DevTools probablemente abierto — no hacemos nada agresivo pero
      // podemos registrar el intento
    }
  },2000);
  // Deshabilitar selección de texto en el body (excepto en inputs/textareas)
  document.addEventListener('selectstart',function(e){
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable) return true;
    // Solo bloquear si NO es gestor/superadmin
    if(gestorSesion) return true;
    // Permitir selección dentro de inputs
    return true; // no bloquear selección — solo F12/U/S
  });
})();

// ================================================================
// NUEVAS FUNCIONES AVANZADAS — GESTOR ACADÉMICO YC
// ================================================================

// ── MÓDULO: RECEPCIÓN DE PERMISOS (ADMIN/RECTOR) ──
function htmlRecepcionPermisos(){
  const sols=(db.ausentismos||[]).slice().reverse();
  if(!sols.length) return `<h3 class="sec-title">📋 Recepción de Permisos Laborales</h3><div class="card"><p style="color:#888">No hay solicitudes pendientes.</p></div>`;
  const cols=['Pendiente','Aprobado','Rechazado'];
  const cards=sols.map(s=>{
    const color=s.estado==='Aprobado'?'#27ae60':s.estado==='Rechazado'?'#c0392b':'#e67e22';
    const tipos=(s.tipos||[s.motivo1||'—']).join(', ');
    return `<div class="card" style="border-left:4px solid ${color};margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <b style="color:#003366">${s.docNombre||s.doc}</b>
          <span style="font-size:0.78rem;color:#888;margin-left:8px">${s.fechaSol||s.fecha||''}</span>
          <span style="margin-left:10px;font-weight:bold;color:${color}">${s.estado||'Pendiente'}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-sm" style="background:#1a5276" onclick="imprimirPermisoH03(${s.id})">🖨️ PDF</button>
          ${s.estado==='Pendiente'?`
          <button class="btn-sm" style="background:#27ae60" onclick="responderPermiso(${s.id},'Aprobado')">✅ Aprobar</button>
          <button class="btn-sm" style="background:#c0392b" onclick="responderPermiso(${s.id},'Rechazado')">❌ Rechazar</button>`:''}
        </div>
      </div>
      <div style="margin-top:8px;font-size:0.82rem">
        <b>Tipos:</b> ${tipos} &nbsp;|&nbsp; <b>Desde:</b> ${s.desde||s.fInicio||'—'} &nbsp;|&nbsp; <b>Hasta:</b> ${s.hasta||s.fFin||'—'} &nbsp;|&nbsp; <b>Días:</b> ${s.diasTotal||s.dias||'—'}
      </div>
      ${s.obs?`<div style="font-size:0.8rem;color:#555;margin-top:4px"><b>Obs:</b> ${s.obs}</div>`:''}
      ${s.respuesta?`<div style="font-size:0.8rem;color:${color};margin-top:4px"><b>Respuesta:</b> ${s.respuesta}</div>`:''}
      ${s.celular?`<div style="font-size:0.78rem;color:#888;margin-top:2px">📱 ${s.celular} ${s.email?'| ✉️ '+s.email:''}</div>`:''}
    </div>`;
  }).join('');
  return `<h3 class="sec-title">📋 Recepción de Permisos Laborales (H03.03.F01)</h3>
  <div class="info-box" style="margin-bottom:12px">Como rector(a) puede aprobar o rechazar las solicitudes. El docente recibirá notificación instantánea.</div>
  ${cards}`;
}
function responderPermiso(id,decision){
  const resp=decision==='Aprobado'?db.rectora+' aprobó su solicitud. '+new Date().toLocaleDateString('es-CO'):'El rector(a) no aprobó su solicitud. '+new Date().toLocaleDateString('es-CO');
  const motivoRec=decision==='Rechazado'?prompt('Motivo del rechazo (opcional):',''):'';
  updDB(d=>{
    const idx=(d.ausentismos||[]).findIndex(s=>s.id===id);
    if(idx>=0){
      d.ausentismos[idx].estado=decision;
      d.ausentismos[idx].respuesta=resp+(motivoRec?' — '+motivoRec:'');
      d.ausentismos[idx].fechaRecibido=new Date().toISOString().slice(0,10);
      d.ausentismos[idx].fechaAprobacion=decision==='Aprobado'?new Date().toISOString().slice(0,10):'';
    }
    return d;
  });
  const sol=(db.ausentismos||[]).find(s=>s.id===id);
  const docNombre=sol?.docNombre||'el/la docente';
  const msg=decision==='Aprobado'?`✅ El rector(a) APROBÓ el permiso de ${docNombre}.`:`❌ El rector(a) RECHAZÓ el permiso de ${docNombre}.${motivoRec?' Motivo: '+motivoRec:''}`;
  try{fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'respuesta-permiso',actor:db.rectora||'Rector(a)',message:msg,meta:{docente:docNombre,decision,fecha:new Date().toISOString()}})}).catch(()=>{});}catch(e){}
  alert(`${decision==='Aprobado'?'✅':'❌'} Permiso ${decision.toLowerCase()}. El docente recibirá notificación.\n\nSi tiene WhatsApp configurado, también se enviará mensaje al celular: ${sol?.celular||'(no registrado)'}`);
  renderApp();
}

// ── MÓDULO: SEGUIMIENTO DE COMPROMISOS DEL OBSERVADOR ──
function htmlSeguimientoObservador(){
  const ests=db.ests||[];
  const grados=db.grados||[];
  const filGrado=window._soGrado||'';
  const filPer=window._soPer||'0';
  const filDoc=window._soDoc||'';
  const busq=(window._soBusq||'').toLowerCase().trim();

  // Recopilar todas las observaciones
  let todasObs=[];
  ests.forEach(e=>{
    (e.observaciones||[]).forEach(o=>{
      todasObs.push({estId:e.id,estNom:e.n,grado:e.g,per:o.per,txt:o.txt,doc:o.doc||'',fecha:o.fecha||'',anio:o.anio||''});
    });
  });

  // Docentes únicos para el filtro
  const docsUnicos=[...new Set(todasObs.map(o=>o.doc).filter(Boolean))].sort();

  // Filtrar
  let filtradas=todasObs;
  if(filGrado) filtradas=filtradas.filter(o=>o.grado===filGrado);
  if(filPer&&filPer!=='0') filtradas=filtradas.filter(o=>String(o.per)===filPer);
  if(filDoc) filtradas=filtradas.filter(o=>o.doc===filDoc);
  if(busq) filtradas=filtradas.filter(o=>o.estNom.toLowerCase().includes(busq)||o.txt.toLowerCase().includes(busq)||o.doc.toLowerCase().includes(busq));

  // Totales resumen
  const totTotal=filtradas.length;
  const porPer={1:0,2:0,3:0,4:0};
  filtradas.forEach(o=>{if(porPer[o.per]!==undefined) porPer[o.per]++;});
  const estConMas=[...new Map(filtradas.map(o=>[o.estId,o])).values()].length;

  const tarjetas=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px">
    <div style="background:#1a5276;color:#fff;border-radius:10px;padding:13px;text-align:center"><div style="font-size:1.7rem;font-weight:bold">${totTotal}</div><div style="font-size:0.75rem;opacity:.85">Observaciones</div></div>
    <div style="background:#2980b9;color:#fff;border-radius:10px;padding:13px;text-align:center"><div style="font-size:1.7rem;font-weight:bold">${estConMas}</div><div style="font-size:0.75rem;opacity:.85">Estudiantes con obs.</div></div>
    <div style="background:#6c3483;color:#fff;border-radius:10px;padding:13px;text-align:center"><div style="font-size:1.7rem;font-weight:bold">${porPer[1]}</div><div style="font-size:0.75rem;opacity:.85">Periodo 1</div></div>
    <div style="background:#1e8449;color:#fff;border-radius:10px;padding:13px;text-align:center"><div style="font-size:1.7rem;font-weight:bold">${porPer[2]}</div><div style="font-size:0.75rem;opacity:.85">Periodo 2</div></div>
    <div style="background:#b7770d;color:#fff;border-radius:10px;padding:13px;text-align:center"><div style="font-size:1.7rem;font-weight:bold">${porPer[3]}</div><div style="font-size:0.75rem;opacity:.85">Periodo 3</div></div>
    <div style="background:#922b21;color:#fff;border-radius:10px;padding:13px;text-align:center"><div style="font-size:1.7rem;font-weight:bold">${porPer[4]}</div><div style="font-size:0.75rem;opacity:.85">Periodo 4</div></div>
  </div>`;

  // Agrupar por estudiante para gráfica y tabla
  const porEst={};
  filtradas.forEach(o=>{
    if(!porEst[o.estId]) porEst[o.estId]={id:o.estId,nom:o.estNom,grado:o.grado,total:0,p1:0,p2:0,p3:0,p4:0,docs:new Set()};
    porEst[o.estId].total++;
    const pk='p'+o.per;if(porEst[o.estId][pk]!==undefined) porEst[o.estId][pk]++;
    porEst[o.estId].docs.add(o.doc);
  });
  const estArr=Object.values(porEst).sort((a,b)=>b.total-a.total);

  // Gráfica SVG barras apiladas por estudiante (top 15)
  let grafica='<p style="color:#aaa;font-size:0.85rem;text-align:center;padding:20px">Sin observaciones que mostrar con los filtros actuales.</p>';
  const top=estArr.slice(0,15);
  if(top.length){
    const maxV=Math.max(...top.map(e=>e.total),1);
    const BAR_W=38,GAP=14,PAD_L=30,H=140,PAD_B=40;
    const svgW=PAD_L+top.length*(BAR_W+GAP)+GAP+10;
    const colores=['#6c3483','#1e8449','#b7770d','#922b21'];
    // Líneas guía
    const guias=[1,2,3,5,8,10,15].filter(g=>g<=maxV).slice(0,4).map(g=>{
      const y=H-Math.round((g/maxV)*H)+10;
      return `<line x1="${PAD_L}" y1="${y}" x2="${svgW-5}" y2="${y}" stroke="#dee2e6" stroke-dasharray="3,3"/><text x="${PAD_L-3}" y="${y+3}" text-anchor="end" font-size="8" fill="#999">${g}</text>`;
    }).join('');
    const barras=top.map((e,i)=>{
      const x=PAD_L+i*(BAR_W+GAP)+GAP;
      const baseY=H+10;let by=baseY;let segs='';
      [1,2,3,4].forEach((p,pi)=>{
        const h=Math.round((e['p'+p]/maxV)*H);
        if(h>0){by-=h;segs+=`<rect x="${x}" y="${by}" width="${BAR_W}" height="${h}" fill="${colores[pi]}" rx="2"><title>P${p}: ${e['p'+p]}</title></rect>`;}
      });
      const nomC=e.nom.split(' ').slice(0,2).join(' ').substring(0,14);
      return `${segs}
        <text x="${x+BAR_W/2}" y="${baseY-Math.round((e.total/maxV)*H)-5}" text-anchor="middle" font-size="10" font-weight="bold" fill="#1a5276">${e.total}</text>
        <text x="${x+BAR_W/2}" y="${baseY+12}" text-anchor="middle" font-size="7.5" fill="#444" transform="rotate(-35,${x+BAR_W/2},${baseY+12})">${nomC}</text>`;
    }).join('');
    const leyenda=`<g transform="translate(${PAD_L},0)">
      ${colores.map((c,i)=>`<rect x="${i*60}" y="0" width="10" height="10" fill="${c}" rx="2"/><text x="${i*60+13}" y="9" font-size="9" fill="#333">P${i+1}</text>`).join('')}
    </g>`;
    grafica=`<div style="overflow-x:auto"><svg width="${svgW}" height="${H+PAD_B+16}" style="display:block;min-width:300px">
      ${leyenda}${guias}${barras}
      <line x1="${PAD_L}" y1="10" x2="${PAD_L}" y2="${H+10}" stroke="#bbb"/>
      <line x1="${PAD_L}" y1="${H+10}" x2="${svgW-5}" y2="${H+10}" stroke="#bbb"/>
    </svg></div>`;
  }

  // Tabla detallada por estudiante
  const filasEst=estArr.length?estArr.map((e,i)=>`<tr style="${i%2===0?'background:#f9fbff':''}">
    <td style="padding:7px 10px;font-weight:500">${e.nom}</td>
    <td style="padding:7px 10px;text-align:center;color:#666">${e.grado}</td>
    <td style="padding:7px 10px;text-align:center;font-weight:bold;color:#1a5276">${e.total}</td>
    <td style="padding:7px 10px;text-align:center;color:#6c3483">${e.p1||0}</td>
    <td style="padding:7px 10px;text-align:center;color:#1e8449">${e.p2||0}</td>
    <td style="padding:7px 10px;text-align:center;color:#b7770d">${e.p3||0}</td>
    <td style="padding:7px 10px;text-align:center;color:#922b21">${e.p4||0}</td>
    <td style="padding:7px 10px;text-align:center;font-size:0.78rem;color:#555">${[...e.docs].join(', ')||'—'}</td>
    <td style="padding:7px 6px;text-align:center;white-space:nowrap">
      <button class="btn-sm" style="background:#2980b9;margin-right:3px" onclick="verHistorialEstudiante(${JSON.stringify(e.id)})">👁 Ver</button>
      <button class="btn-sm" style="background:#1a5276" onclick="pdfObservador('${String(e.id)}')">📄 PDF</button>
    </td>
  </tr>`).join(''):`<tr><td colspan="9" style="padding:20px;text-align:center;color:#aaa">Sin resultados con los filtros seleccionados.</td></tr>`;

  // Lista de compromisos (todas las obs filtradas, últimas 30)
  const ultimas=filtradas.slice().reverse().slice(0,30);
  const listaCompromisos=ultimas.length?ultimas.map(o=>`<div style="border-left:3px solid #1a5276;padding:8px 12px;margin-bottom:8px;background:#f9fbff;border-radius:0 6px 6px 0">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px">
      <span style="font-weight:600;color:#1a5276">${o.estNom}</span>
      <span style="font-size:0.75rem;color:#888">${o.grado} · P${o.per} · ${o.fecha}</span>
    </div>
    <p style="margin:4px 0 0;font-size:0.83rem;color:#333">${o.txt}</p>
    <span style="font-size:0.75rem;color:#666">👤 ${o.doc||'—'}</span>
  </div>`).join(''):'<p style="color:#aaa;text-align:center">Sin compromisos registrados.</p>';

  return `<h3 class="sec-title">📋 Seguimiento de Compromisos del Observador</h3>

  <div class="card" style="margin-bottom:14px">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div>
        <label class="lbl">Grado</label>
        <select onchange="window._soGrado=this.value;renderApp()" style="padding:6px 10px;border:1px solid #c0cfe0;border-radius:6px;font-size:0.85rem">
          <option value="">Todos los grados</option>
          ${grados.map(g=>`<option value="${g.n}"${filGrado===g.n?' selected':''}>${g.n}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="lbl">Período</label>
        <select onchange="window._soPer=this.value;renderApp()" style="padding:6px 10px;border:1px solid #c0cfe0;border-radius:6px;font-size:0.85rem">
          <option value="0"${filPer==='0'?' selected':''}>Todos</option>
          <option value="1"${filPer==='1'?' selected':''}>Período 1</option>
          <option value="2"${filPer==='2'?' selected':''}>Período 2</option>
          <option value="3"${filPer==='3'?' selected':''}>Período 3</option>
          <option value="4"${filPer==='4'?' selected':''}>Período 4</option>
        </select>
      </div>
      <div>
        <label class="lbl">Docente</label>
        <select onchange="window._soDoc=this.value;renderApp()" style="padding:6px 10px;border:1px solid #c0cfe0;border-radius:6px;font-size:0.85rem">
          <option value="">Todos</option>
          ${docsUnicos.map(d=>`<option value="${d}"${filDoc===d?' selected':''}>${d}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="lbl">Buscar estudiante / texto</label>
        <input value="${window._soBusq||''}" placeholder="Nombre o palabra..." oninput="window._soBusq=this.value;renderApp()" style="padding:6px 10px;border:1px solid #c0cfe0;border-radius:6px;font-size:0.85rem;min-width:180px">
      </div>
      <button class="btn btn-navy" onclick="exportarSeguimientoObsPDF()">🖨️ Exportar PDF</button>
      <button class="btn" style="background:#7d3c98;color:#fff" onclick="window._soGrado='';window._soPer='0';window._soDoc='';window._soBusq='';renderApp()">🔄 Limpiar</button>
    </div>
  </div>

  ${tarjetas}

  <div class="card" style="margin-bottom:14px">
    <h4 style="color:#1a5276;margin:0 0 12px">Frecuencia de Observaciones por Estudiante${top.length<estArr.length?' (Top 15)':''}</h4>
    ${grafica}
  </div>

  <div class="card" style="margin-bottom:14px">
    <h4 style="color:#1a5276;margin:0 0 10px">Resumen por Estudiante</h4>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.83rem">
        <thead><tr style="background:#1a5276;color:#fff">
          <th style="padding:8px 10px;text-align:left">Estudiante</th>
          <th style="padding:8px;text-align:center">Grado</th>
          <th style="padding:8px;text-align:center">Total</th>
          <th style="padding:8px;text-align:center;color:#c39bd3">P1</th>
          <th style="padding:8px;text-align:center;color:#a9dfbf">P2</th>
          <th style="padding:8px;text-align:center;color:#f9e79f">P3</th>
          <th style="padding:8px;text-align:center;color:#f1948a">P4</th>
          <th style="padding:8px;text-align:left">Docente(s)</th>
          <th style="padding:8px">PDF</th>
        </tr></thead>
        <tbody>${filasEst}</tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <h4 style="color:#1a5276;margin:0 0 12px">Últimas Observaciones Registradas ${filtradas.length>30?'(últimas 30)':''}</h4>
    ${listaCompromisos}
  </div>`;
}

function exportarSeguimientoObsPDF(){
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF('l','mm','a4');
  const W=297,H=210;
  const filGrado=window._soGrado||'';
  const filPer=window._soPer||'0';
  const filDoc=window._soDoc||'';
  const busq=(window._soBusq||'').toLowerCase().trim();
  const ests=db.ests||[];

  let todasObs=[];
  ests.forEach(e=>{
    (e.observaciones||[]).forEach(o=>{
      todasObs.push({estId:e.id,estNom:e.n,grado:e.g,per:o.per,txt:o.txt,doc:o.doc||'',fecha:o.fecha||''});
    });
  });
  let filtradas=todasObs;
  if(filGrado) filtradas=filtradas.filter(o=>o.grado===filGrado);
  if(filPer&&filPer!=='0') filtradas=filtradas.filter(o=>String(o.per)===filPer);
  if(filDoc) filtradas=filtradas.filter(o=>o.doc===filDoc);
  if(busq) filtradas=filtradas.filter(o=>o.estNom.toLowerCase().includes(busq)||o.txt.toLowerCase().includes(busq));

  const porEst={};
  filtradas.forEach(o=>{
    if(!porEst[o.estId]) porEst[o.estId]={id:o.estId,nom:o.estNom,grado:o.grado,total:0,p1:0,p2:0,p3:0,p4:0};
    porEst[o.estId].total++;
    const pk='p'+o.per;if(porEst[o.estId][pk]!==undefined) porEst[o.estId][pk]++;
  });
  const estArr=Object.values(porEst).sort((a,b)=>b.total-a.total);

  // Cabecera
  doc.setFillColor(26,82,118);doc.rect(0,0,W,18,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(255,255,255);
  const filtDesc=[(filGrado?'Grado: '+filGrado:''),(filPer&&filPer!=='0'?'Período: '+filPer:''),(filDoc?'Docente: '+filDoc:'')].filter(Boolean).join('  |  ')||'Todos los períodos y grados';
  doc.text('SEGUIMIENTO DE COMPROMISOS DEL OBSERVADOR',W/2,9,{align:'center'});
  doc.setFontSize(7.5);doc.setFont('helvetica','normal');
  doc.text((db.nombre||'Institución Educativa').toUpperCase()+'   •   Rector(a): '+(db.rectora||'')+'   •   Año: '+db.anio,W/2,15,{align:'center'});
  doc.setFontSize(7);doc.text('Filtros: '+filtDesc,W/2,19.5,{align:'center'});

  // Tarjetas resumen
  let y=24;
  const tots=[[`Total: ${filtradas.length}`,'#1a5276'],[`Estudiantes: ${estArr.length}`,'#2980b9'],[`P1: ${estArr.reduce((s,e)=>s+e.p1,0)}`,'#6c3483'],[`P2: ${estArr.reduce((s,e)=>s+e.p2,0)}`,'#1e8449'],[`P3: ${estArr.reduce((s,e)=>s+e.p3,0)}`,'#b7770d'],[`P4: ${estArr.reduce((s,e)=>s+e.p4,0)}`,'#922b21']];
  tots.forEach((sc,i)=>{
    const hex=sc[1].replace('#','');
    const r=parseInt(hex.substring(0,2),16),g2=parseInt(hex.substring(2,4),16),b=parseInt(hex.substring(4,6),16);
    doc.setFillColor(r,g2,b);doc.roundedRect(10+i*46,y,42,11,2,2,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
    doc.text(sc[0],10+i*46+21,y+7,{align:'center'});
  });
  y+=16;

  // Tabla resumen por estudiante
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(26,82,118);
  doc.text('Resumen por Estudiante',10,y);y+=4;
  const cols=[{t:'Estudiante',w:80},{t:'Grado',w:22},{t:'Total',w:18},{t:'P1',w:16},{t:'P2',w:16},{t:'P3',w:16},{t:'P4',w:16}];
  doc.setFillColor(26,82,118);doc.rect(10,y,W-20,7,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
  let cx=10;cols.forEach(c=>{doc.text(c.t,cx+c.w/2,y+5,{align:'center'});cx+=c.w;});
  y+=7;
  estArr.forEach((e,i)=>{
    if(y>H-18){doc.addPage('l');y=14;}
    if(i%2===0)doc.setFillColor(240,247,255);else doc.setFillColor(255,255,255);
    doc.rect(10,y,W-20,7,'F');
    doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(8);
    const row=[e.nom,e.grado,e.total,e.p1,e.p2,e.p3,e.p4];
    cx=10;cols.forEach((c,ci)=>{
      if(ci===0)doc.text(String(row[ci]).substring(0,30),cx+2,y+5);
      else doc.text(String(row[ci]),cx+c.w/2,y+5,{align:'center'});
      cx+=c.w;
    });
    y+=7;
  });
  if(!estArr.length){doc.setTextColor(150,150,150);doc.setFontSize(9);doc.text('Sin observaciones con los filtros seleccionados.',10+W/4,y+8);}

  // Detalle de observaciones (por página)
  if(filtradas.length){
    if(y<H-30){y+=8;}else{doc.addPage('l');y=14;}
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(26,82,118);
    doc.text('Detalle de Observaciones',10,y);y+=5;
    const detCols=[{t:'Estudiante',w:65},{t:'Grado',w:20},{t:'Per.',w:14},{t:'Fecha',w:24},{t:'Docente',w:50},{t:'Observación',w:W-20-65-20-14-24-50}];
    doc.setFillColor(92,108,135);doc.rect(10,y,W-20,6,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(7);doc.setFont('helvetica','bold');
    cx=10;detCols.forEach(c=>{doc.text(c.t,cx+2,y+4);cx+=c.w;});y+=6;
    filtradas.slice(0,120).forEach((o,i)=>{
      if(y>H-10){doc.addPage('l');y=14;}
      if(i%2===0)doc.setFillColor(248,252,255);else doc.setFillColor(255,255,255);
      doc.rect(10,y,W-20,6,'F');
      doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(6.5);
      const row=[o.estNom,o.grado,String(o.per||''),o.fecha||'',o.doc||'—',o.txt||''];
      cx=10;detCols.forEach((c,ci)=>{
        doc.text(String(row[ci]).substring(0,ci===5?55:30),cx+2,y+4);cx+=c.w;
      });
      y+=6;
    });
  }

  // Pie
  doc.setFontSize(6.5);doc.setTextColor(160,160,160);doc.setFont('helvetica','normal');
  const totalPags=doc.getNumberOfPages();
  for(let i=1;i<=totalPags;i++){doc.setPage(i);doc.text(`Generado por Gestor Académico YC • ${new Date().toLocaleString('es-CO')} • Pág. ${i}/${totalPags}`,W/2,H-3,{align:'center'});}
  doc.save('Seguimiento_Observador_'+db.anio+'.pdf');
}

// ── HISTORIAL INDIVIDUAL DE OBSERVACIONES (MODAL) ──
function verEstudiantesPorGrado(grado){
  const estsG=(db.ests||[]).filter(e=>e.g===grado);
  const matsG=(db.carga||[]).filter(c=>c.g===grado);
  const numPer=_getNumPer();
  const lista=estsG.map(e=>{
    const tieneN=matsG.some(m=>{for(let p=1;p<=numPer;p++) if(calcNotaDef(e.nts,m.id,p)>0) return true;return false;});
    const prom=tieneN?calcPromedioEst(e.id,grado):null;
    return {e,prom,tieneN};
  }).sort((a,b)=>(b.prom||0)-(a.prom||0));
  const aprobados=lista.filter(s=>s.prom!==null&&s.prom>=3.0);
  const reprobados=lista.filter(s=>s.prom!==null&&s.prom<3.0);
  const sinNotas=lista.filter(s=>!s.tieneN);
  const fila=(s,i,bg)=>`<tr style="background:${i%2===0?bg:'#fff'}">
    <td style="padding:6px 10px;font-size:0.83rem">${i+1}. ${s.e.n}</td>
    <td style="padding:6px 8px;text-align:center;font-weight:bold;color:${s.prom!==null?colorNota(s.prom):'#aaa'}">${s.prom!==null?s.prom.toFixed(2):'—'}</td>
    <td style="padding:6px 8px;text-align:center"><button class="btn-sm" style="background:#1a5276;font-size:0.72rem" onclick="verHistorialEstudiante('${String(s.e.id).replace(/'/g,"\\'")}')">Ver</button></td>
  </tr>`;
  const seccion=(titulo,col,ests,bg)=>ests.length?`<div style="margin-bottom:14px">
    <div style="background:${col};color:#fff;padding:6px 12px;border-radius:7px 7px 0 0;font-size:0.83rem;font-weight:bold">${titulo} (${ests.length})</div>
    <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
      <thead><tr style="background:#f0f4f8"><th style="padding:6px 10px;text-align:left">Estudiante</th><th style="padding:6px 8px;text-align:center">Promedio</th><th style="padding:6px 8px">Historial</th></tr></thead>
      <tbody>${ests.map((s,i)=>fila(s,i,bg)).join('')}</tbody>
    </table></div>`:'';
  const modalId='_modalGrado_'+Date.now();
  document.body.insertAdjacentHTML('beforeend',`<div id="${modalId}" style="position:fixed;inset:0;background:rgba(10,20,40,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(3px)" onclick="if(event.target.id==='${modalId}')document.getElementById('${modalId}').remove()">
  <div style="background:#fff;border-radius:14px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.35)">
    <div style="background:linear-gradient(135deg,#1a3a5c,#2980b9);border-radius:14px 14px 0 0;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="color:#fff;font-size:1.1rem;font-weight:800">👥 Grado: ${grado}</div>
        <div style="color:#b8d4f0;font-size:0.8rem;margin-top:3px">${lista.length} estudiantes · ${aprobados.length} aprobados · ${reprobados.length} reprobados</div>
      </div>
      <button onclick="document.getElementById('${modalId}').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;font-size:1.3rem;cursor:pointer;border-radius:8px;padding:4px 10px">✕</button>
    </div>
    <div style="padding:16px 20px">
      ${seccion('✅ Aprobados','#1e8449',aprobados,'#f2fff6')}
      ${seccion('❌ Reprobados','#c0392b',reprobados,'#fffafa')}
      ${sinNotas.length?`<div style="color:#aaa;font-size:0.8rem;padding:8px 4px">Sin notas aún: ${sinNotas.map(s=>s.e.n).join(', ')}</div>`:''}
    </div>
  </div></div>`);
}

function verHistorialEstudiante(estId){
  const est=(db.ests||[]).find(e=>e.id===estId||(typeof estId==='string'&&String(e.id)===estId));
  if(!est){alert('Estudiante no encontrado.');return;}

  // ── Notas académicas por materia y período ──
  const matsG=(db.carga||[]).filter(c=>c.g===est.g);
  const numPer=_getNumPer();
  const pHeaders=Array.from({length:numPer},(_,i)=>`<th style="padding:5px 7px;text-align:center;font-size:0.78rem">P${i+1}</th>`).join('');
  const filasNotas=matsG.map(m=>{
    const ns=Array.from({length:numPer},(_,i)=>calcNotaDef(est.nts,m.id,i+1));
    const tieneN=ns.some(v=>v>0);
    if(!tieneN) return '';
    const conN=ns.filter(v=>v>0);
    const promMat=parseFloat((conN.reduce((a,b)=>a+b,0)/conN.length).toFixed(2));
    const celdas=ns.map(v=>`<td style="padding:4px 7px;text-align:center;font-size:0.82rem;font-weight:bold;color:${v>0?colorNota(v):'#ccc'}">${v>0?v.toFixed(2):'—'}</td>`).join('');
    return `<tr style="border-bottom:1px solid #eef2f7">
      <td style="padding:5px 10px;font-size:0.82rem;white-space:nowrap">${m.m}</td>
      ${celdas}
      <td style="padding:5px 8px;text-align:center;font-weight:bold;font-size:0.85rem;color:${colorNota(promMat)}">${promMat.toFixed(2)}</td>
    </tr>`;
  }).filter(Boolean).join('');
  const promGlobal=calcPromedioEst(est.id,est.g);
  const notasHTML=filasNotas?`<div style="overflow-x:auto;margin-bottom:16px">
    <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
      <thead><tr style="background:#1a3a5c;color:#fff"><th style="padding:6px 10px;text-align:left">Asignatura</th>${pHeaders}<th style="padding:5px 8px;text-align:center">Prom.</th></tr></thead>
      <tbody>${filasNotas}</tbody>
      <tfoot><tr style="background:#e8f0fb;font-weight:bold"><td style="padding:6px 10px" colspan="${numPer+1}">Promedio General</td><td style="padding:6px 8px;text-align:center;color:${colorNota(promGlobal)}">${promGlobal.toFixed(2)}</td></tr></tfoot>
    </table></div>`:'<p style="color:#aaa;text-align:center;padding:12px;font-size:0.85rem">Sin notas registradas aún.</p>';

  const obs=(est.observaciones||[]).slice().reverse(); // más reciente primero
  const total=obs.length;
  const por={1:0,2:0,3:0,4:0};
  obs.forEach(o=>{if(por[o.per]!==undefined)por[o.per]++;});
  const docsSet=[...new Set(obs.map(o=>o.doc).filter(Boolean))];

  // Nivel de alerta
  let nivelTxt='Sin observaciones',nivelCol='#27ae60';
  if(total>=8){nivelTxt='⚠️ CRÍTICO';nivelCol='#c0392b';}
  else if(total>=5){nivelTxt='🔶 ALTO';nivelCol='#e67e22';}
  else if(total>=3){nivelTxt='🔸 MODERADO';nivelCol='#f39c12';}
  else if(total>=1){nivelTxt='🔹 LEVE';nivelCol='#2980b9';}

  // Gráfica SVG barras por período
  const colPer=['#6c3483','#1e8449','#b7770d','#922b21'];
  const maxP=Math.max(...Object.values(por),1);
  const BAR_W=44,GAP=18,PAD_L=26,SH=110;
  const svgW=PAD_L+4*(BAR_W+GAP)+GAP;
  const barrasPer=[1,2,3,4].map((p,i)=>{
    const v=por[p];const bh=Math.round((v/maxP)*SH)||0;
    const bx=PAD_L+i*(BAR_W+GAP)+GAP;const by=SH+10-bh;
    return `<rect x="${bx}" y="${by}" width="${BAR_W}" height="${bh}" fill="${colPer[i]}" rx="3"><title>Período ${p}: ${v}</title></rect>
      <text x="${bx+BAR_W/2}" y="${by-4}" text-anchor="middle" font-size="11" font-weight="bold" fill="${colPer[i]}">${v||''}</text>
      <text x="${bx+BAR_W/2}" y="${SH+22}" text-anchor="middle" font-size="10" fill="#444">P${p}</text>`;
  }).join('');
  const graficaPer=`<svg width="${svgW}" height="${SH+30}" style="display:block;margin:0 auto">
    <line x1="${PAD_L}" y1="10" x2="${PAD_L}" y2="${SH+10}" stroke="#ccc"/>
    <line x1="${PAD_L}" y1="${SH+10}" x2="${svgW-5}" y2="${SH+10}" stroke="#ccc"/>
    ${barrasPer}
  </svg>`;

  // Timeline de observaciones
  const timeline=obs.length?obs.map((o,i)=>{
    const colP=colPer[(o.per||1)-1]||'#1a5276';
    return `<div style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-start">
      <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:${colP};color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:bold">P${o.per||'?'}</div>
      <div style="flex:1;border:1px solid #e3eaf4;border-radius:8px;padding:10px 12px;background:${i%2===0?'#f7faff':'#fff'}">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:5px">
          <span style="font-size:0.8rem;color:#555">👤 ${o.doc||'Docente no especificado'}</span>
          <span style="font-size:0.75rem;color:#999">${o.fecha||'Sin fecha'}</span>
        </div>
        <p style="margin:0;font-size:0.87rem;color:#222;line-height:1.5">${o.txt||'(sin texto)'}</p>
        ${o.compromisos?`<div style="margin-top:6px;font-size:0.78rem;color:#1a5276;border-top:1px dashed #d0e0f0;padding-top:5px">📌 Compromisos: ${o.compromisos}</div>`:''}
        ${o.acudiente?`<div style="font-size:0.78rem;color:#7d6608;margin-top:3px">🤝 Acudiente: ${o.acudiente}</div>`:''}
      </div>
    </div>`;
  }).join(''):`<p style="text-align:center;color:#aaa;padding:20px">Este estudiante no tiene observaciones registradas.</p>`;

  // Construir modal
  const modalId='_modalHistObs_'+Date.now();
  const htmlModal=`<div id="${modalId}" style="position:fixed;inset:0;background:rgba(10,20,40,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(3px)" onclick="if(event.target.id==='${modalId}')document.getElementById('${modalId}').remove()">
  <div style="background:#fff;border-radius:14px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 12px 48px rgba(0,0,0,.35)">
    <!-- Cabecera -->
    <div style="background:linear-gradient(135deg,#1a3a5c,#2980b9);border-radius:14px 14px 0 0;padding:18px 20px;display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="color:#fff;font-size:1.2rem;font-weight:800;letter-spacing:.3px">${est.n||'Estudiante'}</div>
        <div style="color:#b8d4f0;font-size:0.83rem;margin-top:3px">Grado: ${est.g||'—'} &nbsp;|&nbsp; Doc: ${est.numDoc||'—'} &nbsp;|&nbsp; Año: ${db.anio||''}</div>
        <div style="margin-top:6px;display:inline-block;padding:3px 12px;border-radius:20px;font-size:0.78rem;font-weight:bold;background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">
          Nivel de riesgo: <span style="color:#fff">${nivelTxt}</span>
        </div>
      </div>
      <button onclick="document.getElementById('${modalId}').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;font-size:1.3rem;cursor:pointer;border-radius:8px;padding:4px 10px;line-height:1">✕</button>
    </div>

    <div style="padding:18px 20px">
      <!-- Notas académicas -->
      <div style="border:1px solid #d4e6f1;border-radius:10px;padding:14px;margin-bottom:18px;background:#f4f9ff">
        <h4 style="color:#1a3a5c;margin:0 0 10px;font-size:0.93rem">📝 Notas Académicas por Asignatura</h4>
        ${notasHTML}
      </div>

      <!-- Tarjetas resumen -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:18px">
        <div style="background:#1a3a5c;color:#fff;border-radius:9px;padding:11px;text-align:center"><div style="font-size:1.6rem;font-weight:bold">${total}</div><div style="font-size:0.7rem;opacity:.85">Total obs.</div></div>
        <div style="background:#6c3483;color:#fff;border-radius:9px;padding:11px;text-align:center"><div style="font-size:1.6rem;font-weight:bold">${por[1]}</div><div style="font-size:0.7rem;opacity:.85">Período 1</div></div>
        <div style="background:#1e8449;color:#fff;border-radius:9px;padding:11px;text-align:center"><div style="font-size:1.6rem;font-weight:bold">${por[2]}</div><div style="font-size:0.7rem;opacity:.85">Período 2</div></div>
        <div style="background:#b7770d;color:#fff;border-radius:9px;padding:11px;text-align:center"><div style="font-size:1.6rem;font-weight:bold">${por[3]}</div><div style="font-size:0.7rem;opacity:.85">Período 3</div></div>
        <div style="background:#922b21;color:#fff;border-radius:9px;padding:11px;text-align:center"><div style="font-size:1.6rem;font-weight:bold">${por[4]}</div><div style="font-size:0.7rem;opacity:.85">Período 4</div></div>
        <div style="background:${nivelCol};color:#fff;border-radius:9px;padding:11px;text-align:center"><div style="font-size:0.75rem;font-weight:bold;line-height:1.3">${nivelTxt}</div><div style="font-size:0.7rem;opacity:.85;margin-top:3px">Nivel</div></div>
      </div>

      <!-- Gráfica por período -->
      <div style="border:1px solid #e3eaf4;border-radius:10px;padding:14px;margin-bottom:18px;background:#fafcff">
        <h4 style="color:#1a3a5c;margin:0 0 10px;font-size:0.93rem">📊 Frecuencia por Período</h4>
        ${graficaPer}
        ${docsSet.length?`<div style="font-size:0.75rem;color:#666;text-align:center;margin-top:6px">Docentes involucrados: ${docsSet.join(', ')}</div>`:''}
      </div>

      <!-- Timeline -->
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h4 style="color:#1a3a5c;margin:0;font-size:0.93rem">📜 Historial Completo de Observaciones (${total})</h4>
        </div>
        ${timeline}
      </div>

      <!-- Botones -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;border-top:1px solid #e3eaf4;padding-top:14px">
        <button onclick="pdfHistorialIndividualObs('${String(est.id).replace(/'/g,"\\'")}' )" style="background:#1a5276;color:#fff;border:none;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:0.85rem;font-weight:bold">📄 PDF Historial Observador</button>
        <button onclick="pdfObservador('${String(est.id)}')" style="background:#2980b9;color:#fff;border:none;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:0.85rem;font-weight:bold">📋 PDF Observador Completo</button>
        <button onclick="document.getElementById('${modalId}').remove()" style="background:#f0f4f8;color:#333;border:1px solid #c0cfe0;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:0.85rem">Cerrar</button>
      </div>
    </div>
  </div>
</div>`;

  document.body.insertAdjacentHTML('beforeend',htmlModal);
}

// ── PDF HISTORIAL INDIVIDUAL DE OBSERVACIONES ──
function pdfHistorialIndividualObs(estId){
  const {jsPDF}=window.jspdf;
  const est=(db.ests||[]).find(e=>e.id===estId||(typeof estId==='string'&&String(e.id)===estId));
  if(!est){alert('Estudiante no encontrado.');return;}
  const obs=(est.observaciones||[]).slice().reverse();
  const total=obs.length;
  const por={1:0,2:0,3:0,4:0};
  obs.forEach(o=>{if(por[o.per]!==undefined)por[o.per]++;});

  let nivelTxt='Sin observaciones';
  if(total>=8) nivelTxt='CRÍTICO';
  else if(total>=5) nivelTxt='ALTO';
  else if(total>=3) nivelTxt='MODERADO';
  else if(total>=1) nivelTxt='LEVE';

  const doc=new jsPDF('p','mm','a4');
  const PW=210,PH=297;
  let y=0;

  // Encabezado
  doc.setFillColor(26,58,92);doc.rect(0,0,PW,22,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(255,255,255);
  doc.text('HISTORIAL DE OBSERVACIONES ESTUDIANTIL',PW/2,9,{align:'center'});
  doc.setFontSize(7.5);doc.setFont('helvetica','normal');
  doc.text((db.nombre||'Institución Educativa').toUpperCase(),PW/2,15,{align:'center'});
  doc.text('Rector(a): '+(db.rectora||'')+'   •   Año: '+(db.anio||''),PW/2,20,{align:'center'});
  y=28;

  // Datos del estudiante
  doc.setFillColor(240,247,255);doc.rect(10,y,PW-20,22,'F');
  doc.setDrawColor(41,128,185);doc.rect(10,y,PW-20,22,'D');
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(26,58,92);
  doc.text(est.n||'',14,y+7);
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(60,60,80);
  doc.text(`Grado: ${est.g||'—'}   |   Documento: ${est.numDoc||'—'}   |   Edad: ${est.edad||'—'}`,14,y+13);
  doc.text(`Acudiente: ${est.acudiente||'—'}   |   Contacto: ${est.celAcudiente||est.celular||'—'}`,14,y+19);
  // Nivel de riesgo badge
  const colNivel=total>=8?[192,57,43]:total>=5?[230,126,34]:total>=3?[243,156,18]:total>=1?[41,128,185]:[39,174,96];
  doc.setFillColor(...colNivel);doc.roundedRect(PW-55,y+3,44,14,3,3,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
  doc.text(nivelTxt,PW-55+22,y+12,{align:'center'});
  y+=28;

  // Tarjetas de resumen
  const tarjs=[['Total',total,'#1a3a5c'],['P1',por[1],'#6c3483'],['P2',por[2],'#1e8449'],['P3',por[3],'#b7770d'],['P4',por[4],'#922b21']];
  tarjs.forEach((t,i)=>{
    const hex=t[2].replace('#','');
    const r=parseInt(hex.substring(0,2),16),g2=parseInt(hex.substring(2,4),16),b=parseInt(hex.substring(4,6),16);
    doc.setFillColor(r,g2,b);doc.roundedRect(10+i*38,y,34,13,2,2,'F');
    doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(11);
    doc.text(String(t[1]),10+i*38+17,y+8.5,{align:'center'});
    doc.setFontSize(6.5);doc.setFont('helvetica','normal');
    doc.text(t[0],10+i*38+17,y+12,{align:'center'});
  });
  y+=19;

  // Línea separadora
  doc.setDrawColor(200,210,225);doc.line(10,y,PW-10,y);y+=6;

  // Título detalle
  doc.setFont('helvetica','bold');doc.setFontSize(9.5);doc.setTextColor(26,58,92);
  doc.text(`Detalle de Observaciones (${total} registros)`,10,y);y+=5;

  if(!obs.length){
    doc.setFont('helvetica','italic');doc.setFontSize(9);doc.setTextColor(160,160,160);
    doc.text('No hay observaciones registradas para este estudiante.',PW/2,y+10,{align:'center'});
  } else {
    const colPer=[[108,52,131],[30,132,73],[183,119,13],[146,43,33]];
    obs.forEach((o,i)=>{
      const lineH=14+Math.ceil((String(o.txt||'').length)/80)*4+(o.compromisos?5:0)+(o.acudiente?4:0);
      if(y+lineH>PH-14){doc.addPage();y=14;}
      const bgEven=i%2===0;
      doc.setFillColor(bgEven?247:255,bgEven?251:255,bgEven?255:255);
      doc.rect(10,y,PW-20,lineH,'F');
      doc.setDrawColor(220,230,245);doc.rect(10,y,PW-20,lineH,'D');
      // Banda de período
      const c=colPer[(o.per||1)-1]||[41,128,185];
      doc.setFillColor(...c);doc.rect(10,y,5,lineH,'F');
      // Período badge
      doc.setFillColor(...c);doc.roundedRect(17,y+2,14,8,2,2,'F');
      doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(7);
      doc.text('P'+(o.per||'?'),17+7,y+7.5,{align:'center'});
      // Datos
      doc.setTextColor(40,40,60);doc.setFont('helvetica','bold');doc.setFontSize(7.5);
      doc.text(`${o.fecha||'S/fecha'}   |   Docente: ${o.doc||'—'}`,34,y+6);
      doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(30,30,50);
      const lines=doc.splitTextToSize(o.txt||'(sin texto)',PW-50);
      lines.forEach((l,li)=>{doc.text(l,34,y+11+li*4);});
      let oy=y+11+lines.length*4;
      if(o.compromisos){
        doc.setFont('helvetica','italic');doc.setFontSize(6.5);doc.setTextColor(26,82,118);
        doc.text('📌 '+o.compromisos,34,oy+1);oy+=5;
      }
      if(o.acudiente){
        doc.setFont('helvetica','italic');doc.setFontSize(6.5);doc.setTextColor(125,102,8);
        doc.text('🤝 Acudiente: '+o.acudiente,34,oy+1);
      }
      y+=lineH+2;
    });
  }

  // Pie en todas las páginas
  doc.setFontSize(6);doc.setTextColor(160,160,160);doc.setFont('helvetica','normal');
  const totalP=doc.getNumberOfPages();
  for(let i=1;i<=totalP;i++){
    doc.setPage(i);
    doc.text(`Gestor Académico YC • ${new Date().toLocaleString('es-CO')} • Pág. ${i}/${totalP}`,PW/2,PH-4,{align:'center'});
  }
  doc.save(`Historial_Obs_${(est.n||'estudiante').replace(/\s+/g,'_')}_${db.anio||''}.pdf`);
}

// ── MÓDULO: CONTROL DE PERMISOS MENSUAL ──
function htmlControlPermisos(){
  const sols=db.ausentismos||[];
  const ahora=new Date();
  const mesDefecto=window._cpMes!==undefined?window._cpMes:ahora.getMonth();
  const anioDefecto=window._cpAnio!==undefined?window._cpAnio:ahora.getFullYear();

  // Opciones de mes
  const nombresMes=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const opsMes=nombresMes.map((n,i)=>`<option value="${i}"${i===mesDefecto?' selected':''}>${n}</option>`).join('');
  const opsAnio=[2023,2024,2025,2026,2027].map(a=>`<option value="${a}"${a===anioDefecto?' selected':''}>${a}</option>`).join('');

  // Filtrar solicitudes del mes/año
  const filtradas=sols.filter(s=>{
    const f=s.fechaSol||s.fecha||'';
    if(!f) return false;
    const d=new Date(f+'T00:00:00');
    return d.getMonth()===mesDefecto && d.getFullYear()===anioDefecto;
  });

  // Agrupar por docente
  const porDoc={};
  filtradas.forEach(s=>{
    const nom=s.docNombre||s.doc||'Sin nombre';
    if(!porDoc[nom]) porDoc[nom]={nombre:nom,total:0,aprobado:0,rechazado:0,pendiente:0,tipos:{},dias:0};
    porDoc[nom].total++;
    const est=(s.estado||'Pendiente');
    if(est==='Aprobado') porDoc[nom].aprobado++;
    else if(est==='Rechazado') porDoc[nom].rechazado++;
    else porDoc[nom].pendiente++;
    (s.tipos||[s.motivo1]).filter(Boolean).forEach(t=>{porDoc[nom].tipos[t]=(porDoc[nom].tipos[t]||0)+1;});
    porDoc[nom].dias+=parseInt(s.diasTotal||s.dias||0)||0;
  });
  const docs=Object.values(porDoc).sort((a,b)=>b.total-a.total);

  // Tarjetas resumen
  const totTotal=filtradas.length;
  const totApro=filtradas.filter(s=>s.estado==='Aprobado').length;
  const totRec=filtradas.filter(s=>s.estado==='Rechazado').length;
  const totPend=filtradas.filter(s=>!s.estado||s.estado==='Pendiente').length;
  const totDias=docs.reduce((a,d)=>a+d.dias,0);

  const tarjetas=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px">
    <div style="background:#1a5276;color:#fff;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.8rem;font-weight:bold">${totTotal}</div><div style="font-size:0.78rem;opacity:.85">Total solicitudes</div></div>
    <div style="background:#27ae60;color:#fff;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.8rem;font-weight:bold">${totApro}</div><div style="font-size:0.78rem;opacity:.85">Aprobadas</div></div>
    <div style="background:#c0392b;color:#fff;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.8rem;font-weight:bold">${totRec}</div><div style="font-size:0.78rem;opacity:.85">Rechazadas</div></div>
    <div style="background:#e67e22;color:#fff;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.8rem;font-weight:bold">${totPend}</div><div style="font-size:0.78rem;opacity:.85">Pendientes</div></div>
    <div style="background:#2c3e50;color:#fff;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.8rem;font-weight:bold">${totDias}</div><div style="font-size:0.78rem;opacity:.85">Días totales</div></div>
  </div>`;

  // Gráfica de barras SVG por docente
  let grafica='<p style="color:#aaa;font-size:0.85rem;text-align:center">Sin solicitudes en este período.</p>';
  if(docs.length){
    const maxVal=Math.max(...docs.map(d=>d.total),1);
    const BAR_W=44,GAP=18,PAD_L=130,PAD_B=36,H_BARS=160;
    const svgW=Math.max(520,PAD_L+docs.length*(BAR_W+GAP)+GAP);
    const svgH=H_BARS+PAD_B+20;
    // Líneas guía
    const guias=[1,2,3,4,5].filter(g=>g<=maxVal).map(g=>{
      const y=H_BARS-Math.round((g/maxVal)*H_BARS)+20;
      return `<line x1="${PAD_L}" y1="${y}" x2="${svgW-10}" y2="${y}" stroke="#dee2e6" stroke-dasharray="4,3"/><text x="${PAD_L-6}" y="${y+4}" text-anchor="end" font-size="10" fill="#888">${g}</text>`;
    }).join('');
    const barras=docs.map((d,i)=>{
      const x=PAD_L+i*(BAR_W+GAP)+GAP;
      const hA=Math.round((d.aprobado/maxVal)*H_BARS);
      const hR=Math.round((d.rechazado/maxVal)*H_BARS);
      const hP=Math.round((d.pendiente/maxVal)*H_BARS);
      const baseY=H_BARS+20;
      // Barra apilada: pendiente (naranja) + rechazado (rojo) + aprobado (verde)
      let segY=baseY;
      let segs='';
      if(hP){segY-=hP;segs+=`<rect x="${x}" y="${segY}" width="${BAR_W}" height="${hP}" fill="#e67e22" rx="2"/>`;}
      if(hR){segY-=hR;segs+=`<rect x="${x}" y="${segY}" width="${BAR_W}" height="${hR}" fill="#c0392b" rx="2"/>`;}
      if(hA){segY-=hA;segs+=`<rect x="${x}" y="${segY}" width="${BAR_W}" height="${hA}" fill="#27ae60" rx="2"/>`;}
      const nombreCorto=d.nombre.split(' ').slice(0,2).join(' ');
      return `${segs}
        <text x="${x+BAR_W/2}" y="${baseY-Math.round((d.total/maxVal)*H_BARS)-6}" text-anchor="middle" font-size="11" font-weight="bold" fill="#1a5276">${d.total}</text>
        <text x="${x+BAR_W/2}" y="${baseY+14}" text-anchor="middle" font-size="9" fill="#333" transform="rotate(-30,${x+BAR_W/2},${baseY+14})">${nombreCorto}</text>`;
    }).join('');
    const leyenda=`<g transform="translate(${PAD_L},6)">
      <rect x="0" y="0" width="12" height="12" fill="#27ae60" rx="2"/><text x="16" y="10" font-size="10" fill="#333">Aprobado</text>
      <rect x="70" y="0" width="12" height="12" fill="#c0392b" rx="2"/><text x="86" y="10" font-size="10" fill="#333">Rechazado</text>
      <rect x="155" y="0" width="12" height="12" fill="#e67e22" rx="2"/><text x="171" y="10" font-size="10" fill="#333">Pendiente</text>
    </g>`;
    grafica=`<div style="overflow-x:auto;margin-bottom:4px">
      <svg id="cpGrafica" width="${svgW}" height="${svgH+20}" style="display:block;min-width:320px">
        ${leyenda}${guias}${barras}
        <line x1="${PAD_L}" y1="20" x2="${PAD_L}" y2="${H_BARS+20}" stroke="#aaa"/>
        <line x1="${PAD_L}" y1="${H_BARS+20}" x2="${svgW-10}" y2="${H_BARS+20}" stroke="#aaa"/>
      </svg>
    </div>`;
  }

  // Tabla detallada por docente
  const filasDocs=docs.length?docs.map(d=>{
    const tiposStr=Object.entries(d.tipos).map(([t,c])=>`${t}(${c})`).join(', ')||'—';
    return `<tr>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:500">${d.nombre}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center;font-weight:bold;color:#1a5276">${d.total}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center;color:#27ae60;font-weight:bold">${d.aprobado}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center;color:#c0392b;font-weight:bold">${d.rechazado}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center;color:#e67e22;font-weight:bold">${d.pendiente}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center">${d.dias}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-size:0.78rem;color:#555">${tiposStr}</td>
    </tr>`;
  }).join(''):`<tr><td colspan="7" style="padding:20px;text-align:center;color:#aaa">Sin solicitudes en este período.</td></tr>`;

  return `<h3 class="sec-title">📊 Control de Permisos Mensual</h3>
  <div class="card" style="margin-bottom:14px">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <div>
        <label class="lbl">Mes</label>
        <select onchange="window._cpMes=+this.value;renderApp()" style="padding:6px 10px;border:1px solid #c0cfe0;border-radius:6px;font-size:0.88rem">${opsMes}</select>
      </div>
      <div>
        <label class="lbl">Año</label>
        <select onchange="window._cpAnio=+this.value;renderApp()" style="padding:6px 10px;border:1px solid #c0cfe0;border-radius:6px;font-size:0.88rem">${opsAnio}</select>
      </div>
      <button class="btn btn-navy" style="margin-top:18px" onclick="exportarControlPermisosPDF()">🖨️ Exportar PDF</button>
    </div>
  </div>

  ${tarjetas}

  <div class="card" style="margin-bottom:14px">
    <h4 style="color:#1a5276;margin:0 0 12px">Permisos por Docente — ${nombresMes[mesDefecto]} ${anioDefecto}</h4>
    ${grafica}
  </div>

  <div class="card">
    <h4 style="color:#1a5276;margin:0 0 10px">Detalle por Docente</h4>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead>
          <tr style="background:#f0f4f8;color:#1a5276">
            <th style="padding:8px 10px;text-align:left">Docente</th>
            <th style="padding:8px 10px;text-align:center">Total</th>
            <th style="padding:8px 10px;text-align:center">✅ Aprobados</th>
            <th style="padding:8px 10px;text-align:center">❌ Rechazados</th>
            <th style="padding:8px 10px;text-align:center">⏳ Pendientes</th>
            <th style="padding:8px 10px;text-align:center">Días</th>
            <th style="padding:8px 10px;text-align:left">Tipos solicitados</th>
          </tr>
        </thead>
        <tbody>${filasDocs}</tbody>
      </table>
    </div>
  </div>`;
}

function exportarControlPermisosPDF(){
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF('l','mm','a4'); // landscape
  const W=297,H=210;
  const nombresMes=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mes=window._cpMes!==undefined?window._cpMes:new Date().getMonth();
  const anio=window._cpAnio!==undefined?window._cpAnio:new Date().getFullYear();
  const sols=(db.ausentismos||[]).filter(s=>{
    const f=s.fechaSol||s.fecha||'';if(!f)return false;
    const d=new Date(f+'T00:00:00');return d.getMonth()===mes&&d.getFullYear()===anio;
  });

  // Cabecera
  doc.setFillColor(0,51,102);doc.rect(0,0,W,18,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(255,255,255);
  doc.text('CONTROL DE PERMISOS LABORALES — '+nombresMes[mes].toUpperCase()+' '+anio,W/2,11,{align:'center'});
  doc.setFontSize(8);doc.setFont('helvetica','normal');
  doc.text((db.nombre||'Institución Educativa').toUpperCase()+'  •  Rector(a): '+(db.rectora||''),W/2,16,{align:'center'});

  // Totales
  const tTotal=sols.length;
  const tApro=sols.filter(s=>s.estado==='Aprobado').length;
  const tRec=sols.filter(s=>s.estado==='Rechazado').length;
  const tPend=sols.filter(s=>!s.estado||s.estado==='Pendiente').length;
  doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(9);
  let y=24;
  const sumCards=[[`Total: ${tTotal}`,'#1a5276'],[`Aprobados: ${tApro}`,'#27ae60'],[`Rechazados: ${tRec}`,'#c0392b'],[`Pendientes: ${tPend}`,'#e67e22']];
  sumCards.forEach((sc,i)=>{
    const color=sc[1].replace('#','');
    const r=parseInt(color.substring(0,2),16),g2=parseInt(color.substring(2,4),16),b=parseInt(color.substring(4,6),16);
    doc.setFillColor(r,g2,b);doc.roundedRect(10+i*52,y,48,12,2,2,'F');
    doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text(sc[0],10+i*52+24,y+7,{align:'center'});
  });

  // Tabla por docente
  y=42;
  doc.setTextColor(0,51,102);doc.setFont('helvetica','bold');doc.setFontSize(10);
  doc.text('Detalle por Docente',10,y);y+=4;

  // Agrupar
  const porDoc={};
  sols.forEach(s=>{
    const nom=s.docNombre||s.doc||'Sin nombre';
    if(!porDoc[nom]) porDoc[nom]={nombre:nom,total:0,aprobado:0,rechazado:0,pendiente:0,dias:0,tipos:{}};
    porDoc[nom].total++;
    const est=(s.estado||'Pendiente');
    if(est==='Aprobado') porDoc[nom].aprobado++;
    else if(est==='Rechazado') porDoc[nom].rechazado++;
    else porDoc[nom].pendiente++;
    (s.tipos||[s.motivo1]).filter(Boolean).forEach(t=>{porDoc[nom].tipos[t]=(porDoc[nom].tipos[t]||0)+1;});
    porDoc[nom].dias+=parseInt(s.diasTotal||s.dias||0)||0;
  });
  const docs2=Object.values(porDoc).sort((a,b)=>b.total-a.total);

  // Encabezado tabla
  const cols2=[{t:'Docente',w:75},{t:'Total',w:18},{t:'Aprobados',w:24},{t:'Rechazados',w:24},{t:'Pendientes',w:24},{t:'Días',w:18},{t:'Tipos',w:100}];
  y+=4;
  doc.setFillColor(0,51,102);doc.rect(10,y,W-20,7,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(8);doc.setFont('helvetica','bold');
  let cx=10;
  cols2.forEach(c=>{doc.text(c.t,cx+c.w/2,y+5,{align:'center'});cx+=c.w;});
  y+=7;

  // Filas
  docs2.forEach((d,i)=>{
    if(y>H-20){doc.addPage('l');y=14;}
    if(i%2===0) doc.setFillColor(240,244,248);else doc.setFillColor(255,255,255);
    doc.rect(10,y,W-20,7,'F');
    doc.setTextColor(0,0,0);doc.setFont('helvetica','normal');doc.setFontSize(8);
    const row=[d.nombre,d.total,d.aprobado,d.rechazado,d.pendiente,d.dias,Object.entries(d.tipos).map(([t,c])=>`${t}(${c})`).join(', ')||'—'];
    cx=10;
    cols2.forEach((c,ci)=>{
      const txt=String(row[ci]);
      if(ci===0||ci===6) doc.text(txt.substring(0,ci===6?60:30),cx+2,y+5);
      else doc.text(txt,cx+c.w/2,y+5,{align:'center'});
      cx+=c.w;
    });
    y+=7;
  });

  // Gráfica de barras simple
  if(docs2.length&&y<H-50){
    y+=8;
    doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(0,51,102);
    doc.text('Gráfica de Permisos por Docente',10,y);y+=4;
    const maxV=Math.max(...docs2.map(d=>d.total),1);
    const barW=Math.min(22,Math.floor((W-40)/(docs2.length+1)));
    const chartH=35;const baseY=y+chartH;
    docs2.forEach((d,i)=>{
      const bh=Math.round((d.total/maxV)*chartH);
      const bx=10+i*(barW+4);
      // Pila simplificada
      const hA=Math.round((d.aprobado/maxV)*chartH);
      const hR=Math.round((d.rechazado/maxV)*chartH);
      const hP=bh-hA-hR;
      let by=baseY;
      if(hP>0){doc.setFillColor(230,126,34);doc.rect(bx,by-hP,barW,hP,'F');by-=hP;}
      if(hR>0){doc.setFillColor(192,57,43);doc.rect(bx,by-hR,barW,hR,'F');by-=hR;}
      if(hA>0){doc.setFillColor(39,174,96);doc.rect(bx,by-hA,barW,hA,'F');}
      doc.setFont('helvetica','bold');doc.setFontSize(6);doc.setTextColor(0,51,102);
      doc.text(String(d.total),bx+barW/2,baseY-bh-1,{align:'center'});
      doc.setFont('helvetica','normal');doc.setFontSize(5);doc.setTextColor(80,80,80);
      const nb=d.nombre.split(' ')[0].substring(0,9);
      doc.text(nb,bx+barW/2,baseY+4,{align:'center'});
    });
  }

  // Pie de página
  doc.setFontSize(7);doc.setTextColor(150,150,150);doc.setFont('helvetica','normal');
  doc.text('Generado por Gestor Académico YC • '+new Date().toLocaleString('es-CO'),W/2,H-4,{align:'center'});
  doc.save('Control_Permisos_'+nombresMes[mes]+'_'+anio+'.pdf');
}

// ── MÓDULO: HISTÓRICO DE AÑOS LECTIVOS ──
function htmlHistoricoAnios(){
  const platId=gestorEnPlataforma||window._currentPlatId;
  const plat=platId?gestorDB.platforms.find(x=>x.id===platId):null;
  const aniosDisp=plat?((plat.aniosDisponibles||[plat.anioActivo]).filter(a=>a!==plat.anioActivo)):[];
  const anioActivo=plat?plat.anioActivo:db.anio;
  const hist=db.historialAnios||[];
  // Fusionar años disponibles en gestorDB con historialAnios local
  const todosAniosHist=[...new Set([...aniosDisp,...hist.map(h=>h.anio)])].filter(Boolean).sort().reverse();
  const histMap=Object.fromEntries(hist.map(h=>[h.anio,h]));
  const histRows=todosAniosHist.map(a=>{
    const h=histMap[a]||{anio:a,fechaArchivo:'En nube',numEstudiantes:'?',numGrados:'?',resumen:''};
    return `<div class="card" style="margin-bottom:10px;border-left:4px solid #1a5276">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <b style="color:#003366;font-size:1rem">📅 Año Lectivo ${h.anio}</b>
          <span style="font-size:0.78rem;color:#888;margin-left:10px">Archivado: ${h.fechaArchivo||'—'}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${h.numEstudiantes!=='?'?`<span style="background:#e8f4fd;padding:4px 10px;border-radius:4px;font-size:0.82rem">👥 ${h.numEstudiantes} est.</span>`:''}
          ${h.numGrados!=='?'?`<span style="background:#eafaf1;padding:4px 10px;border-radius:4px;font-size:0.82rem">📚 ${h.numGrados} grados</span>`:''}
          <button class="btn-sm" style="background:#1a5276" onclick="switchAnioLectivoVer('${h.anio}')">👁 Ver datos</button>
          <button class="btn-sm" style="background:#8e44ad" onclick="exportarHistoricoAnio('${h.anio}')">📥 Exportar</button>
          ${plat?`<button class="btn-sm" style="background:#27ae60" onclick="_activarAnioLectivo('${platId}','${h.anio}')">🔄 Activar</button>`:''}
          <button class="btn-sm" style="background:#c0392b" onclick="eliminarHistoricoAnio('${h.anio}')">🗑 Eliminar</button>
        </div>
      </div>
      ${h.resumen?`<div style="font-size:0.8rem;color:#555;margin-top:6px">${h.resumen}</div>`:''}
    </div>`;
  }).join('');
  const sinHistorico=!todosAniosHist.length;
  return `<h3 class="sec-title">📅 Histórico de Años Lectivos</h3>
  <div class="info-box" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <div>Aquí se conservan los registros completos de cada año lectivo archivado. El año activo es <b>${anioActivo}</b>.</div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
    <button class="btn btn-navy" onclick="archivarAñoActual()">📦 Archivar Año Actual (${db.anio})</button>
    <button class="btn btn-success" onclick="iniciarNuevoAnioLectivo()" style="background:#27ae60">➕ Iniciar Nuevo Año Lectivo</button>
    <button class="btn" style="background:#8e44ad;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:0.84rem;font-weight:700;cursor:pointer" onclick="abrirModalImportarAnio()">📥 Importar desde Año Anterior</button>
  </div>
  ${sinHistorico?`<div class="card"><p style="color:#888;text-align:center;padding:20px 0">Sin años históricos archivados. Use <b>"Archivar Año Actual"</b> para guardar una copia del año ${db.anio} antes de iniciar un nuevo año.</p></div>`:''}
  ${histRows}`;
}
function verDatosHistorico(anio){
  const hist=(db.historialAnios||[]).find(h=>h.anio===anio);
  if(!hist||!hist.datos){alert('No hay datos para el año '+anio);return;}
  const d=hist.datos;
  const ests=d.ests||[];const grados=d.grados||[];const carga=d.carga||[];
  let html=`<div style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto" id="_histModalOv" onclick="if(event.target===this)this.remove()">
  <div style="background:#fff;border-radius:12px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;padding:0">
    <div style="background:linear-gradient(135deg,#003366,#1a5276);color:#fff;padding:18px 20px;border-radius:12px 12px 0 0;position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center">
      <div><h3 style="margin:0;font-size:1.05rem">📅 Año Lectivo ${anio} — Vista histórica (solo lectura)</h3>
        <small style="opacity:0.8">${hist.resumen||''}</small></div>
      <button onclick="document.getElementById('_histModalOv').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:1rem">✕</button>
    </div>
    <div style="padding:20px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <div style="background:#e8f4fd;border-radius:8px;padding:12px 20px;text-align:center"><b style="font-size:1.2rem;color:#003366">${ests.length}</b><div style="font-size:0.78rem;color:#666">Estudiantes</div></div>
        <div style="background:#eafaf1;border-radius:8px;padding:12px 20px;text-align:center"><b style="font-size:1.2rem;color:#27ae60">${grados.length}</b><div style="font-size:0.78rem;color:#666">Grados</div></div>
        <div style="background:#f5eef8;border-radius:8px;padding:12px 20px;text-align:center"><b style="font-size:1.2rem;color:#8e44ad">${carga.length}</b><div style="font-size:0.78rem;color:#666">Asignaturas</div></div>
      </div>
      <h4 style="color:#003366;margin-bottom:10px">👥 Listado de Estudiantes (${ests.length})</h4>
      <div style="overflow-x:auto;margin-bottom:20px"><table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead><tr style="background:#003366;color:#fff"><th style="padding:7px;text-align:left">Nombre</th><th style="padding:7px">Documento</th><th style="padding:7px">Grado</th><th style="padding:7px">Estado</th></tr></thead>
        <tbody>${ests.slice(0,200).map((e,i)=>`<tr style="background:${i%2===0?'#f8f9fa':'#fff'}"><td style="padding:6px 8px;border:1px solid #e0e0e0">${e.n||e.nombre||e.nom||'—'}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;text-align:center">${e.numDoc||'—'}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;text-align:center">${e.g||e.grado||'—'}</td><td style="padding:6px 8px;border:1px solid #e0e0e0;text-align:center">${e.estado||e.activo===false?'Retirado':'Activo'}</td></tr>`).join('')}
        ${ests.length>200?`<tr><td colspan="4" style="text-align:center;padding:8px;color:#888;font-style:italic">... y ${ests.length-200} estudiantes más</td></tr>`:''}</tbody>
      </table></div>
      <h4 style="color:#003366;margin-bottom:10px">📚 Grados y Asignaturas</h4>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">${grados.map(g=>`<span style="background:#e8f4fd;padding:5px 12px;border-radius:6px;font-size:0.82rem"><b>${g.n||g}</b>${g.d?' · '+g.d:''}</span>`).join('')}</div>
    </div>
  </div></div>`;
  const div=document.createElement('div');div.innerHTML=html;document.body.appendChild(div.firstChild);
}
function eliminarHistoricoAnio(anio){
  if(!confirm('¿Eliminar el histórico del año '+anio+'? Esta acción no se puede deshacer.')) return;
  updDB(d=>{d.historialAnios=(d.historialAnios||[]).filter(h=>h.anio!==anio);return d;});
  alert('✅ Histórico del año '+anio+' eliminado.');renderApp();
}
async function archivarAñoActual(){
  if(!confirm(`¿Desea archivar el año lectivo ${db.anio}?\n\n• Se guardará una copia completa de todos los datos actuales en el histórico\n• Los datos actuales NO se eliminan\n• El archivo también quedará guardado en la nube\n\n¿Continuar?`)) return;
  const snapshot={
    anio:db.anio,
    fechaArchivo:new Date().toISOString().slice(0,10),
    numEstudiantes:(db.ests||[]).length,
    numGrados:(db.grados||[]).length,
    resumen:`${(db.ests||[]).length} estudiantes | ${(db.grados||[]).length} grados | ${(db.carga||[]).length} asignaturas`,
    datos:{
      ests:JSON.parse(JSON.stringify(db.ests||[])),
      carga:JSON.parse(JSON.stringify(db.carga||[])),
      grados:JSON.parse(JSON.stringify(db.grados||[])),
      ausentismos:JSON.parse(JSON.stringify(db.ausentismos||[])),
      config:JSON.parse(JSON.stringify(db.config||{}))
    }
  };
  updDB(function(d){
    if(!d.historialAnios)d.historialAnios=[];
    const existe=d.historialAnios.findIndex(function(h){return h.anio===d.anio;});
    if(existe>=0) d.historialAnios[existe]=snapshot;
    else d.historialAnios.push(snapshot);
    return d;
  });
  // Guardar también en la nube (SK histórico aislado)
  const platId=gestorEnPlataforma||window._currentPlatId;
  if(platId) {
    try{ await _archivarAnioEnNube(platId, db.anio); }catch(e){}
  }
  alert(`✅ Año ${db.anio} archivado correctamente.\n\nPuede consultarlo en el módulo "Histórico Años" o en el selector de año de la barra superior.`);
  renderApp();
}
async function exportarHistoricoAnio(anio){
  // Buscar primero en historialAnios local, luego en la nube
  const hist=(db.historialAnios||[]).find(h=>h.anio===anio);
  let exportData=hist?hist.datos||hist:null;
  if(!exportData){
    // Intentar desde la nube
    const platId=gestorEnPlataforma||window._currentPlatId;
    const plat=platId?gestorDB.platforms.find(x=>x.id===platId):null;
    if(plat){
      const histSK=plat.sk.replace(/_hist_.*/,'')+'_hist_'+anio;
      try{
        const r=await fetch(API_BASE+'/api/inetis/db?sk='+encodeURIComponent(histSK));
        if(r.ok){const j=await r.json();if(j&&j.data) exportData=j.data;}
      }catch(e){}
    }
  }
  if(!exportData){alert('No se encontraron datos para el año '+anio+'.\nPrimero archívelo usando "Archivar Año Actual".');return;}
  const blob=new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Historico_${anio}_${db.nombre||'IE'}.json`;a.click();
}
function verHistoricoAnios(){navTo('historico-anios');}

// ── MÓDULO: AUTENTICACIÓN BIOMÉTRICA (WebAuthn / Huella / Face ID) ──
async function registrarHuella(){
  if(!window.navigator.credentials||!window.PublicKeyCredential){
    alert('⚠️ Tu navegador o dispositivo no soporta autenticación biométrica (WebAuthn).\nUsa Chrome, Edge o Safari en un dispositivo con lector de huellas o Face ID.');return;
  }
  try{
    const challenge=new Uint8Array(32);crypto.getRandomValues(challenge);
    const credential=await navigator.credentials.create({publicKey:{
      challenge,rp:{name:'Gestor Académico YC',id:location.hostname},
      user:{id:new TextEncoder().encode(sesion.u+':'+SK),name:sesion.u,displayName:sesion.n||sesion.u},
      pubKeyCredParams:[{alg:-7,type:'public-key'},{alg:-257,type:'public-key'}],
      authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'preferred'},
      timeout:60000,attestation:'none'
    }});
    const credId=btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
    updDB(d=>{d.users=(d.users||[]).map(u=>u.u===sesion.u?{...u,webAuthnId:credId,webAuthnTS:new Date().toISOString()}:u);return d;});
    alert('✅ ¡Huella / Face ID registrado exitosamente!\n\nAhora puede usar "🔑 Huella / Face ID" en la pantalla de ingreso.');
    renderApp();
  }catch(e){
    if(e.name==='NotAllowedError') alert('❌ No se pudo registrar la huella. El usuario canceló o el dispositivo no lo permite.');
    else alert('❌ Error al registrar biométrico: '+e.message);
  }
}
// ── Calcula la página destino según el rol del usuario ──
function _pagPorRol(rol){
  if(rol==='estudiante') return 'est-home';
  if(rol==='padre')      return 'padre-home';
  if(rol==='elecciones') return 'elecciones';
  return 'planilla'; // admin, rector, docente y cualquier otro
}

// ── Login biométrico DIRECTO para una plataforma específica (sin pedir usuario) ──
// Recopila todos los webAuthnId registrados en esa institución,
// invoca navigator.credentials.get con la lista completa,
// identifica al usuario por el rawId devuelto y establece la sesión con su rol real.
async function loginBiometricoPortal(platId){
  if(!window.navigator.credentials||!window.PublicKeyCredential){
    alert('⚠️ Autenticación biométrica no soportada en este navegador.\nUse Chrome, Edge o Safari en un dispositivo con lector de huellas o Face ID.');return;
  }
  const plat=gestorDB.platforms.find(x=>x.id===platId);
  if(!plat){alert('Institución no encontrada.');return;}
  if(plat.bloqueada){alert('🔒 Esta plataforma está temporalmente bloqueada. Comuníquese con su institución.');return;}
  let platDB;
  try{platDB=await _fetchPlatDB(plat.sk);}catch(e){alert('❌ Error cargando datos de la institución.');return;}

  // Recopilar todas las credenciales biométricas registradas en esta plataforma
  const credMap={}; // base64CredId -> user
  for(const u of (platDB.users||[])){
    if(u.webAuthnId) credMap[u.webAuthnId]=u;
  }
  if(!Object.keys(credMap).length){
    alert('⚠️ No hay huellas / Face ID registrados en esta institución.\n\nInicie sesión con usuario y contraseña, luego vaya a Mi Perfil → Registrar Huella.');return;
  }

  try{
    const challenge=new Uint8Array(32);crypto.getRandomValues(challenge);
    const allowCredentials=Object.keys(credMap).map(cid=>({
      type:'public-key',
      id:Uint8Array.from(atob(cid),c=>c.charCodeAt(0))
    }));
    const credential=await navigator.credentials.get({
      publicKey:{challenge,allowCredentials,userVerification:'required',timeout:60000}
    });
    // Identificar usuario por rawId devuelto
    const usedId=btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
    const user=credMap[usedId];
    if(!user){alert('❌ No se encontró el usuario asociado a esta credencial biométrica.');return;}
    // Establecer sesión con el rol real del usuario — NO sobreescribir con admin
    db=platDB;
    window._currentPlatSK=plat.sk;
    window._currentPlatId=platId;
    sesion=user;
    pag=_pagPorRol(user.r);
    if(user.r==='docente'){
      try{fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'login',actor:user.n,message:'El/La docente '+user.n+' ingresó al sistema (biométrico)',meta:{u:user.u,fecha:new Date().toISOString()}})}).catch(()=>{});}catch(e){}
    }
    _sseInit();
    _checkSchemaMigrationBanner();
    render();
  }catch(e){
    if(e.name==='NotAllowedError') alert('❌ Autenticación biométrica cancelada por el usuario.');
    else alert('❌ Error en autenticación biométrica: '+e.message);
  }
}

// ── Login biométrico DIRECTO desde el gestor (todas las plataformas activas) ──
// Sin pedir usuario ni contraseña: identifica al usuario por su credencial
// biométrica registrada y establece la sesión con su rol real.
async function loginBiometrico(){
  if(!window.navigator.credentials||!window.PublicKeyCredential){
    alert('⚠️ Autenticación biométrica no soportada en este navegador.');return;
  }
  // Recopilar credenciales de TODAS las plataformas activas
  const credMap={}; // base64CredId -> {user, plat, platDB}
  for(const plat of gestorDB.platforms){
    if(!plat.activa) continue;
    try{
      const platDB=await _fetchPlatDB(plat.sk);
      for(const u of (platDB.users||[])){
        if(u.webAuthnId) credMap[u.webAuthnId]={user:u,plat,platDB};
      }
    }catch(e){}
  }
  if(!Object.keys(credMap).length){
    alert('⚠️ No hay huellas / Face ID registrados en el sistema.\n\nInicie sesión con usuario y contraseña, luego vaya a Mi Perfil → Registrar Huella.');return;
  }
  try{
    const challenge=new Uint8Array(32);crypto.getRandomValues(challenge);
    const allowCredentials=Object.keys(credMap).map(cid=>({
      type:'public-key',
      id:Uint8Array.from(atob(cid),c=>c.charCodeAt(0))
    }));
    const credential=await navigator.credentials.get({
      publicKey:{challenge,allowCredentials,userVerification:'required',timeout:60000}
    });
    const usedId=btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
    const found=credMap[usedId];
    if(!found){alert('❌ No se encontró el usuario asociado a esta credencial biométrica.');return;}
    const {user,plat,platDB}=found;
    // Establecer sesión con el rol real del usuario — NO sobreescribir con admin
    db=platDB;
    window._currentPlatSK=plat.sk;
    window._currentPlatId=plat.id;
    sesion=user;
    pag=_pagPorRol(user.r);
    if(user.r==='docente'){
      try{fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'login',actor:user.n,message:'El/La docente '+user.n+' ingresó al sistema (biométrico)',meta:{u:user.u,fecha:new Date().toISOString()}})}).catch(()=>{});}catch(e){}
    }
    _sseInit();
    _checkSchemaMigrationBanner();
    render();
  }catch(e){
    if(e.name==='NotAllowedError') alert('❌ Autenticación biométrica cancelada por el usuario.');
    else alert('❌ Error en autenticación biométrica: '+e.message);
  }
}

// ── Login biométrico con usuario conocido (uso interno, desde dentro de la cuenta) ──
async function _loginBiometricoConDB(platDB,plat){
  const uInput=document.getElementById('iUser')||document.getElementById('pUser');
  const u=uInput?.value.trim()||'';
  if(!u){alert('Ingrese su usuario primero, luego use Huella / Face ID.');return null;}
  const user=(platDB.users||[]).find(x=>x.u===u);
  if(!user||!user.webAuthnId){alert('Este usuario no tiene huella/Face ID registrado.\nInicie sesión con contraseña y vaya a Mi Perfil → Registrar Huella.');return null;}
  try{
    const challenge=new Uint8Array(32);crypto.getRandomValues(challenge);
    const rawId=Uint8Array.from(atob(user.webAuthnId),c=>c.charCodeAt(0));
    await navigator.credentials.get({publicKey:{challenge,allowCredentials:[{type:'public-key',id:rawId}],userVerification:'required',timeout:60000}});
    return user;
  }catch(e){alert('❌ Autenticación biométrica fallida: '+e.message);return null;}
}

// ── MÓDULO: RECUPERACIÓN DE CONTRASEÑA GESTOR ──
function mostrarRecuperarPasswordGestor(){
  const overlay=document.createElement('div');
  overlay.id='_recGestorOverlay';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML=`<div style="background:#fff;border-radius:14px;padding:28px;max-width:420px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.35)">
    <h3 style="color:#003366;margin-bottom:4px">🔒 Recuperar Contraseña — Admin General</h3>
    <p style="font-size:0.83rem;color:#666;margin-bottom:16px">Se enviará la contraseña al correo registrado del Administrador General.</p>
    <div id="_recGestorStatus" style="margin-bottom:10px;font-size:0.82rem;min-height:20px"></div>
    <div style="display:flex;gap:8px">
      <button onclick="enviarRecuperacionGestor()" style="flex:1;background:#003366;color:#fff;border:none;padding:11px;border-radius:7px;cursor:pointer;font-weight:bold;font-size:0.9rem">📧 Enviar al Correo</button>
      <button onclick="document.getElementById('_recGestorOverlay').remove()" style="flex:1;background:#eee;border:none;padding:11px;border-radius:7px;cursor:pointer">Cancelar</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}
async function enviarRecuperacionGestor(){
  const statusEl=document.getElementById('_recGestorStatus');
  const email=gestorDB&&gestorDB.superAdmin&&gestorDB.superAdmin.email;
  if(!email){
    if(statusEl)statusEl.innerHTML='<span style="color:#c0392b">⚠️ No hay correo registrado para el Administrador General. Configure el correo en ⚙️ Config del gestor.</span>';return;
  }
  if(statusEl)statusEl.innerHTML='<span style="color:#e67e22">🔄 Enviando credenciales...</span>';
  const usuario=gestorDB.superAdmin.usuario||gestorDB.superAdmin.u||'admin';
  const password=gestorDB.superAdmin.password||gestorDB.superAdmin.p||'(ver configuración)';
  const nombre=gestorDB.superAdmin.nombre||'Administrador General';
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;background:#f0f4f8;margin:0;padding:20px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#003366,#1a5276);padding:28px;text-align:center"><h1 style="color:#fff;margin:0;font-size:1.4rem">🎓 Gestor Académico YC</h1><p style="color:#cce4ff;margin:6px 0 0;font-size:0.9rem">Recuperación de Contraseña — Admin General</p></div>
    <div style="padding:28px"><p style="color:#333;font-size:0.95rem">Hola, <b>${nombre}</b>.</p>
    <div style="background:#f0f6ff;border:1px solid #c0d8f0;border-radius:8px;padding:18px;margin:20px 0">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#666;font-size:0.85rem;width:40%">👤 Usuario:</td><td style="padding:6px 0;font-weight:bold;color:#003366;font-size:1.05rem">${usuario}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:0.85rem">🔑 Contraseña:</td><td style="padding:6px 0;font-weight:bold;color:#c0392b;font-size:1.05rem">${password}</td></tr>
        <tr><td style="padding:6px 0;color:#666;font-size:0.85rem">🎭 Rol:</td><td style="padding:6px 0;color:#555">Administrador General</td></tr>
      </table>
    </div>
    <p style="margin-top:20px;text-align:center"><a href="${location.origin}/portal.html" style="background:#003366;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:0.9rem">🚀 Ir a la Plataforma</a></p>
    </div>
    <div style="background:#f8f9fa;padding:16px;text-align:center;border-top:1px solid #eee"><p style="color:#888;font-size:0.75rem;margin:0">Gestor Académico YC · ${new Date().toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'})}</p></div>
  </div></body></html>`;
  try{
    const resp=await fetch(API_BASE+'/api/inetis/send-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:email,subject:'🔑 Recuperación de contraseña — Gestor Académico YC (Admin General)',html})});
    const data=await resp.json();
    if(resp.ok){
      if(statusEl)statusEl.innerHTML=`<div style="background:#eafaf1;border:1px solid #27ae60;border-radius:6px;padding:10px;color:#1a7531">✅ Credenciales enviadas a: <b>${email}</b></div>`;
    } else {
      if(statusEl)statusEl.innerHTML=`<div style="background:#fdecea;border:1px solid #e74c3c;border-radius:8px;padding:14px;font-size:0.85rem;color:#922b21">
        ❌ No se pudo enviar el correo. El servicio de email no está configurado en el servidor.<br>
        <small style="color:#888;margin-top:6px;display:block">Por seguridad, las credenciales solo se envían al correo registrado. Contacte al soporte técnico del sistema para habilitar el correo.</small>
      </div>`;
    }
  }catch(e){
    if(statusEl)statusEl.innerHTML=`<div style="background:#fdecea;border:1px solid #e74c3c;border-radius:8px;padding:14px;font-size:0.85rem;color:#922b21">
      ❌ Error de conexión. No fue posible enviar el correo al servidor.<br>
      <small style="color:#888;margin-top:6px;display:block">Por seguridad, las credenciales no se muestran aquí. Contacte al soporte técnico del sistema.</small>
    </div>`;
  }
}

// ── MÓDULO: RECUPERACIÓN DE CONTRASEÑA ──
function mostrarRecuperarPassword(){
  const overlay=document.createElement('div');
  overlay.id='_recPassOverlay';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML=`<div style="background:#fff;border-radius:14px;padding:28px;max-width:420px;width:92%;box-shadow:0 8px 40px rgba(0,0,0,0.35)">
    <h3 style="color:#003366;margin-bottom:4px">🔒 Recuperar Contraseña</h3>
    <p style="font-size:0.83rem;color:#666;margin-bottom:16px">Ingrese su correo electrónico. Le enviaremos un enlace/código de acceso al correo que tiene registrado.</p>
    <label style="font-size:0.82rem;font-weight:bold;color:#333">Correo electrónico registrado:</label>
    <input id="_recEmail" type="email" placeholder="docente@correo.com" style="width:100%;margin:8px 0 14px;padding:10px;border:1.5px solid #ddd;border-radius:7px;font-size:0.9rem">
    <div style="display:flex;gap:8px">
      <button onclick="enviarRecuperacion()" style="flex:1;background:#003366;color:#fff;border:none;padding:11px;border-radius:7px;cursor:pointer;font-weight:bold;font-size:0.9rem">📧 Solicitar Recuperación</button>
      <button onclick="document.getElementById('_recPassOverlay').remove()" style="flex:1;background:#eee;border:none;padding:11px;border-radius:7px;cursor:pointer">Cancelar</button>
    </div>
    <div id="_recStatus" style="margin-top:12px;font-size:0.82rem;min-height:20px"></div>
  </div>`;
  document.body.appendChild(overlay);
}
function mostrarRecuperarPasswordPortal(platId){
  mostrarRecuperarPassword();
  // Guardar el platId para búsqueda específica
  document.getElementById('_recPassOverlay').dataset.platId=platId;
}
async function _enviarCorreoRecuperacion(destinatario,nombreUsuario,usuario,password,rol,nombrePlat){
  const html=`
  <!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;background:#f0f4f8;margin:0;padding:20px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#003366,#1a5276);padding:28px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:1.4rem">🎓 Gestor Académico YC</h1>
      <p style="color:#cce4ff;margin:6px 0 0;font-size:0.9rem">Recuperación de Contraseña</p>
    </div>
    <div style="padding:28px">
      <p style="color:#333;font-size:0.95rem">Hola, <b>${nombreUsuario||usuario}</b>.</p>
      <p style="color:#555;font-size:0.9rem">Se ha solicitado la recuperación de su contraseña para la plataforma <b>${nombrePlat}</b>. A continuación encontrará sus credenciales de acceso:</p>
      <div style="background:#f0f6ff;border:1px solid #c0d8f0;border-radius:8px;padding:18px;margin:20px 0">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#666;font-size:0.85rem;width:40%">🏫 Institución:</td><td style="padding:6px 0;font-weight:bold;color:#003366">${nombrePlat}</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:0.85rem">👤 Usuario:</td><td style="padding:6px 0;font-weight:bold;color:#003366;font-size:1.05rem;letter-spacing:0.5px">${usuario}</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:0.85rem">🔑 Contraseña:</td><td style="padding:6px 0;font-weight:bold;color:#c0392b;font-size:1.05rem;letter-spacing:0.5px">${password}</td></tr>
          <tr><td style="padding:6px 0;color:#666;font-size:0.85rem">🎭 Rol:</td><td style="padding:6px 0;color:#555;text-transform:capitalize">${rol}</td></tr>
        </table>
      </div>
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px;font-size:0.82rem;color:#856404">
        ⚠️ <b>Importante:</b> Por seguridad, cambie su contraseña después de ingresar. No comparta estas credenciales con nadie.
      </div>
      <p style="margin-top:20px;text-align:center">
        <a href="${location.origin||'https://gestoracademicoyc.replit.app'}/portal.html" style="background:#003366;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:0.9rem">🚀 Ir a la Plataforma</a>
      </p>
    </div>
    <div style="background:#f8f9fa;padding:16px;text-align:center;border-top:1px solid #eee">
      <p style="color:#888;font-size:0.75rem;margin:0">Este correo fue generado automáticamente por Gestor Académico YC · ${new Date().toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'})}</p>
      <p style="color:#aaa;font-size:0.72rem;margin:4px 0 0">Si no solicitó esta recuperación, ignore este mensaje.</p>
    </div>
  </div>
  </body></html>`;
  try{
    const resp=await fetch(API_BASE+'/api/inetis/send-email',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        to:destinatario,
        subject:`🔑 Recuperación de contraseña — Gestor Académico YC (${nombrePlat})`,
        html
      })
    });
    const data=await resp.json();
    return{ok:resp.ok,data};
  }catch(e){return{ok:false,data:{error:String(e)}};}
}

async function enviarRecuperacion(){
  const email=(document.getElementById('_recEmail')?.value||'').trim();
  const statusEl=document.getElementById('_recStatus');
  if(!email||!email.includes('@')){
    if(statusEl)statusEl.innerHTML='<span style="color:#c0392b">⚠️ Ingrese un correo electrónico válido.</span>';return;
  }
  if(statusEl)statusEl.innerHTML='<span style="color:#e67e22">🔄 Buscando usuario en todas las instituciones...</span>';
  let encontrado=false;
  for(const plat of gestorDB.platforms){
    if(!plat.activa) continue;
    try{
      const platDB=await _fetchPlatDB(plat.sk);
      // ── Buscar en usuarios (docentes, admin, rector) ──
      const user=(platDB.users||[]).find(u=>u.email&&u.email.toLowerCase()===email.toLowerCase());
      if(user){
        encontrado=true;
        if(statusEl)statusEl.innerHTML='<span style="color:#e67e22">📧 Usuario encontrado. Enviando correo...</span>';
        // Notificar en el sistema
        try{
          await fetch(API_BASE+'/api/inetis/notify',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({kind:'recuperacion-password',actor:user.n||user.u,
              message:`Recuperación de contraseña enviada por email a ${email} — Usuario: ${user.u} — Institución: ${plat.nombre}`,
              meta:{email,usuario:user.u,nombre:user.n,rol:user.r,plat:plat.nombre,fecha:new Date().toISOString()}
            })
          });
        }catch(e){}
        // Enviar correo real
        const resultado=await _enviarCorreoRecuperacion(email,user.n||user.u,user.u,user.p,user.r,plat.nombre);
        if(resultado.ok){
          if(statusEl)statusEl.innerHTML=`<div style="background:#eafaf1;border:1px solid #27ae60;border-radius:6px;padding:12px;color:#1a7531">
            ✅ <b>¡Correo enviado exitosamente!</b><br>
            Revise su bandeja de entrada en <b>${email}</b>.<br>
            El correo contiene su usuario y contraseña para acceder a <b>${plat.nombre}</b>.<br>
            <small style="color:#888">Si no lo encuentra, revise la carpeta de Spam.</small>
          </div>`;
        } else {
          // Por privacidad y seguridad, NO mostrar credenciales en pantalla
          if(statusEl)statusEl.innerHTML=`<div style="background:#fff3cd;border:1px solid #f1c40f;border-radius:6px;padding:12px;color:#856404">
            ⚠️ <b>No se pudo enviar el correo automático.</b><br>
            Por favor <b>contacte al rector(a) o administrador de su institución</b> para recuperar su contraseña de acceso a <b>${plat.nombre}</b>.<br>
            <small style="color:#888">El rector(a) puede consultar sus credenciales en el módulo de Usuarios.</small>
          </div>`;
        }
        break;
      }
      // ── Buscar acudiente/estudiante ──
      const est=(platDB.ests||[]).find(e=>e.emailAcud&&e.emailAcud.toLowerCase()===email.toLowerCase());
      if(est){
        encontrado=true;
        const usuario=est.numDocAcud||est.numDoc||'(Ver con rector)';
        const pass=est.numDoc||'(Ver con rector)';
        const resultado=await _enviarCorreoRecuperacion(email,`Acudiente de ${est.nombre||est.nom||'estudiante'}`,usuario,pass,'Acudiente',plat.nombre);
        if(resultado.ok){
          if(statusEl)statusEl.innerHTML=`<div style="background:#eafaf1;border:1px solid #27ae60;border-radius:6px;padding:12px;color:#1a7531">
            ✅ <b>¡Correo enviado!</b> Revise su bandeja en <b>${email}</b>.<br>
            <small>Contiene sus credenciales de acudiente para ${plat.nombre}.</small>
          </div>`;
        } else {
          if(statusEl)statusEl.innerHTML=`<div style="background:#fff3cd;border:1px solid #f1c40f;border-radius:6px;padding:12px;color:#856404">
            ⚠️ <b>No se pudo enviar el correo automático.</b><br>
            Por favor <b>contacte al rector(a) de la institución ${plat.nombre}</b> para obtener sus credenciales de acudiente.
          </div>`;
        }
        break;
      }
    }catch(e){}
  }
  if(!encontrado&&statusEl) statusEl.innerHTML=`<div style="background:#fef0f0;border:1px solid #c0392b;border-radius:6px;padding:12px;color:#c0392b">
    ❌ <b>No se encontró ningún usuario</b> con el correo <b>${email}</b>.<br>
    <small>Verifique que sea el correo que registró en la plataforma, o contacte al rector(a) de su institución.</small>
  </div>`;
}

// ── REGISTRO BIOMÉTRICO EN PERFIL ──
// (El bloque del avatar legacy fue eliminado — funciones de voz/parpadeo/chat
//  reemplazadas por iaInjectWidget(). Solo se conservan: _agregarBotonHuellaPerfil,
//  quitarHuella, estadoPromocionEst — activamente usadas desde renderApp().)
function _agregarBotonHuellaPerfil(){
  const perfilSection=document.getElementById('_perfilHuellaZona');
  if(!perfilSection) return;
  const c=db.users.find(u=>u.u===sesion.u);
  const tieneHuella=c&&c.webAuthnId;
  perfilSection.innerHTML=`<div style="background:${tieneHuella?'#eafaf1':'#f0f4f8'};border-radius:8px;padding:12px;border:1px solid ${tieneHuella?'#27ae60':'#c0cfe0'}">
    <b style="color:${tieneHuella?'#1a7531':'#003366'}">🔑 Autenticación Biométrica</b>
    <div style="font-size:0.8rem;color:#555;margin:4px 0">${tieneHuella?'✅ Huella / Face ID registrado':'Sin huella registrada aún.'}</div>
    <button class="btn-sm" style="background:${tieneHuella?'#27ae60':'#003366'};margin-top:6px" onclick="registrarHuella()">${tieneHuella?'🔄 Re-registrar Huella':'🔑 Registrar Huella / Face ID'}</button>
    ${tieneHuella?`<button class="btn-sm" style="background:#c0392b;margin-left:6px" onclick="quitarHuella()">✕ Quitar</button>`:''}
  </div>`;
}
function quitarHuella(){
  if(!confirm('¿Quitar el registro biométrico?')) return;
  updDB(d=>{d.users=(d.users||[]).map(u=>u.u===sesion.u?{...u,webAuthnId:null,webAuthnTS:null}:u);return d;});
  alert('✅ Huella eliminada.');renderApp();
}


// ── ESTADO DE PROMOCIÓN CON CRITERIOS FLEXIBLES ──
function estadoPromocionEst(estId,grado){
  const c=db.config||{};
  const limRepro=c.limAreasReprobacion||3;
  const limAplazado=c.limAreasAplazado||2;
  const habAplazado=c.habilitaAplazado!==false;
  const areasPerd=getAreasPerdidas(estId,grado);
  const n=areasPerd.length;
  if(n>=limRepro) return{estado:'REPROBADO(A)',color:'#c0392b',icon:'❌'};
  if(habAplazado&&n>=limAplazado&&n<limRepro) return{estado:'APLAZADO(A)',color:'#e67e22',icon:'⏳'};
  if(n>0) return{estado:'APROBADO(A) C/NIVELACIÓN',color:'#e67e22',icon:'⚠️'};
  return{estado:'APROBADO(A)',color:'#27ae60',icon:'✅'};
}

// ── PRECARGAR ESCUDO DE COLOMBIA COMO BASE64 PARA PDFS ──
(function(){
  if(window._ESCUDO_COL_B64) return;
  const img=new window.Image();
  img.crossOrigin='anonymous';
  img.onload=function(){
    try{
      const c=document.createElement('canvas');
      c.width=img.naturalWidth;c.height=img.naturalHeight;
      const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      window._ESCUDO_COL_B64=c.toDataURL('image/jpeg',0.92);
    }catch(e){}
  };
  img.onerror=function(){};
  img.src='/escudo-colombia.jpg?v=1';
})();

// ============================================================
// PAZ Y SALVO — helper para colegios privados
// ============================================================
function _getPazSalvoEst(est){
  const pendientes=[];
  if(_getPlatTipo()==='privada'){
    if(!est.pensionAlDia) pendientes.push('Económico (pensión pendiente)');
    if(est.pazSalvoAcad===false) pendientes.push('Académico');
    if(est.pazSalvoDisc===false) pendientes.push('Disciplinario');
  }
  return {ok:pendientes.length===0,pendientes};
}
function abrirPazSalvoModal(estId){
  estId=String(estId);
  const est=db.ests.find(x=>String(x.id)===estId);if(!est) return;
  const ov=document.createElement('div');
  ov.id='_pzOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;padding:26px;max-width:380px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
    <h3 style="color:#003366;margin-bottom:16px">⚖️ Paz y Salvo — ${fmtNombreEst(est)}</h3>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px;background:#f8f8f8;border-radius:8px;border:1.5px solid #ddd">
        <input type="checkbox" id="_pzEcon" ${est.pensionAlDia?'checked':''} style="width:18px;height:18px">
        <div><b>✅ Económico</b><br><small style="color:#666">Pensión / matrícula al día</small></div>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px;background:#f8f8f8;border-radius:8px;border:1.5px solid #ddd">
        <input type="checkbox" id="_pzAcad" ${est.pazSalvoAcad!==false?'checked':''} style="width:18px;height:18px">
        <div><b>📚 Académico</b><br><small style="color:#666">Sin deudas académicas / recuperaciones pendientes</small></div>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px;background:#f8f8f8;border-radius:8px;border:1.5px solid #ddd">
        <input type="checkbox" id="_pzDisc" ${est.pazSalvoDisc!==false?'checked':''} style="width:18px;height:18px">
        <div><b>🤝 Disciplinario</b><br><small style="color:#666">Sin sanciones disciplinarias activas</small></div>
      </label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="document.getElementById('_pzOv').remove()" style="background:#eee;border:none;border-radius:7px;padding:10px 18px;cursor:pointer">Cancelar</button>
      <button onclick="_guardarPazSalvo('${estId}')" style="background:#003366;color:#fff;border:none;border-radius:7px;padding:10px 22px;cursor:pointer;font-weight:bold">💾 Guardar</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function _guardarPazSalvo(estId){
  estId=String(estId);
  const econ=document.getElementById('_pzEcon')?.checked;
  const acad=document.getElementById('_pzAcad')?.checked;
  const disc=document.getElementById('_pzDisc')?.checked;
  updDB(db=>{const e=db.ests.find(x=>String(x.id)===estId);if(e){e.pensionAlDia=!!econ;e.pazSalvoAcad=!!acad;e.pazSalvoDisc=!!disc;}return db;});
  document.getElementById('_pzOv')?.remove();
  renderEstTabla();
}
function solicitarCertificadoEmail(estId){
  estId=String(estId);
  const est=db.ests.find(x=>String(x.id)===estId);if(!est) return;
  const email=db.emailInst||'';
  if(!email){alert('La institución no tiene correo registrado. Contáctela directamente.');return;}
  const nombre=fmtNombreEst(est);
  const subject=encodeURIComponent(`Solicitud de certificado — ${nombre}`);
  const body=encodeURIComponent(`Estimados,\n\nSolicito certificado de estudios para el/la estudiante:\nNombre: ${nombre}\nGrado: ${est.g}\n\nQuedo atento/a.\n\nSaludos.`);
  window.open(`mailto:${email}?subject=${subject}&body=${body}`,'_blank');
}
function solicitarCertificadoWsp(estId){
  estId=String(estId);
  const est=db.ests.find(x=>String(x.id)===estId);if(!est) return;
  const tel=(db.telInst||'').replace(/\D/g,'');
  if(!tel){alert('La institución no tiene teléfono registrado. Contáctela directamente.');return;}
  const nombre=fmtNombreEst(est);
  const msg=encodeURIComponent(`Hola, solicito certificado de estudios para:\nNombre: ${nombre}\nGrado: ${est.g}\n\nQuedo atento/a. Gracias.`);
  window.open(`https://wa.me/57${tel}?text=${msg}`,'_blank');
}

// ============================================================
// ACTIVIDADES — vista estudiante
// ============================================================
function htmlActividadesEstudiante(est){
  const acts=(db.actividades||[]).filter(a=>a.grado===est.g&&a.activa!==false);
  if(!acts.length) return '<p class="empty">No hay actividades asignadas por el docente.</p>';
  const now=new Date();
  // Agrupar por período
  const grupos={};
  acts.forEach(a=>{const p=a.periodo||0;if(!grupos[p]) grupos[p]=[];grupos[p].push(a);});
  return Object.keys(grupos).sort((a,b)=>Number(a)-Number(b)).map(per=>{
    const perActs=grupos[per];
    const perLabel=Number(per)>0?`Período ${per}`:'Sin período';
    const totalActs=perActs.length;
    const entregadasPer=perActs.filter(a=>(db.actEntregas||[]).find(x=>String(x.actId)===String(a.id)&&String(x.estId)===String(est.id))).length;
    const califPer=perActs.filter(a=>{const e=(db.actEntregas||[]).find(x=>String(x.actId)===String(a.id)&&String(x.estId)===String(est.id));return e&&e.notaObtenida!=null;}).length;
    const pctEnt=totalActs>0?Math.round(entregadasPer/totalActs*100):0;
    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
        <b style="color:#003366;font-size:0.88rem">📅 ${perLabel}</b>
        <span style="font-size:0.75rem;color:#555">${entregadasPer}/${totalActs} entregadas · ${califPer} calificadas</span>
      </div>
      <div style="background:#e0e0e0;border-radius:5px;height:7px;margin-bottom:8px;overflow:hidden">
        <div style="background:#27ae60;height:100%;width:${pctEnt}%;border-radius:5px;transition:width 0.4s"></div>
      </div>
      ${perActs.map(a=>{
        const entrega=(db.actEntregas||[]).find(e=>String(e.actId)===String(a.id)&&String(e.estId)===String(est.id));
        const vencida=a.fechaLimite&&new Date(a.fechaLimite)<now;
        const nota=entrega?.notaObtenida;
        const estadoColor=nota!=null?(nota>=3?'#27ae60':'#c0392b'):entrega?'#2980b9':(vencida?'#c0392b':'#e67e22');
        const _escMax=db.config?.escalaS||5.0;const _escB=db.config?.escalaB||3.0;
        const estadoText=nota!=null?`${nota}/${_escMax.toFixed(1)} ${nota>=_escB?'✅':'⚠️'} ${esc(nota)}`:(entrega?'✅ Entregada':(vencida?'⛔ Vencida':'📋 Pendiente'));
        return `<div style="border:1.5px solid #ddd;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fafafa">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:6px">
            <div>
              <b>${a.titulo}</b> <span style="font-size:0.8rem;color:#888">· ${a.asignatura||'—'}</span>
              ${a.fechaLimite?`<span style="font-size:0.78rem;color:${vencida?'#c0392b':'#555'}"> · Límite: ${a.fechaLimite}</span>`:''}
              ${a.penalizacion?`<span style="font-size:0.74rem;color:#e67e22"> · Penal: ${a.penalizacion}%/día</span>`:''}
            </div>
            <span style="background:${estadoColor};color:#fff;border-radius:12px;padding:2px 10px;font-size:0.75rem;font-weight:bold;white-space:nowrap">${estadoText}</span>
          </div>
          ${nota!=null?`<div style="margin-top:6px"><div style="background:#e0e0e0;border-radius:4px;height:5px;overflow:hidden"><div style="background:${nota>=_escB?'#27ae60':'#c0392b'};height:100%;width:${Math.min(100,Math.round((nota/_escMax)*100))}%;transition:width 0.4s;border-radius:4px"></div></div></div>`:''}
          ${a.desc?`<p style="font-size:0.84rem;color:#555;margin:6px 0 4px">${a.desc}</p>`:''}
          ${entrega?.observaciones?`<div style="font-size:0.8rem;background:#e8f8f5;border-radius:6px;padding:6px 10px;margin-top:4px"><b>Obs. docente:</b> ${entrega.observaciones}</div>`:''}
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
            ${a.archivoB64?`<button onclick="_descargarArchivoAct('${a.id}')" class="btn" style="background:#2980b9;color:#fff;font-size:0.78rem;padding:5px 12px">📥 ${(a.archivoNombre||'Archivo').substring(0,22)}</button>`:''}
            ${a.driveLink?`<a href="${a.driveLink}" target="_blank" class="btn" style="background:#1e8449;color:#fff;font-size:0.78rem;padding:5px 12px">📁 Drive</a>`:''}
            ${(()=>{
              const esInteractiva=a.tipo==='interactiva'&&(a.preguntas||[]).length;
              const maxIntentos=a.intentos||1;
              const intentosRealizados=entrega?.intentosRealizados||0;
              const puedeReintentar=!vencida&&intentosRealizados<maxIntentos;
              if(esInteractiva){
                return `
                  ${nota!=null?'':puedeReintentar
                    ?`<button onclick="_iniciarActividadInteractiva('${a.id}','${est.id}')" class="btn" style="background:#d35400;color:#fff;font-size:0.8rem;padding:6px 14px">🎮 ${intentosRealizados>0?'Reintentar actividad':'Responder actividad'}</button>`
                    :`<span style="font-size:0.78rem;color:#27ae60;font-weight:bold">✅ Intentos completados (${intentosRealizados}/${maxIntentos})</span>`}
                  ${intentosRealizados>0?`<span style="font-size:0.75rem;color:#555;background:#f0f0f0;border-radius:8px;padding:2px 8px">Intento ${intentosRealizados}/${maxIntentos}</span>`:''}
                  ${entrega?.archivoB64?`<button onclick="_descargarArchivoEntrega('${a.id}','${est.id}')" class="btn" style="background:#27ae60;color:#fff;font-size:0.78rem;padding:5px 12px">📥 Mi archivo</button>`:''}
                `;
              } else {
                return entrega?`
                  <button onclick="abrirEntregaEst('${a.id}','${est.id}')" class="btn btn-navy" style="font-size:0.78rem;padding:5px 12px">✏️ Editar entrega</button>
                  ${entrega.archivoB64?`<button onclick="_descargarArchivoEntrega('${a.id}','${est.id}')" class="btn" style="background:#27ae60;color:#fff;font-size:0.78rem;padding:5px 12px">📥 Mi archivo</button>`:''}
                  ${nota==null?`<button onclick="_eliminarEntregaEst('${a.id}','${est.id}')" class="btn" style="background:#c0392b;color:#fff;font-size:0.78rem;padding:5px 12px">🗑 Eliminar entrega</button>`:''}
                `:(!vencida
                  ?`<button onclick="abrirEntregaEst('${a.id}','${est.id}')" class="btn" style="background:#27ae60;color:#fff;font-size:0.8rem;padding:6px 14px">📬 Enviar entrega</button>`
                  :`<span style="font-size:0.78rem;color:#c0392b;font-weight:bold">⛔ Vencida</span>`);
              }
            })()}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}
function _marcarEntregaEst(actId,estId){
  const act=(db.actividades||[]).find(a=>a.id===actId);if(!act) return;
  if(act.driveLink){window.open(act.driveLink,'_blank');}
  updDB(db=>{
    if(!Array.isArray(db.actEntregas)) db.actEntregas=[];
    const idx=db.actEntregas.findIndex(e=>e.actId===actId&&e.estId===estId);
    const obj={id:Date.now()+Math.random(),actId,estId,estado:'entregada',fechaEntrega:new Date().toISOString().slice(0,10)};
    if(idx===-1) db.actEntregas.push(obj); else db.actEntregas[idx]={...db.actEntregas[idx],...obj};
    return db;
  });
  renderApp();
}

// ============================================================
// QUIZZES — vista estudiante (temporizador ICFES)
// ============================================================
function htmlQuizzesEstudiante(est){
  const evals=(db.evaluaciones||[]).filter(e=>e.activa&&(e.grado===est.g||!e.grado));
  if(!evals.length) return '<p class="empty">No hay evaluaciones/quizzes activos.</p>';
  const now=new Date();
  return evals.map(ev=>{
    const misResp=(db.evalRespuestas||[]).filter(r=>r.evalId===ev.id&&r.estId===est.id);
    const intentosUsados=misResp.length;
    const maxIntentos=ev.intentos||1;
    const vencido=ev.fechaLimite&&new Date(ev.fechaLimite)<now;
    const ultimaResp=misResp.sort((a,b)=>b.intento-a.intento)[0];
    const puedeResponder=!vencido&&intentosUsados<maxIntentos;
    return `<div style="border:1.5px solid #9b59b6;border-radius:8px;padding:12px;margin-bottom:10px;background:#fdf9ff">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
        <div>
          <b style="color:#8e44ad">${ev.titulo}</b> <span style="font-size:0.8rem;color:#888">· ${ev.asignatura||'—'}</span><br>
          <span style="font-size:0.78rem;color:#555">${(ev.preguntas||[]).length} preguntas · ${ev.tiempoMin||30} min · Intentos: ${intentosUsados}/${maxIntentos}</span>
          ${ev.fechaLimite?`<span style="font-size:0.75rem;color:${vencido?'#c0392b':'#27ae60'}"> · Límite: ${ev.fechaLimite}</span>`:''}
        </div>
        ${ultimaResp!=null?`<span style="background:#8e44ad;color:#fff;border-radius:12px;padding:2px 10px;font-size:0.75rem;font-weight:bold">Nota: ${ultimaResp.notaEscala!=null?ultimaResp.notaEscala+'/'+(db.config?.escalaS||5.0).toFixed(1)+' '+esc(ultimaResp.notaEscala):ultimaResp.puntaje!=null?(()=>{const _n=parseFloat((ultimaResp.puntaje/100*(db.config?.escalaS||5.0)).toFixed(1));return _n+'/'+(db.config?.escalaS||5.0).toFixed(1)+' '+esc(_n);})():'—'}</span>`:''}
      </div>
      ${puedeResponder?`<button class="btn" style="background:#8e44ad;color:#fff;margin-top:8px;font-size:0.82rem" onclick="iniciarQuizEstudiante('${ev.id}','${est.id}')">🧩 ${intentosUsados>0?'Volver a intentar':'Iniciar Quiz'}</button>`:`<p style="font-size:0.8rem;color:${vencido?'#c0392b':'#888'};margin-top:6px">${vencido?'⛔ Quiz vencido.':'✅ Intentos agotados.'}</p>`}
    </div>`;
  }).join('');
}
function iniciarQuizEstudiante(evalId,estId){
  const ev=(db.evaluaciones||[]).find(x=>x.id===evalId);if(!ev||!ev.preguntas?.length){alert('Quiz no disponible.');return;}
  const est=db.ests.find(x=>x.id==estId);if(!est) return;
  const intento=((db.evalRespuestas||[]).filter(r=>r.evalId===evalId&&r.estId===estId).length)+1;
  const tiempoSeg=(ev.tiempoMin||30)*60;
  let respuestas={};let pregIdx=0;let timerRef;let tiempoRestante=tiempoSeg;
  const ov=document.createElement('div');ov.id='_quizOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:20000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  document.body.appendChild(ov);
  function renderQ(){
    const p=ev.preguntas[pregIdx];
    const total=ev.preguntas.length;
    const minR=String(Math.floor(tiempoRestante/60)).padStart(2,'0');
    const segR=String(tiempoRestante%60).padStart(2,'0');
    const esUltima=pregIdx===total-1;
    let optsHtml='';
    if(p.tipo==='seleccion'||!p.tipo){
      optsHtml=(p.opts||[]).map((o,oi)=>`<label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:10px;border:2px solid ${respuestas[pregIdx]===oi?'#8e44ad':'#ddd'};background:${respuestas[pregIdx]===oi?'#f5e6ff':'#fafafa'};cursor:pointer;margin-bottom:8px;transition:all 0.15s;width:100%;box-sizing:border-box;word-break:break-word">
        <input type="radio" name="q_opt" value="${oi}" ${respuestas[pregIdx]===oi?'checked':''} onchange="window._qrSet(${oi})" style="width:18px;height:18px;margin-top:1px;accent-color:#8e44ad;flex-shrink:0">
        <span style="flex:1;min-width:0;font-size:0.92rem;line-height:1.4"><b style="color:#8e44ad;margin-right:4px">${['A','B','C','D','E'][oi]||oi+1}.</b>${o}</span>
      </label>`).join('');
    } else if(p.tipo==='verdadero_falso'){
      optsHtml=['Verdadero','Falso'].map((o,oi)=>`<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:2px solid ${respuestas[pregIdx]===oi?'#8e44ad':'#ddd'};background:${respuestas[pregIdx]===oi?'#f5e6ff':'#fafafa'};cursor:pointer;margin-bottom:6px">
        <input type="radio" name="q_opt" value="${oi}" ${respuestas[pregIdx]===oi?'checked':''} onchange="window._qrSet(${oi})" style="accent-color:#8e44ad">
        <span>${o}</span>
      </label>`).join('');
    } else {
      optsHtml=`<div style="background:#f0e6ff;border-radius:10px;padding:14px">
        <label style="display:block;font-size:0.82rem;font-weight:700;color:#6c3483;margin-bottom:8px">✏️ Escribe tu respuesta:</label>
        <textarea id="q_texto" placeholder="Escribe tu respuesta aquí..." style="width:100%;min-height:120px;max-height:300px;padding:12px;border:2px solid #c39bd3;border-radius:8px;font-size:0.95rem;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5;color:#222;background:#fff" oninput="window._qrSetTexto()">${respuestas[pregIdx]||''}</textarea>
        <p style="font-size:0.78rem;color:#888;margin:6px 0 0">Tu respuesta se guarda automáticamente al escribir. Haz clic en <b>Siguiente</b> o <b>Finalizar</b> cuando termines.</p>
      </div>`;
    }
    ov.innerHTML=`<div style="background:#fff;border-radius:16px;padding:26px;max-width:620px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.4)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:0.85rem;color:#888">📋 ${ev.titulo} · ${fmtNombreEst(est)}</div>
          <div style="font-size:0.9rem;font-weight:bold;color:#8e44ad">Pregunta ${pregIdx+1} de ${total}</div>
        </div>
        <div style="background:${tiempoRestante<120?'#c0392b':'#8e44ad'};color:#fff;border-radius:10px;padding:6px 14px;font-size:1.1rem;font-weight:bold;font-family:monospace" id="_qTimer">${minR}:${segR}</div>
      </div>
      <div style="background:#f0e6ff;border-radius:10px;padding:14px;margin-bottom:14px;font-size:0.95rem;line-height:1.5">
        <b>${pregIdx+1}.</b> ${p.p}
      </div>
      <div id="q_opts">${optsHtml}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:8px">
        <div style="font-size:0.8rem;color:#888">Respondidas: ${Object.keys(respuestas).length}/${total}</div>
        <div class="flex-gap">
          ${pregIdx>0?`<button class="btn" style="background:#eee;color:#333" onclick="window._qNav(-1)">← Anterior</button>`:''}
          ${!esUltima?`<button class="btn" style="background:#8e44ad;color:#fff" onclick="window._qNav(1)">Siguiente →</button>`:''}
          <button class="btn btn-green" onclick="window._qFin()" style="font-weight:bold">${esUltima?'✅ Finalizar':'⏩ Finalizar ya'}</button>
        </div>
      </div>
    </div>`;
  }
  window._qrSet=function(val){respuestas[pregIdx]=val;renderQ();}
  window._qrSetTexto=function(){const el=document.getElementById('q_texto');if(el) respuestas[pregIdx]=el.value;}
  window._qNav=function(d){pregIdx=Math.max(0,Math.min(ev.preguntas.length-1,pregIdx+d));renderQ();}
  window._qFin=function(){
    clearInterval(timerRef);
    let correctas=0;
    const calificables=ev.preguntas.filter(p=>p.resp!=null);
    ev.preguntas.forEach((p,i)=>{if(p.resp!=null&&respuestas[i]==p.resp) correctas++;});
    const puntaje=calificables.length>0?Math.round((correctas/calificables.length)*100):null;
    const _qzEscMax=db.config?.escalaS||5;const _qzEscB=db.config?.escalaB||3;
    const notaEscala=puntaje!=null?Math.round((puntaje/100)*_qzEscMax*10)/10:null;
    updDB(db2=>{
      if(!Array.isArray(db2.evalRespuestas)) db2.evalRespuestas=[];
      db2.evalRespuestas.push({id:Date.now()+Math.random(),evalId,estId,respuestas,intento,fechaFin:new Date().toISOString(),puntaje,notaEscala});
      return db2;
    });
    const _revHtml=ev.preguntas.map((p,i)=>{
      const tieneResp=p.resp!=null&&p.tipo!=='texto';
      const estResp=respuestas[i];
      const correcto=tieneResp&&estResp===p.resp;
      const noRespond=estResp===undefined||estResp===null;
      let respLabel='Sin responder';
      if(!noRespond){
        if(p.tipo==='verdadero_falso') respLabel=['Verdadero','Falso'][estResp]||String(estResp);
        else if(p.tipo==='seleccion') respLabel=((['A','B','C','D'][estResp]||String(estResp+1))+'. '+(p.opts?.[estResp]||''));
        else respLabel=String(estResp).substring(0,80)+(String(estResp).length>80?'…':'');
      }
      let corrLabel='';
      if(tieneResp){
        if(p.tipo==='verdadero_falso') corrLabel=['Verdadero','Falso'][p.resp]||String(p.resp);
        else if(p.tipo==='seleccion') corrLabel=((['A','B','C','D'][p.resp]||String(p.resp+1))+'. '+(p.opts?.[p.resp]||''));
      }
      const bgColor=noRespond?'#f8f8f8':correcto?'#eafaf1':'#fdf2f2';
      const bColor=noRespond?'#ddd':correcto?'#27ae60':'#e74c3c';
      const icon=noRespond?'⬜':correcto?'✅':'❌';
      return `<div style="border:2px solid ${bColor};border-radius:10px;padding:12px 14px;margin-bottom:10px;background:${bgColor};text-align:left">
        <div style="font-size:0.88rem;font-weight:bold;color:#333;margin-bottom:6px">${icon} ${i+1}. ${p.p}</div>
        ${tieneResp?`<div style="font-size:0.82rem;margin-bottom:3px;color:${correcto?'#27ae60':'#c0392b'}"><b>Tu respuesta:</b> ${noRespond?'(sin responder)':respLabel}</div>
        ${!correcto?`<div style="font-size:0.82rem;margin-bottom:3px;color:#27ae60"><b>Respuesta correcta:</b> ${corrLabel}</div>`:''}`:
        `<div style="font-size:0.8rem;color:#888">Respuesta abierta — revisada por el docente.</div>`}
        ${p.just?`<div style="background:#fffbf0;border:1.5px solid #f0c080;border-radius:7px;padding:8px 10px;margin-top:7px;font-size:0.82rem;color:#555"><b>💡 Retroalimentación:</b> ${p.just}</div>`:''}
      </div>`;
    }).join('');
    ov.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px;max-width:580px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.4)">
      <div style="text-align:center;margin-bottom:18px">
        <div style="font-size:2.5rem;margin-bottom:6px">🎉</div>
        <h3 style="color:#8e44ad;margin:0 0 4px">¡Quiz completado!</h3>
        ${notaEscala!=null?`<div style="font-size:2.2rem;font-weight:bold;color:${notaEscala>=_qzEscB?'#27ae60':'#c0392b'};margin:8px 0">${notaEscala}<span style="font-size:1rem">/${_qzEscMax.toFixed(1)}</span></div><div style="font-size:0.8rem;color:#888">${esc(notaEscala)} · ${correctas}/${calificables.length} correctas (${puntaje}%)</div>`:'<p style="color:#888;margin:4px 0">Respuestas enviadas al docente.</p>'}
      </div>
      <h4 style="color:#333;font-size:0.92rem;margin:0 0 10px;border-bottom:1px solid #eee;padding-bottom:6px">📋 Revisión de respuestas</h4>
      ${_revHtml}
      <div style="text-align:center;margin-top:16px">
        <button class="btn btn-navy" onclick="document.getElementById('_quizOv').remove();renderApp();" style="padding:10px 28px">Cerrar</button>
      </div>
    </div>`;
  }
  timerRef=setInterval(()=>{
    tiempoRestante--;
    const el=document.getElementById('_qTimer');
    if(el){const m=String(Math.floor(tiempoRestante/60)).padStart(2,'0');const s=String(tiempoRestante%60).padStart(2,'0');el.textContent=m+':'+s;el.style.background=tiempoRestante<120?'#c0392b':'#8e44ad';}
    if(tiempoRestante<=0){clearInterval(timerRef);window._qFin();}
  },1000);
  renderQ();
}

// ============================================================
// EVALUACIÓN DOCENTE — vista estudiante (anónima)
// ============================================================
function htmlEvalDocenteEstudiante(est){
  const evals=(db.evalDocente||[]).filter(ev=>ev.activa&&(ev.cursos||[]).includes(est.g));
  if(!evals.length) return '';
  const yaRespond=evals.filter(ev=>(ev.resp||[]).some(r=>r.curso===est.g));
  const pendientes=evals.filter(ev=>!(ev.resp||[]).some(r=>r.curso===est.g&&r.estRef&&r.estRef===String(est.id).slice(-4)));
  if(!pendientes.length) return `<div class="card" style="border-left:4px solid #f39c12"><h4 class="card-title">⭐ Evaluación Docentes</h4><p class="empty">Ya respondiste la evaluación de tus docentes. ¡Gracias!</p></div>`;
  return `<div class="card" style="border-left:4px solid #f39c12">
    <h4 class="card-title">⭐ Evaluación Docentes</h4>
    <div class="info-box">Esta evaluación es completamente anónima. Tus respuestas no llevan tu nombre ni datos personales.</div>
    ${pendientes.map(ev=>`<div style="border:1.5px solid #f39c12;border-radius:8px;padding:14px;margin-bottom:10px">
      <b>${ev.titulo}</b>
      <div id="_evdResp_${ev.id}" style="margin-top:10px">${(ev.preguntas||[]).map((p,pi)=>`<div style="margin-bottom:10px">
        <div style="font-size:0.88rem;font-weight:bold;margin-bottom:4px">${pi+1}. ${p.p}</div>
        ${p.tipo==='escala5'?`<div style="display:flex;gap:6px;flex-wrap:wrap">${[1,2,3,4,5].map(v=>`<label style="cursor:pointer;padding:5px 12px;border-radius:6px;border:1.5px solid #f39c12;background:#fffbf0;font-size:0.85rem"><input type="radio" name="evd_${ev.id}_${pi}" value="${v}" style="accent-color:#f39c12"> ${v}⭐</label>`).join('')}</div>`:''}
        ${p.tipo==='texto'?`<textarea placeholder="Escribe tu respuesta aquí..." style="width:100%;min-height:100px;max-height:250px;padding:10px 12px;border:2px solid #f39c12;border-radius:8px;font-size:0.9rem;font-family:inherit;resize:vertical;box-sizing:border-box;line-height:1.5;color:#222;background:#fff" id="evd_txt_${ev.id}_${pi}"></textarea>`:''}
        ${(!p.tipo||p.tipo==='seleccion')?`<div style="display:flex;flex-direction:column;gap:6px">${(p.opts||[]).map((o,oi)=>`<label style="cursor:pointer;padding:10px 14px;border-radius:8px;border:2px solid #f0d060;background:#fffbf0;font-size:0.88rem;display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box;word-break:break-word"><input type="radio" name="evd_${ev.id}_${pi}" value="${oi}" style="accent-color:#f39c12;flex-shrink:0;margin-top:2px"> <span style="flex:1;min-width:0"><b style="color:#d35400;margin-right:4px">${['A','B','C','D'][oi]||oi+1}.</b>${o}</span></label>`).join('')}</div>`:''}
      </div>`).join('')}
      <button class="btn" style="background:#f39c12;color:#fff" onclick="enviarEvalDocente('${ev.id}','${est.id}','${est.g}')">📤 Enviar Evaluación (anónima)</button>
    </div>`).join('')}
  </div>`;
}
function enviarEvalDocente(evalId,estId,grado){
  const ev=(db.evalDocente||[]).find(x=>x.id===evalId);if(!ev) return;
  const preguntas=ev.preguntas||[];
  const resps=preguntas.map((p,pi)=>{
    if(p.tipo==='texto'){return document.getElementById(`evd_txt_${evalId}_${pi}`)?.value||'';}
    const sel=document.querySelector(`input[name="evd_${evalId}_${pi}"]:checked`);
    return sel?sel.value:null;
  });
  if(resps.some(r=>r==null)){alert('Por favor responde todas las preguntas.');return;}
  // Se guarda con un ref parcial del ID (últimos 4 dígitos) para evitar repetición pero sin nombre
  const estRef=String(estId).slice(-4);
  updDB(db2=>{
    const evx=db2.evalDocente.find(x=>x.id===evalId);
    if(evx){if(!Array.isArray(evx.resp)) evx.resp=[];evx.resp.push({curso:grado,estRef,resps,fecha:new Date().toISOString().slice(0,10)});}
    return db2;
  });
  alert('✅ ¡Gracias! Tu evaluación ha sido enviada de forma anónima.');
  renderApp();
}

// ============================================================
// DOCENTE — MÓDULO ACTIVIDADES
// ============================================================
// ── S09.I  Actividades Docente y Quizzes / Evaluaciones ──────
function htmlDocenteActividades(){
  const isDocente=sesion.r==='docente';
  const gradosDoc=isDocente?gradosDelDocente(sesion.u):db.grados.map(g=>g.n);
  const asigs=isDocente?[...new Set((db.carga||[]).filter(c=>c.d===sesion.u).map(c=>c.m))].filter(Boolean):(db.carga||[]).map(c=>c.m).filter((v,i,a)=>a.indexOf(v)===i);
  const numPer=_getNumPer();
  const perOpts=Array.from({length:numPer},(_,i)=>`<option value="${i+1}">Período ${i+1}</option>`).join('');
  const filtPer=window._actFiltPer||'';
  const filtAsig=window._actFiltAsig||'';
  const filtGrado=window._actFiltGrado||'';
  let acts=(db.actividades||[]).filter(a=>isDocente?gradosDoc.includes(a.grado):true);
  if(filtPer) acts=acts.filter(a=>String(a.periodo)===String(filtPer));
  if(filtAsig) acts=acts.filter(a=>a.asignatura===filtAsig);
  if(filtGrado) acts=acts.filter(a=>a.grado===filtGrado);
  acts=acts.sort((a,b)=>new Date(b.fechaCreacion||0)-new Date(a.fechaCreacion||0));
  const perOptsFilt=Array.from({length:numPer},(_,i)=>`<option value="${i+1}"${String(filtPer)===String(i+1)?' selected':''}>Período ${i+1}</option>`).join('');
  return `<h3 class="sec-title">📝 Módulo de Actividades</h3>

  <!-- ═══ LECCIONARIO DIGITAL ═══ -->
  <div class="card" style="border-left:4px solid #2980b9;background:linear-gradient(160deg,#f0f7ff 0%,#fff 60%)">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <h4 class="card-title" style="margin:0;color:#1a5276">📖 Leccionario Digital / Planificador de Aula</h4>
      <button onclick="_abrirPlanificadorAdan()" style="background:linear-gradient(135deg,#1a5276,#2980b9);color:#fff;border:none;border-radius:7px;padding:8px 15px;font-size:0.82rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(41,128,185,0.3)">✨ Planificar con Adán</button>
    </div>
    <div class="grid3" style="gap:8px;margin-bottom:8px">
      <div><label class="lbl">Fecha *</label><input type="date" id="lecFecha" value="${new Date().toISOString().slice(0,10)}"></div>
      <div><label class="lbl">Asignatura *</label><select id="lecAsig"><option value="">— Seleccione —</option>${asigs.map(a=>`<option value="${a}">${a}</option>`).join('')}</select></div>
      <div><label class="lbl">Grado *</label><select id="lecGrado"><option value="">— Seleccione —</option>${gradosDoc.map(g=>`<option>${g}</option>`).join('')}</select></div>
    </div>
    <div style="margin-bottom:8px"><label class="lbl">Tema / Logro Dictado *</label><input id="lecTema" placeholder="Ej: Fracciones equivalentes, Revolución Industrial, Célula eucariota..."></div>
    <div style="margin-bottom:12px"><label class="lbl">Observaciones del Día</label><textarea id="lecObs" style="min-height:62px;resize:vertical" placeholder="Participación, compromisos asignados, dificultades, notas del docente..."></textarea></div>
    <button class="btn" style="background:#1a5276;color:#fff;font-weight:700" onclick="guardarLeccion()">💾 Registrar en Leccionario</button>
    ${(()=>{
      const isDocente2=sesion.r==='docente';
      let lecs=(db.leccionario||[]).filter(l=>isDocente2?l.docente===sesion.u:true).sort((a,b)=>new Date(b.fecha||0)-new Date(a.fecha||0));
      if(!lecs.length) return '<p class="empty" style="margin-top:14px">Sin registros en el leccionario aún. ¡Registre su primera clase!</p>';
      return `<div class="over" style="margin-top:14px"><table><thead><tr><th>Fecha</th><th>Asignatura</th><th>Grado</th><th style="min-width:160px;text-align:left">Tema</th><th style="min-width:130px;text-align:left">Observaciones</th>${!isDocente2?'<th>Docente</th>':''}<th></th></tr></thead><tbody>${lecs.map(l=>`<tr><td style="white-space:nowrap">${l.fecha||''}</td><td>${l.asignatura||''}</td><td>${l.grado||''}</td><td style="text-align:left">${l.tema||''}</td><td style="text-align:left;max-width:180px;word-break:break-word;white-space:pre-wrap">${l.observaciones||'—'}</td>${!isDocente2?`<td>${l.docente||''}</td>`:''}<td><button class="btn-sm" style="background:#c0392b" onclick="eliminarLeccion('${l.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>`;
    })()}
  </div>

  <!-- ═══ PLANEACIONES TERMINADAS ═══ -->
  ${(()=>{
    const planes=(db.planeacionesIA||[]).filter(p=>isDocente?p.docente===sesion.u||!p.docente:true);
    return `<div class="card" style="border-left:4px solid #8e44ad;background:linear-gradient(160deg,#fdf2ff 0%,#fff 60%)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <h4 class="card-title" style="margin:0;color:#6c3483">📋 Planeaciones Terminadas</h4>
        <span style="font-size:0.78rem;color:#8e44ad;font-weight:600">${planes.length} planeación${planes.length!==1?'es':''} guardada${planes.length!==1?'s':''}</span>
      </div>
      ${!planes.length?`<p class="empty">Sin planeaciones guardadas aún.<br><span style="font-size:0.82rem;color:#a0a0a0">Use el botón <b>✨ Planificar con Adán</b> y luego <b>💾 Guardar planeación</b> en el chat del asistente.</span></p>`
      :`<div style="display:flex;flex-direction:column;gap:10px">${planes.map(p=>`
        <div style="border:1.5px solid #d2b4de;border-radius:10px;padding:13px 14px;background:#faf0fe;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;color:#5b2a86;font-size:0.92rem;margin-bottom:3px">${p.titulo}</div>
            <div style="font-size:0.77rem;color:#888">📅 ${p.fecha||'—'} · 👤 ${p.docente||'—'}${p.editado?` · ✏️ Editada: ${p.editado}`:''}
              <br>${p.asignatura?' 📚 '+p.asignatura:''} ${p.grado?' 🎓 '+p.grado:''}${p.tema?' · '+p.tema.slice(0,60)+(p.tema.length>60?'...':''):''}
            </div>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;flex-shrink:0">
            <button class="btn-sm" style="background:#8e44ad;white-space:nowrap" onclick="_verPlaneacionIA('${p.id}')">👁 Ver</button>
            <button class="btn-sm" style="background:#c0392b;white-space:nowrap" onclick="_descargarPlaneIAGuardadaPDF('${p.id}')">📄 PDF</button>
            <button class="btn-sm" style="background:#1a5276;white-space:nowrap" onclick="_descargarPlaneIAGuardadaWord('${p.id}')">📝 Word</button>
            <button class="btn-sm" style="background:#e67e22;white-space:nowrap" onclick="_editarPlaneacionIA('${p.id}')">✏️ Editar</button>
            <button class="btn-sm" style="background:#c0392b;white-space:nowrap" onclick="_eliminarPlaneacionIA('${p.id}')">🗑</button>
          </div>
        </div>`).join('')}
      </div>`}
    </div>`;
  })()}

  <div class="card" style="border-left:4px solid #27ae60">
    <h4 class="card-title">➕ Nueva Actividad</h4>
    <div class="grid2" style="gap:8px;margin-bottom:10px">
      <div><label class="lbl">Título *</label><input id="actTitulo" placeholder="Ej: Taller de fracciones"></div>
      <div><label class="lbl">Asignatura *</label><select id="actAsig"><option value="">— Seleccione —</option>${asigs.map(a=>`<option value="${a}">${a}</option>`).join('')}</select></div>
      <div><label class="lbl">Grado *</label><select id="actGrado"><option value="">— Seleccione —</option>${gradosDoc.map(g=>`<option>${g}</option>`).join('')}</select></div>
      <div><label class="lbl">Período *</label><select id="actPeriodo"><option value="">— Seleccione —</option>${perOpts}</select></div>
      <div><label class="lbl">Tipo</label><select id="actTipo" onchange="document.getElementById('actInteractivaWrap').style.display=this.value==='interactiva'?'':'none'">
        <option value="taller">📝 Taller</option>
        <option value="tarea">📚 Tarea</option>
        <option value="proyecto">🎯 Proyecto</option>
        <option value="exposicion">🎤 Exposición</option>
        <option value="interactiva">🎮 Interactiva (auto-calificable)</option>
      </select></div>
      <div><label class="lbl">Fecha Límite</label><input type="date" id="actFechaLim"></div>
      <div><label class="lbl">Intentos permitidos</label><input type="number" id="actIntentos" min="1" max="10" value="1"></div>
      <div><label class="lbl">Penalización (% por día tarde)</label><input type="number" id="actPenal" min="0" max="50" value="0" placeholder="0"></div>
      <div style="grid-column:span 2"><label class="lbl">🔗 Enlace Google Drive (carpeta de entregas)</label><input id="actDrive" placeholder="https://drive.google.com/drive/folders/..." type="url"></div>
      <div style="grid-column:span 2"><label class="lbl">Instrucciones</label><textarea id="actDesc" style="min-height:70px;resize:vertical" placeholder="Descripción detallada de la actividad..."></textarea></div>
      <div style="grid-column:span 2">
        <label class="lbl">📎 Archivo para los estudiantes (Word, Excel, PPT, PDF, imagen, txt — máx. 6 MB)</label>
        <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
          <label style="background:#2980b9;color:#fff;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:0.85rem;white-space:nowrap">
            📂 Seleccionar archivo
            <input id="actArchivoInput" type="file" accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.jpg,.jpeg,.png,.gif,.txt,.csv,.zip" onchange="_leerArchivoAct(this)" style="display:none">
          </label>
          <span id="actArchivoNombre" style="font-size:0.82rem;color:#555">Sin archivo seleccionado</span>
          <button type="button" onclick="_limpiarArchivoAct()" style="background:#c0392b;color:#fff;border:none;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:0.78rem">✕</button>
        </div>
      </div>
    </div>
    <div id="actInteractivaWrap" style="display:none;margin-bottom:12px;border:2px solid #f0c080;border-radius:8px;padding:12px;background:#fffbf0">
      <h4 style="color:#d35400;margin:0 0 6px">🎮 Preguntas de la actividad interactiva</h4>
      <p style="font-size:0.82rem;color:#888;margin-bottom:10px">El estudiante responde en línea — la nota se calcula automáticamente en la escala configurada por la institución (0.0 – ${(db.config?.escalaS||5.0).toFixed(1)}).</p>
      <div id="actPreguntas"><p style="color:#aaa;font-size:0.82rem;margin:0">Sin preguntas. Agrega la primera abajo.</p></div>
      <button type="button" class="btn" style="background:#d35400;color:#fff;margin-top:8px;font-size:0.83rem" onclick="agregarPreguntaAct()">➕ Agregar Pregunta</button>
    </div>
    <button class="btn btn-green" onclick="guardarActividad()">💾 Publicar Actividad</button>
  </div>
  <div class="card">
    <h4 class="card-title">📋 Actividades Publicadas</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-end">
      <div><label class="lbl" style="margin-bottom:3px">Período</label><select onchange="window._actFiltPer=this.value;renderApp()" style="padding:5px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:0.85rem"><option value="">Todos</option>${perOptsFilt}</select></div>
      <div><label class="lbl" style="margin-bottom:3px">Asignatura</label><select onchange="window._actFiltAsig=this.value;renderApp()" style="padding:5px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:0.85rem"><option value="">Todas</option>${asigs.map(a=>`<option value="${a}"${filtAsig===a?' selected':''}>${a}</option>`).join('')}</select></div>
      <div><label class="lbl" style="margin-bottom:3px">Grado</label><select onchange="window._actFiltGrado=this.value;renderApp()" style="padding:5px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:0.85rem"><option value="">Todos</option>${gradosDoc.map(g=>`<option value="${g}"${filtGrado===g?' selected':''}>${g}</option>`).join('')}</select></div>
    </div>
    ${acts.length?acts.map(a=>{
      const entregas=(db.actEntregas||[]).filter(e=>String(e.actId)===String(a.id));
      const totalEst=db.ests.filter(x=>x.g===a.grado).length;
      const entregadas=entregas.length;
      const calificadas=entregas.filter(e=>e.notaObtenida!=null).length;
      const pctEnt=totalEst>0?Math.round(entregadas/totalEst*100):0;
      const pctCal=totalEst>0?Math.round(calificadas/totalEst*100):0;
      const promNotas=calificadas>0?parseFloat((entregas.filter(e=>e.notaObtenida!=null).reduce((s,e)=>s+e.notaObtenida,0)/calificadas).toFixed(1)):null;
      return `<div style="border:1.5px solid #ddd;border-radius:8px;padding:12px;margin-bottom:10px;background:#fafafa">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div>
            <b>${a.titulo}</b> <span style="font-size:0.8rem;color:#888">· ${a.asignatura||'—'} · ${a.grado}${a.periodo?' · P'+a.periodo:''}</span><br>
            <span style="font-size:0.78rem;color:#555">Tipo: ${a.tipo||'taller'} · Límite: ${a.fechaLimite||'sin fecha'} · Penalización: ${a.penalizacion||0}%</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${promNotas!=null?`<span style="background:#27ae60;color:#fff;border-radius:10px;padding:2px 10px;font-size:0.75rem">Nota prom: <b>${promNotas}/${(db.config?.escalaS||5.0).toFixed(1)}</b></span>`:''}
            ${a.tipo==='interactiva'?`<span style="background:#d35400;color:#fff;border-radius:8px;padding:1px 7px;font-size:0.7rem">🎮 Interactiva</span>`:''}
            ${a.archivoB64?`<span style="background:#2980b9;color:#fff;border-radius:8px;padding:1px 7px;font-size:0.7rem">📎 Archivo</span>`:''}
            <button class="btn-sm" style="background:#1a5276" onclick="editarActividad('${a.id}')">✏️ Editar</button>
            <button class="btn-sm" style="background:#e67e22" onclick="abrirCalificarActividad('${a.id}')">✎ Calificar</button>
            <button class="btn-sm" style="background:#c0392b" onclick="eliminarActividad('${a.id}')">🗑</button>
          </div>
        </div>
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#666;margin-bottom:3px">
            <span>📬 Entregas: ${entregadas}/${totalEst} (${pctEnt}%)</span>
            <span>✅ Calificadas: ${calificadas}/${totalEst} (${pctCal}%)</span>
          </div>
          <div style="background:#e0e0e0;border-radius:6px;height:9px;overflow:hidden;position:relative">
            <div style="background:#a3d977;height:100%;width:${pctEnt}%;position:absolute;top:0;left:0;border-radius:6px"></div>
            <div style="background:#27ae60;height:100%;width:${pctCal}%;position:absolute;top:0;left:0;border-radius:6px"></div>
          </div>
          <div style="font-size:0.67rem;color:#aaa;margin-top:2px">Claro: entregadas · Oscuro: calificadas</div>
        </div>
        ${a.driveLink?`<a href="${a.driveLink}" target="_blank" style="font-size:0.8rem;color:#27ae60;display:block;margin-top:6px">📁 Ver entregas en Drive</a>`:''}
      </div>`;
    }).join(''):`<p class="empty">No hay actividades publicadas${filtPer||filtAsig||filtGrado?' con los filtros seleccionados':' aún'}.</p>`}
  </div>`;
}
function guardarActividad(){
  const titulo=(document.getElementById('actTitulo')?.value||'').trim();
  const asig=document.getElementById('actAsig')?.value||'';
  const grado=document.getElementById('actGrado')?.value||'';
  const periodo=document.getElementById('actPeriodo')?.value||'';
  const tipo=document.getElementById('actTipo')?.value||'taller';
  const fechaLim=document.getElementById('actFechaLim')?.value||'';
  const intentos=parseInt(document.getElementById('actIntentos')?.value||'1')||1;
  const penal=parseFloat(document.getElementById('actPenal')?.value||'0')||0;
  const drive=(document.getElementById('actDrive')?.value||'').trim();
  const desc=(document.getElementById('actDesc')?.value||'').trim();
  if(!titulo||!grado){alert('Ingrese título y grado.');return;}
  if(!asig){alert('Seleccione la asignatura.');return;}
  if(!periodo){alert('Seleccione el período.');return;}
  if(tipo==='interactiva'&&(!window._actPregs||!window._actPregs.length)){alert('Agregue al menos una pregunta para la actividad interactiva.');return;}
  if(tipo==='interactiva'){
    for(let i=0;i<window._actPregs.length;i++){
      const p=window._actPregs[i];
      if(!p.p.trim()){alert('La pregunta '+(i+1)+' no tiene enunciado.');return;}
      if(p.tipo==='seleccion'&&(p.opts||[]).some(o=>!o.trim())){alert('Complete todas las opciones de la pregunta '+(i+1)+'.');return;}
    }
  }
  const preguntas=tipo==='interactiva'?(window._actPregs||[]).map(p=>({...p})):[];
  const archivoB64=window._actArchivoB64||null;
  const archivoNombre=window._actArchivoNombre||null;
  const archivoMime=window._actArchivoMime||null;
  updDB(db2=>{
    if(!Array.isArray(db2.actividades)) db2.actividades=[];
    db2.actividades.push({id:Date.now()+Math.random(),titulo,asignatura:asig,grado,periodo:Number(periodo),tipo,intentos,fechaLimite:fechaLim,penalizacion:penal,driveLink:drive,desc,docente:sesion.u,activa:true,fechaCreacion:new Date().toISOString().slice(0,10),preguntas,archivoB64,archivoNombre,archivoMime});
    return db2;
  });
  window._actPregs=[];window._actArchivoB64=null;window._actArchivoNombre=null;window._actArchivoMime=null;
  alert('✅ Actividad publicada.');renderApp();
}
function eliminarActividad(actId){if(!confirm('¿Eliminar actividad y sus entregas?')) return;
  updDB(db2=>{db2.actividades=(db2.actividades||[]).filter(x=>x.id!=actId);db2.actEntregas=(db2.actEntregas||[]).filter(x=>x.actId!=actId);return db2;});
  renderApp();
}
// ====================================================
// LECCIONARIO DIGITAL — guardar y eliminar registros
// ====================================================
function guardarLeccion(){
  const fecha=(document.getElementById('lecFecha')?.value||'').trim();
  const asig=document.getElementById('lecAsig')?.value||'';
  const grado=document.getElementById('lecGrado')?.value||'';
  const tema=(document.getElementById('lecTema')?.value||'').trim();
  const obs=(document.getElementById('lecObs')?.value||'').trim();
  if(!fecha||!tema){alert('Ingrese la fecha y el tema dictado.');return;}
  if(!asig){alert('Seleccione la asignatura.');return;}
  if(!grado){alert('Seleccione el grado.');return;}
  updDB(db2=>{
    if(!Array.isArray(db2.leccionario)) db2.leccionario=[];
    db2.leccionario.push({id:Date.now()+Math.random(),fecha,asignatura:asig,grado,tema,observaciones:obs,docente:sesion.u,docenteNombre:sesion.n,fechaCreacion:new Date().toISOString()});
    return db2;
  });
  alert('✅ Registro guardado en el leccionario.');
  renderApp();
}
function eliminarLeccion(id){
  if(!confirm('¿Eliminar este registro del leccionario?')) return;
  updDB(db2=>{db2.leccionario=(db2.leccionario||[]).filter(x=>String(x.id)!==String(id));return db2;});
  renderApp();
}
// ====================================================
// ACTIVIDADES — manejo de archivos (docente)
// ====================================================
window._actArchivoB64=null;window._actArchivoNombre=null;window._actArchivoMime=null;
function _leerArchivoAct(input){
  const f=input.files[0];if(!f) return;
  if(f.size>6*1024*1024){alert('Archivo muy grande. Máximo 6 MB.');input.value='';return;}
  const rd=new FileReader();
  rd.onload=e=>{window._actArchivoB64=e.target.result;window._actArchivoNombre=f.name;window._actArchivoMime=f.type;
    const el=document.getElementById('actArchivoNombre');
    if(el) el.textContent='📎 '+f.name+' ('+Math.round(f.size/1024)+' KB)';};
  rd.readAsDataURL(f);
}
function _limpiarArchivoAct(){
  window._actArchivoB64=null;window._actArchivoNombre=null;window._actArchivoMime=null;
  const el=document.getElementById('actArchivoNombre');if(el) el.textContent='Sin archivo seleccionado';
  const inp=document.getElementById('actArchivoInput');if(inp) inp.value='';
}
function _descargarArchivoAct(actId){
  const act=(db.actividades||[]).find(a=>String(a.id)===String(actId));
  if(!act?.archivoB64){alert('No hay archivo adjunto.');return;}
  const lk=document.createElement('a');lk.href=act.archivoB64;lk.download=act.archivoNombre||'archivo';
  document.body.appendChild(lk);lk.click();document.body.removeChild(lk);
}
function _descargarArchivoEntrega(actId,estId){
  estId=String(estId);
  const e=(db.actEntregas||[]).find(x=>String(x.actId)===String(actId)&&String(x.estId)===estId);
  if(!e?.archivoB64){alert('No hay archivo en esta entrega.');return;}
  const lk=document.createElement('a');lk.href=e.archivoB64;lk.download=e.archivoNombre||'entrega';
  document.body.appendChild(lk);lk.click();document.body.removeChild(lk);
}
// ====================================================
// ACTIVIDADES INTERACTIVAS — constructor de preguntas
// ====================================================
window._actPregs=[];
function agregarPreguntaAct(){
  window._actPregs.push({p:'',tipo:'seleccion',opts:['','','',''],resp:0});
  renderPreguntasAct();
}
function renderPreguntasAct(){
  const c=document.getElementById('actPreguntas');if(!c) return;
  if(!window._actPregs.length){c.innerHTML='<p style="color:#aaa;font-size:0.82rem;margin:0">Sin preguntas. Agrega la primera abajo.</p>';return;}
  c.innerHTML=window._actPregs.map((p,i)=>`<div style="border:1.5px solid #f0c080;border-radius:8px;padding:12px;margin-bottom:10px;background:#fffdf0">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <b style="color:#d35400">Pregunta ${i+1}</b>
      <select onchange="window._actTipoChg(${i},this.value)" style="font-size:0.82rem;padding:3px 8px;border:1.5px solid #ddd;border-radius:5px">
        <option value="seleccion" ${p.tipo==='seleccion'?'selected':''}>Selección Múltiple (A B C D)</option>
        <option value="verdadero_falso" ${p.tipo==='verdadero_falso'?'selected':''}>Verdadero / Falso</option>
        <option value="texto" ${p.tipo==='texto'?'selected':''}>Respuesta Abierta</option>
      </select>
      <button onclick="window._actElim(${i})" style="background:#c0392b;color:#fff;border:none;border-radius:5px;padding:2px 8px;font-size:0.78rem;cursor:pointer;margin-left:auto">🗑</button>
    </div>
    <textarea oninput="window._actSetEnunciado(${i},this.value)" placeholder="Enunciado de la pregunta..." style="width:100%;padding:7px;border:1.5px solid #ddd;border-radius:7px;margin-bottom:8px;box-sizing:border-box;min-height:56px;resize:vertical;font-size:0.9rem;font-family:inherit">${p.p}</textarea>
    ${p.tipo==='seleccion'?(p.opts||['','','','']).map((o,oi)=>`<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;width:100%;box-sizing:border-box">
      <input type="radio" name="actResp_${i}" value="${oi}" ${p.resp===oi?'checked':''} onchange="window._actSetResp(${i},${oi})" style="accent-color:#d35400;flex-shrink:0;width:16px;height:16px" title="Marcar como correcta">
      <span style="font-size:0.85rem;color:#d35400;font-weight:bold;flex-shrink:0;min-width:20px">${['A','B','C','D'][oi]||oi+1}.</span>
      <textarea oninput="window._actSetOpt(${i},${oi},this.value)" placeholder="Opción ${['A','B','C','D'][oi]||oi+1}..." style="flex:1;min-width:0;padding:7px 10px;border:1.5px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;width:100%;min-height:38px;max-height:110px;resize:vertical;line-height:1.4;font-family:inherit;overflow-y:auto">${o}</textarea>
    </div>`).join(''):''}
    ${p.tipo==='verdadero_falso'?`<div style="display:flex;gap:14px;margin-top:4px">
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="actResp_${i}" value="0" ${p.resp===0?'checked':''} onchange="window._actSetResp(${i},0)" style="accent-color:#d35400"> <b>Verdadero</b></label>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="actResp_${i}" value="1" ${p.resp===1?'checked':''} onchange="window._actSetResp(${i},1)" style="accent-color:#d35400"> <b>Falso</b></label>
    </div>`:''}
    ${p.tipo==='texto'?'<div style="font-size:0.8rem;color:#888;font-style:italic">Respuesta abierta — no tiene corrección automática.</div>':''}
    <div style="margin-top:8px">
      <label style="font-size:0.78rem;font-weight:bold;color:#a04000;display:block;margin-bottom:3px">💡 Retroalimentación (opcional — se muestra al estudiante al finalizar)</label>
      <textarea oninput="window._actSetJust(${i},this.value)" placeholder="Explica por qué esa es la respuesta correcta..." style="width:100%;padding:7px;border:1.5px solid #f0c080;border-radius:6px;min-height:46px;resize:vertical;font-size:0.85rem;font-family:inherit;box-sizing:border-box">${p.just||''}</textarea>
    </div>
  </div>`).join('');
}
window._actTipoChg=function(i,t){window._actPregs[i].tipo=t;if(t==='seleccion'&&!window._actPregs[i].opts) window._actPregs[i].opts=['','','',''];window._actPregs[i].resp=0;renderPreguntasAct();}
window._actElim=function(i){window._actPregs.splice(i,1);renderPreguntasAct();}
window._actSetEnunciado=function(i,v){window._actPregs[i].p=v;}
window._actSetResp=function(i,v){window._actPregs[i].resp=parseInt(v);}
window._actSetOpt=function(i,oi,v){if(window._actPregs[i].opts) window._actPregs[i].opts[oi]=v;}
window._actSetJust=function(i,v){window._actPregs[i].just=v;}
// ====================================================
// ACTIVIDADES — editar actividad (docente)
// ====================================================
function editarActividad(actId){
  const act=(db.actividades||[]).find(a=>String(a.id)===String(actId));if(!act) return;
  const numPer=_getNumPer();
  const isDocente=sesion.r==='docente';
  const gradosDoc=isDocente?gradosDelDocente(sesion.u):db.grados.map(g=>g.n);
  const asigs=isDocente?[...new Set((db.carga||[]).filter(c=>c.d===sesion.u).map(c=>c.m))].filter(Boolean):(db.carga||[]).map(c=>c.m).filter((v,i,a)=>a.indexOf(v)===i);
  const perOpts=Array.from({length:numPer},(_,i)=>`<option value="${i+1}"${Number(act.periodo)===i+1?' selected':''}>Período ${i+1}</option>`).join('');
  window._editActArchivoB64=act.archivoB64||null;window._editActArchivoNombre=act.archivoNombre||null;
  const ov=document.createElement('div');ov.id='_editActOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;padding:24px;max-width:580px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
    <h3 style="color:#1a5276;margin-bottom:16px">✏️ Editar Actividad</h3>
    <div class="grid2" style="gap:8px;margin-bottom:10px">
      <div><label class="lbl">Título *</label><input id="eaActTitulo" value="${act.titulo.replace(/"/g,'&quot;')}"></div>
      <div><label class="lbl">Asignatura *</label><select id="eaActAsig"><option value="">— Seleccione —</option>${asigs.map(a=>`<option value="${a}"${act.asignatura===a?' selected':''}>${a}</option>`).join('')}</select></div>
      <div><label class="lbl">Grado *</label><select id="eaActGrado"><option value="">— Seleccione —</option>${gradosDoc.map(g=>`<option${act.grado===g?' selected':''}>${g}</option>`).join('')}</select></div>
      <div><label class="lbl">Período *</label><select id="eaActPeriodo"><option value="">— Seleccione —</option>${perOpts}</select></div>
      <div><label class="lbl">Tipo</label><select id="eaActTipo">
        <option value="taller"${act.tipo==='taller'?' selected':''}>📝 Taller</option>
        <option value="tarea"${act.tipo==='tarea'?' selected':''}>📚 Tarea</option>
        <option value="proyecto"${act.tipo==='proyecto'?' selected':''}>🎯 Proyecto</option>
        <option value="exposicion"${act.tipo==='exposicion'?' selected':''}>🎤 Exposición</option>
        <option value="interactiva"${act.tipo==='interactiva'?' selected':''}>🎮 Interactiva</option>
      </select></div>
      <div><label class="lbl">Fecha Límite</label><input type="date" id="eaActFecha" value="${act.fechaLimite||''}"></div>
      <div><label class="lbl">Penalización %</label><input type="number" id="eaActPenal" min="0" max="50" value="${act.penalizacion||0}"></div>
      <div><label class="lbl">Enlace Drive</label><input id="eaActDrive" value="${(act.driveLink||'').replace(/"/g,'&quot;')}" type="url"></div>
      <div style="grid-column:span 2"><label class="lbl">Instrucciones</label><textarea id="eaActDesc" style="min-height:60px;resize:vertical">${act.desc||''}</textarea></div>
    </div>
    <div style="margin-bottom:12px">
      <label class="lbl">📎 ${act.archivoNombre?'Reemplazar archivo (opcional)':'Adjuntar archivo (máx. 6 MB)'}</label>
      <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap">
        <label style="background:#2980b9;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:0.83rem">
          📂 Seleccionar
          <input type="file" accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.jpg,.jpeg,.png,.gif,.txt,.csv,.zip" onchange="_leerArchivoEdit(this)" style="display:none">
        </label>
        <span id="eaActArchivoNombre" style="font-size:0.82rem;color:#555">${act.archivoNombre?'📎 '+act.archivoNombre:'Sin archivo'}</span>
        ${act.archivoB64?`<button type="button" onclick="_descargarArchivoAct('${actId}')" style="background:#27ae60;color:#fff;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:0.8rem">📥 Ver actual</button>
        <button type="button" onclick="window._editActArchivoB64='';window._editActArchivoNombre='';document.getElementById('eaActArchivoNombre').textContent='Sin archivo';" style="background:#c0392b;color:#fff;border:none;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:0.78rem">✕ Quitar</button>`:''}
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button onclick="document.getElementById('_editActOv').remove()" style="background:#eee;border:none;border-radius:7px;padding:10px 18px;cursor:pointer">Cancelar</button>
      <button onclick="_guardarEdicionActividad('${actId}')" style="background:#1a5276;color:#fff;border:none;border-radius:7px;padding:10px 22px;cursor:pointer;font-weight:bold">💾 Guardar Cambios</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function _leerArchivoEdit(input){
  const f=input.files[0];if(!f) return;
  if(f.size>6*1024*1024){alert('Máximo 6 MB.');input.value='';return;}
  const rd=new FileReader();
  rd.onload=e=>{window._editActArchivoB64=e.target.result;window._editActArchivoNombre=f.name;
    const el=document.getElementById('eaActArchivoNombre');
    if(el) el.textContent='📎 '+f.name+' ('+Math.round(f.size/1024)+' KB)';};
  rd.readAsDataURL(f);
}
function _guardarEdicionActividad(actId){
  const titulo=(document.getElementById('eaActTitulo')?.value||'').trim();
  const asig=document.getElementById('eaActAsig')?.value||'';
  const grado=document.getElementById('eaActGrado')?.value||'';
  const periodo=document.getElementById('eaActPeriodo')?.value||'';
  const tipo=document.getElementById('eaActTipo')?.value||'taller';
  const fecha=document.getElementById('eaActFecha')?.value||'';
  const penal=parseFloat(document.getElementById('eaActPenal')?.value||'0')||0;
  const drive=(document.getElementById('eaActDrive')?.value||'').trim();
  const desc=(document.getElementById('eaActDesc')?.value||'').trim();
  if(!titulo||!asig||!grado||!periodo){alert('Complete los campos obligatorios.');return;}
  updDB(db2=>{
    const idx=db2.actividades.findIndex(a=>String(a.id)===String(actId));if(idx===-1) return db2;
    const base=db2.actividades[idx];
    const newB64=window._editActArchivoB64;
    db2.actividades[idx]={...base,titulo,asignatura:asig,grado,periodo:Number(periodo),tipo,fechaLimite:fecha,penalizacion:penal,driveLink:drive,desc,
      archivoB64:newB64===''?null:(newB64||base.archivoB64||null),
      archivoNombre:newB64===''?null:(window._editActArchivoNombre||base.archivoNombre||null)};
    return db2;
  });
  window._editActArchivoB64=null;window._editActArchivoNombre=null;
  document.getElementById('_editActOv')?.remove();
  alert('✅ Actividad actualizada.');renderApp();
}
// ====================================================
// ENTREGAS — estudiante: enviar, editar, eliminar
// ====================================================
window._entregaArchivoB64=null;window._entregaArchivoNombre=null;
function _leerArchivoEntrega(input){
  const f=input.files[0];if(!f) return;
  if(f.size>6*1024*1024){alert('Máximo 6 MB.');input.value='';return;}
  const rd=new FileReader();
  rd.onload=e=>{window._entregaArchivoB64=e.target.result;window._entregaArchivoNombre=f.name;
    const el=document.getElementById('entregaArchivoNombre');
    if(el) el.textContent='📎 '+f.name+' ('+Math.round(f.size/1024)+' KB)';};
  rd.readAsDataURL(f);
}
function abrirEntregaEst(actId,estId){
  estId=String(estId);
  const act=(db.actividades||[]).find(a=>String(a.id)===String(actId));if(!act) return;
  const entrega=(db.actEntregas||[]).find(e=>String(e.actId)===String(actId)&&String(e.estId)===estId);
  window._entregaArchivoB64=null;window._entregaArchivoNombre=null;
  const ov=document.createElement('div');ov.id='_entregaOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;padding:24px;max-width:480px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
    <h3 style="color:#27ae60;margin-bottom:14px">📬 ${entrega?'Editar entrega':'Enviar entrega'}</h3>
    <p style="font-size:0.88rem;color:#555;margin-bottom:12px"><b>${act.titulo}</b> · ${act.asignatura||'—'}${act.periodo?' · P'+act.periodo:''}</p>
    ${act.archivoB64?`<div style="background:#e8f8f5;border-radius:8px;padding:10px 12px;margin-bottom:12px">
      <b style="font-size:0.83rem">📎 Archivo del docente:</b>
      <button type="button" onclick="_descargarArchivoAct('${actId}')" style="background:#2980b9;color:#fff;border:none;border-radius:5px;padding:4px 12px;cursor:pointer;font-size:0.82rem;margin-left:6px">📥 ${act.archivoNombre||'Descargar'}</button>
    </div>`:''}
    <div style="margin-bottom:12px">
      <label class="lbl">📎 Su archivo de entrega (Word, PDF, imagen, etc. — máx. 6 MB)</label>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
        <label style="background:#27ae60;color:#fff;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:0.85rem;white-space:nowrap">
          📂 Seleccionar
          <input type="file" accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.jpg,.jpeg,.png,.gif,.txt,.csv,.zip" onchange="_leerArchivoEntrega(this)" style="display:none">
        </label>
        <span id="entregaArchivoNombre" style="font-size:0.82rem;color:#555">${entrega?.archivoNombre?'📎 '+entrega.archivoNombre:'Sin archivo'}</span>
        ${entrega?.archivoB64?`<button type="button" onclick="_descargarArchivoEntrega('${actId}','${estId}')" style="background:#2980b9;color:#fff;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:0.8rem">📥 Ver entrega actual</button>`:''}
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="lbl">Comentario (opcional)</label>
      <textarea id="entregaComentario" placeholder="Agregue una nota sobre su entrega..." style="width:100%;min-height:60px;padding:8px;border:1.5px solid #ddd;border-radius:6px;font-size:0.85rem;resize:vertical;box-sizing:border-box">${entrega?.comentario||''}</textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button type="button" onclick="document.getElementById('_entregaOv').remove();window._entregaArchivoB64=null;window._entregaArchivoNombre=null;" style="background:#eee;border:none;border-radius:7px;padding:10px 18px;cursor:pointer">Cancelar</button>
      <button type="button" onclick="_guardarEntregaEst('${actId}','${estId}')" style="background:#27ae60;color:#fff;border:none;border-radius:7px;padding:10px 22px;cursor:pointer;font-weight:bold">📬 ${entrega?'Actualizar':'Enviar'}</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function _guardarEntregaEst(actId,estId){
  estId=String(estId);
  const comentario=(document.getElementById('entregaComentario')?.value||'').trim();
  const existing=(db.actEntregas||[]).find(e=>String(e.actId)===String(actId)&&String(e.estId)===estId);
  updDB(db2=>{
    if(!Array.isArray(db2.actEntregas)) db2.actEntregas=[];
    const idx=db2.actEntregas.findIndex(e=>String(e.actId)===String(actId)&&String(e.estId)===estId);
    const obj={id:existing?.id||(Date.now()+Math.random()),actId,estId,estado:'entregada',
      fechaEntrega:new Date().toISOString().slice(0,10),comentario,
      archivoB64:window._entregaArchivoB64||existing?.archivoB64||null,
      archivoNombre:window._entregaArchivoNombre||existing?.archivoNombre||null,
      notaObtenida:existing?.notaObtenida??null,
      observaciones:existing?.observaciones||null};
    if(idx===-1) db2.actEntregas.push(obj); else db2.actEntregas[idx]=obj;
    return db2;
  });
  window._entregaArchivoB64=null;window._entregaArchivoNombre=null;
  document.getElementById('_entregaOv')?.remove();
  alert('✅ Entrega guardada.');renderApp();
}
function _eliminarEntregaEst(actId,estId){
  estId=String(estId);
  if(!confirm('¿Eliminar tu entrega? El docente no podrá verla.')) return;
  updDB(db2=>{db2.actEntregas=(db2.actEntregas||[]).filter(e=>!(String(e.actId)===String(actId)&&String(e.estId)===estId));return db2;});
  renderApp();
}
// ====================================================
// ACTIVIDAD INTERACTIVA — overlay estudiante
// ====================================================
function _iniciarActividadInteractiva(actId,estId){
  estId=String(estId);
  const act=(db.actividades||[]).find(a=>String(a.id)===String(actId));
  if(!act?.preguntas?.length){alert('Esta actividad no tiene preguntas configuradas todavía.');return;}
  const preguntas=act.preguntas;
  let pregIdx=0;const respuestas={};
  const ov=document.createElement('div');ov.id='_actInterOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.78);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  const intentosAnteriores=(()=>{const e=(db.actEntregas||[]).find(x=>String(x.actId)===String(actId)&&String(x.estId)===estId);return e?.intentosRealizados||0;})();
  const maxIntentos=act.intentos||1;
  const intentoActual=intentosAnteriores+1;
  function renderQ(){
    const p=preguntas[pregIdx];const total=preguntas.length;
    const tipoP=p.tipo||'seleccion';
    ov.innerHTML=`<div style="background:#fff;border-radius:16px;padding:24px 28px;max-width:540px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.4);overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:8px">
        <b style="color:#d35400;font-size:0.9rem;word-break:break-word;flex:1">🎮 ${act.titulo}</b>
        <span style="font-size:0.78rem;color:#888;white-space:nowrap;flex-shrink:0">P${pregIdx+1}/${total} · Int.${intentoActual}/${maxIntentos}</span>
      </div>
      <div style="background:#e0e0e0;border-radius:5px;height:5px;margin-bottom:16px">
        <div style="background:#d35400;height:100%;width:${Math.round((pregIdx+1)/total*100)}%;border-radius:5px;transition:width 0.3s"></div>
      </div>
      <p style="font-size:0.92rem;font-weight:bold;margin-bottom:14px;color:#222;word-break:break-word">${pregIdx+1}. ${p.p}</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
        ${tipoP==='verdadero_falso'?`
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ${respuestas[pregIdx]===0?'#d35400':'#ddd'};border-radius:8px;cursor:pointer;background:${respuestas[pregIdx]===0?'#fff3e8':'#fafafa'}">
            <input type="radio" name="actQ" value="0" ${respuestas[pregIdx]===0?'checked':''} onchange="window._actQRespSet(0)" style="accent-color:#d35400;flex-shrink:0">
            <span style="font-size:0.92rem;word-break:break-word;min-width:0;flex:1"><b>Verdadero</b></span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ${respuestas[pregIdx]===1?'#d35400':'#ddd'};border-radius:8px;cursor:pointer;background:${respuestas[pregIdx]===1?'#fff3e8':'#fafafa'}">
            <input type="radio" name="actQ" value="1" ${respuestas[pregIdx]===1?'checked':''} onchange="window._actQRespSet(1)" style="accent-color:#d35400;flex-shrink:0">
            <span style="font-size:0.92rem;word-break:break-word;min-width:0;flex:1"><b>Falso</b></span>
          </label>
        `:tipoP==='texto'?`
          <textarea id="actQTextResp" placeholder="Escribe tu respuesta aquí..." style="width:100%;min-height:80px;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9rem;resize:vertical;box-sizing:border-box">${respuestas[pregIdx]||''}</textarea>
          <p style="font-size:0.78rem;color:#888;margin:0">Esta pregunta no se califica automáticamente.</p>
        `:(p.opts||[]).map((o,oi)=>`<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ${respuestas[pregIdx]===oi?'#d35400':'#ddd'};border-radius:8px;cursor:pointer;background:${respuestas[pregIdx]===oi?'#fff3e8':'#fafafa'};transition:all 0.15s;width:100%;box-sizing:border-box">
          <input type="radio" name="actQ" value="${oi}" ${respuestas[pregIdx]===oi?'checked':''} onchange="window._actQRespSet(${oi})" style="accent-color:#d35400;flex-shrink:0">
          <span style="font-size:0.9rem;word-break:break-word;overflow-wrap:break-word;min-width:0;flex:1"><b style="color:#d35400;margin-right:4px">${['A','B','C','D'][oi]||oi+1}.</b>${o}</span>
        </label>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button onclick="window._actQNav(-1)" style="background:#eee;border:none;border-radius:7px;padding:8px 16px;cursor:pointer${pregIdx===0?';opacity:0.4;pointer-events:none':''}">← Anterior</button>
        ${pregIdx<total-1
          ?`<button onclick="window._actQNav(1)" style="background:#d35400;color:#fff;border:none;border-radius:7px;padding:8px 20px;cursor:pointer;font-weight:bold">Siguiente →</button>`
          :`<button onclick="window._actQFin()" style="background:#27ae60;color:#fff;border:none;border-radius:7px;padding:8px 20px;cursor:pointer;font-weight:bold">✅ Enviar respuestas</button>`}
      </div>
    </div>`;
    if(tipoP==='texto'){const ta=document.getElementById('actQTextResp');if(ta) ta.oninput=function(){respuestas[pregIdx]=this.value;};}
  }
  window._actQRespSet=function(val){respuestas[pregIdx]=val;renderQ();}
  window._actQNav=function(d){pregIdx=Math.max(0,Math.min(preguntas.length-1,pregIdx+d));renderQ();}
  window._actQFin=function(){
    let correctas=0;
    const calificables=preguntas.filter(p=>p.resp!=null&&p.tipo!=='texto');
    preguntas.forEach((p,i)=>{if(p.resp!=null&&p.tipo!=='texto'&&respuestas[i]===p.resp) correctas++;});
    const puntaje=calificables.length>0?Math.round((correctas/calificables.length)*100):null;
    const _actEscMax=db.config?.escalaS||5;const _actEscB=db.config?.escalaB||3;
    const nota=puntaje!=null?Math.round((puntaje/100)*_actEscMax*10)/10:null;
    updDB(db2=>{
      if(!Array.isArray(db2.actEntregas)) db2.actEntregas=[];
      const idx=db2.actEntregas.findIndex(e=>String(e.actId)===String(actId)&&String(e.estId)===estId);
      const base=idx!==-1?db2.actEntregas[idx]:{};
      const nuevosIntentos=(base.intentosRealizados||0)+1;
      const obj={id:base.id||(Date.now()+Math.random()),actId,estId,estado:'entregada',
        fechaEntrega:new Date().toISOString().slice(0,10),
        notaObtenida:nota,
        intentosRealizados:nuevosIntentos,
        respuestasInteractivas:respuestas,correctas,totalPregs:preguntas.length};
      if(idx===-1) db2.actEntregas.push(obj); else db2.actEntregas[idx]=obj;
      return db2;
    });
    const nuevosIntentos2=(()=>{const e=(db.actEntregas||[]).find(x=>String(x.actId)===String(actId)&&String(x.estId)===estId);return e?.intentosRealizados||intentoActual;})();
    const quedanIntentos=maxIntentos-nuevosIntentos2;
    const _actRevHtml=preguntas.map((p,i)=>{
      const tieneResp=p.resp!=null&&p.tipo!=='texto';
      const estResp=respuestas[i];
      const correcto=tieneResp&&estResp===p.resp;
      const noRespond=estResp===undefined||estResp===null||estResp==='';
      let respLabel='Sin responder';
      if(!noRespond){
        if(p.tipo==='verdadero_falso') respLabel=['Verdadero','Falso'][estResp]||String(estResp);
        else if(p.tipo==='seleccion') respLabel=((['A','B','C','D'][estResp]||String(estResp+1))+'. '+(p.opts?.[estResp]||''));
        else respLabel=String(estResp).substring(0,80)+(String(estResp).length>80?'…':'');
      }
      let corrLabel='';
      if(tieneResp){
        if(p.tipo==='verdadero_falso') corrLabel=['Verdadero','Falso'][p.resp]||String(p.resp);
        else if(p.tipo==='seleccion') corrLabel=((['A','B','C','D'][p.resp]||String(p.resp+1))+'. '+(p.opts?.[p.resp]||''));
      }
      const bgColor=noRespond?'#f8f8f8':correcto?'#eafaf1':'#fdf2f2';
      const bColor=noRespond?'#ddd':correcto?'#27ae60':'#e74c3c';
      const icon=noRespond?'⬜':correcto?'✅':'❌';
      return `<div style="border:2px solid ${bColor};border-radius:10px;padding:12px 14px;margin-bottom:10px;background:${bgColor};text-align:left">
        <div style="font-size:0.88rem;font-weight:bold;color:#333;margin-bottom:6px">${icon} ${i+1}. ${p.p}</div>
        ${tieneResp?`<div style="font-size:0.82rem;margin-bottom:3px;color:${correcto?'#27ae60':'#c0392b'}"><b>Tu respuesta:</b> ${noRespond?'(sin responder)':respLabel}</div>
        ${!correcto?`<div style="font-size:0.82rem;margin-bottom:3px;color:#27ae60"><b>Respuesta correcta:</b> ${corrLabel}</div>`:''}`:
        `<div style="font-size:0.8rem;color:#888">Respuesta abierta — revisada por el docente.</div>`}
        ${p.just?`<div style="background:#fff8e8;border:1.5px solid #f0c080;border-radius:7px;padding:8px 10px;margin-top:7px;font-size:0.82rem;color:#555"><b>💡 Retroalimentación:</b> ${p.just}</div>`:''}
      </div>`;
    }).join('');
    ov.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px;max-width:580px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.4)">
      <div style="text-align:center;margin-bottom:18px">
        <div style="font-size:2.4rem;margin-bottom:6px">🎮</div>
        <h3 style="color:#d35400;margin:0 0 4px">¡Actividad completada!</h3>
        <p style="font-size:0.82rem;color:#888;margin:0">Intento ${nuevosIntentos2} de ${maxIntentos}</p>
        ${nota!=null?`<div style="font-size:2.2rem;font-weight:bold;color:${nota>=_actEscB?'#27ae60':'#c0392b'};margin:8px 0">${nota}<span style="font-size:1rem">/${_actEscMax.toFixed(1)}</span></div><div style="font-size:0.8rem;color:#888">${esc(nota)} · ${correctas}/${calificables.length} correctas (${puntaje}%)</div>`:
        '<p style="color:#888;margin:4px 0">Respuestas enviadas.</p>'}
        ${quedanIntentos>0?`<p style="font-size:0.82rem;color:#e67e22;margin-top:6px;margin-bottom:0">Te quedan <b>${quedanIntentos}</b> intento(s) para mejorar tu nota.</p>`:''}
      </div>
      <h4 style="color:#333;font-size:0.92rem;margin:0 0 10px;border-bottom:1px solid #eee;padding-bottom:6px">📋 Revisión de respuestas</h4>
      ${_actRevHtml}
      <div style="text-align:center;margin-top:16px">
        <button onclick="document.getElementById('_actInterOv').remove();renderApp();" style="background:#003366;color:#fff;border:none;border-radius:8px;padding:10px 28px;cursor:pointer;font-weight:bold">Cerrar</button>
      </div>
    </div>`;
  }
  renderQ();
  document.body.appendChild(ov);
}
function abrirCalificarActividad(actId){
  const act=(db.actividades||[]).find(a=>a.id==actId);if(!act) return;
  const ests=db.ests.filter(e=>e.g===act.grado);
  const entregas=db.actEntregas||[];
  const ov=document.createElement('div');ov.id='_calActOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  const rows=ests.map(e=>{
    const en=entregas.find(x=>x.actId==actId&&x.estId===e.id);
    const tieneArch=!!(en?.archivoB64);
    return `<tr>
      <td style="text-align:left">${fmtNombreEst(e)}</td>
      <td style="text-align:center;color:${en?'#27ae60':'#c0392b'}">${en?'✅':'⛔'} ${tieneArch?`<button onclick="_descargarArchivoEntrega('${actId}','${e.id}')" style="background:#2980b9;color:#fff;border:none;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:0.72rem;margin-left:3px">📥</button>`:''}</td>
      <td>${en?.comentario?`<span style="font-size:0.72rem;color:#555" title="${en.comentario}">💬</span>`:''}</td>
      <td><input type="number" min="0" max="10" step="0.1" id="nota_${e.id}" value="${en?.notaObtenida??''}" placeholder="—" style="width:58px;padding:4px;border:1.5px solid #ddd;border-radius:5px;text-align:center"></td>
      <td><input type="text" id="obs_${e.id}" value="${en?.observaciones||''}" placeholder="Observación..." style="min-width:110px;padding:4px;border:1.5px solid #ddd;border-radius:5px"></td>
    </tr>`;
  }).join('');
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;padding:24px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
    <h3 style="color:#003366;margin-bottom:14px">✎ Calificar: ${act.titulo}</h3>
    ${act.archivoB64?`<div style="background:#e8f8f5;border-radius:7px;padding:8px 12px;margin-bottom:12px;font-size:0.83rem"><b>📎 Archivo de la actividad:</b> <button onclick="_descargarArchivoAct('${actId}')" style="background:#2980b9;color:#fff;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:0.8rem;margin-left:4px">📥 Descargar</button></div>`:''}
    <div class="over"><table><thead><tr><th style="text-align:left">Estudiante</th><th>Entregó</th><th>Coment.</th><th>Nota (/10)</th><th>Observación docente</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button onclick="document.getElementById('_calActOv').remove()" style="background:#eee;border:none;border-radius:7px;padding:10px 18px;cursor:pointer">Cancelar</button>
      <button onclick="_guardarCalificacionesAct('${actId}')" style="background:#003366;color:#fff;border:none;border-radius:7px;padding:10px 22px;cursor:pointer;font-weight:bold">💾 Guardar Calificaciones</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function _guardarCalificacionesAct(actId){
  const act=(db.actividades||[]).find(a=>a.id==actId);if(!act) return;
  const ests=db.ests.filter(e=>e.g===act.grado);
  updDB(db2=>{
    if(!Array.isArray(db2.actEntregas)) db2.actEntregas=[];
    ests.forEach(e=>{
      const notaEl=document.getElementById('nota_'+e.id);
      const obsEl=document.getElementById('obs_'+e.id);
      const nota=notaEl&&notaEl.value!==''?parseFloat(notaEl.value):null;
      const obs=obsEl?.value||'';
      const idx=db2.actEntregas.findIndex(x=>x.actId==actId&&x.estId===e.id);
      if(idx===-1){if(nota!=null) db2.actEntregas.push({id:Date.now()+Math.random(),actId,estId:e.id,estado:'entregada',notaObtenida:nota,observaciones:obs,fechaEntrega:new Date().toISOString().slice(0,10)});}
      else{db2.actEntregas[idx].notaObtenida=nota;db2.actEntregas[idx].observaciones=obs;}
    });
    return db2;
  });
  document.getElementById('_calActOv')?.remove();
  alert('✅ Calificaciones guardadas.');renderApp();
}

// ============================================================
// DOCENTE — MÓDULO QUIZZES / EVALUACIONES
// ============================================================
function htmlDocenteQuizzes(){
  const isDocente=sesion.r==='docente';
  const asigs=isDocente?[...new Set((db.carga||[]).filter(c=>c.d===sesion.u).map(c=>c.m))].filter(Boolean):(db.carga||[]).map(c=>c.m).filter((v,i,a)=>a.indexOf(v)===i);
  const numPer=_getNumPer();
  const perOpts=Array.from({length:numPer},(_,i)=>`<option value="${i+1}">Período ${i+1}</option>`).join('');
  const filtQzPer=window._qzFiltPer||'';
  const filtQzGrado=window._qzFiltGrado||'';
  let evals=(db.evaluaciones||[]);
  if(filtQzPer) evals=evals.filter(e=>String(e.periodo)===String(filtQzPer));
  if(filtQzGrado) evals=evals.filter(e=>e.grado===filtQzGrado);
  evals=evals.sort((a,b)=>new Date(b.fechaCreacion||0)-new Date(a.fechaCreacion||0));
  const gradosDisp=isDocente?gradosDelDocente(sesion.u):db.grados.map(g=>g.n);
  const gradoOpts=gradosDisp.map(g=>`<option value="${g}">${g}</option>`).join('');
  const perOptsFilt=Array.from({length:numPer},(_,i)=>`<option value="${i+1}"${String(filtQzPer)===String(i+1)?' selected':''}>Período ${i+1}</option>`).join('');
  const gradoOptsFilt=gradosDisp.map(g=>`<option value="${g}"${filtQzGrado===g?' selected':''}>${g}</option>`).join('');
  return `<h3 class="sec-title">🧩 Quiz / Evaluaciones Temporizadas</h3>
  <div class="card" style="border-left:4px solid #8e44ad">
    <h4 class="card-title">➕ Crear Nueva Evaluación</h4>
    <div class="grid2" style="gap:8px;margin-bottom:10px">
      <div><label class="lbl">Título *</label><input id="qzTitulo" placeholder="Ej: Quiz Capítulo 3"></div>
      <div><label class="lbl">Asignatura *</label><select id="qzAsig"><option value="">— Seleccione —</option>${asigs.map(a=>`<option value="${a}">${a}</option>`).join('')}</select></div>
      <div><label class="lbl">Grado *</label><select id="qzGrado"><option value="">— Seleccione —</option>${gradoOpts}</select></div>
      <div><label class="lbl">Período *</label><select id="qzPeriodo"><option value="">— Seleccione —</option>${perOpts}</select></div>
      <div><label class="lbl">Tiempo (minutos)</label><input type="number" id="qzTiempo" min="5" max="180" value="30"></div>
      <div><label class="lbl">Intentos permitidos</label><input type="number" id="qzIntentos" min="1" max="10" value="1"></div>
      <div><label class="lbl">Fecha Límite</label><input type="date" id="qzFechaLim"></div>
    </div>
    <div id="qzPreguntasWrap">
      <h4 class="card-title" style="margin-top:0">Preguntas <span style="font-size:0.78rem;font-weight:normal;color:#8e44ad">(● marca la opción correcta para auto-calificación)</span></h4>
      <div id="qzPreguntas"></div>
      <button class="btn" style="background:#8e44ad;color:#fff;margin-top:8px" onclick="agregarPreguntaQz()">➕ Agregar Pregunta</button>
    </div>
    <div class="flex-gap" style="margin-top:14px;align-items:center">
      <button class="btn btn-green" onclick="guardarQuiz()">💾 Publicar Quiz</button>
      <button class="btn" onclick="iaAbrirConPrompt(_qzBuildPrompt())" style="background:linear-gradient(135deg,#5b2a86,#8e44ad);color:#fff;display:flex;align-items:center;gap:7px;font-size:0.87rem;border:none;border-radius:6px;padding:10px 16px;cursor:pointer;box-shadow:0 2px 10px rgba(142,68,173,0.35);transition:opacity .2s">✨ Generar Quiz con Adán</button>
    </div>
  </div>
  <div class="card">
    <h4 class="card-title">📋 Evaluaciones Creadas</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-end">
      <div><label class="lbl" style="margin-bottom:3px">Período</label><select onchange="window._qzFiltPer=this.value;renderApp()" style="padding:5px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:0.85rem"><option value="">Todos</option>${perOptsFilt}</select></div>
      <div><label class="lbl" style="margin-bottom:3px">Grado</label><select onchange="window._qzFiltGrado=this.value;renderApp()" style="padding:5px 8px;border:1.5px solid #ddd;border-radius:6px;font-size:0.85rem"><option value="">Todos</option>${gradoOptsFilt}</select></div>
    </div>
    ${evals.length?evals.map(ev=>{
      const resps=(db.evalRespuestas||[]).filter(r=>r.evalId===ev.id);
      const totalEst=db.ests.filter(x=>x.g===ev.grado).length;
      const respondieron=[...new Set(resps.map(r=>r.estId))].length;
      const pctResp=totalEst>0?Math.round(respondieron/totalEst*100):0;
      const _qzDocEsc=db.config?.escalaS||5;const notasEsc=resps.filter(r=>r.notaEscala!=null||r.puntaje!=null).map(r=>r.notaEscala!=null?r.notaEscala:Math.round((r.puntaje||0)/100*_qzDocEsc*10)/10);
      const promNota=notasEsc.length?parseFloat((notasEsc.reduce((a,b)=>a+b,0)/notasEsc.length).toFixed(1)):null;
      return `<div style="border:1.5px solid #9b59b6;border-radius:8px;padding:12px;margin-bottom:10px;background:#fdf9ff">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div>
            <b style="color:#8e44ad">${ev.titulo}</b> · <span style="font-size:0.8rem;color:#888">${ev.asignatura||'—'} · ${ev.grado}${ev.periodo?' · P'+ev.periodo:''}</span><br>
            <span style="font-size:0.78rem;color:#555">${(ev.preguntas||[]).length} preg. · ${ev.tiempoMin||30} min · ${ev.intentos||1} intento(s) · Límite: ${ev.fechaLimite||'sin fecha'}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${promNota!=null?`<span style="background:#8e44ad;color:#fff;border-radius:10px;padding:2px 10px;font-size:0.75rem">Nota prom: <b>${promNota}/${(db.config?.escalaS||5).toFixed(1)}</b></span>`:''}
            <span style="background:#e8e0ff;border-radius:10px;padding:2px 10px;font-size:0.75rem"><b>${respondieron}</b>/${totalEst} respuestas</span>
            <button class="btn-sm" style="background:${ev.activa?'#27ae60':'#888'}" onclick="toggleActividadQz('${ev.id}')">${ev.activa?'✅ Activa':'⏸ Inactiva'}</button>
            <button class="btn-sm" style="background:#2980b9" onclick="verResultadosQz('${ev.id}')">📊 Resultados</button>
            <button class="btn-sm" style="background:#c0392b" onclick="eliminarQuiz('${ev.id}')">🗑</button>
          </div>
        </div>
        <div style="margin-top:8px">
          <div style="background:#e8e0ff;border-radius:5px;height:7px;overflow:hidden">
            <div style="background:#8e44ad;height:100%;width:${pctResp}%;border-radius:5px;transition:width 0.3s"></div>
          </div>
          <div style="font-size:0.7rem;color:#888;margin-top:2px">${pctResp}% de estudiantes han respondido</div>
        </div>
      </div>`;
    }).join(''):`<p class="empty">No hay evaluaciones creadas${filtQzPer||filtQzGrado?' con los filtros seleccionados':' aún'}.</p>`}
  </div>`;
}
let _qzPregs=[];
function agregarPreguntaQz(){
  _qzPregs.push({p:'',tipo:'seleccion',opts:['','','',''],resp:0});
  renderPreguntasQz();
}
function renderPreguntasQz(){
  const wrap=document.getElementById('qzPreguntas');if(!wrap) return;
  wrap.innerHTML=_qzPregs.map((p,i)=>`<div style="border:1.5px solid #ddd;border-radius:8px;padding:12px;margin-bottom:10px;background:#fafafa">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <b style="color:#8e44ad">Pregunta ${i+1}</b>
      <select onchange="window._qzTipoChg(${i},this.value)" style="font-size:0.82rem;padding:3px 8px;border:1.5px solid #ddd;border-radius:5px">
        <option value="seleccion" ${p.tipo==='seleccion'?'selected':''}>Selección Múltiple</option>
        <option value="verdadero_falso" ${p.tipo==='verdadero_falso'?'selected':''}>Verdadero/Falso</option>
        <option value="texto" ${p.tipo==='texto'?'selected':''}>Respuesta Abierta</option>
      </select>
      <button onclick="window._qzElim(${i})" style="background:#c0392b;color:#fff;border:none;border-radius:5px;padding:2px 8px;font-size:0.78rem;cursor:pointer;margin-left:auto">🗑</button>
    </div>
    <textarea oninput="window._qzSetEnunciado(${i},this.value)" placeholder="Enunciado de la pregunta..." style="width:100%;padding:7px;border:1.5px solid #ddd;border-radius:7px;margin-bottom:8px;box-sizing:border-box;min-height:56px;resize:vertical;font-size:0.9rem;font-family:inherit">${p.p}</textarea>
    ${p.tipo==='seleccion'?(p.opts||['','','']).map((o,oi)=>`<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;width:100%;box-sizing:border-box">
      <input type="radio" name="qzResp_${i}" value="${oi}" ${p.resp===oi?'checked':''} onchange="window._qzSetResp(${i},${oi})" style="accent-color:#8e44ad;flex-shrink:0;width:16px;height:16px" title="Marcar como correcta">
      <span style="font-size:0.85rem;color:#8e44ad;font-weight:bold;flex-shrink:0;min-width:20px">${['A','B','C','D'][oi]||oi+1}.</span>
      <textarea oninput="window._qzSetOpt(${i},${oi},this.value)" placeholder="Opción ${['A','B','C','D'][oi]||oi+1}..." style="flex:1;min-width:0;padding:7px 10px;border:1.5px solid #ddd;border-radius:6px;font-size:0.9rem;box-sizing:border-box;width:100%;min-height:38px;max-height:110px;resize:vertical;line-height:1.4;font-family:inherit;overflow-y:auto">${o}</textarea>
    </div>`).join(''):''}
    ${p.tipo==='verdadero_falso'?`<div style="display:flex;gap:10px">
      <label><input type="radio" name="qzResp_${i}" value="0" ${p.resp===0?'checked':''} onchange="window._qzSetResp(${i},0)" style="accent-color:#8e44ad"> Verdadero</label>
      <label><input type="radio" name="qzResp_${i}" value="1" ${p.resp===1?'checked':''} onchange="window._qzSetResp(${i},1)" style="accent-color:#8e44ad"> Falso</label>
    </div>`:''}
    ${p.tipo==='texto'?'<div style="font-size:0.8rem;color:#888">Esta pregunta no tiene corrección automática.</div>':''}
    <div style="margin-top:8px">
      <label style="font-size:0.78rem;font-weight:bold;color:#6c3483;display:block;margin-bottom:3px">💡 Retroalimentación (opcional — se muestra al estudiante al finalizar)</label>
      <textarea oninput="window._qzSetJust(${i},this.value)" placeholder="Explica por qué esa es la respuesta correcta..." style="width:100%;padding:7px;border:1.5px solid #c39bd3;border-radius:6px;min-height:46px;resize:vertical;font-size:0.85rem;font-family:inherit;box-sizing:border-box">${p.just||''}</textarea>
    </div>
  </div>`).join('');
}
window._qzTipoChg=function(i,t){_qzPregs[i].tipo=t;if(t==='seleccion'&&!_qzPregs[i].opts) _qzPregs[i].opts=['','','',''];_qzPregs[i].resp=0;renderPreguntasQz();}
window._qzElim=function(i){_qzPregs.splice(i,1);renderPreguntasQz();}
window._qzSetEnunciado=function(i,v){_qzPregs[i].p=v;}
window._qzSetResp=function(i,v){_qzPregs[i].resp=parseInt(v);}
window._qzSetOpt=function(i,oi,v){if(_qzPregs[i].opts) _qzPregs[i].opts[oi]=v;}
window._qzSetJust=function(i,v){_qzPregs[i].just=v;}
function guardarQuiz(){
  const titulo=(document.getElementById('qzTitulo')?.value||'').trim();
  const asig=document.getElementById('qzAsig')?.value||'';
  const grado=document.getElementById('qzGrado')?.value||'';
  const periodo=document.getElementById('qzPeriodo')?.value||'';
  const tiempo=parseInt(document.getElementById('qzTiempo')?.value||'30');
  const intentos=parseInt(document.getElementById('qzIntentos')?.value||'1');
  const fechaLim=document.getElementById('qzFechaLim')?.value||'';
  if(!titulo||!grado){alert('Ingrese título y grado.');return;}
  if(!asig){alert('Seleccione la asignatura.');return;}
  if(!periodo){alert('Seleccione el período.');return;}
  if(!_qzPregs.length){alert('Agregue al menos una pregunta.');return;}
  const pregs=_qzPregs.map(p=>({...p}));
  updDB(db2=>{
    if(!Array.isArray(db2.evaluaciones)) db2.evaluaciones=[];
    db2.evaluaciones.push({id:Date.now()+Math.random(),titulo,asignatura:asig,grado,periodo:Number(periodo),tiempoMin:tiempo,intentos,fechaLimite:fechaLim,preguntas:pregs,docente:sesion.u,activa:true,fechaCreacion:new Date().toISOString().slice(0,10)});
    return db2;
  });
  _qzPregs=[];
  alert('✅ Quiz publicado.');renderApp();
}
function _qzBuildPrompt(){
  const asig=document.getElementById('qzAsig')?.value||'';
  const grado=document.getElementById('qzGrado')?.value||'';
  const titulo=(document.getElementById('qzTitulo')?.value||'').trim();
  const asigTxt=asig?` de ${asig}`:'';
  const gradoTxt=grado?` para el grado ${grado}`:'';
  const temaTxt=titulo?` sobre "${titulo}"`:' sobre el siguiente tema: [describe el tema aquí]';
  return `Adán, por favor genera un quiz de 5 preguntas de opción múltiple (con 4 opciones A/B/C/D)${asigTxt}${temaTxt}${gradoTxt}. Para cada pregunta: marca claramente la respuesta correcta con ✓ y agrega una retroalimentación breve que explique el por qué. Presenta el resultado de forma organizada y lista para usar en clase.`;
}
function eliminarQuiz(evalId){if(!confirm('¿Eliminar evaluación y todas sus respuestas?')) return;
  updDB(db2=>{db2.evaluaciones=(db2.evaluaciones||[]).filter(x=>x.id!=evalId);db2.evalRespuestas=(db2.evalRespuestas||[]).filter(x=>x.evalId!=evalId);return db2;});
  renderApp();
}
function toggleActividadQz(evalId){
  updDB(db2=>{const ev=db2.evaluaciones.find(x=>x.id==evalId);if(ev) ev.activa=!ev.activa;return db2;});
  renderApp();
}
function verResultadosQz(evalId){
  const ev=(db.evaluaciones||[]).find(x=>x.id==evalId);if(!ev) return;
  const resps=(db.evalRespuestas||[]).filter(r=>r.evalId==evalId);
  const ests=db.ests.filter(e=>e.g===ev.grado);
  const ov=document.createElement('div');ov.id='_resQzOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  const rows=ests.map(e=>{
    const misR=resps.filter(r=>r.estId===e.id).sort((a,b)=>b.intento-a.intento);
    const mejorPct=misR.length?Math.max(...misR.map(r=>r.puntaje||0)):null;
    const notasEsc=misR.filter(r=>r.notaEscala!=null).map(r=>r.notaEscala);
    const _vrEsc=db.config?.escalaS||5;const _vrEscB=db.config?.escalaB||3;
    const mejorNota=notasEsc.length?Math.max(...notasEsc):mejorPct!=null?Math.round((mejorPct/100)*_vrEsc*10)/10:null;
    return `<tr>
      <td style="text-align:left">${fmtNombreEst(e)}</td>
      <td style="text-align:center">${misR.length}</td>
      <td style="text-align:center;font-weight:bold;color:${mejorNota!=null?(mejorNota>=_vrEscB?'#27ae60':'#c0392b'):'#888'}">${mejorNota!=null?mejorNota+'/'+_vrEsc.toFixed(1)+' '+esc(mejorNota):'—'}</td>
    </tr>`;
  }).join('');
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;padding:24px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
    <h3 style="color:#8e44ad;margin-bottom:14px">📊 Resultados: ${ev.titulo}</h3>
    <div class="over"><table><thead><tr><th style="text-align:left">Estudiante</th><th>Intentos</th><th>Mejor Puntaje</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <button onclick="document.getElementById('_resQzOv').remove()" style="background:#eee;border:none;border-radius:7px;padding:10px 18px;cursor:pointer">Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}

// ============================================================
// ADMIN — EVALUACIÓN DOCENTES (anónima)
// ============================================================
function htmlEvalDocenteAdmin(){
  const evals=(db.evalDocente||[]).sort((a,b)=>new Date(b.fechaCreacion||0)-new Date(a.fechaCreacion||0));
  const gradoOpts=db.grados.map(g=>`<option value="${g.n}">${g.n}</option>`).join('');
  return `<h3 class="sec-title">⭐ Evaluación de Docentes — Anónima</h3>
  <div class="info-box"><b>¿Cómo funciona?</b> Usted crea la encuesta, activa el período de respuesta y los estudiantes la responden de forma anónima. Los resultados muestran solo estadísticas consolidadas, sin identificar a ningún estudiante.</div>
  <div class="card" style="border-left:4px solid #f39c12">
    <h4 class="card-title">➕ Crear Nueva Evaluación</h4>
    <div class="grid2" style="gap:8px;margin-bottom:10px">
      <div><label class="lbl">Título *</label><input id="evdTitulo" placeholder="Ej: Evaluación Docentes Período 1"></div>
      <div><label class="lbl">Cursos participantes</label><select id="evdCursos" multiple size="3" style="width:100%">${gradoOpts}</select></div>
    </div>
    <div id="evdPreguntasWrap">
      <h4 class="card-title" style="margin-top:0">Preguntas de la Encuesta</h4>
      <div id="evdPreguntas"></div>
      <button class="btn" style="background:#f39c12;color:#fff;margin-top:8px" onclick="agregarPreguntaEvd()">➕ Agregar Pregunta</button>
    </div>
    <div class="flex-gap" style="margin-top:14px">
      <button class="btn btn-green" onclick="guardarEvalDocente()">💾 Publicar Encuesta</button>
    </div>
  </div>
  <div class="card">
    <h4 class="card-title">📋 Encuestas Creadas</h4>
    ${evals.length?evals.map(ev=>{
      const totalResp=(ev.resp||[]).length;
      return `<div style="border:1.5px solid #f39c12;border-radius:8px;padding:12px;margin-bottom:10px;background:#fffbf0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div>
            <b>${ev.titulo}</b><br>
            <span style="font-size:0.78rem;color:#555">${(ev.preguntas||[]).length} preguntas · Cursos: ${(ev.cursos||[]).join(', ')} · ${totalResp} respuestas</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button class="btn-sm" style="background:${ev.activa?'#27ae60':'#888'}" onclick="toggleEvalDocente('${ev.id}')">${ev.activa?'✅ Activa':'⏸ Inactiva'}</button>
            <button class="btn-sm" style="background:#2980b9" onclick="verResultadosEvd('${ev.id}')">📊 Ver Resultados</button>
            <button class="btn-sm" style="background:#c0392b" onclick="eliminarEvalDocente('${ev.id}')">🗑</button>
          </div>
        </div>
      </div>`;
    }).join(''):`<p class="empty">No hay encuestas creadas.</p>`}
  </div>`;
}
let _evdPregs=[];
function agregarPreguntaEvd(){
  _evdPregs.push({p:'',tipo:'escala5'});
  renderPreguntasEvd();
}
function renderPreguntasEvd(){
  const wrap=document.getElementById('evdPreguntas');if(!wrap) return;
  wrap.innerHTML=_evdPregs.map((p,i)=>`<div style="border:1.5px solid #f39c12;border-radius:8px;padding:10px;margin-bottom:8px;background:#fffbf0">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
      <b style="color:#f39c12">${i+1}</b>
      <select onchange="window._evdTipo(${i},this.value)" style="font-size:0.82rem;padding:3px 8px;border:1.5px solid #ddd;border-radius:5px">
        <option value="escala5" ${p.tipo==='escala5'?'selected':''}>Escala 1-5 estrellas</option>
        <option value="texto" ${p.tipo==='texto'?'selected':''}>Respuesta abierta</option>
        <option value="seleccion" ${p.tipo==='seleccion'?'selected':''}>Selección múltiple</option>
      </select>
      <button onclick="window._evdElim(${i})" style="background:#c0392b;color:#fff;border:none;border-radius:5px;padding:2px 8px;font-size:0.78rem;cursor:pointer;margin-left:auto">🗑</button>
    </div>
    <input value="${p.p}" oninput="window._evdSetP(${i},this.value)" placeholder="Escribe la pregunta..." style="width:100%;padding:7px;border:1.5px solid #ddd;border-radius:7px">
    ${p.tipo==='seleccion'?`<div style="margin-top:6px"><label class="lbl" style="font-size:0.78rem">Opciones (una por línea)</label><textarea id="evdOpts_${i}" oninput="window._evdSetOpts(${i},this.value)" style="width:100%;min-height:50px;padding:5px;border:1.5px solid #ddd;border-radius:5px;font-size:0.82rem" placeholder="Muy satisfecho&#10;Satisfecho&#10;Neutral&#10;Insatisfecho">${(p.opts||[]).join('\n')}</textarea></div>`:''}
  </div>`).join('');
}
window._evdTipo=function(i,t){_evdPregs[i].tipo=t;renderPreguntasEvd();}
window._evdElim=function(i){_evdPregs.splice(i,1);renderPreguntasEvd();}
window._evdSetP=function(i,v){_evdPregs[i].p=v;}
window._evdSetOpts=function(i,v){_evdPregs[i].opts=v.split('\n').map(x=>x.trim()).filter(Boolean);}
function guardarEvalDocente(){
  const titulo=(document.getElementById('evdTitulo')?.value||'').trim();
  const cursosEl=document.getElementById('evdCursos');
  const cursos=cursosEl?Array.from(cursosEl.selectedOptions).map(o=>o.value):[];
  if(!titulo){alert('Ingrese título.');return;}
  if(!_evdPregs.length){alert('Agregue al menos una pregunta.');return;}
  const pregs=_evdPregs.map(p=>({...p}));
  updDB(db2=>{
    if(!Array.isArray(db2.evalDocente)) db2.evalDocente=[];
    db2.evalDocente.push({id:Date.now()+Math.random(),titulo,cursos,preguntas:pregs,activa:true,resp:[],fechaCreacion:new Date().toISOString().slice(0,10)});
    return db2;
  });
  _evdPregs=[];
  alert('✅ Encuesta publicada. Los estudiantes podrán responderla desde su panel.');renderApp();
}
function eliminarEvalDocente(evalId){if(!confirm('¿Eliminar encuesta y todas sus respuestas?')) return;
  updDB(db2=>{db2.evalDocente=(db2.evalDocente||[]).filter(x=>x.id!=evalId);return db2;});
  renderApp();
}
function toggleEvalDocente(evalId){
  updDB(db2=>{const ev=(db2.evalDocente||[]).find(x=>x.id==evalId);if(ev) ev.activa=!ev.activa;return db2;});
  renderApp();
}
function verResultadosEvd(evalId){
  const ev=(db.evalDocente||[]).find(x=>x.id==evalId);if(!ev) return;
  const resps=ev.resp||[];
  const pregs=ev.preguntas||[];
  const ov=document.createElement('div');ov.id='_resEvdOv';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  const statsHtml=pregs.map((p,pi)=>{
    const vals=resps.map(r=>r.resps?.[pi]).filter(v=>v!=null);
    if(p.tipo==='escala5'){
      const avg=vals.length?( vals.reduce((s,v)=>s+Number(v),0)/vals.length).toFixed(2):null;
      const dist=[1,2,3,4,5].map(v=>({v,c:vals.filter(x=>Number(x)===v).length}));
      return `<div style="margin-bottom:16px;padding:12px;background:#fffbf0;border-radius:8px;border:1.5px solid #f39c12">
        <b>${pi+1}. ${p.p}</b><br>
        <div style="font-size:1.2rem;color:#f39c12;margin:6px 0">Promedio: <b>${avg||'—'}</b> ⭐ (${vals.length} respuestas)</div>
        <div style="display:flex;gap:4px;align-items:flex-end;height:50px">
          ${dist.map(d=>`<div style="display:flex;flex-direction:column;align-items:center;flex:1">
            <div style="background:#f39c12;border-radius:4px 4px 0 0;width:100%;height:${vals.length?Math.max(4,Math.round((d.c/vals.length)*46)):4}px"></div>
            <div style="font-size:0.7rem">${d.v}⭐</div>
            <div style="font-size:0.72rem;font-weight:bold;color:#555">${d.c}</div>
          </div>`).join('')}
        </div>
      </div>`;
    }
    if(p.tipo==='texto'){
      const textos=vals.filter(v=>typeof v==='string'&&v.trim());
      return `<div style="margin-bottom:16px;padding:12px;background:#fffbf0;border-radius:8px;border:1.5px solid #f39c12">
        <b>${pi+1}. ${p.p}</b> <span style="font-size:0.8rem;color:#888">(${textos.length} respuestas)</span>
        <ul style="margin:6px 0;padding-left:16px">${textos.map(t=>`<li style="font-size:0.85rem;color:#555;margin-bottom:3px">"${t}"</li>`).join('')}</ul>
      </div>`;
    }
    return `<div style="margin-bottom:16px;padding:12px;background:#fffbf0;border-radius:8px;border:1.5px solid #f39c12">
      <b>${pi+1}. ${p.p}</b> <span style="font-size:0.8rem;color:#888">(${vals.length} respuestas)</span>
      ${(p.opts||[]).map((o,oi)=>{const c=vals.filter(v=>v==oi).length;return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span style="font-size:0.82rem;min-width:120px">${o}</span><div style="height:14px;background:#f39c12;border-radius:4px;width:${vals.length?Math.round((c/vals.length)*180):0}px"></div><span style="font-size:0.8rem;color:#555">${c}</span></div>`;}).join('')}
    </div>`;
  }).join('');
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;padding:24px;max-width:580px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.3)">
    <h3 style="color:#f39c12;margin-bottom:4px">📊 Resultados: ${ev.titulo}</h3>
    <div style="font-size:0.82rem;color:#888;margin-bottom:14px">Total de respuestas anónimas: <b>${resps.length}</b> · Cursos: ${(ev.cursos||[]).join(', ')}</div>
    ${statsHtml||'<p class="empty">Sin respuestas aún.</p>'}
    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <button onclick="document.getElementById('_resEvdOv').remove()" style="background:#eee;border:none;border-radius:7px;padding:10px 18px;cursor:pointer">Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
}

// ============================================================
// SEGUIMIENTO EVALUACIÓN DESEMPEÑO DOCENTE — DRIVE
// ============================================================
function htmlSeguimientoEvalDocenteAdmin(){
  const link=db.config?.driveEvalDesempeno||'';
  const accesoList=db.config?.driveEvalAcceso;
  const accesoConfigurado=accesoList!==null&&accesoList!==undefined;
  const todosDocentes=db.users.filter(u=>u.r==='docente');
  const docCalifican=todosDocentes.filter(u=>_docenteCalificaEvalDesempeno(u));
  const docNoCalifican=todosDocentes.filter(u=>!_docenteCalificaEvalDesempeno(u));
  const badgeDecre=(u)=>{
    if(!u.decreto) return `<span style="background:#f8d7da;color:#721c24;padding:2px 7px;border-radius:10px;font-size:0.72rem">Sin decreto</span>`;
    if(u.decreto==='2277') return `<span style="background:#fff3cd;color:#856404;padding:2px 7px;border-radius:10px;font-size:0.72rem">Dec. 2277 — Sin acceso</span>`;
    if(u.modalidadDecre==='Propiedad'||u.modalidadDecre==='Periodo de Prueba') return `<span style="background:#d1ecf1;color:#0c5460;padding:2px 7px;border-radius:10px;font-size:0.72rem">Dec. 1278 — ${u.modalidadDecre}</span>`;
    return `<span style="background:#fde8e8;color:#922b21;padding:2px 7px;border-radius:10px;font-size:0.72rem">Dec. 1278 — ${u.modalidadDecre||'Sin modalidad'} — Sin acceso</span>`;
  };
  return `<h3 class="sec-title">📁 Seguimiento Evaluación de Desempeño Docente</h3>
  <div class="info-box" style="border-left-color:#1a5276;background:#eaf2f8">ℹ️ Solo los docentes del <b>Decreto 1278</b> en <b>Propiedad</b> o <b>Periodo de Prueba</b> tienen acceso a este módulo. Los provisionales y los del Decreto 2277 <b>no tienen acceso</b>.</div>
  <div class="card" style="border-left:4px solid #1a5276">
    <h4 class="card-title">🔗 Enlace Google Drive para carga de documentos</h4>
    <p style="font-size:0.85rem;color:#555;margin-bottom:12px">Ingrese el enlace compartido de la carpeta de Google Drive donde los docentes elegibles subirán sus documentos de evaluación de desempeño.</p>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
      <div style="flex:1;min-width:260px">
        <label class="lbl">🔗 Enlace de Google Drive *</label>
        <input id="driveEvalLink" type="url" value="${link.replace(/"/g,'&quot;')}" placeholder="https://drive.google.com/drive/folders/..." style="width:100%;box-sizing:border-box">
      </div>
      <button class="btn btn-green" onclick="guardarDriveEvalDocente()" style="white-space:nowrap;padding:9px 18px">💾 Guardar todo</button>
    </div>
    ${link?`<div style="background:#eafaf1;border:1.5px solid #27ae60;border-radius:8px;padding:10px 14px;font-size:0.85rem;margin-bottom:0">
      <b>✅ Enlace configurado.</b> <a href="${link}" target="_blank" style="color:#1a5276;word-break:break-all;font-size:0.82rem">${link.length>60?link.slice(0,60)+'…':link}</a>
    </div>`:`<div class="info-box" style="margin-bottom:0;background:#fef9e7;border-left-color:#f39c12">⚠️ Aún no hay enlace configurado.</div>`}
  </div>
  <div class="card" style="border-left:4px solid #27ae60">
    <h4 class="card-title">✅ Docentes con acceso habilitado (Decreto 1278 elegibles)</h4>
    <p style="font-size:0.83rem;color:#555;margin-bottom:10px">Seleccione a cuáles docentes elegibles les habilita el acceso al enlace Drive. Al guardar, <b>solo los marcados tendrán acceso</b>. Si desmarca a todos y guarda, nadie tendrá acceso.</p>
    ${docCalifican.length?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:7px">
      ${docCalifican.map(u=>{
        const checked=!accesoConfigurado||accesoList.includes(u.u);
        return `<label style="display:flex;align-items:flex-start;gap:8px;background:#f0faf4;border:1.5px solid #a9dfbf;border-radius:8px;padding:9px 12px;cursor:pointer">
          <input type="checkbox" id="evalAcc_${u.u}" ${checked?'checked':''} style="margin-top:2px;accent-color:#27ae60">
          <span>
            <span style="font-weight:700;font-size:0.86rem;display:block">${u.n}</span>
            <span style="font-size:0.75rem;color:#555">${badgeDecre(u)}</span>
            ${u.tipoPregrado||u.nivelFormacion?`<span style="font-size:0.72rem;color:#555;display:block;margin-top:2px">🎓 ${u.tipoPregrado?u.tipoPregrado+' — ':''}${u.nivelFormacion||''}</span>`:''}
            ${u.nivelPosgrado?`<span style="font-size:0.7rem;color:#6c3483;display:block">🏅 ${u.nivelPosgrado}${u.tituloPosgrado?' — '+u.tituloPosgrado:''}</span>`:''}
          </span>
        </label>`;
      }).join('')}
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" style="background:#27ae60;color:#fff;font-size:0.78rem;padding:5px 14px" onclick="docCalifican_markAll(true)">✓ Marcar todos</button>
      <button class="btn btn-gray" style="font-size:0.78rem;padding:5px 14px" onclick="docCalifican_markAll(false)">○ Desmarcar todos</button>
    </div>`:
    `<div class="info-box" style="background:#fff3cd;border-left-color:#f39c12">⚠️ No hay docentes del Decreto 1278 con modalidad válida registrados. Asigne el decreto y modalidad en <b>Carga Académica → editar docente</b>.</div>`}
  </div>
  ${docNoCalifican.length?`<div class="card" style="border-left:4px solid #e74c3c">
    <h4 class="card-title" style="color:#c0392b">🚫 Docentes SIN acceso (Decreto 2277 / sin decreto)</h4>
    <p style="font-size:0.83rem;color:#777;margin-bottom:8px">Estos docentes <b>no verán</b> el módulo ni el enlace Drive. No aparecen en la lista de acceso.</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${docNoCalifican.map(u=>`<span style="background:#fdecea;color:#922b21;border:1px solid #f1948a;border-radius:8px;padding:5px 10px;font-size:0.8rem">🚫 ${u.n} — ${badgeDecre(u)}</span>`).join('')}
    </div>
  </div>`:''}`;
}
function docCalifican_markAll(state){
  document.querySelectorAll('[id^="evalAcc_"]').forEach(el=>el.checked=state);
}
function guardarDriveEvalDocente(){
  const link=(document.getElementById('driveEvalLink')?.value||'').trim();
  if(!link){alert('Ingrese un enlace válido de Google Drive.');return;}
  const acceso=[];
  document.querySelectorAll('[id^="evalAcc_"]').forEach(el=>{if(el.checked) acceso.push(el.id.replace('evalAcc_',''));});
  updDB(db2=>{
    if(!db2.config) db2.config={};
    db2.config.driveEvalDesempeno=link;
    db2.config.driveEvalAcceso=acceso;
    return db2;
  });
  alert('✅ Enlace y accesos guardados correctamente.');renderApp();
}
function htmlSeguimientoEvalDocenteDocente(){
  const link=db.config?.driveEvalDesempeno||'';
  const accesoList=db.config?.driveEvalAcceso;
  const accesoConfigurado2=accesoList!==null&&accesoList!==undefined;
  const usrFull=db.users.find(x=>x.u===sesion.u)||sesion;
  const califica=_docenteCalificaEvalDesempeno(usrFull);
  const tieneAcceso=califica&&(!accesoConfigurado2||accesoList.includes(sesion.u));
  const encoded=link?encodeURIComponent(link):'';
  const qrUrl=link?`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encoded}&bgcolor=ffffff&color=1a5276&margin=10`:'';
  const docNombre=sesion.n||sesion.u||'Docente';
  const badgeInfo=`<div style="background:#eaf4fb;border:1.5px solid #aed6f1;border-radius:8px;padding:8px 12px;font-size:0.81rem;margin-bottom:14px">
    📜 <b>Decreto:</b> ${usrFull.decreto||'No registrado'} &nbsp;|&nbsp; 📋 <b>Modalidad:</b> ${usrFull.decreto==='1278'?(usrFull.modalidadDecre||'Sin definir'):'N/A'}
    <br style="margin:3px 0">
    🎓 <b>Pregrado:</b> ${usrFull.tipoPregrado?`<b>${usrFull.tipoPregrado}</b>${usrFull.nivelFormacion?' — '+usrFull.nivelFormacion:''}`:usrFull.nivelFormacion||'No registrado'}
    ${usrFull.nivelPosgrado?`&nbsp;|&nbsp; 🏅 <b>Posgrado:</b> ${usrFull.nivelPosgrado}${usrFull.tituloPosgrado?' — '+usrFull.tituloPosgrado:''}`:''}  
  </div>`;
  if(!califica){
    return `<h3 class="sec-title">📁 Evaluación de Desempeño</h3>
    <div class="card" style="border-left:4px solid #e74c3c;max-width:520px;margin:0 auto">
      ${badgeInfo}
      <div style="text-align:center;padding:24px 16px">
        <div style="font-size:3rem;margin-bottom:12px">🚫</div>
        <p style="color:#c0392b;font-size:0.95rem;font-weight:bold">Sin acceso a este módulo</p>
        <p style="color:#888;font-size:0.85rem">El módulo de Evaluación de Desempeño está disponible únicamente para docentes del <b>Decreto 1278</b> en <b>Propiedad</b> o <b>Periodo de Prueba</b>.<br><br>Su decreto o modalidad no cumple los requisitos. Contacte al administrador para actualizar su información.</p>
      </div>
    </div>`;
  }
  if(!tieneAcceso){
    return `<h3 class="sec-title">📁 Evaluación de Desempeño</h3>
    <div class="card" style="border-left:4px solid #f39c12;max-width:520px;margin:0 auto">
      ${badgeInfo}
      <div style="text-align:center;padding:24px 16px">
        <div style="font-size:3rem;margin-bottom:12px">⏳</div>
        <p style="color:#d68910;font-size:0.95rem;font-weight:bold">Acceso pendiente de habilitación</p>
        <p style="color:#888;font-size:0.85rem">Usted califica para este módulo, pero el administrador aún no ha habilitado su acceso al enlace Drive. Por favor espere a que la rectoría lo habilite.</p>
      </div>
    </div>`;
  }
  return `<h3 class="sec-title">📁 Evaluación de Desempeño — Carga de Documentos</h3>
  <div class="card" style="border-left:4px solid #1a5276;max-width:520px;margin:0 auto">
    <h4 class="card-title">📋 Instrucciones para ${docNombre}</h4>
    ${badgeInfo}
    <div class="info-box" style="margin-bottom:14px">Para cargar sus documentos, haga clic en el botón de abajo o escanee el código QR con su celular. El enlace lo lleva directamente a la carpeta de Drive habilitada por la rectoría.</div>
    ${link?`
    <div style="text-align:center;padding:16px 0">
      <button onclick="window.open('${link}','_blank')" style="background:#1a5276;color:#fff;border:none;border-radius:12px;padding:16px 36px;font-size:1.05rem;font-weight:bold;cursor:pointer;box-shadow:0 4px 12px rgba(26,82,118,0.3);margin-bottom:24px;display:inline-flex;align-items:center;gap:10px;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        <span style="font-size:1.4rem">📤</span> Cargar Documentos en Drive
      </button>
      <div style="margin-bottom:8px">
        <p style="font-size:0.82rem;color:#888;margin-bottom:10px">O escanee este código QR desde su celular:</p>
        <div style="display:inline-block;background:#fff;border-radius:12px;padding:10px;box-shadow:0 2px 8px rgba(0,0,0,0.12);border:2px solid #dce6f0">
          <img src="${qrUrl}" alt="QR Drive" width="180" height="180" style="display:block;border-radius:6px">
        </div>
        <p style="font-size:0.75rem;color:#aaa;margin-top:8px">Apunte la cámara al QR para abrir el Drive directamente</p>
      </div>
    </div>
    <div style="background:#eafaf1;border-radius:8px;padding:10px 14px;font-size:0.83rem;color:#1e8449;text-align:center">
      ✅ Acceso habilitado por la rectoría. Cargue sus documentos cuando los tenga listos.
    </div>`:
    `<div style="text-align:center;padding:30px 20px">
      <div style="font-size:3rem;margin-bottom:12px">⏳</div>
      <p style="color:#888;font-size:0.9rem">La rectoría aún no ha configurado el enlace de Drive.<br>Por favor espere.</p>
    </div>`}
  </div>`;
}

// ============================================================
// PAZ Y SALVO — botón en tabla de estudiantes (privada)
// ============================================================
function htmlBtnPazSalvo(est){
  if(_getPlatTipo()!=='privada') return '';
  const ps=_getPazSalvoEst(est);
  return `<button class="btn-sm" style="background:${ps.ok?'#27ae60':'#c0392b'}" title="Gestionar Paz y Salvo" onclick="abrirPazSalvoModal('${String(est.id)}')">${ps.ok?'⚖️ P&S':'⚖️ !'}</button>`;
}

// ============================================================
// TRASLADO DE ESTUDIANTES ENTRE GRADOS (con conservación de notas)
// ============================================================
// Abre modal para trasladar UN estudiante (desde botón 🔄 en la tabla)
function abrirModalTrasladar1(estId){
  const e=db.ests.find(x=>String(x.id)===String(estId));
  if(!e){alert('Estudiante no encontrado.');return;}
  const gradOpts=db.grados.filter(g=>g.n!==e.g).map(g=>`<option value="${g.n}">${g.n}</option>`).join('');
  if(!gradOpts){alert('No hay otros grados disponibles para trasladar.');return;}
  let ov=document.getElementById('_trasladoModal');if(ov)ov.remove();
  ov=document.createElement('div');ov.id='_trasladoModal';
  ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:480px;box-shadow:0 8px 40px rgba(0,0,0,0.35);overflow:hidden">
    <div style="background:#16a085;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:1rem">🔄 Trasladar Estudiante</span>
      <button onclick="document.getElementById('_trasladoModal').remove()" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer">✕</button>
    </div>
    <div style="padding:22px 20px">
      <div style="background:#e8f8f5;border-radius:8px;padding:12px 14px;margin-bottom:18px;font-size:0.88rem">
        <b>Estudiante:</b> ${fmtNombreEst(e)}<br>
        <b>Grado actual:</b> <span style="color:#e74c3c;font-weight:700">${e.g}</span>
      </div>
      <div style="margin-bottom:18px">
        <label style="display:block;font-size:0.85rem;font-weight:700;color:#555;margin-bottom:6px">Grado destino *</label>
        <select id="_trasladoGradoDest" style="width:100%;padding:10px 12px;border:2px solid #16a085;border-radius:7px;font-size:0.92rem">
          ${gradOpts}
        </select>
      </div>
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#856404;margin-bottom:18px">
        ✅ <b>Todas las notas de todos los periodos</b> del estudiante se conservan sin cambios al trasladarlo.
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('_trasladoModal').remove()" style="flex:1;background:#7f8c8d;color:#fff;border:none;border-radius:8px;padding:11px;font-size:0.9rem;font-weight:700;cursor:pointer">Cancelar</button>
        <button onclick="_ejecutarTraslado1('${estId}')" style="flex:2;background:#16a085;color:#fff;border:none;border-radius:8px;padding:11px;font-size:0.9rem;font-weight:700;cursor:pointer">🔄 Trasladar Ahora</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
}
function _ejecutarTraslado1(estId){
  const gradDest=(document.getElementById('_trasladoGradoDest')?.value||'').trim();
  if(!gradDest){alert('Seleccione el grado destino.');return;}
  const e=db.ests.find(x=>String(x.id)===String(estId));
  if(!e){alert('Estudiante no encontrado.');return;}
  const gradOrigen=e.g;
  updDB(d=>{
    const idx=d.ests.findIndex(x=>String(x.id)===String(estId));
    if(idx>=0) d.ests[idx]={...d.ests[idx],g:gradDest};
    return d;
  });
  document.getElementById('_trasladoModal')?.remove();
  _showToast(`✅ ${fmtNombreEst(e)} trasladado(a) de ${gradOrigen} → ${gradDest}. Notas conservadas.`,'#16a085');
  renderApp();
}

// Abre modal para traslado masivo entre grados
function abrirModalTrasladarMasivo(){
  const gradOpts=db.grados.map(g=>`<option value="${g.n}">${g.n}</option>`).join('');
  if(db.grados.length<2){alert('Se necesitan al menos 2 grados para realizar un traslado.');return;}
  let ov=document.getElementById('_trasladoMasivoModal');if(ov)ov.remove();
  ov=document.createElement('div');ov.id='_trasladoMasivoModal';
  ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.65);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;width:100%;max-width:680px;box-shadow:0 8px 40px rgba(0,0,0,0.35);overflow:hidden;margin:auto">
    <div style="background:#16a085;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:1rem">🔄 Traslado Masivo de Estudiantes</span>
      <button onclick="document.getElementById('_trasladoMasivoModal').remove()" style="background:none;border:none;color:#fff;font-size:1.4rem;cursor:pointer">✕</button>
    </div>
    <div style="padding:20px">
      <div class="grid2" style="gap:12px;margin-bottom:16px">
        <div>
          <label style="display:block;font-size:0.83rem;font-weight:700;color:#555;margin-bottom:5px">Grado de origen</label>
          <select id="_tmGradoOrigen" onchange="_tmCargarEstudiantes()" style="width:100%;padding:9px 12px;border:2px solid #16a085;border-radius:7px;font-size:0.9rem">${gradOpts}</select>
        </div>
        <div>
          <label style="display:block;font-size:0.83rem;font-weight:700;color:#555;margin-bottom:5px">Grado destino</label>
          <select id="_tmGradoDest" style="width:100%;padding:9px 12px;border:1px solid #ccc;border-radius:7px;font-size:0.9rem">${gradOpts}</select>
        </div>
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="_tmSelecTodos(true)" style="background:#1a5276;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:0.82rem;font-weight:700;cursor:pointer">✔ Seleccionar todos</button>
        <button onclick="_tmSelecTodos(false)" style="background:#7f8c8d;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:0.82rem;font-weight:700;cursor:pointer">✗ Deseleccionar todos</button>
      </div>
      <div id="_tmEstLista" style="max-height:280px;overflow-y:auto;border:1px solid #ddd;border-radius:8px;padding:8px"></div>
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#856404;margin:14px 0">
        ✅ Todas las notas de todos los periodos de los estudiantes seleccionados se conservan sin cambios.
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('_trasladoMasivoModal').remove()" style="flex:1;background:#7f8c8d;color:#fff;border:none;border-radius:8px;padding:11px;font-size:0.9rem;font-weight:700;cursor:pointer">Cancelar</button>
        <button onclick="_ejecutarTrasladoMasivo()" style="flex:2;background:#16a085;color:#fff;border:none;border-radius:8px;padding:11px;font-size:0.9rem;font-weight:700;cursor:pointer">🔄 Trasladar Seleccionados</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(_tmCargarEstudiantes,80);
}
function _tmCargarEstudiantes(){
  const gOrigen=(document.getElementById('_tmGradoOrigen')?.value||'');
  const lista=document.getElementById('_tmEstLista');if(!lista)return;
  const ests=db.ests.filter(e=>e.g===gOrigen).sort((a,b)=>fmtNombreEst(a).localeCompare(fmtNombreEst(b)));
  if(!ests.length){lista.innerHTML='<p style="color:#888;padding:12px;text-align:center">No hay estudiantes en este grado.</p>';return;}
  lista.innerHTML=ests.map(e=>`<label style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer;border-radius:5px" class="tm-est-row">
    <input type="checkbox" value="${e.id}" style="width:17px;height:17px;accent-color:#16a085;flex-shrink:0">
    <span style="font-size:0.87rem;font-weight:600">${fmtNombreEst(e)}</span>
  </label>`).join('');
}
function _tmSelecTodos(sel){
  document.querySelectorAll('#_tmEstLista input[type=checkbox]').forEach(c=>c.checked=sel);
}
function _ejecutarTrasladoMasivo(){
  const gDest=(document.getElementById('_tmGradoDest')?.value||'').trim();
  const gOrigen=(document.getElementById('_tmGradoOrigen')?.value||'').trim();
  if(!gDest){alert('Seleccione el grado destino.');return;}
  if(gOrigen===gDest){alert('El grado de origen y destino son iguales. Seleccione grados distintos.');return;}
  const selIds=new Set([...document.querySelectorAll('#_tmEstLista input[type=checkbox]:checked')].map(c=>String(c.value)));
  if(!selIds.size){alert('Seleccione al menos un estudiante para trasladar.');return;}
  let count=0;
  updDB(d=>{
    d.ests=d.ests.map(e=>{
      if(selIds.has(String(e.id))){count++;return{...e,g:gDest};}
      return e;
    });
    return d;
  });
  document.getElementById('_trasladoMasivoModal')?.remove();
  _showToast(`✅ ${count} estudiante(s) trasladado(s) de ${gOrigen} → ${gDest}. Notas conservadas.`,'#16a085');
  renderApp();
}

