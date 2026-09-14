/* Carga SheetJS con fallback entre dos CDNs para garantizar disponibilidad */
(function(){
  function tryLoad(urls,idx){
    if(idx>=urls.length)return;
    var s=document.createElement('script');
    s.src=urls[idx];
    s.onerror=function(){tryLoad(urls,idx+1);};
    document.head.appendChild(s);
  }
  tryLoad([
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
  ],0);
})();
