const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================================
// CONFIGURACIÓN DE SEGURIDAD
// En Render, agrega la variable: FRONTEND_URL = https://tu-usuario.github.io
// =====================================================================
app.use(cors({
    origin: process.env.FRONTEND_URL || "*"
}));

app.use(express.json({ limit: '10mb' }));

// =====================================================================
// GEMINI API
// =====================================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// =====================================================================
// LISTA DE ACCESO
// IMPORTANTE: No hardcodear credenciales en el código.
// En Render, crea la variable de entorno:
//   USUARIOS_JSON = {"rubenbhai":"144000","vanessaben":"144000",...}
// =====================================================================
const USUARIOS_AUTORIZADOS = JSON.parse(process.env.USUARIOS_JSON || "{}");
console.log(`Usuarios cargados: ${Object.keys(USUARIOS_AUTORIZADOS).length}`);

// =====================================================================
// MIDDLEWARE DE AUTENTICACIÓN (opcional, comentado para acceso libre)
// Protege /api/evaluar-audio de llamadas externas no autorizadas.
// En Render, crea la variable: ACCESS_TOKEN = (cualquier string seguro)
// =====================================================================
function verificarAcceso(req, res, next) {
    const token = req.headers['x-access-token'];
    if (!token || token !== process.env.ACCESS_TOKEN) {
        return res.status(401).json({ error: "No autorizado." });
    }
    next();
}

// =====================================================================
// RUTAS
// =====================================================================
app.get('/', (req, res) => {
    res.send('🎭 El Servidor del Teatro de Gujarati está activo y listo, Bhai.');
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ acceso: false, mensaje: "Faltan datos de ingreso." });
    }
    const usuarioClave = username.toLowerCase().trim();
    const passwordLimpia = password.trim();

    console.log(`Usuario "${usuarioClave}" existe: ${!!USUARIOS_AUTORIZADOS[usuarioClave]}`);
    console.log(`Longitud password ingresada: ${passwordLimpia.length} | almacenada: ${(USUARIOS_AUTORIZADOS[usuarioClave] || '').length}`);
    
    if (USUARIOS_AUTORIZADOS[usuarioClave] && USUARIOS_AUTORIZADOS[usuarioClave] === passwordLimpia) {
        return res.json({ acceso: true, mensaje: "¡Acceso concedido!", token: process.env.ACCESS_TOKEN });
    } else {
        return res.status(401).json({ acceso: false, mensaje: "Usuario o contraseña incorrectos." });
    }
});

app.post('/api/evaluar-audio', async (req, res) => {
    const { audioBase64, mimeType, fraseObjetivo } = req.body;

    if (!audioBase64 || !fraseObjetivo) {
        return res.status(400).json({ error: "Datos multimedia incompletos o corruptos." });
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ GEMINI_API_KEY no está configurada en Render");
        return res.status(500).json({ error: "Servidor no configurado: falta GEMINI_API_KEY" });
    }

    const promptPedagogico = `
        Eres un tutor nativo de Gujarati y experto en fonética. Escucha el audio adjunto.
        El alumno está intentando pronunciar exactamente esta frase: "${fraseObjetivo}".
        Compara su voz con el estándar nativo y devuélveme ESTRICTAMENTE un objeto JSON con esta estructura:
        {
          "nota": (un número entero del 1 al 10 según su precisión),
          "transcripcion": (lo que lograste entender textualmente de su pronunciación),
          "consejo": (un tip corto, empático y práctico en español para mejorar su acento)
        }
    `;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const response = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: promptPedagogico },
                        { 
                            inlineData: { 
                                mimeType: mimeType || "audio/webm", 
                                data: audioBase64 
                            } 
                        }
                    ]
                }
            ]
        });

        let iaTexto = response.response.text();
        iaTexto = iaTexto.replace(/```json/gi, "").replace(/```/g, "").trim();

        res.json(JSON.parse(iaTexto));

    } catch (error) {
        console.error("❌ Error en el motor de IA:", error.message);
        res.status(500).json({ error: `Error interno: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo con éxito en el puerto ${PORT}`);
});
