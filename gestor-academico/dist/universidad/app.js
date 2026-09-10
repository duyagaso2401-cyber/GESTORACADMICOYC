// ══════════════════════════════════════════════════════════════════════════
// SISTEMA INDEPENDIENTE DE EDUCACIÓN SUPERIOR — app.js
// ------------------------------------------------------------------------
// Aplicación separada del portal K-12 (portal.html / 03-app-core.js /
// 06-documentos-y-resto.js). No importa ni depende de ningún archivo de
// ese sistema. Su estado y su ciclo de renderizado son propios.
// ══════════════════════════════════════════════════════════════════════════
(function(){
  'use strict';

  let TOKEN=null;
  let SESION=null; // {sk, rol, userId, nombre, exp}
  let vista='dashboard';
  let cache={}; // por vista, para no re-pedir datos que no cambiaron

  // ── Arranque: recibe el token por la URL (?token=...) al llegar desde el
  // portal principal, o lo recupera de sessionStorage si ya estaba dentro
  // de esta app (ej. al refrescar la página).
  function iniciar(){
    const params=new URLSearchParams(window.location.search);
    const tokenUrl=params.get('token');
    if(tokenUrl){
      TOKEN=tokenUrl;
      sessionStorage.setItem('univ_token',tokenUrl);
      // Limpia el token de la URL visible, por prolijidad y seguridad
      window.history.replaceState({},'',window.location.pathname);
    } else {
      TOKEN=sessionStorage.getItem('univ_token');
    }
    if(!TOKEN){
      renderError('No se encontró una sesión activa. Por favor, inicie sesión desde el portal de su institución.');
      return;
    }
    api('/auth/whoami').then(function(data){
      SESION=data.sesion;
      vista='dashboard';
      render();
    }).catch(function(err){
      sessionStorage.removeItem('univ_token');
      renderError(err.message||'Su sesión venció o no es válida. Vuelva a iniciar sesión desde el portal de su institución.');
    });
  }

  // ── Helper de API: agrega el token automáticamente, maneja errores de
  // forma consistente.
  function api(ruta,opts){
    opts=opts||{};
    const headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});
    if(TOKEN) headers['Authorization']='Bearer '+TOKEN;
    return fetch('/api/university'+ruta,{
      method:opts.method||'GET',
      headers:headers,
      body:opts.body?JSON.stringify(opts.body):undefined,
    }).then(function(r){
      return r.json().then(function(data){
        if(!r.ok){
          if(data.institucionPausada){
            // La institución se suspendió/bloqueó mientras esta sesión
            // seguía abierta — se corta el acceso de inmediato, sin
            // importar en qué pantalla estuviera.
            sessionStorage.removeItem('univ_token');TOKEN=null;SESION=null;
            renderError(data.error||'Esta institución ya no tiene acceso disponible.');
          }
          throw new Error(data.error||'Error de conexión con el servidor.');
        }
        return data;
      });
    });
  }

  function irA(nuevaVista){ vista=nuevaVista; render(); }
  window._univIrA=irA; // usado por los onclick del HTML generado dinámicamente

  function cerrarSesion(){
    sessionStorage.removeItem('univ_token');
    TOKEN=null;SESION=null;
    document.getElementById('app').innerHTML=
      '<div class="login-wrap"><div class="login-box">'
      +'<h2 style="color:#4a1a6e;margin-bottom:12px">🎓 Aula Virtual</h2>'
      +'<p style="color:#1e8449;font-weight:700;margin-bottom:10px">✅ Sesión cerrada correctamente.</p>'
      +'<p style="color:#666;font-size:0.85rem">Regresando al portal principal de Gestor Académico YC...</p>'
      +'</div></div>';
    // Redirige al portal principal (la pantalla de inicio de sesión de
    // siempre) — no tiene sentido dejar a la persona "varada" en esta
    // pantalla aparte, sin ninguna indicación de a dónde ir después.
    setTimeout(function(){ window.location.href=window.location.origin+'/'; },1200);
  }
  window._univCerrarSesion=cerrarSesion;

  function renderError(msg){
    document.getElementById('app').innerHTML=
      '<div class="login-wrap"><div class="login-box">'
      +'<h2 style="color:#4a1a6e;margin-bottom:12px">🎓 Aula Virtual</h2>'
      +'<div class="error-box" style="margin:0 0 16px 0">⚠️ '+escapeHtml(msg)+'</div>'
      +'<a href="'+window.location.origin+'/" class="btn" style="text-decoration:none;display:inline-block">← Volver al portal principal</a>'
      +'</div></div>';
  }
  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }

  // ── Router principal ────────────────────────────────────────────────────
  function render(){
    if(!SESION){ renderError('No hay una sesión activa.'); return; }
    const tabs=_tabsParaRol(SESION.rol);
    const navHtml=tabs.map(function(t){
      return '<button class="'+(vista===t.id?'activo':'')+'" onclick="_univIrA(\''+t.id+'\')">'+t.label+'</button>';
    }).join('');
    document.getElementById('app').innerHTML=
      '<div class="topbar">'
      +'<div><h1>🎓 Aula Virtual — Educación Superior</h1><div class="sub">'+escapeHtml(SESION.nombre)+' · '+_rolLabel(SESION.rol)+'</div></div>'
      +'<div class="topbar-right"><button class="btn gris" style="padding:7px 14px;font-size:0.78rem" onclick="_univCerrarSesion()">Cerrar sesión</button></div>'
      +'</div>'
      +'<div class="nav">'+navHtml+'</div>'
      +'<div class="wrap" id="contenido"><div class="estado-box"><div class="spinner"></div>Cargando...</div></div>'
      +_htmlWidgetAsistente();
    _renderVistaActual();
  }
  function _rolLabel(r){ return r==='admin'?'Administrador':r==='docente'?'Catedrático':'Estudiante'; }
  function _tabsParaRol(rol){
    if(rol==='admin') return [{id:'dashboard',label:'📊 Panel'},{id:'estructura',label:'🏛️ Estructura'},{id:'calendario',label:'📅 Calendario'},{id:'gestion',label:'🎓 Gestión Académica'},{id:'estudiantes',label:'👥 Matrícula'},{id:'config-cortes',label:'⚙️ Cortes Evaluativos'},{id:'perfil',label:'👤 Mi Perfil'}];
    if(rol==='docente') return [{id:'dashboard',label:'📊 Panel'},{id:'aula-docente',label:'💻 Mis Aulas'},{id:'perfil',label:'👤 Mi Perfil'}];
    return [{id:'dashboard',label:'📊 Panel'},{id:'aula-estudiante',label:'💻 Mis Aulas'},{id:'buzon',label:'📥 Buzón de Entregas'},{id:'historial',label:'📜 Historial Académico'},{id:'perfil',label:'👤 Mi Perfil'}];
  }
  function _renderVistaActual(){
    if(vista==='dashboard') return renderDashboard();
    if(vista==='perfil') return renderPerfil();
    if(vista==='config-cortes') return renderConfigCortes();
    if(vista==='estructura') return renderEstructura();
    if(vista==='calendario') return renderCalendario();
    if(vista==='buzon') return renderBuzonEntregas();
    if(vista==='gestion') return renderGestionAcademica();
    if(vista==='aula-docente') return renderMisAulasDocente();
    if(vista==='aula-estudiante') return renderMisAulasEstudiante();
    if(vista==='historial') return renderHistorial();
    if(vista==='estudiantes') return renderEstudiantes();
    if(vista==='aula-detalle') return renderAulaDetalle(cache._seccionActualId);
    if(vista==='tomar-quiz') return renderTomarQuiz(cache._quizActividadId);
    if(vista==='gradebook') return renderGradebook(cache._gbSeccionId);
  }
  function contenedor(){ return document.getElementById('contenido'); }

  // ══════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ══════════════════════════════════════════════════════════════════════
  function renderDashboard(){
    api('/dashboard').then(function(d){
      let html='';
      if(SESION.rol==='estudiante'){
        html='<div class="kpis">'
          +kpi(d.creditosInscritos,'Créditos Inscritos')
          +kpi(d.asignaturasInscritas,'Asignaturas')
          +kpi(d.estudiante.grupo||'—','Semestre/Grupo')
          +'</div>'
          +'<div class="card"><h2>👋 Hola, '+escapeHtml(d.estudiante.nombre)+'</h2>'
          +'<p style="color:#666;font-size:0.88rem">Institución: '+escapeHtml(d.institucion.nombre)+' · Año '+escapeHtml(d.institucion.anio)+'</p></div>';
      } else if(SESION.rol==='docente'){
        html='<div class="kpis">'
          +kpi(d.asignaturasACargo,'Asignaturas a Cargo')
          +kpi(d.grupos.length,'Grupos')
          +'</div>'
          +'<div class="card"><h2>👋 Hola, '+escapeHtml(d.catedratico.nombre)+'</h2>'
          +'<p style="color:#666;font-size:0.88rem">Institución: '+escapeHtml(d.institucion.nombre)+'</p></div>';
      } else {
        html='<div class="kpis">'
          +kpi(d.totalEstudiantes,'Estudiantes')
          +kpi(d.totalDocentes,'Catedráticos')
          +kpi(d.totalPlanesEstudio,'Programas Académicos')
          +'</div>'
          +'<div class="card"><h2>🏫 '+escapeHtml(d.institucion.nombre)+'</h2>'
          +'<p style="color:#666;font-size:0.88rem">Rector(a)/Decano(a): '+escapeHtml(d.institucion.rectora||'—')+' · Año '+escapeHtml(d.institucion.anio)+'</p></div>';
      }
      contenedor().innerHTML=html;
    }).catch(mostrarErrorEnContenido);
  }
  function kpi(val,lbl){ return '<div class="kpi"><div class="val">'+escapeHtml(val)+'</div><div class="lbl">'+escapeHtml(lbl)+'</div></div>'; }
  function mostrarErrorEnContenido(err){ contenedor().innerHTML='<div class="error-box">⚠️ '+escapeHtml(err.message||'Error cargando la información.')+'</div>'; }

  // ══════════════════════════════════════════════════════════════════════
  // GESTIÓN ACADÉMICA (admin): Programas, Asignaturas, Secciones
  // ══════════════════════════════════════════════════════════════════════
  function renderGestionAcademica(){
    Promise.all([api('/programas'),api('/asignaturas'),api('/secciones'),api('/docentes'),api('/departamentos')]).then(function(res){
      const programas=res[0].programas, asignaturas=res[1].asignaturas, secciones=res[2].secciones, docentes=res[3].docentes, departamentos=res[4].departamentos;
      cache.gestion={programas:programas,asignaturas:asignaturas,secciones:secciones,docentes:docentes,departamentos:departamentos};
      const NIVEL_LABEL={PREGRADO:'Pregrado',POSGRADO:'Posgrado',EDUCACION_CONTINUA:'Educación Continua'};
      const filasProg=programas.map(function(p){
        const depto=departamentos.find(function(d){return d.id===p.departamentoId;});
        return '<tr><td>'+escapeHtml(p.nombreCarrera)+'<br><span style="font-size:0.72rem;color:#888">'+(NIVEL_LABEL[p.nivel]||'Pregrado')+(depto?' · '+escapeHtml(depto.nombre):'')+'</span></td><td>'+p.totalCreditos+'</td>'
          +'<td><button class="btn-sm" style="background:#1a5276" onclick="_univAbrirModalPensums('+p.id+',\''+p.nombreCarrera.replace(/'/g,"\\'")+'\')">📑 Pensums</button> <button class="btn-sm" onclick="_univEditarPrograma('+p.id+')">✎</button> <button class="btn-sm" style="background:#c0392b" onclick="_univEliminarPrograma('+p.id+')">🗑</button></td></tr>';
      }).join('');
      const CARACTER_LABEL={OBLIGATORIA:'Obligatoria',ELECTIVA:'Electiva',OPTATIVA:'Optativa'};
      const CARACTER_COLOR={OBLIGATORIA:'#1a5276',ELECTIVA:'#8e44ad',OPTATIVA:'#b7950b'};
      const filasAsig=asignaturas.map(function(a){
        return '<tr><td>'+escapeHtml(a.codigoMateria)+'</td><td>'+escapeHtml(a.nombre)+'</td><td><span class="tag-credito">'+a.creditos+' créd.</span></td><td>'+a.semestre+'</td>'
          +'<td><span style="background:'+(CARACTER_COLOR[a.caracter]||'#1a5276')+';color:#fff;padding:2px 8px;border-radius:10px;font-size:0.72rem">'+(CARACTER_LABEL[a.caracter]||'Obligatoria')+'</span></td>'
          +'<td><button class="btn-sm" style="background:#b7950b" onclick="_univAbrirModalCorrequisitos('+a.id+',\''+escapeHtml(a.nombre).replace(/'/g,"\\'")+'\')">🔗 Correq.</button> <button class="btn-sm" onclick="_univEditarAsignatura('+a.id+')">✎</button> <button class="btn-sm" style="background:#c0392b" onclick="_univEliminarAsignatura('+a.id+')">🗑</button></td></tr>';
      }).join('');
      const filasDoc=docentes.map(function(d){
        return '<tr><td>'+escapeHtml(d.nombre)+'</td><td>'+escapeHtml(d.u)+'</td><td>'+escapeHtml(d.correo||'—')+'</td>'
          +'<td><button class="btn-sm" style="background:#8e44ad" onclick="_univRestablecerPassDocente(\''+d.u+'\',\''+escapeHtml(d.nombre).replace(/'/g,"\\'")+'\')">🔒 Restablecer clave</button></td></tr>';
      }).join('');
      const filasSecc=secciones.map(function(s){
        return '<tr><td>'+escapeHtml(s.codigoMateria)+' — '+escapeHtml(s.nombreAsignatura)+'</td><td>'+escapeHtml(s.grupo)+'</td><td>'+escapeHtml(s.catedraticoId)+'</td>'
          +'<td><button class="btn-sm" style="background:#1e8449" onclick="_univAbrirModalMatriculaSeccion('+s.id+')">👥 Matricular</button> <button class="btn-sm" onclick="_univEditarSeccion('+s.id+')">✎</button> <button class="btn-sm" style="background:#c0392b" onclick="_univEliminarSeccion('+s.id+')">🗑</button></td></tr>';
      }).join('');
      contenedor().innerHTML=
        '<div class="card"><h2>📋 Programas Académicos</h2>'
        +(programas.length?'<table><thead><tr><th>Programa</th><th>Créditos Totales</th><th></th></tr></thead><tbody>'+filasProg+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Sin programas creados todavía.</p>')
        +'<div style="margin-top:14px"><label>Nombre del programa</label><input id="_gProgNombre" placeholder="Ej: Ingeniería de Sistemas">'
        +'<div class="grid2"><div><label>Créditos totales</label><input type="number" id="_gProgCreditos" placeholder="Ej: 160"></div>'
        +'<div><label>Nivel</label><select id="_gProgNivel"><option value="PREGRADO">Pregrado</option><option value="POSGRADO">Posgrado</option><option value="EDUCACION_CONTINUA">Educación Continua</option></select></div></div>'
        +'<label>Departamento (opcional)</label><select id="_gProgDepartamento"><option value="">— Sin asignar —</option>'+departamentos.map(function(d){return '<option value="'+d.id+'">'+escapeHtml(d.nombre)+'</option>';}).join('')+'</select>'
        +'<button class="btn verde" onclick="_univCrearPrograma()">+ Crear Programa</button></div></div>'
        +'<div class="card"><h2>📚 Asignaturas</h2>'
        +(asignaturas.length?'<table><thead><tr><th>Código</th><th>Nombre</th><th>Créditos</th><th>Semestre</th><th>Carácter</th><th></th></tr></thead><tbody>'+filasAsig+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Sin asignaturas creadas todavía.</p>')
        +'<div style="margin-top:14px">'
        +'<label>Programa</label><select id="_gAsigPrograma">'+programas.map(function(p){return '<option value="'+p.id+'">'+escapeHtml(p.nombreCarrera)+'</option>';}).join('')+'</select>'
        +'<label>Código</label><input id="_gAsigCodigo" placeholder="Ej: MAT-101">'
        +'<label>Nombre</label><input id="_gAsigNombre" placeholder="Ej: Cálculo Diferencial">'
        +'<div class="grid2"><div><label>Créditos</label><input type="number" id="_gAsigCreditos" placeholder="Ej: 3"></div>'
        +'<div><label>Semestre</label><input type="number" id="_gAsigSemestre" placeholder="1" value="1"></div></div>'
        +'<label>Carácter</label><select id="_gAsigCaracter"><option value="OBLIGATORIA">Obligatoria</option><option value="ELECTIVA">Electiva</option><option value="OPTATIVA">Optativa</option></select>'
        +'<button class="btn verde" onclick="_univCrearAsignatura()">+ Crear Asignatura</button></div></div>'
        +'<div class="card"><h2>👨‍🏫 Catedráticos</h2>'
        +'<p style="font-size:0.8rem;color:#666;margin-bottom:10px">Cree aquí la cuenta del catedrático ANTES de asignarlo a una sección — si no existe la cuenta, esa persona nunca podrá iniciar sesión.</p>'
        +(docentes.length?'<table><thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th></th></tr></thead><tbody>'+filasDoc+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Sin catedráticos creados todavía.</p>')
        +'<div style="margin-top:14px">'
        +'<label>Nombre completo</label><input id="_gDocNombre" placeholder="Ej: Juan Pérez">'
        +'<div class="grid2"><div><label>Usuario</label><input id="_gDocUsuario" placeholder="usuario de acceso"></div>'
        +'<div><label>Contraseña (mín. 6 caracteres)</label><input type="password" id="_gDocPassword" placeholder="Contraseña"></div></div>'
        +'<label>Correo (opcional)</label><input id="_gDocCorreo" type="email" placeholder="correo@...">'
        +'<p id="_gDocError" style="color:#c0392b;font-size:0.78rem;display:none;margin-bottom:8px"></p>'
        +'<button class="btn verde" onclick="_univCrearDocente()">+ Crear Catedrático</button></div></div>'
        +'<div class="card"><h2>🏫 Secciones (Asignar Catedrático)</h2>'
        +(secciones.length?'<table><thead><tr><th>Asignatura</th><th>Grupo</th><th>Catedrático</th><th></th></tr></thead><tbody>'+filasSecc+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Sin secciones creadas todavía.</p>')
        +'<div style="margin-top:14px">'
        +'<label>Asignatura</label><select id="_gSeccAsig">'+asignaturas.map(function(a){return '<option value="'+a.id+'">'+escapeHtml(a.codigoMateria)+' — '+escapeHtml(a.nombre)+'</option>';}).join('')+'</select>'
        +'<label>Grupo (ej: Sistemas-2026-A)</label><input id="_gSeccGrupo" placeholder="Grupo">'
        +'<label>Catedrático</label>'
        +(docentes.length?'<select id="_gSeccCatedratico">'+docentes.map(function(d){return '<option value="'+d.u+'">'+escapeHtml(d.nombre)+' ('+escapeHtml(d.u)+')</option>';}).join('')+'</select>'
          :'<p style="font-size:0.8rem;color:#c0392b;margin-bottom:8px">⚠️ Todavía no hay catedráticos creados — cree uno arriba primero.</p>')
        +'<button class="btn verde" onclick="_univCrearSeccion()"'+(docentes.length?'':' disabled')+'>+ Crear Sección</button></div></div>';
    }).catch(mostrarErrorEnContenido);
  }
  window._univCrearDocente=function(){
    const nombre=document.getElementById('_gDocNombre').value.trim();
    const usuario=document.getElementById('_gDocUsuario').value.trim();
    const password=document.getElementById('_gDocPassword').value;
    const correo=document.getElementById('_gDocCorreo').value.trim();
    const errEl=document.getElementById('_gDocError');
    errEl.style.display='none';
    if(!nombre||!usuario||!password){errEl.textContent='Complete nombre, usuario y contraseña.';errEl.style.display='block';return;}
    if(password.length<6){errEl.textContent='La contraseña debe tener mínimo 6 caracteres.';errEl.style.display='block';return;}
    api('/docentes',{method:'POST',body:{nombre:nombre,usuario:usuario,password:password,correo:correo}}).then(function(){
      _showAlertaOk('✅ Catedrático creado. Ya puede iniciar sesión con usuario: '+usuario);
      renderGestionAcademica();
    }).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };
  window._univRestablecerPassDocente=function(usuario,nombre){
    _abrirModal('<h2>🔒 Restablecer Contraseña</h2><p style="font-size:0.82rem;color:#666;margin-bottom:8px">'+escapeHtml(nombre)+' ('+escapeHtml(usuario)+')</p>'
      +'<label>Nueva contraseña (mínimo 6 caracteres)</label><input type="password" id="_rpNueva">'
      +'<p id="_rpError" style="color:#c0392b;font-size:0.78rem;display:none;margin-bottom:8px"></p>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarResetPassDocente(\''+usuario+'\')">💾 Restablecer</button></div>');
  };
  window._univGuardarResetPassDocente=function(usuario){
    const nueva=document.getElementById('_rpNueva').value;
    const errEl=document.getElementById('_rpError');
    if(!nueva||nueva.length<6){errEl.textContent='La contraseña debe tener mínimo 6 caracteres.';errEl.style.display='block';return;}
    api('/docentes/'+usuario+'/password',{method:'PUT',body:{password:nueva}}).then(function(){
      _cerrarModal();_showAlertaOk('✅ Contraseña restablecida correctamente.');
    }).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };
  window._univCrearPrograma=function(){
    const nombreCarrera=document.getElementById('_gProgNombre').value.trim();
    if(!nombreCarrera){alert('Escriba el nombre del programa.');return;}
    const totalCreditos=document.getElementById('_gProgCreditos').value.trim()||'0';
    const nivel=document.getElementById('_gProgNivel').value;
    const departamentoId=document.getElementById('_gProgDepartamento').value;
    api('/programas',{method:'POST',body:{nombreCarrera:nombreCarrera,totalCreditos:totalCreditos,nivel:nivel,departamentoId:departamentoId}}).then(function(){renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };
  window._univEditarPrograma=function(id){
    const p=(cache.gestion.programas||[]).find(function(x){return x.id===id;});
    if(!p) return;
    _abrirModal('<h2>✎ Editar Programa</h2><label>Nombre</label><input id="_mPNombre" value="'+escapeHtml(p.nombreCarrera)+'">'
      +'<label>Créditos totales</label><input type="number" id="_mPCreditos" value="'+p.totalCreditos+'">'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarEdicionPrograma('+id+')">Guardar</button></div>');
  };
  window._univGuardarEdicionPrograma=function(id){
    const nombreCarrera=document.getElementById('_mPNombre').value.trim();
    const totalCreditos=document.getElementById('_mPCreditos').value.trim()||'0';
    if(!nombreCarrera){alert('Escriba el nombre.');return;}
    api('/programas/'+id,{method:'PUT',body:{nombreCarrera:nombreCarrera,totalCreditos:totalCreditos}}).then(function(){_cerrarModal();renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };
  window._univEliminarPrograma=function(id){
    if(!confirm('¿Eliminar este programa académico?')) return;
    api('/programas/'+id,{method:'DELETE'}).then(function(){renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };

  // ── Pensums (mallas curriculares versionadas de un Programa) ────────────
  window._univAbrirModalPensums=function(planEstudioId,nombrePrograma){
    api('/pensums?planEstudioId='+planEstudioId).then(function(res){
      cache._pensumsProgramaActual={planEstudioId:planEstudioId,nombrePrograma:nombrePrograma};
      const filas=res.pensums.map(function(p){
        return '<tr><td>'+escapeHtml(p.nombre)+'</td><td>'+escapeHtml(p.vigenteDesde||'—')+'</td>'
          +'<td>'+(p.activo?'<span style="color:#1e8449">✅ Activo</span>':'<span style="color:#888">Inactivo</span>')+'</td>'
          +'<td><button class="btn-sm" style="background:#1a5276" onclick="_univAbrirModalAsigPensum('+p.id+',\''+escapeHtml(p.nombre).replace(/'/g,"\\'")+'\')">📚 Asignaturas</button> '
          +'<button class="btn-sm" style="background:#c0392b" onclick="_univEliminarPensum('+p.id+','+planEstudioId+',\''+nombrePrograma.replace(/'/g,"\\'")+'\')">🗑</button></td></tr>';
      }).join('');
      _abrirModal('<h2>📑 Pensums — '+escapeHtml(nombrePrograma)+'</h2>'
        +(res.pensums.length?'<table><thead><tr><th>Nombre</th><th>Vigente desde</th><th>Estado</th><th></th></tr></thead><tbody>'+filas+'</tbody></table>':'<p style="font-size:0.82rem;color:#888;margin-bottom:10px">Todavía no hay pensums para este programa.</p>')
        +'<h4 style="font-size:0.85rem;margin:14px 0 6px">Nuevo Pensum</h4>'
        +'<label>Nombre (ej: "Pensum 2026-1")</label><input id="_mPensumNombre" placeholder="Pensum 2026-1">'
        +'<label>Vigente desde</label><input id="_mPensumVigente" placeholder="ej: 2026-1">'
        +'<button class="btn verde" onclick="_univCrearPensum()">+ Crear Pensum</button>'
        +'<div style="margin-top:14px"><button class="btn gris" onclick="_cerrarModal()">Cerrar</button></div>');
    }).catch(function(e){alert(e.message);});
  };
  window._univCrearPensum=function(){
    const nombre=document.getElementById('_mPensumNombre').value.trim();
    if(!nombre){alert('Escriba el nombre del pensum.');return;}
    const vigenteDesde=document.getElementById('_mPensumVigente').value.trim();
    const ctx=cache._pensumsProgramaActual;
    api('/pensums',{method:'POST',body:{planEstudioId:ctx.planEstudioId,nombre:nombre,vigenteDesde:vigenteDesde}}).then(function(){
      _cerrarModal();window._univAbrirModalPensums(ctx.planEstudioId,ctx.nombrePrograma);
    }).catch(function(e){alert(e.message);});
  };
  window._univEliminarPensum=function(id,planEstudioId,nombrePrograma){
    if(!confirm('¿Eliminar este pensum? Las asignaturas en sí NO se eliminan, solo dejan de estar agrupadas en esta malla.')) return;
    api('/pensums/'+id,{method:'DELETE'}).then(function(){window._univAbrirModalPensums(planEstudioId,nombrePrograma);}).catch(function(e){alert(e.message);});
  };
  window._univAbrirModalAsigPensum=function(pensumId,nombrePensum){
    api('/pensums/'+pensumId+'/asignaturas').then(function(res){
      if(!res.asignaturas.length){
        _abrirModal('<h2>📚 Asignaturas — '+escapeHtml(nombrePensum)+'</h2><p style="font-size:0.82rem;color:#888">Este programa todavía no tiene asignaturas creadas. Cree asignaturas primero (arriba, en "Asignaturas"), y luego vuelva aquí para incluirlas en este pensum.</p><div style="margin-top:14px"><button class="btn gris" onclick="_cerrarModal()">Cerrar</button></div>');
        return;
      }
      const filas=res.asignaturas.map(function(a){
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-weight:400;font-size:0.85rem">'
          +'<input type="checkbox" '+(a.incluidaEnPensum?'checked':'')+' onchange="_univToggleAsigPensum('+pensumId+','+a.id+',this.checked)" style="width:auto;margin:0">'
          +escapeHtml(a.codigoMateria)+' — '+escapeHtml(a.nombre)+' <span class="tag-credito">'+a.creditos+' créd.</span></label>';
      }).join('');
      _abrirModal('<h2>📚 Asignaturas — '+escapeHtml(nombrePensum)+'</h2><p style="font-size:0.78rem;color:#666;margin-bottom:8px">Marque las asignaturas que pertenecen a esta malla curricular.</p>'
        +'<div style="max-height:300px;overflow-y:auto">'+filas+'</div>'
        +'<div style="margin-top:14px"><button class="btn gris" onclick="_cerrarModal()">Cerrar</button></div>');
    }).catch(function(e){alert(e.message);});
  };
  window._univToggleAsigPensum=function(pensumId,asignaturaId,incluir){
    api('/pensums/'+pensumId+'/asignaturas',{method:'POST',body:{asignaturaId:asignaturaId,incluir:incluir}}).catch(function(e){alert(e.message);});
  };

  window._univCrearAsignatura=function(){
    const planEstudioId=document.getElementById('_gAsigPrograma').value;
    const codigoMateria=document.getElementById('_gAsigCodigo').value.trim();
    const nombre=document.getElementById('_gAsigNombre').value.trim();
    if(!codigoMateria||!nombre){alert('Complete código y nombre.');return;}
    const creditos=document.getElementById('_gAsigCreditos').value.trim()||'0';
    const semestre=document.getElementById('_gAsigSemestre').value.trim()||'1';
    const caracter=document.getElementById('_gAsigCaracter').value;
    api('/asignaturas',{method:'POST',body:{planEstudioId:planEstudioId,codigoMateria:codigoMateria,nombre:nombre,creditos:creditos,semestre:semestre,caracter:caracter}}).then(function(){renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };
  window._univAbrirModalCorrequisitos=function(asigId,nombreAsig){
    Promise.all([api('/asignaturas/'+asigId+'/correquisitos'),Promise.resolve(cache.gestion.asignaturas||[])]).then(function(res){
      const correquisitos=res[0].correquisitos, todas=res[1];
      const disponibles=todas.filter(function(a){return a.id!==asigId&&!correquisitos.find(function(c){return c.correquisitoId===a.id;});});
      const filas=correquisitos.map(function(c){
        return '<tr><td style="text-align:left">'+escapeHtml(c.codigoMateria)+' — '+escapeHtml(c.nombre)+'</td><td><button class="btn-sm" style="background:#c0392b" onclick="_univQuitarCorrequisito('+c.id+','+asigId+',\''+nombreAsig.replace(/'/g,"\\'")+'\')">🗑</button></td></tr>';
      }).join('');
      _abrirModal('<h2>🔗 Correquisitos — '+escapeHtml(nombreAsig)+'</h2><p style="font-size:0.78rem;color:#666;margin-bottom:8px">Materias que se deben cursar AL MISMO TIEMPO que ésta.</p>'
        +(correquisitos.length?'<table><tbody>'+filas+'</tbody></table>':'<p style="font-size:0.8rem;color:#888">Sin correquisitos agregados.</p>')
        +'<div style="margin-top:12px">'
        +(disponibles.length?'<select id="_correqSelect">'+disponibles.map(function(a){return '<option value="'+a.id+'">'+escapeHtml(a.codigoMateria)+' — '+escapeHtml(a.nombre)+'</option>';}).join('')+'</select>'
          +'<button class="btn-sm" style="background:#1e8449" onclick="_univAgregarCorrequisito('+asigId+',\''+nombreAsig.replace(/'/g,"\\'")+'\')">➕ Agregar</button>'
          :'<p style="font-size:0.78rem;color:#888">No hay más asignaturas disponibles para agregar.</p>')
        +'</div><div style="margin-top:14px"><button class="btn gris" onclick="_cerrarModal()">Cerrar</button></div>');
    }).catch(function(e){alert(e.message);});
  };
  window._univAgregarCorrequisito=function(asigId,nombreAsig){
    const correquisitoId=document.getElementById('_correqSelect').value;
    api('/asignaturas/'+asigId+'/correquisitos',{method:'POST',body:{correquisitoId:correquisitoId}}).then(function(){_cerrarModal();window._univAbrirModalCorrequisitos(asigId,nombreAsig);}).catch(function(e){alert(e.message);});
  };
  window._univQuitarCorrequisito=function(correqId,asigId,nombreAsig){
    api('/correquisitos/'+correqId,{method:'DELETE'}).then(function(){_cerrarModal();window._univAbrirModalCorrequisitos(asigId,nombreAsig);}).catch(function(e){alert(e.message);});
  };
  window._univEditarAsignatura=function(id){
    const a=(cache.gestion.asignaturas||[]).find(function(x){return x.id===id;});
    if(!a) return;
    _abrirModal('<h2>✎ Editar Asignatura</h2><label>Código</label><input id="_mACodigo" value="'+escapeHtml(a.codigoMateria)+'">'
      +'<label>Nombre</label><input id="_mANombre" value="'+escapeHtml(a.nombre)+'">'
      +'<label>Créditos</label><input type="number" id="_mACreditos" value="'+a.creditos+'">'
      +'<label>Semestre</label><input type="number" id="_mASemestre" value="'+a.semestre+'">'
      +'<label>Carácter</label><select id="_mACaracter">'
      +'<option value="OBLIGATORIA"'+(a.caracter==='OBLIGATORIA'?' selected':'')+'>Obligatoria</option>'
      +'<option value="ELECTIVA"'+(a.caracter==='ELECTIVA'?' selected':'')+'>Electiva</option>'
      +'<option value="OPTATIVA"'+(a.caracter==='OPTATIVA'?' selected':'')+'>Optativa</option></select>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarEdicionAsignatura('+id+')">Guardar</button></div>');
  };
  window._univGuardarEdicionAsignatura=function(id){
    const codigoMateria=document.getElementById('_mACodigo').value.trim();
    const nombre=document.getElementById('_mANombre').value.trim();
    if(!codigoMateria||!nombre){alert('Complete código y nombre.');return;}
    const creditos=document.getElementById('_mACreditos').value.trim()||'0';
    const semestre=document.getElementById('_mASemestre').value.trim()||'1';
    const caracter=document.getElementById('_mACaracter').value;
    api('/asignaturas/'+id,{method:'PUT',body:{codigoMateria:codigoMateria,nombre:nombre,creditos:creditos,semestre:semestre,caracter:caracter}}).then(function(){_cerrarModal();renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };
  window._univEliminarAsignatura=function(id){
    if(!confirm('¿Eliminar esta asignatura?')) return;
    api('/asignaturas/'+id,{method:'DELETE'}).then(function(){renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };
  window._univCrearSeccion=function(){
    const asignaturaId=document.getElementById('_gSeccAsig').value;
    const grupo=document.getElementById('_gSeccGrupo').value.trim();
    const catedraticoId=document.getElementById('_gSeccCatedratico').value.trim();
    if(!grupo||!catedraticoId){alert('Complete grupo y catedrático.');return;}
    api('/secciones',{method:'POST',body:{asignaturaId:asignaturaId,grupo:grupo,catedraticoId:catedraticoId}}).then(function(){renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };
  window._univEditarSeccion=function(id){
    const s=(cache.gestion.secciones||[]).find(function(x){return x.id===id;});
    if(!s) return;
    _abrirModal('<h2>✎ Editar Sección</h2><p style="font-size:0.82rem;color:#666;margin-bottom:8px">'+escapeHtml(s.codigoMateria)+' — '+escapeHtml(s.nombreAsignatura)+'</p>'
      +'<label>Grupo</label><input id="_mSGrupo" value="'+escapeHtml(s.grupo)+'">'
      +'<label>Usuario del Catedrático</label><input id="_mSCatedratico" value="'+escapeHtml(s.catedraticoId)+'">'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarEdicionSeccion('+id+')">Guardar</button></div>');
  };
  window._univGuardarEdicionSeccion=function(id){
    const grupo=document.getElementById('_mSGrupo').value.trim();
    const catedraticoId=document.getElementById('_mSCatedratico').value.trim();
    if(!grupo||!catedraticoId){alert('Complete grupo y catedrático.');return;}
    api('/secciones/'+id,{method:'PUT',body:{grupo:grupo,catedraticoId:catedraticoId}}).then(function(){_cerrarModal();renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };
  window._univEliminarSeccion=function(id){
    if(!confirm('¿Eliminar esta sección? Las unidades/actividades del Aula Virtual asociada NO se borran, solo dejan de estar accesibles desde aquí.')) return;
    api('/secciones/'+id,{method:'DELETE'}).then(function(){renderGestionAcademica();}).catch(function(e){alert(e.message);});
  };

  // ── Matrícula de estudiantes a UNA SECCIÓN específica ────────────────────
  window._univAbrirModalMatriculaSeccion=function(seccionId){
    Promise.all([api('/secciones/'+seccionId+'/matriculas'),api('/estudiantes')]).then(function(res){
      const matriculados=res[0].matriculas, todos=res[1].estudiantes;
      const idsYaMatriculados=matriculados.map(function(m){return String(m.estudianteId);});
      const disponibles=todos.filter(function(e){return idsYaMatriculados.indexOf(String(e.id))===-1;});
      const filasMatriculados=matriculados.map(function(m){
        return '<tr><td>'+escapeHtml(m.nombreEstudiante)+'</td><td><button class="btn-sm" style="background:#c0392b" onclick="_univRetirarMatricula('+m.id+','+seccionId+')">Retirar</button></td></tr>';
      }).join('');
      _abrirModal('<h2>👥 Matricular Estudiantes</h2>'
        +'<h4 style="font-size:0.85rem;margin:10px 0 6px">Ya matriculados ('+matriculados.length+')</h4>'
        +(matriculados.length?'<table><tbody>'+filasMatriculados+'</tbody></table>':'<p style="font-size:0.8rem;color:#888">Ninguno todavía.</p>')
        +'<h4 style="font-size:0.85rem;margin:14px 0 6px">Matricular a:</h4>'
        +(disponibles.length?'<select id="_mMatEstudiante">'+disponibles.map(function(e){return '<option value="'+e.id+'">'+escapeHtml(e.nombre)+' ('+escapeHtml(e.grupo)+')</option>';}).join('')+'</select>'
          +'<button class="btn verde" style="margin-top:6px" onclick="_univMatricularEnSeccion('+seccionId+')">+ Matricular</button>'
          :'<p style="font-size:0.8rem;color:#888">Todos los estudiantes ya están matriculados aquí.</p>')
        +'<div style="margin-top:14px"><button class="btn gris" onclick="_cerrarModal()">Cerrar</button></div>');
    }).catch(function(e){alert(e.message);});
  };
  window._univMatricularEnSeccion=function(seccionId){
    const estudianteId=document.getElementById('_mMatEstudiante').value;
    api('/matriculas',{method:'POST',body:{seccionId:seccionId,estudianteId:estudianteId}}).then(function(){_cerrarModal();window._univAbrirModalMatriculaSeccion(seccionId);}).catch(function(e){alert(e.message);});
  };
  window._univRetirarMatricula=function(matriculaId,seccionId){
    if(!confirm('¿Retirar esta matrícula? El estudiante perderá acceso al Aula Virtual de esta sección.')) return;
    api('/matriculas/'+matriculaId,{method:'DELETE'}).then(function(){window._univAbrirModalMatriculaSeccion(seccionId);}).catch(function(e){alert(e.message);});
  };

  // ══════════════════════════════════════════════════════════════════════
  // MATRÍCULA DE ESTUDIANTES A UN PROGRAMA ACADÉMICO
  // ══════════════════════════════════════════════════════════════════════
  function renderEstudiantes(){
    Promise.all([api('/estudiantes'),api('/programas')]).then(function(res){
      const estudiantes=res[0].estudiantes, programas=res[1].programas;
      cache.estudiantes={estudiantes:estudiantes,programas:programas};
      const filas=estudiantes.map(function(e){
        const prog=programas.find(function(p){return String(p.id)===String(e.planEstudioId);});
        return '<tr><td>'+escapeHtml(e.nombre)+'</td><td>'+escapeHtml(e.numDoc||'—')+'</td><td>'+escapeHtml(e.grupo)+'</td>'
          +'<td>'+(prog?escapeHtml(prog.nombreCarrera):'<span style="color:#c0392b">Sin asignar</span>')+'</td>'
          +'<td><button class="btn-sm" onclick="_univAbrirModalMatricula(\''+e.id+'\')">🎓 Programa</button> <button class="btn-sm" style="background:#8e44ad" onclick="_univVerCredencialesEst(\''+e.id+'\',\''+escapeHtml(e.nombre).replace(/'/g,"\\'")+'\')">🔑 Credenciales</button></td></tr>';
      }).join('');
      contenedor().innerHTML=
        '<div class="card"><h2>➕ Matricular Nuevo Estudiante</h2>'
        +'<p style="font-size:0.8rem;color:#666;margin-bottom:10px">Registra un estudiante nuevo directamente aquí — queda disponible de inmediato para iniciar sesión desde el portal principal de la institución (usuario y contraseña inicial: su número de documento).</p>'
        +'<div class="grid2">'
        +'<div><label>Primer apellido *</label><input id="_eApellido1" placeholder="Apellido"></div>'
        +'<div><label>Segundo apellido</label><input id="_eApellido2" placeholder="Apellido"></div>'
        +'</div>'
        +'<div class="grid2">'
        +'<div><label>Primer nombre *</label><input id="_eNombre1" placeholder="Nombre"></div>'
        +'<div><label>Segundo nombre</label><input id="_eNombre2" placeholder="Nombre"></div>'
        +'</div>'
        +'<div class="grid2">'
        +'<div><label>Número de documento *</label><input id="_eNumDoc" placeholder="Documento"></div>'
        +'<div><label>Semestre/Grupo *</label><input id="_eGrupo" placeholder="ej: Sistemas-2026-A"></div>'
        +'</div>'
        +'<label>Programa Académico (opcional, se puede asignar después)</label>'
        +'<select id="_eProgramaId"><option value="">— Sin asignar —</option>'+programas.map(function(p){return '<option value="'+p.id+'">'+escapeHtml(p.nombreCarrera)+'</option>';}).join('')+'</select>'
        +'<p id="_eError" style="color:#c0392b;font-size:0.78rem;display:none;margin-bottom:8px"></p>'
        +'<button class="btn verde" onclick="_univCrearEstudiante()">➕ Matricular Estudiante</button>'
        +'</div>'
        +'<div class="card"><h2>👥 Estudiantes Matriculados ('+estudiantes.length+')</h2>'
        +(estudiantes.length?'<table><thead><tr><th>Estudiante</th><th>Documento</th><th>Grupo</th><th>Programa Académico</th><th></th></tr></thead><tbody>'+filas+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Todavía no hay estudiantes matriculados.</p>')
        +'</div>';
    }).catch(mostrarErrorEnContenido);
  }
  window._univCrearEstudiante=function(){
    const apellido1=document.getElementById('_eApellido1').value.trim();
    const apellido2=document.getElementById('_eApellido2').value.trim();
    const nombre1=document.getElementById('_eNombre1').value.trim();
    const nombre2=document.getElementById('_eNombre2').value.trim();
    const numDoc=document.getElementById('_eNumDoc').value.trim();
    const grupo=document.getElementById('_eGrupo').value.trim();
    const planEstudioId=document.getElementById('_eProgramaId').value;
    const errEl=document.getElementById('_eError');
    errEl.style.display='none';
    if(!apellido1||!nombre1||!numDoc||!grupo){errEl.textContent='Complete al menos primer apellido, primer nombre, documento y grupo.';errEl.style.display='block';return;}
    api('/estudiantes',{method:'POST',body:{apellido1:apellido1,apellido2:apellido2,nombre1:nombre1,nombre2:nombre2,numDoc:numDoc,grupo:grupo,planEstudioId:planEstudioId}}).then(function(){
      _showAlertaOk('✅ Estudiante matriculado correctamente. Ya puede iniciar sesión con su número de documento.');
      renderEstudiantes();
    }).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };
  window._univAbrirModalMatricula=function(estId){
    const e=(cache.estudiantes.estudiantes||[]).find(function(x){return String(x.id)===String(estId);});
    const programas=cache.estudiantes.programas||[];
    if(!e) return;
    _abrirModal('<h2>🎓 Matricular a Programa Académico</h2><p style="font-size:0.82rem;color:#666;margin-bottom:8px">'+escapeHtml(e.nombre)+'</p>'
      +'<label>Programa Académico</label><select id="_mMPrograma"><option value="">— Sin asignar —</option>'
      +programas.map(function(p){return '<option value="'+p.id+'"'+(String(e.planEstudioId)===String(p.id)?' selected':'')+'>'+escapeHtml(p.nombreCarrera)+'</option>';}).join('')+'</select>'
      +'<label>Grupo/Sección (ej: Sistemas-2026-A)</label><input id="_mMGrupo" value="'+escapeHtml(e.grupo)+'">'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarMatricula(\''+estId+'\')">Guardar</button></div>');
  };
  window._univGuardarMatricula=function(estId){
    const planEstudioId=document.getElementById('_mMPrograma').value;
    const grupo=document.getElementById('_mMGrupo').value.trim();
    api('/estudiantes/'+estId+'/matricula',{method:'PUT',body:{planEstudioId:planEstudioId,grupo:grupo}}).then(function(){_cerrarModal();renderEstudiantes();}).catch(function(e){alert(e.message);});
  };
  window._univVerCredencialesEst=function(estId,nombre){
    api('/estudiantes/'+estId+'/credenciales').then(function(res){
      _abrirModal('<h2>🔑 Credenciales — '+escapeHtml(nombre)+'</h2>'
        +'<label>Usuario</label><input id="_credUsuario" value="'+escapeHtml(res.usuario)+'">'
        +'<label>Contraseña</label><input id="_credPassword" value="'+escapeHtml(res.password)+'">'
        +'<p style="font-size:0.76rem;color:#888;margin-bottom:8px">Puede editar y guardar para restablecer las credenciales de este estudiante.</p>'
        +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cerrar</button>'
        +'<button class="btn verde" onclick="_univGuardarCredencialesEst(\''+estId+'\')">💾 Guardar</button></div>');
    }).catch(function(e){alert(e.message);});
  };
  window._univGuardarCredencialesEst=function(estId){
    const usuario=document.getElementById('_credUsuario').value.trim();
    const password=document.getElementById('_credPassword').value.trim();
    if(!usuario||!password){alert('Complete usuario y contraseña.');return;}
    api('/estudiantes/'+estId+'/credenciales',{method:'PUT',body:{usuario:usuario,password:password}}).then(function(){
      _cerrarModal();_showAlertaOk('✅ Credenciales actualizadas.');
    }).catch(function(e){alert(e.message);});
  };

  // ══════════════════════════════════════════════════════════════════════
  // AULA VIRTUAL — CATEDRÁTICO
  // ══════════════════════════════════════════════════════════════════════
  function renderMisAulasDocente(){
    api('/secciones').then(function(res){
      const mias=res.secciones.filter(function(s){return s.catedraticoId===SESION.userId;});
      if(!mias.length){ contenedor().innerHTML='<div class="card"><p style="color:#888">No tiene secciones asignadas todavía.</p></div>'; return; }
      const filas=mias.map(function(s){
        return '<tr><td>'+escapeHtml(s.codigoMateria)+' — '+escapeHtml(s.nombreAsignatura)+'</td><td>'+escapeHtml(s.grupo)+'</td>'
          +'<td><button class="btn-sm" onclick="_univAbrirAula(\''+s.id+'\')">💻 Entrar al Aula</button></td></tr>';
      }).join('');
      contenedor().innerHTML='<div class="card"><h2>💻 Mis Aulas Virtuales</h2><table><thead><tr><th>Asignatura</th><th>Grupo</th><th></th></tr></thead><tbody>'+filas+'</tbody></table></div>';
    }).catch(mostrarErrorEnContenido);
  }
  window._univAbrirAula=function(seccionId){ cache._seccionActualId=seccionId; irA('aula-detalle'); };

  function renderAulaDetalle(seccionId){
    api('/aula/'+seccionId).then(function(d){
      cache.aulaActual=d;
      const esDocente=SESION.rol==='docente';
      let html='<button class="btn gris" style="margin-bottom:14px" onclick="_univIrA(\''+(esDocente?'aula-docente':'aula-estudiante')+'\')">← Volver</button>';
      html+='<div class="card"><h2>💻 '+escapeHtml(d.seccion.codigoMateria)+' — '+escapeHtml(d.seccion.nombreAsignatura)+'</h2>';
      if(esDocente){
        html+='<label>Enlace de Clase en Vivo</label><input id="_aLinkClase" value="'+escapeHtml(d.aula.linkClaseVivo||'')+'" placeholder="https://meet.google.com/...">'
          +'<button class="btn verde" onclick="_univGuardarLinkClase('+d.aula.id+')">💾 Guardar Enlace</button>';
        if(d.aula.linkClaseVivo) html+=' <a href="'+d.aula.linkClaseVivo+'" target="_blank" rel="noopener noreferrer" class="btn" style="text-decoration:none;display:inline-block;margin-left:6px">🎥 Ir a Clase</a>';
      } else if(d.aula.linkClaseVivo){
        html+='<a href="'+d.aula.linkClaseVivo+'" target="_blank" rel="noopener noreferrer" class="btn" style="text-decoration:none;display:inline-block">🎥 Ir a la Clase en Vivo</a>';
      }
      html+='</div>';

      html+='<div class="card"><h2>📚 Módulos de Aprendizaje</h2>';
      if(esDocente&&d.unidades.length>1) html+='<p style="font-size:0.72rem;color:#888;margin-bottom:8px">💡 Arrastre una unidad desde el ícono ⠿ para reordenarla.</p>';
      if(!d.unidades.length){ html+='<p style="color:#888;font-size:0.85rem">Todavía no hay unidades creadas.</p>'; }
      d.unidades.forEach(function(u){
        html+='<div class="_univUnidadDrag" draggable="'+(esDocente?'true':'false')+'" data-unidad-id="'+u.id+'" '
          +(esDocente?('ondragstart="_univDragStart(event,'+u.id+')" ondragover="_univDragOver(event)" ondrop="_univDrop(event,'+u.id+')"'):'')
          +' style="border:1px solid #e0d8f0;border-radius:8px;padding:12px;margin-bottom:10px;'+(esDocente?'cursor:move':'')+'">'
          +'<b>'+(esDocente?'<span style="color:#aaa;margin-right:4px" title="Arrastre para reordenar">⠿</span>':'')+'📁 '+escapeHtml(u.titulo)+'</b>'+(u.descripcion?'<p style="font-size:0.8rem;color:#666;margin:4px 0">'+escapeHtml(u.descripcion)+'</p>':'');
        (u.recursos||[]).forEach(function(r){
          html+='<div style="padding:6px 10px;background:#f4f1fa;border-radius:6px;margin-top:6px;font-size:0.82rem">'
            +(r.tipo==='TEXTO_HTML'?('📝 '+escapeHtml(r.contenidoHtml)):('<a href="'+r.urlCloudinary+'" target="_blank" rel="noopener noreferrer">📄 '+escapeHtml(r.titulo)+'</a>'))+'</div>';
        });
        (u.actividades||[]).forEach(function(a){
          html+=_htmlActividad(a,esDocente);
        });
        if(esDocente){
          html+='<div style="margin-top:8px"><button class="btn-sm" onclick="_univAbrirModalRecurso('+u.id+')">➕ Recurso</button> '
            +'<button class="btn-sm" style="background:#b7950b" onclick="_univAbrirModalActividad('+u.id+')">➕ Actividad</button></div>';
        }
        html+='</div>';
      });
      if(esDocente) html+='<button class="btn" onclick="_univAbrirModalUnidad('+d.aula.id+')">➕ Nueva Unidad</button>';
      html+='</div>';

      if(esDocente){
        html+='<div class="card"><h2>📊 Libro de Calificaciones</h2><p style="font-size:0.8rem;color:#666;margin-bottom:10px">Categorías ponderadas, promedio en tiempo real, y exportar/importar a Excel.</p>'
          +'<button class="btn verde" onclick="_univAbrirGradebook('+d.seccion.id+',\''+escapeHtml(d.seccion.codigoMateria+' — '+d.seccion.nombreAsignatura).replace(/'/g,"\\'")+'\')">📊 Abrir Libro de Calificaciones</button></div>';
        html+='<div class="card"><h2>📝 Centro de Calificaciones</h2><div id="_univCalifCont"><p style="color:#888;font-size:0.85rem">Seleccione una actividad arriba para calificar sus entregas.</p></div></div>';
      }
      contenedor().innerHTML=html;
    }).catch(mostrarErrorEnContenido);
  }
  function _htmlActividad(a,esDocente){
    const cierre=a.fechaCierre?new Date(a.fechaCierre).toLocaleDateString('es-CO'):'Sin fecha límite';
    const icono=a.tipo==='QUIZ'?'❓':(a.tipo==='FORO'?'💬':'📌');
    let html='<div style="padding:8px 10px;background:#fff8e1;border-radius:6px;margin-top:6px">'
      +'<b style="font-size:0.85rem">'+icono+' '+escapeHtml(a.titulo)+'</b>'
      +(a.instruccion?'<p style="font-size:0.78rem;margin:3px 0">'+escapeHtml(a.instruccion)+'</p>':'')
      +'<span style="font-size:0.72rem;color:#666">Vence: '+cierre+'</span>';
    if(a.tipo==='QUIZ'){
      if(esDocente){
        html+='<br><button class="btn-sm" style="margin-top:4px;background:#8e44ad" onclick="_univAbrirModalConfigQuiz('+a.id+')">⚙️ Configurar</button> '
          +'<button class="btn-sm" style="margin-top:4px" onclick="_univVerIntentosQuiz('+a.id+',\''+escapeHtml(a.titulo).replace(/'/g,"\\'")+'\')">👁️ Ver Intentos</button>';
      } else {
        html+='<br><button class="btn-sm" style="margin-top:4px;background:#8e44ad" onclick="_univAbrirTomarQuiz('+a.id+',\''+escapeHtml(a.titulo).replace(/'/g,"\\'")+'\')">❓ Tomar Cuestionario</button>';
      }
    } else if(esDocente){
      html+='<br><button class="btn-sm" style="margin-top:4px" onclick="_univVerEntregas('+a.id+','+a.maxCalificacion+')">👁️ Ver Entregas</button>';
    } else {
      html+='<br><button class="btn-sm" style="margin-top:4px;background:#b7950b" onclick="_univAbrirModalEntrega('+a.id+')">📤 Entregar</button>';
    }
    html+='</div>';
    return html;
  }
  window._univGuardarLinkClase=function(aulaId){
    const link=document.getElementById('_aLinkClase').value.trim();
    api('/aula/'+aulaId,{method:'PUT',body:{linkClaseVivo:link}}).then(function(){renderAulaDetalle(cache._seccionActualId);}).catch(function(e){alert(e.message);});
  };
  window._univVerEntregas=function(actividadId,maxCalif){
    api('/entregas/'+actividadId).then(function(res){
      const filas=res.entregas.map(function(en){
        return '<tr><td>'+escapeHtml(en.estudianteId)+'</td>'
          +'<td>'+(en.archivoUrlCloudinary?'<a href="'+en.archivoUrlCloudinary+'" target="_blank" rel="noopener noreferrer">📎 Ver</a>':(en.textoEntrega?'📝 Texto':'—'))+'</td>'
          +'<td><span class="badge-estado" style="background:'+(en.estado==='CALIFICADO'?'#d5f4e6':'#fdebd0')+';color:'+(en.estado==='CALIFICADO'?'#1e8449':'#b7950b')+'">'+en.estado+'</span></td>'
          +'<td><input type="number" min="0" max="'+maxCalif+'" step="0.1" value="'+(en.nota||'')+'" id="_nota_'+en.id+'" style="width:70px"></td>'
          +'<td><button class="btn-sm" style="background:#1e8449" onclick="_univCalificar('+en.id+')">✔ Calificar</button></td></tr>';
      }).join('');
      document.getElementById('_univCalifCont').innerHTML=res.entregas.length
        ?'<table><thead><tr><th>Estudiante</th><th>Entrega</th><th>Estado</th><th>Nota</th><th></th></tr></thead><tbody>'+filas+'</tbody></table>'
        :'<p style="color:#888;font-size:0.85rem">Todavía nadie ha entregado esta actividad.</p>';
    }).catch(function(e){alert(e.message);});
  };
  window._univCalificar=function(entregaId){
    const nota=document.getElementById('_nota_'+entregaId).value.trim();
    if(nota===''){alert('Escriba la nota.');return;}
    api('/entregas/'+entregaId+'/calificar',{method:'PUT',body:{nota:nota}}).then(function(res){
      alert(res.alimentadoEnPlanilla?'✅ Calificado y agregado al libro de calificaciones.':'✅ Calificado.');
    }).catch(function(e){alert(e.message);});
  };
  window._univAbrirModalUnidad=function(aulaId){
    _abrirModal('<h2>➕ Nueva Unidad</h2><label>Título</label><input id="_mUTitulo" placeholder="Ej: Unidad 1">'
      +'<label>Descripción</label><textarea id="_mUDesc" rows="3"></textarea>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarUnidad('+aulaId+')">Crear</button></div>');
  };
  window._univGuardarUnidad=function(aulaId){
    const titulo=document.getElementById('_mUTitulo').value.trim();
    if(!titulo){alert('Escriba un título.');return;}
    const descripcion=document.getElementById('_mUDesc').value.trim();
    api('/unidades',{method:'POST',body:{aulaId:aulaId,titulo:titulo,descripcion:descripcion}}).then(function(){_cerrarModal();renderAulaDetalle(cache._seccionActualId);}).catch(function(e){alert(e.message);});
  };
  // ── Reordenar unidades por arrastre (drag & drop nativo) ────────────────
  let _univDragOrigenId=null;
  window._univDragStart=function(ev,unidadId){ _univDragOrigenId=unidadId; ev.dataTransfer.effectAllowed='move'; };
  window._univDragOver=function(ev){ ev.preventDefault(); ev.dataTransfer.dropEffect='move'; };
  window._univDrop=function(ev,unidadDestinoId){
    ev.preventDefault();
    const origenId=_univDragOrigenId; _univDragOrigenId=null;
    if(!origenId||origenId===unidadDestinoId) return;
    const lista=(cache.aulaActual.unidades||[]).slice();
    const idxOrigen=lista.findIndex(function(u){return u.id===origenId;});
    const idxDestino=lista.findIndex(function(u){return u.id===unidadDestinoId;});
    if(idxOrigen===-1||idxDestino===-1) return;
    const movida=lista.splice(idxOrigen,1)[0];
    lista.splice(idxDestino,0,movida);
    cache.aulaActual.unidades=lista;
    // Vista optimista inmediata; si el guardado falla, se recarga desde el servidor
    _repintarUnidadesDesdeCache();
    const reordenar=lista.map(function(u,i){return {id:u.id,orden:i};});
    api('/unidades',{method:'POST',body:{reordenar:reordenar}}).catch(function(){renderAulaDetalle(cache._seccionActualId);});
  };
  function _repintarUnidadesDesdeCache(){ renderAulaDetalle(cache._seccionActualId); }
  // Subida de archivos: función aparte de "api()" porque esta usa
  // FormData (no JSON) — el navegador arma el "Content-Type" correcto
  // automáticamente para archivos.
  function apiUpload(file,carpeta){
    const fd=new FormData();
    fd.append('archivo',file);
    fd.append('carpeta',carpeta||'general');
    return fetch('/api/university/upload',{method:'POST',headers:{'Authorization':'Bearer '+TOKEN},body:fd}).then(function(r){
      return r.json().then(function(data){ if(!r.ok) throw new Error(data.error||'No se pudo subir el archivo.'); return data; });
    });
  }
  window._univAbrirModalRecurso=function(unidadId){
    _abrirModal('<h2>➕ Nuevo Recurso</h2><label>Título</label><input id="_mRTitulo" placeholder="Título">'
      +'<label>Tipo</label><select id="_mRTipo" onchange="(function(v){document.getElementById(\'_mRBloqueArchivo\').style.display=(v===\'DOCUMENTO\')?\'block\':\'none\';document.getElementById(\'_mRBloqueUrl\').style.display=(v===\'ENLACE_EXTERNO\')?\'block\':\'none\';document.getElementById(\'_mRBloqueTexto\').style.display=(v===\'TEXTO_HTML\')?\'block\':\'none\';})(this.value)">'
      +'<option value="DOCUMENTO">📄 Documento (subir archivo)</option><option value="ENLACE_EXTERNO">🔗 Enlace</option><option value="TEXTO_HTML">📝 Texto</option></select>'
      +'<div id="_mRBloqueArchivo"><label>Archivo</label><input type="file" id="_mRArchivo" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png"></div>'
      +'<div id="_mRBloqueUrl" style="display:none"><label>URL</label><input id="_mRUrl" placeholder="https://..."></div>'
      +'<div id="_mRBloqueTexto" style="display:none"><label>Texto</label><textarea id="_mRTexto" rows="3"></textarea></div>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" id="_mRBtnGuardar" onclick="_univGuardarRecurso('+unidadId+')">Crear</button></div>');
  };
  window._univGuardarRecurso=function(unidadId){
    const titulo=document.getElementById('_mRTitulo').value.trim();
    if(!titulo){alert('Escriba un título.');return;}
    const tipo=document.getElementById('_mRTipo').value;
    const btn=document.getElementById('_mRBtnGuardar');
    function guardarConValores(urlCloudinary,contenidoHtml){
      api('/recursos',{method:'POST',body:{unidadId:unidadId,titulo:titulo,tipo:tipo,urlCloudinary:urlCloudinary||'',contenidoHtml:contenidoHtml||''}}).then(function(){_cerrarModal();renderAulaDetalle(cache._seccionActualId);}).catch(function(e){alert(e.message);btn.disabled=false;btn.textContent='Crear';});
    }
    if(tipo==='DOCUMENTO'){
      const archivo=document.getElementById('_mRArchivo').files[0];
      if(!archivo){alert('Seleccione un archivo.');return;}
      btn.disabled=true;btn.textContent='⏳ Subiendo...';
      apiUpload(archivo,'recursos').then(function(res){ guardarConValores(res.url,''); }).catch(function(e){alert(e.message);btn.disabled=false;btn.textContent='Crear';});
    } else if(tipo==='ENLACE_EXTERNO'){
      const url=document.getElementById('_mRUrl').value.trim();
      if(!url){alert('Escriba la URL.');return;}
      guardarConValores(url,'');
    } else {
      const texto=document.getElementById('_mRTexto').value.trim();
      if(!texto){alert('Escriba el texto.');return;}
      guardarConValores('',texto);
    }
  };
  window._univAbrirModalActividad=function(unidadId){
    _abrirModal('<h2>➕ Nueva Actividad</h2><label>Título</label><input id="_mATitulo" placeholder="Título">'
      +'<label>Tipo</label><select id="_mATipo" onchange="document.getElementById(\'_mABloqueTarea\').style.display=(this.value===\'TAREA\')?\'block\':\'none\'">'
      +'<option value="TAREA">📝 Tarea / Entrega</option><option value="QUIZ">❓ Cuestionario / Examen</option><option value="FORO">💬 Foro de Discusión</option></select>'
      +'<label>Instrucciones</label><textarea id="_mAInstruccion" rows="3"></textarea>'
      +'<label>Fecha de cierre</label><input type="date" id="_mACierre">'
      +'<div id="_mABloqueTarea"><label>Nota máxima</label><input id="_mAMax" value="5.0"></div>'
      +'<p style="font-size:0.76rem;color:#888;display:none" id="_mAAvisoQuiz">💡 Tras crear la actividad, se abrirá la configuración del cuestionario (tiempo, intentos, preguntas).</p>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarActividad('+unidadId+')">Crear</button></div>');
    document.getElementById('_mATipo').addEventListener('change',function(){document.getElementById('_mAAvisoQuiz').style.display=(this.value==='QUIZ')?'block':'none';});
  };
  window._univGuardarActividad=function(unidadId){
    const titulo=document.getElementById('_mATitulo').value.trim();
    if(!titulo){alert('Escriba un título.');return;}
    const tipo=document.getElementById('_mATipo').value;
    const instruccion=document.getElementById('_mAInstruccion').value.trim();
    const fechaCierre=document.getElementById('_mACierre').value||null;
    const maxCalificacion=(tipo==='TAREA'?document.getElementById('_mAMax').value.trim():'')||'5.0';
    api('/actividades',{method:'POST',body:{unidadId:unidadId,titulo:titulo,instruccion:instruccion,tipo:tipo,fechaCierre:fechaCierre,maxCalificacion:maxCalificacion}}).then(function(res){
      _cerrarModal();
      if(tipo==='QUIZ'){ window._univAbrirModalConfigQuiz(res.actividad.id); }
      else { renderAulaDetalle(cache._seccionActualId); }
    }).catch(function(e){alert(e.message);});
  };

  // ══════════════════════════════════════════════════════════════════════
  // MOTOR DE CUESTIONARIOS/QUIZ — configuración (docente)
  // ══════════════════════════════════════════════════════════════════════
  window._univAbrirModalConfigQuiz=function(actividadId){
    Promise.all([api('/actividades/'+actividadId+'/cuestionario'),api('/banco-preguntas')]).then(function(res){
      const cuestionario=res[0].cuestionario, preguntasAgregadas=res[0].preguntas, bancos=res[1].bancos;
      if(!cuestionario){
        _abrirModal('<h2>⚙️ Configurar Cuestionario</h2>'
          +'<label>Tiempo límite (minutos, opcional)</label><input type="number" id="_qzTiempo" placeholder="Sin límite si se deja vacío">'
          +'<label>Intentos permitidos</label><input type="number" id="_qzIntentos" value="1">'
          +'<label>Método de calificación (con varios intentos)</label><select id="_qzMetodo">'
          +'<option value="NOTA_MAS_ALTA">Nota más alta</option><option value="PROMEDIO">Promedio</option><option value="ULTIMO_INTENTO">Último intento</option></select>'
          +'<label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="checkbox" id="_qzBarajarP" style="width:auto"> Barajar orden de las preguntas</label>'
          +'<label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="checkbox" id="_qzBarajarR" style="width:auto"> Barajar orden de las respuestas</label>'
          +'<label>Retroalimentación</label><select id="_qzRetro"><option value="AL_FINALIZAR">Al finalizar el intento</option><option value="INMEDIATA">Inmediata (por pregunta)</option><option value="NINGUNA">Ninguna</option></select>'
          +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal();renderAulaDetalle(cache._seccionActualId);">Cerrar</button>'
          +'<button class="btn verde" onclick="_univGuardarConfigQuiz('+actividadId+')">💾 Crear Cuestionario</button></div>');
        return;
      }
      window._univRenderPreguntasQuiz(actividadId,cuestionario,preguntasAgregadas,bancos);
    }).catch(function(e){alert(e.message);});
  };
  window._univGuardarConfigQuiz=function(actividadId){
    const tiempoLimiteMinutos=document.getElementById('_qzTiempo').value.trim()||null;
    const intentosPermitidos=document.getElementById('_qzIntentos').value.trim()||'1';
    const metodoCalificacion=document.getElementById('_qzMetodo').value;
    const barajarPreguntas=document.getElementById('_qzBarajarP').checked;
    const barajarRespuestas=document.getElementById('_qzBarajarR').checked;
    const retroalimentacion=document.getElementById('_qzRetro').value;
    api('/actividades/'+actividadId+'/cuestionario',{method:'POST',body:{tiempoLimiteMinutos:tiempoLimiteMinutos,intentosPermitidos:intentosPermitidos,metodoCalificacion:metodoCalificacion,barajarPreguntas:barajarPreguntas,barajarRespuestas:barajarRespuestas,retroalimentacion:retroalimentacion}}).then(function(){
      window._univAbrirModalConfigQuiz(actividadId);
    }).catch(function(e){alert(e.message);});
  };
  window._univRenderPreguntasQuiz=function(actividadId,cuestionario,preguntasAgregadas,bancos){
    const filas=preguntasAgregadas.map(function(p){
      return '<tr><td style="text-align:left">'+escapeHtml(p.enunciado)+'</td><td>'+p.tipo.replace('_',' ')+'</td><td>'+p.puntaje+'</td>'
        +'<td><button class="btn-sm" style="background:#c0392b" onclick="_univQuitarPreguntaQuiz('+p.id+','+actividadId+')">🗑</button></td></tr>';
    }).join('');
    const puntajeTotal=preguntasAgregadas.reduce(function(s,p){return s+Number(p.puntaje);},0);
    _abrirModal('<h2>❓ Preguntas del Cuestionario</h2><p style="font-size:0.78rem;color:#666;margin-bottom:8px">Puntaje total actual: <b>'+puntajeTotal.toFixed(1)+'</b></p>'
      +(preguntasAgregadas.length?'<table><thead><tr><th>Pregunta</th><th>Tipo</th><th>Pts</th><th></th></tr></thead><tbody>'+filas+'</tbody></table>':'<p style="font-size:0.8rem;color:#888">Sin preguntas agregadas todavía.</p>')
      +'<h4 style="font-size:0.85rem;margin:14px 0 6px">Agregar desde el Banco de Preguntas</h4>'
      +(bancos.length?'<button class="btn-sm" style="background:#1a5276" onclick="_univAbrirModalBancoPreguntas('+actividadId+')">📚 Ir al Banco de Preguntas</button>'
        :'<p style="font-size:0.8rem;color:#c0392b">Todavía no tiene ningún banco de preguntas creado. <button class="btn-sm" style="background:#1a5276" onclick="_univAbrirModalBancoPreguntas('+actividadId+')">➕ Crear uno</button></p>')
      +'<div style="margin-top:14px"><button class="btn gris" onclick="_cerrarModal();renderAulaDetalle(cache._seccionActualId);">Cerrar</button></div>');
  };
  window._univQuitarPreguntaQuiz=function(itemId,actividadId){
    api('/cuestionarios/preguntas/'+itemId,{method:'DELETE'}).then(function(){window._univAbrirModalConfigQuiz(actividadId);}).catch(function(e){alert(e.message);});
  };

  // ── Banco de Preguntas ────────────────────────────────────────────────
  window._univAbrirModalBancoPreguntas=function(actividadId){
    api('/banco-preguntas').then(function(res){
      const bancos=res.bancos;
      const filas=bancos.map(function(b){
        return '<tr><td style="text-align:left">'+escapeHtml(b.categoria)+'</td>'
          +'<td><button class="btn-sm" onclick="_univAbrirModalPreguntasBanco('+b.id+',\''+escapeHtml(b.categoria).replace(/'/g,"\\'")+'\','+(actividadId||'null')+')">📝 Ver Preguntas</button></td></tr>';
      }).join('');
      _abrirModal('<h2>📚 Banco de Preguntas</h2>'
        +(bancos.length?'<table><tbody>'+filas+'</tbody></table>':'<p style="font-size:0.8rem;color:#888">Sin bancos creados.</p>')
        +'<div style="margin-top:12px"><label>Nueva categoría</label><input id="_bancoNombre" placeholder="Ej: Cálculo I - Derivadas">'
        +'<button class="btn-sm" style="background:#1e8449" onclick="_univCrearBanco('+(actividadId||'null')+')">➕ Crear Banco</button></div>'
        +'<div style="margin-top:14px"><button class="btn gris" onclick="'+(actividadId?('_cerrarModal();window._univAbrirModalConfigQuiz('+actividadId+')'):'_cerrarModal()')+'">Cerrar</button></div>');
    }).catch(function(e){alert(e.message);});
  };
  window._univCrearBanco=function(actividadId){
    const categoria=document.getElementById('_bancoNombre').value.trim();
    if(!categoria){alert('Escriba el nombre de la categoría.');return;}
    api('/banco-preguntas',{method:'POST',body:{categoria:categoria}}).then(function(){window._univAbrirModalBancoPreguntas(actividadId);}).catch(function(e){alert(e.message);});
  };
  window._univAbrirModalPreguntasBanco=function(bancoId,nombreBanco,actividadId){
    api('/banco-preguntas/'+bancoId+'/preguntas').then(function(res){
      const preguntas=res.preguntas;
      const TIPO_LABEL={OPCION_UNICA:'Opción única',OPCION_MULTIPLE:'Opción múltiple',VERDADERO_FALSO:'Verdadero/Falso',RESPUESTA_CORTA:'Respuesta corta',ENSAYO:'Ensayo'};
      const filas=preguntas.map(function(p){
        return '<tr><td style="text-align:left">'+escapeHtml(p.enunciado)+'</td><td>'+TIPO_LABEL[p.tipo]+'</td><td>'+p.puntaje+'</td>'
          +'<td>'+(actividadId?'<button class="btn-sm" style="background:#1e8449" onclick="_univAgregarPreguntaAQuiz('+actividadId+','+p.id+')">➕ Usar</button>':'')
          +' <button class="btn-sm" style="background:#c0392b" onclick="_univEliminarPregunta('+p.id+','+bancoId+',\''+nombreBanco.replace(/'/g,"\\'")+'\','+(actividadId||'null')+')">🗑</button></td></tr>';
      }).join('');
      _abrirModal('<h2>📝 Preguntas — '+escapeHtml(nombreBanco)+'</h2>'
        +(preguntas.length?'<table><thead><tr><th>Enunciado</th><th>Tipo</th><th>Pts</th><th></th></tr></thead><tbody>'+filas+'</tbody></table>':'<p style="font-size:0.8rem;color:#888">Sin preguntas todavía.</p>')
        +'<button class="btn-sm" style="background:#1a5276;margin-top:10px" onclick="_univAbrirModalNuevaPregunta('+bancoId+',\''+nombreBanco.replace(/'/g,"\\'")+'\','+(actividadId||'null')+')">➕ Nueva Pregunta</button>'
        +'<div style="margin-top:14px"><button class="btn gris" onclick="_cerrarModal();window._univAbrirModalBancoPreguntas('+(actividadId||'null')+')">← Volver</button></div>');
    }).catch(function(e){alert(e.message);});
  };
  window._univAgregarPreguntaAQuiz=function(actividadId,preguntaId){
    api('/actividades/'+actividadId+'/cuestionario').then(function(res){
      if(!res.cuestionario){alert('Primero configure el cuestionario.');return;}
      api('/cuestionarios/'+res.cuestionario.id+'/preguntas',{method:'POST',body:{preguntaId:preguntaId}}).then(function(){
        _showAlertaOk('✅ Pregunta agregada al cuestionario.');
      }).catch(function(e){alert(e.message);});
    });
  };
  window._univEliminarPregunta=function(preguntaId,bancoId,nombreBanco,actividadId){
    if(!confirm('¿Eliminar esta pregunta? Se quitará de cualquier cuestionario que la esté usando.')) return;
    api('/preguntas/'+preguntaId,{method:'DELETE'}).then(function(){window._univAbrirModalPreguntasBanco(bancoId,nombreBanco,actividadId);}).catch(function(e){alert(e.message);});
  };

  window._univAbrirModalNuevaPregunta=function(bancoId,nombreBanco,actividadId){
    _abrirModal('<h2>➕ Nueva Pregunta</h2>'
      +'<label>Tipo de pregunta</label><select id="_pgTipo" onchange="_univActualizarFormPregunta()">'
      +'<option value="OPCION_UNICA">Opción única</option><option value="OPCION_MULTIPLE">Opción múltiple</option>'
      +'<option value="VERDADERO_FALSO">Verdadero/Falso</option><option value="RESPUESTA_CORTA">Respuesta corta</option>'
      +'<option value="ENSAYO">Ensayo (calificación manual)</option></select>'
      +'<label>Enunciado</label><textarea id="_pgEnunciado" rows="2"></textarea>'
      +'<label>Puntaje</label><input type="number" step="0.1" id="_pgPuntaje" value="1.0">'
      +'<div id="_pgOpcionesCont"></div>'
      +'<p id="_pgError" style="color:#c0392b;font-size:0.78rem;display:none;margin-top:6px"></p>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal();window._univAbrirModalPreguntasBanco('+bancoId+',\''+nombreBanco.replace(/'/g,"\\'")+'\','+(actividadId||'null')+')">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarPregunta('+bancoId+',\''+nombreBanco.replace(/'/g,"\\'")+'\','+(actividadId||'null')+')">💾 Crear Pregunta</button></div>');
    window._univActualizarFormPregunta();
  };
  window._univActualizarFormPregunta=function(){
    const tipo=document.getElementById('_pgTipo').value;
    const cont=document.getElementById('_pgOpcionesCont');
    if(tipo==='OPCION_UNICA'||tipo==='OPCION_MULTIPLE'){
      cont.innerHTML='<label>Opciones (marque la(s) correcta(s))</label><div id="_pgOpcionesLista"></div>'
        +'<button type="button" class="btn-sm" style="background:#1a5276" onclick="_univAgregarOpcionPregunta()">➕ Agregar Opción</button>';
      window._univOpcionesPregunta=[{texto:'',correcta:false},{texto:'',correcta:false}];
      window._univRenderOpcionesPregunta(tipo);
    } else if(tipo==='VERDADERO_FALSO'){
      cont.innerHTML='<label>Respuesta correcta</label><select id="_pgVFCorrecta"><option value="v">Verdadero</option><option value="f">Falso</option></select>';
    } else if(tipo==='RESPUESTA_CORTA'){
      cont.innerHTML='<label>Respuestas aceptadas como correctas (una por línea)</label><textarea id="_pgRespCorta" rows="3" placeholder="Bogotá&#10;Bogota"></textarea>';
    } else {
      cont.innerHTML='<p style="font-size:0.78rem;color:#666">El ensayo no tiene opciones — el estudiante escribe libremente y usted lo califica después.</p>';
    }
  };
  window._univAgregarOpcionPregunta=function(){
    window._univOpcionesPregunta.push({texto:'',correcta:false});
    window._univRenderOpcionesPregunta(document.getElementById('_pgTipo').value);
  };
  window._univRenderOpcionesPregunta=function(tipo){
    const inputTipo=tipo==='OPCION_UNICA'?'radio':'checkbox';
    document.getElementById('_pgOpcionesLista').innerHTML=window._univOpcionesPregunta.map(function(o,i){
      return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'
        +'<input type="'+inputTipo+'" name="_pgOpcCorrecta" '+(o.correcta?'checked':'')+' onchange="window._univOpcionesPregunta.forEach(function(x,j){if(\''+inputTipo+'\'===\'radio\') x.correcta=(j==='+i+');});if(\''+inputTipo+'\'!=\'radio\') window._univOpcionesPregunta['+i+'].correcta=this.checked;" style="width:auto">'
        +'<input value="'+escapeHtml(o.texto)+'" placeholder="Texto de la opción" oninput="window._univOpcionesPregunta['+i+'].texto=this.value" style="flex:1;margin-bottom:0">'
        +'</div>';
    }).join('');
  };
  window._univGuardarPregunta=function(bancoId,nombreBanco,actividadId){
    const tipo=document.getElementById('_pgTipo').value;
    const enunciado=document.getElementById('_pgEnunciado').value.trim();
    const puntaje=document.getElementById('_pgPuntaje').value.trim()||'1.0';
    const errEl=document.getElementById('_pgError');
    errEl.style.display='none';
    if(!enunciado){errEl.textContent='Escriba el enunciado.';errEl.style.display='block';return;}
    let opciones=[],respuestaCorta=[];
    if(tipo==='OPCION_UNICA'||tipo==='OPCION_MULTIPLE'){
      opciones=window._univOpcionesPregunta.map(function(o,i){return {id:String.fromCharCode(97+i),texto:o.texto,correcta:o.correcta};}).filter(function(o){return o.texto.trim();});
      if(opciones.length<2){errEl.textContent='Agregue al menos 2 opciones con texto.';errEl.style.display='block';return;}
      if(!opciones.some(function(o){return o.correcta;})){errEl.textContent='Marque al menos una opción como correcta.';errEl.style.display='block';return;}
    } else if(tipo==='VERDADERO_FALSO'){
      const correcta=document.getElementById('_pgVFCorrecta').value;
      opciones=[{id:'v',texto:'Verdadero',correcta:correcta==='v'},{id:'f',texto:'Falso',correcta:correcta==='f'}];
    } else if(tipo==='RESPUESTA_CORTA'){
      respuestaCorta=document.getElementById('_pgRespCorta').value.split('\n').map(function(s){return s.trim();}).filter(Boolean);
      if(!respuestaCorta.length){errEl.textContent='Escriba al menos una respuesta aceptada.';errEl.style.display='block';return;}
    }
    api('/preguntas',{method:'POST',body:{bancoId:bancoId,tipo:tipo,enunciado:enunciado,puntaje:puntaje,opciones:opciones,respuestaCorta:respuestaCorta}}).then(function(){
      _cerrarModal();window._univAbrirModalPreguntasBanco(bancoId,nombreBanco,actividadId);
    }).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };

  // ══════════════════════════════════════════════════════════════════════
  // TOMAR CUESTIONARIO (estudiante) — con cronómetro y autoguardado
  // ══════════════════════════════════════════════════════════════════════
  window._univAbrirTomarQuiz=function(actividadId,titulo){
    cache._quizActividadId=actividadId;
    cache._quizTitulo=titulo;
    irA('tomar-quiz');
  };
  function renderTomarQuiz(actividadId){
    api('/cuestionarios/'+actividadId+'/tomar').then(function(res){
      if(_univQuizTimerInterval){clearInterval(_univQuizTimerInterval);_univQuizTimerInterval=null;}
      if(res.agotado){
        contenedor().innerHTML='<button class="btn gris" style="margin-bottom:14px" onclick="_univIrA(\'aula-detalle\')">← Volver</button>'
          +'<div class="card"><h2>❓ '+escapeHtml(cache._quizTitulo||'Cuestionario')+'</h2>'
          +'<p style="color:#c0392b">⚠️ Ya utilizó todos sus intentos permitidos ('+res.cuestionario.intentosPermitidos+').</p>'
          +_htmlResumenIntentosPrevios(res.intentosPrevios)+'</div>';
        return;
      }
      cache._quizEstado={intento:res.intento,preguntas:res.preguntas,cuestionario:res.cuestionario,respuestas:(res.intento.respuestas||{})};
      let html='<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">'
        +'<h2 style="margin:0">❓ '+escapeHtml(cache._quizTitulo||'Cuestionario')+'</h2>';
      if(res.cuestionario.tiempoLimiteMinutos) html+='<div id="_quizCronometro" style="background:#c0392b;color:#fff;padding:8px 16px;border-radius:8px;font-weight:700;font-size:1.1rem">⏱️ --:--</div>';
      html+='</div><p style="font-size:0.78rem;color:#666;margin-top:6px">Intento '+res.intento.numeroIntento+' de '+res.cuestionario.intentosPermitidos+' · '+res.preguntas.length+' pregunta(s)</p></div>';
      res.preguntas.forEach(function(p,idx){ html+=_htmlPreguntaQuiz(p,idx,cache._quizEstado.respuestas[String(p.id)]); });
      html+='<div class="card"><button class="btn verde" style="width:100%;padding:14px;font-size:1rem" onclick="_univEntregarQuiz()">✅ Entregar Cuestionario</button></div>';
      contenedor().innerHTML=html;
      if(res.cuestionario.tiempoLimiteMinutos){
        const finTs=new Date(res.intento.fechaInicio).getTime()+res.cuestionario.tiempoLimiteMinutos*60000;
        _univQuizTimerInterval=setInterval(function(){ _univActualizarCronometro(finTs); },1000);
        _univActualizarCronometro(finTs);
      }
    }).catch(mostrarErrorEnContenido);
  }
  function _htmlResumenIntentosPrevios(intentos){
    if(!intentos||!intentos.length) return '';
    const filas=intentos.map(function(i){
      return '<tr><td>Intento '+i.numeroIntento+'</td><td>'+(i.notaObtenida!=null?i.notaObtenida+'/'+i.notaMaxima:(i.tienePendientesManual?'Pendiente de calificación':'—'))+'</td></tr>';
    }).join('');
    return '<table style="margin-top:10px"><thead><tr><th>Intento</th><th>Nota</th></tr></thead><tbody>'+filas+'</tbody></table>';
  }
  function _htmlPreguntaQuiz(p,idx,respuestaGuardada){
    let html='<div class="card"><b style="font-size:0.9rem">'+(idx+1)+'. '+escapeHtml(p.enunciado)+'</b> <span class="tag-credito">'+p.puntaje+' pts</span>';
    if(p.tipo==='OPCION_UNICA'||p.tipo==='VERDADERO_FALSO'){
      html+='<div style="margin-top:10px">'+p.opciones.map(function(o){
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-weight:400"><input type="radio" name="_qzP'+p.id+'" value="'+o.id+'" '+(respuestaGuardada===o.id?'checked':'')+' onchange="_univGuardarRespuestaLocal('+p.id+',this.value)" style="width:auto">'+escapeHtml(o.texto)+'</label>';
      }).join('')+'</div>';
    } else if(p.tipo==='OPCION_MULTIPLE'){
      const seleccionadas=Array.isArray(respuestaGuardada)?respuestaGuardada:[];
      html+='<div style="margin-top:10px">'+p.opciones.map(function(o){
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-weight:400"><input type="checkbox" value="'+o.id+'" '+(seleccionadas.indexOf(o.id)!==-1?'checked':'')+' onchange="_univToggleRespuestaMultiple('+p.id+',\''+o.id+'\',this.checked)" style="width:auto">'+escapeHtml(o.texto)+'</label>';
      }).join('')+'</div>';
    } else if(p.tipo==='RESPUESTA_CORTA'){
      html+='<input style="margin-top:10px" value="'+escapeHtml(respuestaGuardada||'')+'" oninput="_univGuardarRespuestaLocal('+p.id+',this.value)" placeholder="Su respuesta">';
    } else { // ENSAYO
      html+='<textarea style="margin-top:10px" rows="5" oninput="_univGuardarRespuestaLocal('+p.id+',this.value)" placeholder="Escriba su respuesta...">'+escapeHtml(respuestaGuardada||'')+'</textarea>';
    }
    html+='</div>';
    return html;
  }
  let _univQuizTimerInterval=null;
  let _univQuizGuardadoTimeout=null;
  function _univActualizarCronometro(finTs){
    const restante=finTs-Date.now();
    const el=document.getElementById('_quizCronometro');
    if(restante<=0){
      if(el) el.textContent='⏱️ 00:00';
      clearInterval(_univQuizTimerInterval);_univQuizTimerInterval=null;
      alert('⏱️ Se acabó el tiempo. El cuestionario se entregará automáticamente.');
      _univEntregarQuiz();
      return;
    }
    const min=Math.floor(restante/60000), seg=Math.floor((restante%60000)/1000);
    if(el) el.textContent='⏱️ '+String(min).padStart(2,'0')+':'+String(seg).padStart(2,'0');
  }
  window._univGuardarRespuestaLocal=function(preguntaId,valor){
    cache._quizEstado.respuestas[String(preguntaId)]=valor;
    _univAutoguardarRespuesta(preguntaId,valor);
  };
  window._univToggleRespuestaMultiple=function(preguntaId,opcionId,marcada){
    const actual=Array.isArray(cache._quizEstado.respuestas[String(preguntaId)])?cache._quizEstado.respuestas[String(preguntaId)].slice():[];
    const idx=actual.indexOf(opcionId);
    if(marcada&&idx===-1) actual.push(opcionId);
    else if(!marcada&&idx!==-1) actual.splice(idx,1);
    cache._quizEstado.respuestas[String(preguntaId)]=actual;
    _univAutoguardarRespuesta(preguntaId,actual);
  };
  function _univAutoguardarRespuesta(preguntaId,valor){
    // Autoguardado con una pequeña espera (evita mandar una petición por
    // cada tecla si es respuesta de texto) — no bloquea al estudiante.
    clearTimeout(_univQuizGuardadoTimeout);
    _univQuizGuardadoTimeout=setTimeout(function(){
      api('/intentos/'+cache._quizEstado.intento.id+'/responder',{method:'PUT',body:{preguntaId:preguntaId,respuesta:valor}}).catch(function(){/* si falla el autoguardado, la respuesta sigue en pantalla; se reintentará con la siguiente respuesta o al entregar */});
    },500);
  }
  window._univEntregarQuiz=function(){
    if(_univQuizTimerInterval){clearInterval(_univQuizTimerInterval);_univQuizTimerInterval=null;}
    if(!confirm('¿Entregar el cuestionario? No podrá cambiar sus respuestas después de esto.')) return;
    api('/intentos/'+cache._quizEstado.intento.id+'/entregar',{method:'POST'}).then(function(res){
      let msg=res.pendienteManual?'✅ Entregado. Una parte requiere calificación manual del docente.':'✅ Entregado. Nota obtenida: '+res.notaObtenida+'/'+res.notaMaxima;
      alert(msg);
      irA('aula-detalle');
    }).catch(function(e){alert(e.message);});
  };

  // ── Ver Intentos y calificar Ensayos (docente) ───────────────────────────
  window._univVerIntentosQuiz=function(actividadId,titulo){
    api('/actividades/'+actividadId+'/cuestionario').then(function(res){
      if(!res.cuestionario){alert('Este cuestionario todavía no está configurado.');return;}
      cache._quizPreguntasDocente=res.preguntas; // se reutiliza al calificar ensayos, sin pedirlo de nuevo
      api('/cuestionarios/'+res.cuestionario.id+'/intentos').then(function(res2){
        const intentos=res2.intentos;
        const filas=intentos.map(function(i){
          const estadoColor=i.estado==='CALIFICADO'?'#1e8449':(i.estado==='ENTREGADO'?'#b7950b':'#888');
          return '<tr><td>'+escapeHtml(i.estudianteId)+'</td><td>Intento '+i.numeroIntento+'</td>'
            +'<td><span style="color:'+estadoColor+';font-weight:700">'+i.estado+(i.tienePendientesManual?' (pendiente)':'')+'</span></td>'
            +'<td>'+(i.notaObtenida!=null?i.notaObtenida+'/'+i.notaMaxima:'—')+'</td>'
            +'<td>'+(i.tienePendientesManual?'<button class="btn-sm" style="background:#8e44ad" onclick="_univAbrirCalificarEnsayo('+i.id+')">✍️ Calificar Ensayo</button>':'')+'</td></tr>';
        }).join('');
        contenedor().innerHTML='<button class="btn gris" style="margin-bottom:14px" onclick="_univIrA(\'aula-detalle\')">← Volver</button>'
          +'<div class="card"><h2>👁️ Intentos — '+escapeHtml(titulo)+'</h2>'
          +(intentos.length?'<table><thead><tr><th>Estudiante</th><th>Intento</th><th>Estado</th><th>Nota</th><th></th></tr></thead><tbody>'+filas+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Nadie ha presentado este cuestionario todavía.</p>')
          +'</div>';
        cache._quizIntentosDocente=intentos; // para reutilizar en el modal de calificar
      });
    }).catch(function(e){alert(e.message);});
  };
  window._univAbrirCalificarEnsayo=function(intentoId){
    const intento=(cache._quizIntentosDocente||[]).find(function(i){return i.id===intentoId;});
    const preguntasEnsayo=(cache._quizPreguntasDocente||[]).filter(function(p){return p.tipo==='ENSAYO';});
    if(!intento||!preguntasEnsayo.length){alert('No se encontraron ensayos para calificar en este intento.');return;}
    const respuestas=intento.respuestas||{};
    const bloques=preguntasEnsayo.map(function(p){
      const respuestaEstudiante=respuestas[String(p.preguntaId||p.id)]||'(sin responder)';
      const idPregunta=p.preguntaId||p.id;
      return '<div style="border:1px solid #eee;border-radius:8px;padding:10px;margin-bottom:10px">'
        +'<b style="font-size:0.85rem">'+escapeHtml(p.enunciado)+'</b> <span class="tag-credito">máx. '+p.puntaje+' pts</span>'
        +'<p style="font-size:0.82rem;background:#f4f1fa;padding:8px;border-radius:6px;margin:8px 0">'+escapeHtml(respuestaEstudiante)+'</p>'
        +'<label>Puntaje asignado</label><input type="number" step="0.1" min="0" max="'+p.puntaje+'" data-pregunta-id="'+idPregunta+'" data-ensayo-puntaje></div>';
    }).join('');
    _abrirModal('<h2>✍️ Calificar Ensayo</h2><p style="font-size:0.82rem;color:#666;margin-bottom:10px">Estudiante: '+escapeHtml(intento.estudianteId)+'</p>'
      +bloques
      +'<div style="display:flex;gap:8px;margin-top:14px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarCalificacionEnsayo('+intentoId+')">💾 Guardar Calificación</button></div>');
  };
  window._univGuardarCalificacionEnsayo=function(intentoId){
    const puntajesEnsayo={};
    document.querySelectorAll('[data-ensayo-puntaje]').forEach(function(el){
      puntajesEnsayo[el.getAttribute('data-pregunta-id')]=el.value;
    });
    api('/intentos/'+intentoId+'/calificar-manual',{method:'PUT',body:{puntajesEnsayo:puntajesEnsayo}}).then(function(res){
      _cerrarModal();_showAlertaOk('✅ Ensayo calificado. Nota total: '+res.notaObtenida);
    }).catch(function(e){alert(e.message);});
  };

  // ══════════════════════════════════════════════════════════════════════
  // AULA VIRTUAL — ESTUDIANTE
  // ══════════════════════════════════════════════════════════════════════
  function renderMisAulasEstudiante(){
    // Usa matrícula real (tabla univ_matriculas) — ya no filtra por
    // coincidencia de texto de "grupo" como antes.
    api('/mis-secciones').then(function(res){
      const misSecciones=res.secciones;
      if(!misSecciones.length){ contenedor().innerHTML='<div class="card"><p style="color:#888">No tiene aulas virtuales disponibles todavía. Su Programa Académico debe matricularlo en una sección primero.</p></div>'; return; }
      const filas=misSecciones.map(function(s){
        return '<tr><td>'+escapeHtml(s.codigoMateria)+' — '+escapeHtml(s.nombreAsignatura)+'</td><td><span class="tag-credito">'+s.creditos+' créd.</span></td>'
          +'<td><button class="btn-sm" onclick="_univAbrirAula(\''+s.id+'\')">💻 Entrar</button></td></tr>';
      }).join('');
      contenedor().innerHTML='<div class="card"><h2>💻 Mis Aulas Virtuales</h2><table><thead><tr><th>Asignatura</th><th>Créditos</th><th></th></tr></thead><tbody>'+filas+'</tbody></table></div>';
    }).catch(mostrarErrorEnContenido);
  }
  window._univAbrirModalEntrega=function(actividadId){
    _abrirModal('<h2>📤 Entregar Actividad</h2>'
      +'<label>Archivo (opcional — PDF, Word, imagen; máx. 15 MB)</label><input type="file" id="_mEArchivo" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png">'
      +'<p id="_mEArchivoError" style="color:#c0392b;font-size:0.76rem;display:none;margin-top:3px"></p>'
      +'<label>O escriba su respuesta</label><textarea id="_mEtexto" rows="4"></textarea>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" id="_mEBtnEnviar" onclick="_univEnviarEntrega('+actividadId+')">Enviar</button></div>');
  };
  window._univEnviarEntrega=function(actividadId){
    const archivo=document.getElementById('_mEArchivo').files[0];
    const textoEntrega=document.getElementById('_mEtexto').value.trim();
    const errEl=document.getElementById('_mEArchivoError');
    errEl.style.display='none';
    if(!archivo&&!textoEntrega){alert('Adjunte un archivo o escriba una respuesta.');return;}
    if(archivo){
      const MAX_MB=15;
      const extsPermitidas=['pdf','doc','docx','jpg','jpeg','png'];
      const ext=(archivo.name.split('.').pop()||'').toLowerCase();
      if(!extsPermitidas.includes(ext)){ errEl.textContent='⚠️ Formato no permitido. Use: '+extsPermitidas.join(', ').toUpperCase(); errEl.style.display='block'; return; }
      if(archivo.size>MAX_MB*1024*1024){ errEl.textContent='⚠️ El archivo pesa '+(archivo.size/1024/1024).toFixed(1)+' MB — el máximo es '+MAX_MB+' MB.'; errEl.style.display='block'; return; }
    }
    const btn=document.getElementById('_mEBtnEnviar');
    btn.disabled=true;btn.textContent='⏳ Enviando...';
    function enviarConUrl(archivoUrlCloudinary){
      api('/entregas',{method:'POST',body:{actividadId:actividadId,archivoUrlCloudinary:archivoUrlCloudinary||'',textoEntrega:textoEntrega}}).then(function(){
        _cerrarModal();alert('✅ Entrega enviada.');renderAulaDetalle(cache._seccionActualId);
      }).catch(function(e){alert(e.message);btn.disabled=false;btn.textContent='Enviar';});
    }
    if(archivo){
      apiUpload(archivo,'entregas').then(function(res){ enviarConUrl(res.url); }).catch(function(e){alert(e.message);btn.disabled=false;btn.textContent='Enviar';});
    } else {
      enviarConUrl('');
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  // HISTORIAL ACADÉMICO (estudiante)
  // ══════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════
  // MI PERFIL — para los 3 roles
  // ══════════════════════════════════════════════════════════════════════
  function renderPerfil(){
    api('/perfil').then(function(p){
      contenedor().innerHTML=
        '<div class="card"><h2>👤 Mi Perfil</h2>'
        +'<div style="display:flex;gap:16px;align-items:center;margin-bottom:16px;flex-wrap:wrap">'
        +'<div style="width:80px;height:80px;border-radius:50%;overflow:hidden;background:#eee;display:flex;align-items:center;justify-content:center;flex-shrink:0" id="_pFotoPreview">'
        +(p.fotoUrl?'<img src="'+p.fotoUrl+'" style="width:100%;height:100%;object-fit:cover">':'<span style="font-size:2rem">👤</span>')
        +'</div>'
        +'<div><input type="file" id="_pFotoArchivo" accept=".jpg,.jpeg,.png" onchange="_univSubirFotoPerfil()"><p style="font-size:0.72rem;color:#888;margin-top:4px">JPG o PNG</p></div>'
        +'</div>'
        +'<label>Nombre completo</label><input id="_pNombre" value="'+escapeHtml(p.nombre)+'">'
        +'<label>Teléfono</label><input id="_pTelefono" value="'+escapeHtml(p.telefono)+'">'
        +'<label>Correo</label><input id="_pCorreo" value="'+escapeHtml(p.correo)+'" type="email">'
        +'<label>Biografía / Formación académica</label><textarea id="_pBiografia" rows="3">'+escapeHtml(p.biografia)+'</textarea>'
        +'<button class="btn verde" onclick="_univGuardarPerfil()">💾 Guardar Cambios</button>'
        +'</div>'
        +'<div class="card"><h2>🔒 Cambiar Contraseña</h2>'
        +'<label>Contraseña actual</label><input type="password" id="_pPassActual">'
        +'<label>Nueva contraseña (mínimo 6 caracteres)</label><input type="password" id="_pPassNueva">'
        +'<label>Confirmar nueva contraseña</label><input type="password" id="_pPassConfirmar">'
        +'<p id="_pPassError" style="color:#c0392b;font-size:0.78rem;display:none;margin-bottom:8px"></p>'
        +'<button class="btn" style="background:#8e44ad" onclick="_univCambiarPassword()">🔒 Cambiar Contraseña</button>'
        +'</div>';
    }).catch(mostrarErrorEnContenido);
  }
  window._univSubirFotoPerfil=function(){
    const archivo=document.getElementById('_pFotoArchivo').files[0];
    if(!archivo) return;
    if(archivo.size>5*1024*1024){alert('La foto no debe pesar más de 5 MB.');return;}
    apiUpload(archivo,'perfiles').then(function(res){
      document.getElementById('_pFotoPreview').innerHTML='<img src="'+res.url+'" style="width:100%;height:100%;object-fit:cover">';
      window._univFotoPerfilNueva=res.url;
    }).catch(function(e){alert(e.message);});
  };
  window._univGuardarPerfil=function(){
    const nombre=document.getElementById('_pNombre').value.trim();
    const telefono=document.getElementById('_pTelefono').value.trim();
    const correo=document.getElementById('_pCorreo').value.trim();
    const biografia=document.getElementById('_pBiografia').value.trim();
    const body={nombre:nombre,telefono:telefono,correo:correo,biografia:biografia};
    if(window._univFotoPerfilNueva) body.fotoUrl=window._univFotoPerfilNueva;
    api('/perfil',{method:'PUT',body:body}).then(function(){
      _showAlertaOk('✅ Perfil actualizado correctamente.');
      SESION.nombre=nombre; // refresca el nombre mostrado en la barra superior
      render();
    }).catch(function(e){alert(e.message);});
  };
  window._univCambiarPassword=function(){
    const actual=document.getElementById('_pPassActual').value;
    const nueva=document.getElementById('_pPassNueva').value;
    const confirmar=document.getElementById('_pPassConfirmar').value;
    const errEl=document.getElementById('_pPassError');
    errEl.style.display='none';
    if(!actual||!nueva||!confirmar){errEl.textContent='Complete los 3 campos.';errEl.style.display='block';return;}
    if(nueva.length<6){errEl.textContent='La nueva contraseña debe tener mínimo 6 caracteres.';errEl.style.display='block';return;}
    if(nueva!==confirmar){errEl.textContent='La confirmación no coincide con la nueva contraseña.';errEl.style.display='block';return;}
    api('/perfil/password',{method:'PUT',body:{passwordActual:actual,passwordNueva:nueva}}).then(function(){
      document.getElementById('_pPassActual').value='';document.getElementById('_pPassNueva').value='';document.getElementById('_pPassConfirmar').value='';
      _showAlertaOk('✅ Contraseña cambiada correctamente.');
    }).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };
  function _showAlertaOk(msg){
    const div=document.createElement('div');
    div.style.cssText='position:fixed;top:16px;right:16px;background:#1e8449;color:#fff;padding:12px 18px;border-radius:8px;z-index:99999;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    div.textContent=msg;
    document.body.appendChild(div);
    setTimeout(function(){div.remove();},3000);
  }

  // ══════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN DE CORTES EVALUATIVOS (solo admin)
  // ══════════════════════════════════════════════════════════════════════
  function renderConfigCortes(){
    api('/config/cortes').then(function(res){
      cache.cortes=res.cortes;
      const filas=res.cortes.map(function(c,i){
        return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'
          +'<input value="'+escapeHtml(c.nombre)+'" id="_cNombre'+i+'" style="flex:2;margin-bottom:0">'
          +'<input type="number" value="'+c.porcentaje+'" id="_cPct'+i+'" style="flex:1;margin-bottom:0"><span>%</span>'
          +'<button class="btn-sm" style="background:#c0392b" onclick="_univQuitarCorte('+i+')">🗑</button></div>';
      }).join('');
      contenedor().innerHTML='<div class="card"><h2>⚙️ Cortes Evaluativos de la Institución</h2>'
        +'<p style="font-size:0.82rem;color:#666;margin-bottom:12px">Defina cuántos cortes de evaluación tiene el semestre y qué porcentaje pesa cada uno — deben sumar 100%. Esto es lo que verá el catedrático al crear una actividad.</p>'
        +'<div id="_cCortesLista">'+filas+'</div>'
        +'<button class="btn-sm" style="background:#1a5276;margin-top:6px" onclick="_univAgregarCorte()">➕ Agregar Corte</button>'
        +'<div style="margin-top:16px"><button class="btn verde" onclick="_univGuardarCortes()">💾 Guardar Configuración</button></div>'
        +'<p id="_cCortesError" style="color:#c0392b;font-size:0.8rem;margin-top:8px;display:none"></p>';
    }).catch(mostrarErrorEnContenido);
  }
  function _univLeerCortesDelFormulario(){
    const lista=[];
    let i=0;
    while(document.getElementById('_cNombre'+i)){
      lista.push({nombre:document.getElementById('_cNombre'+i).value.trim(),porcentaje:Number(document.getElementById('_cPct'+i).value)||0});
      i++;
    }
    return lista;
  }
  window._univAgregarCorte=function(){
    cache.cortes=_univLeerCortesDelFormulario();
    cache.cortes.push({nombre:'Corte '+(cache.cortes.length+1),porcentaje:0});
    renderConfigCortesDesdeCache();
  };
  window._univQuitarCorte=function(idx){
    cache.cortes=_univLeerCortesDelFormulario();
    cache.cortes.splice(idx,1);
    renderConfigCortesDesdeCache();
  };
  function renderConfigCortesDesdeCache(){
    const filas=cache.cortes.map(function(c,i){
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'
        +'<input value="'+escapeHtml(c.nombre)+'" id="_cNombre'+i+'" style="flex:2;margin-bottom:0">'
        +'<input type="number" value="'+c.porcentaje+'" id="_cPct'+i+'" style="flex:1;margin-bottom:0"><span>%</span>'
        +'<button class="btn-sm" style="background:#c0392b" onclick="_univQuitarCorte('+i+')">🗑</button></div>';
    }).join('');
    document.getElementById('_cCortesLista').innerHTML=filas;
  }
  window._univGuardarCortes=function(){
    const cortes=_univLeerCortesDelFormulario();
    const errEl=document.getElementById('_cCortesError');
    const suma=cortes.reduce(function(s,c){return s+c.porcentaje;},0);
    if(Math.abs(suma-100)>0.5){errEl.textContent='⚠️ Los porcentajes deben sumar 100% (hoy suman '+suma+'%).';errEl.style.display='block';return;}
    errEl.style.display='none';
    api('/config/cortes',{method:'PUT',body:{cortes:cortes}}).then(function(){_showAlertaOk('✅ Configuración de cortes guardada.');}).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };

  // ══════════════════════════════════════════════════════════════════════
  // ESTRUCTURA INSTITUCIONAL — Facultades y Departamentos
  // ══════════════════════════════════════════════════════════════════════
  function renderEstructura(){
    Promise.all([api('/facultades'),api('/departamentos')]).then(function(res){
      const facultades=res[0].facultades, departamentos=res[1].departamentos;
      cache.estructura={facultades:facultades,departamentos:departamentos};
      const bloquesFacultad=facultades.map(function(f){
        const deptosDeEsta=departamentos.filter(function(d){return d.facultadId===f.id;});
        const filasDepto=deptosDeEsta.map(function(d){
          return '<tr><td style="text-align:left">'+escapeHtml(d.nombre)+'</td><td>'+escapeHtml(d.jefeDepartamento||'—')+'</td>'
            +'<td><button class="btn-sm" style="background:#c0392b" onclick="_univEliminarDepartamento('+d.id+')">🗑</button></td></tr>';
        }).join('');
        return '<div class="card"><h2>🏛️ '+escapeHtml(f.nombre)+'</h2>'
          +'<p style="font-size:0.8rem;color:#666;margin-bottom:10px">Decano(a): '+escapeHtml(f.decano||'—')+'</p>'
          +(deptosDeEsta.length?'<table><thead><tr><th>Departamento</th><th>Jefe</th><th></th></tr></thead><tbody>'+filasDepto+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Sin departamentos todavía.</p>')
          +'<div style="margin-top:12px;display:flex;gap:8px;align-items:flex-end">'
          +'<div style="flex:2"><label>Nuevo departamento</label><input id="_estDepNombre_'+f.id+'" placeholder="Nombre del departamento"></div>'
          +'<div style="flex:2"><label>Jefe de departamento</label><input id="_estDepJefe_'+f.id+'" placeholder="Nombre (opcional)"></div>'
          +'<button class="btn-sm" style="background:#1e8449;height:38px" onclick="_univCrearDepartamento('+f.id+')">➕ Agregar</button></div>'
          +'<div style="margin-top:10px"><button class="btn-sm" style="background:#c0392b" onclick="_univEliminarFacultad('+f.id+')">🗑 Eliminar Facultad</button></div>'
          +'</div>';
      }).join('');
      contenedor().innerHTML=
        (facultades.length?bloquesFacultad:'<div class="card"><p style="color:#888;font-size:0.85rem">Todavía no hay facultades creadas.</p></div>')
        +'<div class="card"><h2>➕ Nueva Facultad / Decanatura</h2>'
        +'<label>Nombre</label><input id="_estFacNombre" placeholder="Ej: Facultad de Ingeniería">'
        +'<label>Decano(a) (opcional)</label><input id="_estFacDecano" placeholder="Nombre del decano">'
        +'<button class="btn verde" onclick="_univCrearFacultad()">+ Crear Facultad</button></div>';
    }).catch(mostrarErrorEnContenido);
  }
  window._univCrearFacultad=function(){
    const nombre=document.getElementById('_estFacNombre').value.trim();
    if(!nombre){alert('Escriba el nombre de la facultad.');return;}
    const decano=document.getElementById('_estFacDecano').value.trim();
    api('/facultades',{method:'POST',body:{nombre:nombre,decano:decano}}).then(function(){renderEstructura();}).catch(function(e){alert(e.message);});
  };
  window._univEliminarFacultad=function(id){
    if(!confirm('¿Eliminar esta facultad? Debe estar vacía (sin departamentos) para poder eliminarla.')) return;
    api('/facultades/'+id,{method:'DELETE'}).then(function(){renderEstructura();}).catch(function(e){alert(e.message);});
  };
  window._univCrearDepartamento=function(facultadId){
    const nombre=document.getElementById('_estDepNombre_'+facultadId).value.trim();
    if(!nombre){alert('Escriba el nombre del departamento.');return;}
    const jefeDepartamento=document.getElementById('_estDepJefe_'+facultadId).value.trim();
    api('/departamentos',{method:'POST',body:{facultadId:facultadId,nombre:nombre,jefeDepartamento:jefeDepartamento}}).then(function(){renderEstructura();}).catch(function(e){alert(e.message);});
  };
  window._univEliminarDepartamento=function(id){
    if(!confirm('¿Eliminar este departamento? Debe estar vacío (sin programas académicos asignados) para poder eliminarlo.')) return;
    api('/departamentos/'+id,{method:'DELETE'}).then(function(){renderEstructura();}).catch(function(e){alert(e.message);});
  };

  // ══════════════════════════════════════════════════════════════════════
  // CALENDARIO ACADÉMICO — Periodos + Parámetros Globales
  // ══════════════════════════════════════════════════════════════════════
  function renderCalendario(){
    Promise.all([api('/periodos'),api('/parametros')]).then(function(res){
      const periodos=res[0].periodos, parametros=res[1].parametros;
      cache.calendario={periodos:periodos};
      cache._paramEscala=parametros.escalaPersonalizada||[];
      const filasPeriodo=periodos.map(function(p){
        return '<tr><td style="text-align:left">'+escapeHtml(p.nombre)+(p.activo?' <span style="color:#1e8449;font-weight:700">● Activo</span>':'')+'</td>'
          +'<td>'+_fmtFechaCorta(p.fechaInicioClases)+' — '+_fmtFechaCorta(p.fechaCierreClases)+'</td>'
          +'<td>'+(p.cortes&&p.cortes.length?p.cortes.length+' cortes':'—')+'</td>'
          +'<td><button class="btn-sm" onclick="_univAbrirModalPeriodo('+p.id+')">✎ Ver/Editar</button> <button class="btn-sm" style="background:#c0392b" onclick="_univEliminarPeriodo('+p.id+')">🗑</button></td></tr>';
      }).join('');
      contenedor().innerHTML=
        '<div class="card"><h2>📅 Periodos Académicos</h2>'
        +(periodos.length?'<table><thead><tr><th>Periodo</th><th>Clases</th><th>Cortes</th><th></th></tr></thead><tbody>'+filasPeriodo+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Todavía no hay periodos creados.</p>')
        +'<button class="btn verde" style="margin-top:12px" onclick="_univAbrirModalPeriodo(null)">➕ Nuevo Periodo Académico</button></div>'
        +'<div class="card"><h2>⚙️ Parámetros Globales</h2>'
        +'<label>Tipo de escala</label><select id="_paramEscala">'
        +'<option value="NUMERICA"'+(parametros.escalaTipo==='NUMERICA'?' selected':'')+'>Numérica</option>'
        +'<option value="LETRAS"'+(parametros.escalaTipo==='LETRAS'?' selected':'')+'>Letras</option></select>'
        +'<div class="grid2"><div><label>Nota máxima (techo de la escala)</label><input type="number" step="0.1" id="_paramNotaMax" value="'+parametros.notaMaxima+'"></div>'
        +'<div><label>Nota mínima de aprobación</label><input type="number" step="0.1" id="_paramNotaMin" value="'+parametros.notaMinimaAprobacion+'"></div></div>'
        +'<label>Tope de fallas para pérdida de asignatura (%)</label><input type="number" id="_paramTopeFallas" value="'+parametros.topeFallasPorcentaje+'">'
        +'<h4 style="font-size:0.85rem;margin:14px 0 6px">Bandas de Desempeño (editables)</h4>'
        +'<p style="font-size:0.76rem;color:#666;margin-bottom:8px">Defina cuántos niveles tiene la escala, su nombre y su rango — no está limitado a ninguna combinación fija.</p>'
        +'<div id="_paramEscalaLista">'+_htmlBandasEscala(cache._paramEscala)+'</div>'
        +'<button class="btn-sm" style="background:#1a5276;margin-top:6px" onclick="_univAgregarBandaEscala()">➕ Agregar Banda</button>'
        +'<p id="_paramEscalaError" style="color:#c0392b;font-size:0.78rem;display:none;margin-top:8px"></p>'
        +'<div style="margin-top:14px"><button class="btn verde" onclick="_univGuardarParametros()">💾 Guardar Parámetros</button></div></div>';
    }).catch(mostrarErrorEnContenido);
  }
  function _htmlBandasEscala(bandas){
    return bandas.map(function(b,i){
      return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'
        +'<input value="'+escapeHtml(b.nombre)+'" id="_ebNombre'+i+'" placeholder="Nombre (ej: Bajo)" style="flex:2;margin-bottom:0">'
        +'<input type="number" step="0.1" value="'+b.min+'" id="_ebMin'+i+'" placeholder="Mín" style="flex:1;margin-bottom:0">'
        +'<span>a</span>'
        +'<input type="number" step="0.1" value="'+b.max+'" id="_ebMax'+i+'" placeholder="Máx" style="flex:1;margin-bottom:0">'
        +'<button class="btn-sm" style="background:#c0392b" onclick="_univQuitarBandaEscala('+i+')">🗑</button></div>';
    }).join('');
  }
  function _univLeerBandasDelForm(){
    const lista=[]; let i=0;
    while(document.getElementById('_ebNombre'+i)){
      lista.push({nombre:document.getElementById('_ebNombre'+i).value.trim(),min:Number(document.getElementById('_ebMin'+i).value),max:Number(document.getElementById('_ebMax'+i).value)});
      i++;
    }
    return lista;
  }
  window._univAgregarBandaEscala=function(){
    cache._paramEscala=_univLeerBandasDelForm();
    cache._paramEscala.push({nombre:'Nueva banda',min:0,max:0});
    document.getElementById('_paramEscalaLista').innerHTML=_htmlBandasEscala(cache._paramEscala);
  };
  window._univQuitarBandaEscala=function(idx){
    cache._paramEscala=_univLeerBandasDelForm();
    cache._paramEscala.splice(idx,1);
    document.getElementById('_paramEscalaLista').innerHTML=_htmlBandasEscala(cache._paramEscala);
  };
  function _fmtFechaCorta(f){ if(!f) return '—'; try{ return new Date(f).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}); }catch(e){ return '—'; } }
  window._univGuardarParametros=function(){
    const escalaTipo=document.getElementById('_paramEscala').value;
    const notaMaxima=document.getElementById('_paramNotaMax').value.trim()||'5.0';
    const notaMinimaAprobacion=document.getElementById('_paramNotaMin').value;
    const topeFallasPorcentaje=document.getElementById('_paramTopeFallas').value;
    const escalaPersonalizada=_univLeerBandasDelForm();
    const errEl=document.getElementById('_paramEscalaError');
    errEl.style.display='none';
    if(!escalaPersonalizada.length){errEl.textContent='Agregue al menos una banda de desempeño.';errEl.style.display='block';return;}
    if(escalaPersonalizada.some(function(b){return !b.nombre;})){errEl.textContent='Todas las bandas necesitan un nombre.';errEl.style.display='block';return;}
    if(escalaPersonalizada.some(function(b){return b.min>b.max;})){errEl.textContent='En cada banda, el mínimo no puede ser mayor que el máximo.';errEl.style.display='block';return;}
    api('/parametros',{method:'PUT',body:{escalaTipo:escalaTipo,notaMaxima:notaMaxima,notaMinimaAprobacion:notaMinimaAprobacion,topeFallasPorcentaje:topeFallasPorcentaje,escalaPersonalizada:escalaPersonalizada}}).then(function(){_showAlertaOk('✅ Parámetros guardados.');}).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };
  window._univAbrirModalPeriodo=function(periodoId){
    const p=periodoId?(cache.calendario.periodos||[]).find(function(x){return x.id===periodoId;}):null;
    const cortes=(p&&p.cortes)||[];
    function _isoInput(f){ if(!f) return ''; try{ return new Date(f).toISOString().slice(0,10); }catch(e){ return ''; } }
    _abrirModal('<h2>📅 '+(p?'Editar':'Nuevo')+' Periodo Académico</h2>'
      +'<label>Nombre (ej: 2026-1)</label><input id="_pdNombre" value="'+(p?escapeHtml(p.nombre):'')+'">'
      +'<div class="grid2"><div><label>Inicio de clases</label><input type="date" id="_pdInicioClases" value="'+_isoInput(p&&p.fechaInicioClases)+'"></div>'
      +'<div><label>Cierre de clases</label><input type="date" id="_pdCierreClases" value="'+_isoInput(p&&p.fechaCierreClases)+'"></div></div>'
      +'<div class="grid2"><div><label>Apertura prematrícula</label><input type="date" id="_pdAperturaPre" value="'+_isoInput(p&&p.fechaAperturaPrematricula)+'"></div>'
      +'<div><label>Cierre prematrícula</label><input type="date" id="_pdCierrePre" value="'+_isoInput(p&&p.fechaCierrePrematricula)+'"></div></div>'
      +'<div class="grid2"><div><label>Apertura adiciones/cancelaciones</label><input type="date" id="_pdAperturaAdi" value="'+_isoInput(p&&p.fechaAperturaAdiciones)+'"></div>'
      +'<div><label>Cierre adiciones/cancelaciones</label><input type="date" id="_pdCierreAdi" value="'+_isoInput(p&&p.fechaCierreAdiciones)+'"></div></div>'
      +'<label style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="checkbox" id="_pdActivo" style="width:auto" '+(p&&p.activo?'checked':'')+'> Marcar como periodo activo (el actual)</label>'
      +'<h4 style="font-size:0.85rem;margin:14px 0 6px">Cortes de este periodo (con fecha límite de notas)</h4>'
      +'<div id="_pdCortesLista">'+_htmlFilasCortesPeriodo(cortes)+'</div>'
      +'<button class="btn-sm" style="background:#1a5276" onclick="_univAgregarCortePeriodo()">➕ Agregar Corte</button>'
      +'<p id="_pdError" style="color:#c0392b;font-size:0.78rem;display:none;margin-top:8px"></p>'
      +'<div style="display:flex;gap:8px;margin-top:14px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univGuardarPeriodo('+(p?p.id:'null')+')">💾 Guardar</button></div>');
  };
  function _htmlFilasCortesPeriodo(cortes){
    return cortes.map(function(c,i){
      return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'
        +'<input value="'+escapeHtml(c.nombre||'')+'" id="_pdCNombre'+i+'" placeholder="Nombre" style="flex:2;margin-bottom:0">'
        +'<input type="number" value="'+(c.porcentaje||0)+'" id="_pdCPct'+i+'" style="flex:1;margin-bottom:0"><span>%</span>'
        +'<input type="date" value="'+(c.fechaLimiteNotas||'')+'" id="_pdCFecha'+i+'" style="flex:1.5;margin-bottom:0">'
        +'<button class="btn-sm" style="background:#c0392b" onclick="_univQuitarCortePeriodo('+i+')">🗑</button></div>';
    }).join('');
  }
  window._univAgregarCortePeriodo=function(){
    const cortes=_univLeerCortesPeriodoDelForm();
    cortes.push({nombre:'Corte '+(cortes.length+1),porcentaje:0,fechaLimiteNotas:''});
    document.getElementById('_pdCortesLista').innerHTML=_htmlFilasCortesPeriodo(cortes);
  };
  window._univQuitarCortePeriodo=function(idx){
    const cortes=_univLeerCortesPeriodoDelForm();
    cortes.splice(idx,1);
    document.getElementById('_pdCortesLista').innerHTML=_htmlFilasCortesPeriodo(cortes);
  };
  function _univLeerCortesPeriodoDelForm(){
    const lista=[]; let i=0;
    while(document.getElementById('_pdCNombre'+i)){
      lista.push({nombre:document.getElementById('_pdCNombre'+i).value.trim(),porcentaje:Number(document.getElementById('_pdCPct'+i).value)||0,fechaLimiteNotas:document.getElementById('_pdCFecha'+i).value||''});
      i++;
    }
    return lista;
  }
  window._univGuardarPeriodo=function(periodoId){
    const nombre=document.getElementById('_pdNombre').value.trim();
    const errEl=document.getElementById('_pdError');
    errEl.style.display='none';
    if(!nombre){errEl.textContent='Escriba el nombre del periodo (ej: 2026-1).';errEl.style.display='block';return;}
    const cortes=_univLeerCortesPeriodoDelForm();
    const body={
      nombre:nombre,
      fechaInicioClases:document.getElementById('_pdInicioClases').value||null,
      fechaCierreClases:document.getElementById('_pdCierreClases').value||null,
      fechaAperturaPrematricula:document.getElementById('_pdAperturaPre').value||null,
      fechaCierrePrematricula:document.getElementById('_pdCierrePre').value||null,
      fechaAperturaAdiciones:document.getElementById('_pdAperturaAdi').value||null,
      fechaCierreAdiciones:document.getElementById('_pdCierreAdi').value||null,
      activo:document.getElementById('_pdActivo').checked,
      cortes:cortes,
    };
    const metodo=periodoId?'PUT':'POST';
    const ruta=periodoId?('/periodos/'+periodoId):'/periodos';
    api(ruta,{method:metodo,body:body}).then(function(){_cerrarModal();renderCalendario();}).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
  };
  window._univEliminarPeriodo=function(id){
    if(!confirm('¿Eliminar este periodo académico?')) return;
    api('/periodos/'+id,{method:'DELETE'}).then(function(){renderCalendario();}).catch(function(e){alert(e.message);});
  };

  // ══════════════════════════════════════════════════════════════════════
  // BUZÓN DE ENTREGAS — vista consolidada de todas las entregas del estudiante
  // ══════════════════════════════════════════════════════════════════════
  function renderBuzonEntregas(){
    api('/mis-entregas').then(function(res){
      const entregas=res.entregas;
      if(!entregas.length){ contenedor().innerHTML='<div class="card"><p style="color:#888;font-size:0.85rem">Todavía no ha enviado ninguna entrega.</p></div>'; return; }
      entregas.sort(function(a,b){ return new Date(b.fechaEnvio)-new Date(a.fechaEnvio); });
      const filas=entregas.map(function(en){
        const colorEstado=en.estado==='CALIFICADO'?'#1e8449':(en.estado==='ATRASADO'?'#c0392b':'#1a5276');
        return '<tr><td style="text-align:left">'+escapeHtml(en.codigoMateria)+' — '+escapeHtml(en.nombreAsignatura)+'</td>'
          +'<td style="text-align:left">'+escapeHtml(en.tituloActividad)+'</td>'
          +'<td>'+new Date(en.fechaEnvio).toLocaleDateString('es-CO')+'</td>'
          +'<td><span style="color:'+colorEstado+';font-weight:700;font-size:0.78rem">'+en.estado+'</span></td>'
          +'<td>'+(en.nota?en.nota+'/'+en.maxCalificacion:'—')+'</td>'
          +'<td>'+(en.archivoUrlCloudinary?'<a href="'+en.archivoUrlCloudinary+'" target="_blank" rel="noopener noreferrer">📎 Ver</a>':(en.textoEntrega?'📝 Texto':'—'))+'</td></tr>'
          +(en.retroalimentacion?'<tr><td colspan="6" style="text-align:left;background:#f4f1fa;font-size:0.78rem;font-style:italic">💬 '+escapeHtml(en.retroalimentacion)+'</td></tr>':'');
      }).join('');
      contenedor().innerHTML='<div class="card"><h2>📥 Buzón de Entregas</h2>'
        +'<table><thead><tr><th>Asignatura</th><th>Actividad</th><th>Fecha envío</th><th>Estado</th><th>Nota</th><th>Adjunto</th></tr></thead><tbody>'+filas+'</tbody></table></div>';
    }).catch(mostrarErrorEnContenido);
  }

  function renderHistorial(){
    api('/historial/'+SESION.userId).then(function(d){
      const filas=d.materias.map(function(m){
        const colorEstado=m.estado==='APROBADO'?'#1e8449':(m.estado==='REPROBADO'?'#c0392b':'#888');
        return '<tr><td>'+escapeHtml(m.codigoMateria)+' — '+escapeHtml(m.nombreAsignatura)+'</td><td>'+m.creditos+'</td>'
          +'<td style="font-weight:700;color:'+colorEstado+'">'+(m.promedio>0?m.promedio.toFixed(2):'—')+'</td>'
          +'<td style="color:'+colorEstado+'">'+m.estado.replace('_',' ')+'</td></tr>';
      }).join('');
      contenedor().innerHTML='<div class="kpis">'
        +kpi(d.gpa>0?d.gpa.toFixed(2):'—','Promedio Ponderado (GPA)')
        +kpi(d.creditosAprobados+'/'+d.creditosTotales,'Créditos Aprobados')
        +'</div><div class="card"><h2>📜 Historial Académico</h2>'
        +(d.materias.length?'<table><thead><tr><th>Asignatura</th><th>Créditos</th><th>Nota</th><th>Estado</th></tr></thead><tbody>'+filas+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Todavía no hay asignaturas registradas.</p>')
        +'</div>';
    }).catch(mostrarErrorEnContenido);
  }

  // ══════════════════════════════════════════════════════════════════════
  // LIBRO DE CALIFICACIONES (GRADEBOOK) — categorías, cálculo ponderado,
  // exportar/importar a Excel
  // ══════════════════════════════════════════════════════════════════════
  window._univAbrirGradebook=function(seccionId,nombreSeccion){
    cache._gbSeccionId=seccionId;cache._gbNombreSeccion=nombreSeccion;
    irA('gradebook');
  };
  function renderGradebook(seccionId){
    Promise.all([api('/secciones/'+seccionId+'/categorias'),api('/secciones/'+seccionId+'/gradebook')]).then(function(res){
      const categorias=res[0].categorias, gb=res[1];
      cache._gbDatos=gb;
      const sumaPorcentajes=categorias.reduce(function(s,c){return s+Number(c.porcentaje);},0);
      const filasCat=categorias.map(function(c){
        return '<tr><td style="text-align:left">'+escapeHtml(c.nombre)+'</td><td>'+c.porcentaje+'%</td>'
          +'<td><button class="btn-sm" style="background:#c0392b" onclick="_univEliminarCategoriaGB('+c.id+','+seccionId+')">🗑</button></td></tr>';
      }).join('');
      let html='<button class="btn gris" style="margin-bottom:14px" onclick="_univIrA(\'aula-detalle\')">← Volver al Aula</button>'
        +'<div class="card"><h2>📊 Libro de Calificaciones — '+escapeHtml(cache._gbNombreSeccion||'')+'</h2>'
        +'<h4 style="font-size:0.85rem;margin-bottom:8px">Categorías'+(sumaPorcentajes!==100?' <span style="color:#c0392b;font-weight:400">(suman '+sumaPorcentajes+'%, deberían sumar 100%)</span>':'')+'</h4>'
        +(categorias.length?'<table><thead><tr><th>Nombre</th><th>%</th><th></th></tr></thead><tbody>'+filasCat+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Sin categorías creadas — cree al menos una (ej. "Talleres" 30%, "Exámenes" 40%, "Proyecto" 30%) para que las actividades puedan agruparse y calcular la nota final.</p>')
        +'<div style="margin-top:12px;display:flex;gap:8px;align-items:flex-end">'
        +'<div style="flex:2"><label>Nueva categoría</label><input id="_gbCatNombre" placeholder="Ej: Talleres"></div>'
        +'<div style="flex:1"><label>%</label><input type="number" id="_gbCatPct" placeholder="30"></div>'
        +'<button class="btn-sm" style="background:#1e8449;height:38px" onclick="_univCrearCategoriaGB('+seccionId+')">➕ Agregar</button></div>'
        +'</div>';

      // Tabla principal: estudiantes x categorías + nota final
      const filasEst=gb.estudiantes.map(function(e){
        const celdas=categorias.map(function(c){
          const det=e.detalleCategorias.find(function(d){return d.categoriaId===c.id;});
          return '<td>'+(det&&det.promedio!=null?det.promedio.toFixed(2):'—')+'</td>';
        }).join('');
        const colorFinal=e.notaFinal==null?'#888':(e.notaFinal>=3?'#1e8449':'#c0392b');
        return '<tr><td style="text-align:left">'+escapeHtml(e.nombre)+'</td>'+celdas
          +'<td style="font-weight:700;color:'+colorFinal+'">'+(e.notaFinal!=null?e.notaFinal.toFixed(2):'—')+'</td>'
          +'<td style="font-size:0.72rem;color:#888">'+e.pesoUsado+'% evaluado</td></tr>';
      }).join('');
      html+='<div class="card"><h2>📋 Notas por Estudiante</h2>'
        +(gb.estudiantes.length?'<div style="overflow-x:auto"><table><thead><tr><th>Estudiante</th>'+categorias.map(function(c){return '<th>'+escapeHtml(c.nombre)+'</th>';}).join('')+'<th>Final</th><th>Avance</th></tr></thead><tbody>'+filasEst+'</tbody></table></div>':'<p style="color:#888;font-size:0.85rem">No hay estudiantes matriculados en esta sección todavía.</p>')
        +'<div style="margin-top:12px"><button class="btn-sm" style="background:#1a5276" onclick="_univExportarGradebook()">📊 Exportar a Excel</button></div>'
        +'</div>';

      // Bloque para asignar categoría a cada actividad + importar notas
      const filasAct=gb.actividades.map(function(a){
        return '<tr><td style="text-align:left">'+escapeHtml(a.titulo)+' <span style="font-size:0.7rem;color:#888">('+a.tipo+')</span></td>'
          +'<td><select onchange="_univAsignarCategoriaActividad('+a.id+',this.value,'+seccionId+')"><option value="">— Sin categoría —</option>'
          +categorias.map(function(c){return '<option value="'+c.id+'"'+(a.categoriaId===c.id?' selected':'')+'>'+escapeHtml(c.nombre)+'</option>';}).join('')+'</select></td>'
          +'<td>'+(a.tipo!=='QUIZ'?'<button class="btn-sm" style="background:#8e44ad" onclick="_univAbrirImportarNotas('+a.id+',\''+escapeHtml(a.titulo).replace(/'/g,"\\'")+'\')">📥 Importar Notas</button>':'<span style="font-size:0.7rem;color:#888">Se califica desde el cuestionario</span>')+'</td></tr>';
      }).join('');
      html+='<div class="card"><h2>🔗 Asignar Categoría a cada Actividad</h2>'
        +(gb.actividades.length?'<table><thead><tr><th>Actividad</th><th>Categoría</th><th></th></tr></thead><tbody>'+filasAct+'</tbody></table>':'<p style="color:#888;font-size:0.85rem">Sin actividades creadas todavía en esta sección.</p>')
        +'</div>';
      contenedor().innerHTML=html;
    }).catch(mostrarErrorEnContenido);
  }
  window._univCrearCategoriaGB=function(seccionId){
    const nombre=document.getElementById('_gbCatNombre').value.trim();
    if(!nombre){alert('Escriba el nombre de la categoría.');return;}
    const porcentaje=document.getElementById('_gbCatPct').value.trim()||'0';
    api('/secciones/'+seccionId+'/categorias',{method:'POST',body:{nombre:nombre,porcentaje:porcentaje}}).then(function(){renderGradebook(seccionId);}).catch(function(e){alert(e.message);});
  };
  window._univEliminarCategoriaGB=function(catId,seccionId){
    if(!confirm('¿Eliminar esta categoría? Las actividades que la tenían asignada quedan sin categoría.')) return;
    api('/categorias/'+catId,{method:'DELETE'}).then(function(){renderGradebook(seccionId);}).catch(function(e){alert(e.message);});
  };
  window._univAsignarCategoriaActividad=function(actividadId,categoriaId,seccionId){
    api('/actividades/'+actividadId+'/categoria',{method:'PUT',body:{categoriaId:categoriaId}}).then(function(){renderGradebook(seccionId);}).catch(function(e){alert(e.message);});
  };
  window._univExportarGradebook=function(){
    if(typeof XLSX==='undefined'){alert('La librería de Excel todavía se está cargando, intente de nuevo en unos segundos.');return;}
    const gb=cache._gbDatos;
    const filas=gb.estudiantes.map(function(e){
      const fila={'Estudiante':e.nombre};
      gb.categorias.forEach(function(c){
        const det=e.detalleCategorias.find(function(d){return d.categoriaId===c.id;});
        fila[c.nombre]=det&&det.promedio!=null?Number(det.promedio.toFixed(2)):'';
      });
      fila['Nota Final']=e.notaFinal!=null?Number(e.notaFinal.toFixed(2)):'';
      fila['% Evaluado']=e.pesoUsado;
      return fila;
    });
    const ws=XLSX.utils.json_to_sheet(filas);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Calificaciones');
    XLSX.writeFile(wb,'Libro_Calificaciones_'+(cache._gbNombreSeccion||'seccion').replace(/[^a-zA-Z0-9]/g,'_')+'.xlsx');
  };
  window._univAbrirImportarNotas=function(actividadId,tituloActividad){
    _abrirModal('<h2>📥 Importar Notas — '+escapeHtml(tituloActividad)+'</h2>'
      +'<p style="font-size:0.8rem;color:#666;margin-bottom:10px">Suba un archivo Excel/CSV con dos columnas: <b>estudianteId</b> y <b>nota</b>. También puede descargar la plantilla ya con la lista de estudiantes matriculados.</p>'
      +'<button class="btn-sm" style="background:#1a5276;margin-bottom:10px" onclick="_univDescargarPlantillaNotas()">📄 Descargar Plantilla</button>'
      +'<label>Archivo (.xlsx, .xls o .csv)</label><input type="file" id="_impNotasArchivo" accept=".xlsx,.xls,.csv">'
      +'<p id="_impNotasError" style="color:#c0392b;font-size:0.78rem;display:none;margin-top:6px"></p>'
      +'<div style="display:flex;gap:8px;margin-top:10px"><button class="btn gris" onclick="_cerrarModal()">Cancelar</button>'
      +'<button class="btn verde" onclick="_univProcesarImportarNotas('+actividadId+')">📥 Importar</button></div>');
  };
  window._univDescargarPlantillaNotas=function(){
    if(typeof XLSX==='undefined'){alert('La librería de Excel todavía se está cargando, intente de nuevo.');return;}
    const gb=cache._gbDatos;
    const filas=(gb&&gb.estudiantes||[]).map(function(e){return {estudianteId:e.estudianteId,nombre:e.nombre,nota:''};});
    const ws=XLSX.utils.json_to_sheet(filas);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Plantilla');
    XLSX.writeFile(wb,'Plantilla_Notas.xlsx');
  };
  window._univProcesarImportarNotas=function(actividadId){
    const archivo=document.getElementById('_impNotasArchivo').files[0];
    const errEl=document.getElementById('_impNotasError');
    errEl.style.display='none';
    if(!archivo){errEl.textContent='Seleccione un archivo.';errEl.style.display='block';return;}
    if(typeof XLSX==='undefined'){errEl.textContent='La librería de Excel todavía se está cargando, intente de nuevo.';errEl.style.display='block';return;}
    const lector=new FileReader();
    lector.onload=function(ev){
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'});
        const hoja=wb.Sheets[wb.SheetNames[0]];
        const filas=XLSX.utils.sheet_to_json(hoja);
        const filasLimpias=filas.map(function(f){return {estudianteId:f.estudianteId||f.EstudianteId||f.ID||'',nota:f.nota||f.Nota||''};}).filter(function(f){return f.estudianteId;});
        if(!filasLimpias.length){errEl.textContent='No se encontraron filas válidas (revise que las columnas se llamen "estudianteId" y "nota").';errEl.style.display='block';return;}
        api('/actividades/'+actividadId+'/importar-notas',{method:'POST',body:{filas:filasLimpias}}).then(function(res){
          _cerrarModal();_showAlertaOk('✅ Importadas: '+res.creados+' nuevas, '+res.actualizados+' actualizadas'+(res.saltados?', '+res.saltados+' filas inválidas omitidas':'')+'.');
          renderGradebook(cache._gbSeccionId);
        }).catch(function(e){errEl.textContent=e.message;errEl.style.display='block';});
      }catch(err){errEl.textContent='No se pudo leer el archivo. Verifique que sea un Excel o CSV válido.';errEl.style.display='block';}
    };
    lector.readAsArrayBuffer(archivo);
  };

  // ══════════════════════════════════════════════════════════════════════
  // ASISTENTE UNIVERSITARIO (IA) — widget flotante, disponible en toda la app
  // ══════════════════════════════════════════════════════════════════════
  let _univAsistenteAbierto=false;
  let _univAsistenteHistorial=[]; // [{role:'user'|'model',content:'...'}]
  let _univAsistenteCargando=false;
  function _htmlWidgetAsistente(){
    if(!_univAsistenteAbierto){
      return '<button onclick="_univToggleAsistente()" style="position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#8e44ad,#4a1a6e);color:#fff;border:none;font-size:1.5rem;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer;z-index:9998" title="Asistente Universitario">🤖</button>';
    }
    const mensajesHtml=_univAsistenteHistorial.map(function(m){
      const esUser=m.role==='user';
      return '<div style="display:flex;justify-content:'+(esUser?'flex-end':'flex-start')+';margin-bottom:8px">'
        +'<div style="max-width:80%;padding:8px 12px;border-radius:10px;font-size:0.84rem;white-space:pre-wrap;background:'+(esUser?'#8e44ad':'#f4f1fa')+';color:'+(esUser?'#fff':'#1a1a2e')+'">'+escapeHtml(m.content)+'</div></div>';
    }).join('');
    return '<div style="position:fixed;bottom:20px;right:20px;width:340px;max-width:90vw;height:460px;max-height:75vh;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;z-index:9998">'
      +'<div style="background:linear-gradient(135deg,#8e44ad,#4a1a6e);color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:center">'
      +'<b style="font-size:0.9rem">🤖 Asistente Universitario</b>'
      +'<button onclick="_univToggleAsistente()" style="background:none;border:none;color:#fff;font-size:1.1rem;cursor:pointer">✕</button></div>'
      +'<div id="_univAsistenteMensajes" style="flex:1;overflow-y:auto;padding:12px">'
      +(_univAsistenteHistorial.length?mensajesHtml:'<p style="font-size:0.82rem;color:#888">Hola, soy el Asistente Universitario. Pregúntame sobre programas, matrícula, el aula virtual o cualquier duda del sistema.</p>')
      +(_univAsistenteCargando?'<div style="font-size:0.8rem;color:#888">⏳ Escribiendo...</div>':'')
      +'</div>'
      +'<div style="padding:10px;border-top:1px solid #eee;display:flex;gap:6px">'
      +'<input id="_univAsistenteInput" placeholder="Escriba su pregunta..." style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:0.84rem;margin-bottom:0" onkeydown="if(event.key===\'Enter\')_univEnviarMensajeAsistente()">'
      +'<button onclick="_univEnviarMensajeAsistente()" style="background:#8e44ad;color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer">➤</button></div>'
      +'</div>';
  }
  window._univToggleAsistente=function(){
    _univAsistenteAbierto=!_univAsistenteAbierto;
    _univRepintarWidgetAsistente();
    if(_univAsistenteAbierto) setTimeout(function(){var i=document.getElementById('_univAsistenteInput');if(i)i.focus();},50);
  };
  function _univRepintarWidgetAsistente(){
    // Repinta SOLO el widget (no toda la app, para no perder el estado de
    // lo que se esté viendo en ese momento) — se busca el nodo flotante
    // existente y se reemplaza por el nuevo HTML.
    const appEl=document.getElementById('app');
    const anterior=appEl.querySelector('[style*="position:fixed"][style*="bottom:20px"]');
    if(anterior) anterior.remove();
    appEl.insertAdjacentHTML('beforeend',_htmlWidgetAsistente());
    const cont=document.getElementById('_univAsistenteMensajes');
    if(cont) cont.scrollTop=cont.scrollHeight;
  }
  window._univEnviarMensajeAsistente=function(){
    const input=document.getElementById('_univAsistenteInput');
    const texto=input.value.trim();
    if(!texto||_univAsistenteCargando) return;
    input.value='';
    _univAsistenteHistorial.push({role:'user',content:texto});
    _univAsistenteCargando=true;
    _univRepintarWidgetAsistente();
    api('/asistente/chat',{method:'POST',body:{mensaje:texto,historial:_univAsistenteHistorial.slice(0,-1)}}).then(function(res){
      _univAsistenteHistorial.push({role:'model',content:res.respuesta});
      _univAsistenteCargando=false;
      _univRepintarWidgetAsistente();
    }).catch(function(e){
      _univAsistenteHistorial.push({role:'model',content:'⚠️ '+e.message});
      _univAsistenteCargando=false;
      _univRepintarWidgetAsistente();
    });
  };

  // ── Modal genérico ──────────────────────────────────────────────────────
  function _abrirModal(innerHtml){
    const ov=document.createElement('div');
    ov.className='modal-overlay';ov.id='_univModal';
    ov.innerHTML='<div class="modal-box">'+innerHtml+'</div>';
    document.body.appendChild(ov);
  }
  window._cerrarModal=function(){ const m=document.getElementById('_univModal'); if(m) m.remove(); };

  iniciar();
})();
