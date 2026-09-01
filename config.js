// Configuración dinámica del sistema (compatible local y producción)
window.CONFIG = window.CONFIG || {
    API_URL: (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http')) 
        ? window.location.origin 
        : ''
};
var CONFIG = window.CONFIG;
