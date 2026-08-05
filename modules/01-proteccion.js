// Ocultar marca de agua "Made in Bolt" y de Replit agresivamente
(function(){
  const hideWatermarks = () => {
    try {
      // Bolt "Made in Bolt" badge
      document.querySelectorAll('[class*="bolt"], [id*="bolt"], [data-bolt], [class*="Bolt"], [id*="Bolt"]').forEach(el => {
        const txt=(el.textContent||el.innerText||'').toLowerCase();
        if(txt.includes('made in bolt')||txt.includes('bolt.new')||el.className&&typeof el.className==='string'&&(el.className.includes('bolt')||el.className.includes('Bolt'))){
          el.style.cssText='display:none !important;visibility:hidden !important;opacity:0 !important;pointer-events:none !important;width:0 !important;height:0 !important;overflow:hidden !important;';
        }
      });
      // Cualquier elemento fijo en la esquina inferior derecha que contenga "bolt"
      document.querySelectorAll('div, span, a, p, footer').forEach(el => {
        const txt=(el.textContent||'').trim().toLowerCase();
        if(txt.includes('made in bolt')||txt.includes('bolt.new')){
          el.style.cssText='display:none !important;visibility:hidden !important;opacity:0 !important;pointer-events:none !important;';
        }
      });
    } catch(e) {}
  };
  const hideReplit = () => {
    try {
      // Buscar por id, class, src, data attributes
      document.querySelectorAll('[id*="replit"], [class*="replit"], [src*="replit"], [data-replit], [data-component*="replit"]').forEach(el => {
        if(el && el.parentNode) {
          el.style.cssText = 'display:none !important; visibility:hidden !important; width:0 !important; height:0 !important; margin:0 !important; padding:0 !important; border:0 !important; opacity:0 !important; pointer-events:none !important;';
          try { el.remove(); } catch(e) {}
        }
      });
      // Buscar iframes con Replit
      document.querySelectorAll('iframe').forEach(el => {
        if (el.src && el.src.includes('replit')) {
          el.style.cssText = 'display:none !important; visibility:hidden !important;';
          try { el.remove(); } catch(e) {}
        }
      });
      // Buscar scripts de Replit
      document.querySelectorAll('script').forEach(el => {
        if (el.src && (el.src.includes('replit') || el.src.includes('dev-banner'))) {
          el.style.cssText = 'display:none !important;';
          try { el.remove(); } catch(e) {}
        }
      });
      // Buscar por nombre de clase común de Replit
      document.querySelectorAll('.replit-banner, .replit-watermark, .replit-notice, [role="banner"][style*="replit"]').forEach(el => {
        if(el) {
          el.style.cssText = 'display:none !important; visibility:hidden !important;';
          try { el.remove(); } catch(e) {}
        }
      });
    } catch(e) {}
  };
  
  // Ejecutar inmediatamente
  hideReplit();
  hideWatermarks();
  
  // Ejecutar cuando está lista la página
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideReplit);
    document.addEventListener('DOMContentLoaded', hideWatermarks);
  }
  
  // Monitorear continuamente
  const observer = new MutationObserver(() => { 
    setTimeout(hideReplit, 10); 
    setTimeout(hideWatermarks, 10);
  });
  observer.observe(document.documentElement, { 
    childList: true, 
    subtree: true, 
    attributes: true, 
    attributeFilter: ['id', 'class', 'src', 'data-replit', 'data-bolt'] 
  });
  
  // Ejecutar en varios puntos del ciclo
  window.addEventListener('load', hideReplit);
  window.addEventListener('load', hideWatermarks);
  setTimeout(hideReplit, 100);
  setTimeout(hideWatermarks, 100);
  setTimeout(hideReplit, 500);
  setTimeout(hideWatermarks, 500);
  setTimeout(hideReplit, 1000);
  setTimeout(hideWatermarks, 1000);
  setInterval(function(){ hideReplit(); hideWatermarks(); }, 2000);
})();

// ── PROTECCIÓN DE CÓDIGO FUENTE — GESTOR ACADÉMICO YC ─────────────────────
(function(){
  // 1. Bloquear clic derecho (menú contextual)
  document.addEventListener('contextmenu', function(e){
    e.preventDefault();
    return false;
  }, true);
  // 2. Bloquear teclas de desarrollo y descarga
  document.addEventListener('keydown', function(e){
    if(e.key==='F12'){ e.preventDefault(); e.stopPropagation(); return false; }
    if(e.ctrlKey&&e.shiftKey&&['I','J','C','K','S'].includes(e.key.toUpperCase())){
      e.preventDefault(); e.stopPropagation(); return false;
    }
    if(e.ctrlKey&&['U','P'].includes(e.key.toUpperCase())){
      e.preventDefault(); e.stopPropagation(); return false;
    }
    // Ctrl+S solo se permite en inputs/textareas
    if(e.ctrlKey&&e.key.toUpperCase()==='S'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){
      e.preventDefault(); return false;
    }
    // Bloquear Ctrl+A en área de app (no en campos de texto)
    if(e.ctrlKey&&e.key.toUpperCase()==='A'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.activeElement?.isContentEditable){
      e.preventDefault(); return false;
    }
  }, true);
  // 3. Bloquear arrastre
  document.addEventListener('dragstart', function(e){
    if(!['INPUT','TEXTAREA'].includes(e.target?.tagName)) e.preventDefault();
  });
  // 4. Bloquear selección masiva de texto fuera de campos editables
  document.addEventListener('selectstart', function(e){
    if(['INPUT','TEXTAREA'].includes(e.target?.tagName)||e.target?.isContentEditable) return true;
    // Permitir selección solo para copiar datos académicos en tablas
    if(e.target?.closest&&e.target.closest('table,textarea,input')) return true;
    e.preventDefault(); return false;
  });
  // 5. Bloquear acceso a devtools por timing (detección básica)
  let _devtoolsOpen=false;
  const _dtCheck=function(){
    const _t=new Date();
    debugger;
    if(new Date()-_t>100&&!_devtoolsOpen){
      _devtoolsOpen=true;
    }
  };
  // 6. Ocultar fuente al imprimir (solo estilos)
  const _pStyle=document.createElement('style');
  _pStyle.textContent='@media print{body{display:none!important}}'+'@media print{#app{display:none!important}}';
  document.head.appendChild(_pStyle);
})();
