const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================================
// CONFIGURACIÓN
// =====================================================================
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// =====================================================================
// SARVAM STT
// =====================================================================
const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
const SARVAM_KEY     = process.env.SARAM_KEY;
const LANGUAGE_CODE  = "gu-IN";
const STT_MODEL      = "saarika:v2.5";

// =====================================================================
// LISTA DE ACCESO (login conservado por compatibilidad)
// =====================================================================
const USUARIOS_AUTORIZADOS = JSON.parse(process.env.USUARIOS_JSON || "{}");
console.log(`Usuarios cargados: ${Object.keys(USUARIOS_AUTORIZADOS).length}`);

// =====================================================================
// HELPER: normalizar texto gujarati para comparar
// =====================================================================
function normalizar(texto) {
    if (!texto) return "";
    return String(texto)
        .trim()
        // quitar signos de puntuación comunes
        .replace(/[।॥?!.,'"\s]/g, "")
        .toLowerCase();
}

// =====================================================================
// HELPER: reintentos para errores temporales de Sarvam
// =====================================================================
function esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

async function transcribirConReintentos(audioBuffer, mimeType, maxIntentos = 3) {
    let ultimoError;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            // Determinar extensión/nombre según el mimeType del navegador
            let filename = "audio.webm";
            if (mimeType && mimeType.includes("mp4"))  filename = "audio.mp4";
            if (mimeType && mimeType.includes("ogg"))  filename = "audio.ogg";
            if (mimeType && mimeType.includes("wav"))  filename = "audio.wav";

            const form = new FormData();
            const blob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });
            form.append("file", blob, filename);
            form.append("language_code", LANGUAGE_CODE);
            form.append("model", STT_MODEL);

            const resp = await fetch(SARVAM_STT_URL, {
                method: "POST",
                headers: { "api-subscription-key": SARVAM_KEY },
                body: form
            });

            if (resp.ok) {
                return await resp.json();
            }

            // 429 (rate limit) o 5xx -> reintentar
            if (resp.status === 429 || resp.status >= 500) {
                ultimoError = new Error(`Sarvam HTTP ${resp.status}`);
                ultimoError.status = resp.status;
                if (intento < maxIntentos) {
                    const espera = 500 * Math.pow(2, intento - 1);
                    console.log(`Sarvam ${resp.status} (intento ${intento}/${maxIntentos}). Reintentando en ${espera}ms...`);
                    await esperar(espera);
                    continue;
                }
            }

            // otros errores: no reintentar
            const txt = await resp.text();
            const err = new Error(`Sarvam HTTP ${resp.status}: ${txt.slice(0,200)}`);
            err.status = resp.status;
            throw err;

        } catch (e) {
            ultimoError = e;
            if (intento === maxIntentos) throw e;
            const espera = 500 * Math.pow(2, intento - 1);
            console.log(`Error Sarvam (intento ${intento}/${maxIntentos}): ${e.message}. Reintentando en ${espera}ms...`);
            await esperar(espera);
        }
    }
    throw ultimoError;
}

// =====================================================================
// RUTAS
// =====================================================================
app.get('/', (req, res) => {
    res.send('🎭 Servidor Piensa en Gujarati activo (Sarvam STT).');
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ acceso: false, mensaje: "Faltan datos de ingreso." });
    }
    const usuarioClave = username.toLowerCase().trim();
    const passwordLimpia = password.trim();
    if (USUARIOS_AUTORIZADOS[usuarioClave] && USUARIOS_AUTORIZADOS[usuarioClave] === passwordLimpia) {
        return res.json({ acceso: true, mensaje: "¡Acceso concedido!", token: process.env.ACCESS_TOKEN });
    }
    return res.status(401).json({ acceso: false, mensaje: "Usuario o contraseña incorrectos." });
});

// =====================================================================
// EVALUAR PRONUNCIACIÓN — Sarvam STT (devuelve "lo que escuchó")
// =====================================================================
app.post('/api/evaluar-audio', async (req, res) => {
    const { audioBase64, mimeType, fraseObjetivo } = req.body;

    if (!audioBase64 || !fraseObjetivo) {
        return res.status(400).json({ error: "Datos de audio incompletos." });
    }

    if (!SARVAM_KEY) {
        console.error("Falta la variable de entorno SARAM_KEY");
        return res.status(500).json({ error: "Configuración del servidor incompleta." });
    }

    try {
        const audioBuffer = Buffer.from(audioBase64, "base64");
        const data = await transcribirConReintentos(audioBuffer, mimeType);

        // Sarvam devuelve el texto en "transcript" (o "text")
        const escuchado = (data && (data.transcript || data.text) || "").trim();

        // Comparar normalizado contra la frase objetivo
        const objetivoNorm = normalizar(fraseObjetivo);
        const escuchadoNorm = normalizar(escuchado);
        const acierto = objetivoNorm.length > 0 && objetivoNorm === escuchadoNorm;

        res.json({
            escuchado: escuchado,        // lo que Sarvam entendió
            objetivo: fraseObjetivo,     // lo que debía decir
            acierto: acierto             // true si coinciden
        });

    } catch (error) {
        console.error("Error en Sarvam STT:", error.message);
        const status = error.status;
        if (status === 429 || (status >= 500 && status < 600)) {
            return res.status(503).json({
                error: "El servicio de reconocimiento está ocupado. Intenta de nuevo en un momento.",
                reintentar: true
            });
        }
        res.status(500).json({ error: "Error procesando el audio." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
