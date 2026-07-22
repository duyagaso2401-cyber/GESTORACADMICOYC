const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '50mb' })); 

const uri = process.env.MONGODB_URI || "mongodb+srv://duyagaso2401_db_user:d3JymLsokpyqfkzY@repositorioiedelviolo.rfszbka.mongodb.net/?appName=REPOSITORIOIEDELVIOLO";
const client = new MongoClient(uri);
let db;

// Áreas y Grados por defecto para la institución (INETIS)
const defaultAreas = [
    { id: "ingles", name: "Inglés / Idiomas Extranjeros" },
    { id: "informatica", name: "Tecnología e Informática" },
    { id: "matematicas", name: "Matemáticas" },
    { id: "lenguaje", name: "Lengua Castellana" },
    { id: "ciencias", name: "Ciencias Naturales" },
    { id: "sociales", name: "Ciencias Sociales" }
];

const defaultGrados = [
    { id: "sexto", name: "Grado 6°" },
    { id: "septimo", name: "Grado 7°" },
    { id: "octavo", name: "Grado 8°" },
    { id: "noveno", name: "Grado 9°" },
    { id: "decimo", name: "Grado 10°" },
    { id: "once", name: "Grado 11°" }
];

const defaultTipos = [
    { id: "guia", name: "Guía de Aprendizaje" },
    { id: "taller", name: "Taller / Actividad" },
    { id: "evaluacion", name: "Evaluación / Examen" },
    { id: "presentacion", name: "Presentación / Diapositivas" },
    { id: "lectura", name: "Lectura / Documento" },
    { id: "audio_video", name: "Audio / Video Didáctico" }
];

async function connectDB() {
    try {
        await client.connect();
        db = client.db('repositorio_ingles_violo');
        console.log("¡Conexión segura establecida con MongoDB Atlas en la nube!");
        
        // Inicializar documento de estadísticas y configuración si no existen
        const statsCount = await db.collection('platform_stats').countDocuments();
        if (statsCount === 0) {
            await db.collection('platform_stats').insertOne({ views: 0, uploads: 0, downloads: 0, logs: [] });
        }
        
        const configCount = await db.collection('institution_config').countDocuments();
        if (configCount === 0) {
            await db.collection('institution_config').insertOne({ 
                name: "REPOSITORIO DE RECURSOS - INSTITUCIÓN EDUCATIVA TÉCNICA EN INFORMÁTICA DE SINCELEJITO", 
                logo: "" 
            });
        }

        // Inicializar áreas si la colección está vacía
        const areasCount = await db.collection('areas').countDocuments();
        if (areasCount === 0) {
            await db.collection('areas').insertMany(defaultAreas);
        }

        // Inicializar grados si la colección está vacía
        const gradosCount = await db.collection('grados').countDocuments();
        if (gradosCount === 0) {
            await db.collection('grados').insertMany(defaultGrados);
        }

        // Inicializar tipos de recursos si la colección está vacía
        const tiposCount = await db.collection('tipos').countDocuments();
        if (tiposCount === 0) {
            await db.collection('tipos').insertMany(defaultTipos);
        }

        // Crear usuario administrador por defecto si no existe
        const adminExists = await db.collection('users').findOne({ username: 'admin' });
        if (!adminExists) {
            await db.collection('users').insertOne({ 
                username: 'admin', 
                fullname: 'Administrador General', 
                role: 'Administrador', 
                pass: 'admin123' 
            });
        }
    } catch (e) {
        console.error("Error grave de conexión a la nube de MongoDB:", e);
    }
}
connectDB();

// --- RUTAS DE ESTRUCTURA INSTITUCIONAL (FALTANTES) ---
app.get('/api/inst-context', async (req, res) => {
    try {
        const config = await db.collection('institution_config').findOne({});
        const areas = await db.collection('areas').find().toArray();
        const grados = await db.collection('grados').find().toArray();
        const tipos = await db.collection('tipos').find().toArray();
        res.json({
            institution: config ? config.name : "INSTITUCIÓN EDUCATIVA TÉCNICA EN INFORMÁTICA DE SINCELEJITO",
            areas,
            grados,
            tipos
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/areas', async (req, res) => {
    try {
        const areas = await db.collection('areas').find().toArray();
        res.json(areas.length > 0 ? areas : defaultAreas);
    } catch (e) { res.json(defaultAreas); }
});

app.get('/api/grados', async (req, res) => {
    try {
        const grados = await db.collection('grados').find().toArray();
        res.json(grados.length > 0 ? grados : defaultGrados);
    } catch (e) { res.json(defaultGrados); }
});

app.get('/api/tipos', async (req, res) => {
    try {
        const tipos = await db.collection('tipos').find().toArray();
        res.json(tipos.length > 0 ? tipos : defaultTipos);
    } catch (e) { res.json(defaultTipos); }
});

// --- AUTENTICACIÓN ---
app.post('/api/login', async (req, res) => {
    const { userIn, passIn, selectedRole } = req.body;
    try {
        const found = await db.collection('users').findOne({ username: userIn, pass: passIn, role: selectedRole });
        if (found) {
            const now = new Date();
            const logEntry = {
                user: found.fullname, role: found.role, 
                action: 'Ingresó a la plataforma', 
                timestamp: now.toLocaleDateString() + ' ' + now.toLocaleTimeString()
            };
            await db.collection('platform_stats').updateOne({}, { $push: { logs: { $each: [logEntry], $position: 0 } }, $inc: { views: 1 } });
            res.json({ success: true, user: found });
        } else {
            res.json({ success: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- GESTIÓN DE USUARIOS ---
app.get('/api/users', async (req, res) => {
    try {
        const users = await db.collection('users').find({ username: { $ne: 'admin' } }).toArray();
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
    const { user, name, role, pass } = req.body;
    try {
        const result = await db.collection('users').insertOne({ username: user, fullname: name, role, pass });
        res.json({ success: true, id: result.insertedId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:username', async (req, res) => {
    try {
        await db.collection('users').deleteOne({ username: req.params.username });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- MATERIALES DIDÁCTICOS (RECURSOS) ---
app.get('/api/resources', async (req, res) => {
    try {
        const items = await db.collection('resources').find().toArray();
        res.json(items);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources', async (req, res) => {
    try {
        const resource = { ...req.body, ratingSum: 0, ratingCount: 0, comments: [] };
        const result = await db.collection('resources').insertOne(resource);
        await db.collection('platform_stats').updateOne({}, { $inc: { uploads: 1 } });
        res.json({ success: true, id: result.insertedId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/resources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        delete req.body._id;
        await db.collection('resources').updateOne({ _id: new ObjectId(id) }, { $set: req.body });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/resources/:id', async (req, res) => {
    try {
        await db.collection('resources').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources/:id/rate', async (req, res) => {
    const { rating } = req.body;
    try {
        await db.collection('resources').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $inc: { ratingSum: rating, ratingCount: 1 } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources/:id/comment', async (req, res) => {
    const { user, text, date } = req.body;
    try {
        await db.collection('resources').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $push: { comments: { user, text, date } } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ESTADÍSTICAS Y CONFIGURACIONES ---
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.collection('platform_stats').findOne({});
        res.json(stats);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stats/download', async (req, res) => {
    try {
        await db.collection('platform_stats').updateOne({}, { $inc: { downloads: 1 } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config', async (req, res) => {
    try {
        const cfg = await db.collection('institution_config').findOne({});
        res.json(cfg);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', async (req, res) => {
    const { name, logo } = req.body;
    try {
        await db.collection('institution_config').updateOne({}, { $set: { name, logo } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Servidor de Repositorio de Inglés corriendo de forma segura en puerto: ${port}`);
});