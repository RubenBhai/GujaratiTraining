const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================================
// CONFIGURACIÓN DE SEGURIDAD
// En Render, agrega la variable: FRONTEND_URL = https://tu-usuario.github.io
// =====================================================================
app.use(cors({
    origin: process.env.FRONTEND_URL || "*"
}));

app.use(cors());

app.use(express.json({ limit: '10mb' }));

// =====================================================================
// GEMINI API
// =====================================================================
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// =====================================================================
// LISTA DE ACCESO
// IMPORTANTE: No hardcodear credenciales en el código.
// En Render, crea la variable de entorno:
//   USUARIOS_JSON = {"rubenbhai":"144000","vanessaben":"144000",...}
// =====================================================================
const USUARIOS_AUTORIZADOS = JSON.parse(process.env.USUARIOS_JSON || "{}");
console.log(`Usuarios cargados: ${Object.keys(USUARIOS_AUTORIZADOS).length}`);

// =====================================================================
// MIDDLEWARE DE AUTENTICACIÓN (comentado - acceso libre)
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

// =====================================================================
// HELPER: Reintentos con espera progresiva para errores 503 de Gemini
// =====================================================================
function esperar(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function generarConReintentos(peticion, maxIntentos = 4) {
    let ultimoError;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            return await ai.models.generateContent(peticion);
        } catch (error) {
            ultimoError = error;
            // Solo reintentar en errores temporales (503 saturación, 429 límite, 500 interno)
            const status = error.status || (error.response && error.response.status);
            const esTemporal = status === 503 || status === 429 || status === 500;
            if (!esTemporal || intento === maxIntentos) {
                throw error;
            }
            // Espera progresiva: 1s, 2s, 4s
            const espera = 1000 * Math.pow(2, intento - 1);
            console.log(`Gemini ${status} (intento ${intento}/${maxIntentos}). Reintentando en ${espera}ms...`);
            await esperar(espera);
        }
    }
    throw ultimoError;
}

app.post('/api/evaluar-audio', async (req, res) => {
    const { audioBase64, mimeType, fraseObjetivo } = req.body;

    if (!audioBase64 || !fraseObjetivo) {
        return res.status(400).json({ error: "Datos multimedia incompletos o corruptos." });
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
        const response = await generarConReintentos({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: promptPedagogico },
                        { inlineData: { mimeType: mimeType || "audio/webm", data: audioBase64 } }
                    ]
                }
            ],
            config: { responseMimeType: "application/json" }
        });

        // BUG FIX: \n escapado correctamente (no salto de línea literal)
        let iaTexto = response.text;
        iaTexto = iaTexto.replace(/```json/gi, "").replace(/\n```/g, "").trim();

        res.json(JSON.parse(iaTexto));

    } catch (error) {
        console.error("Error en el motor de IA:", error);
        const status = error.status || (error.response && error.response.status);
        if (status === 503 || status === 429) {
            return res.status(503).json({
                error: "El evaluador está muy ocupado en este momento. Espera unos segundos e intenta de nuevo.",
                reintentar: true
            });
        }
        res.status(500).json({ error: "Error interno procesando la voz en el servidor." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo con éxito en el puerto ${PORT}`);
});
