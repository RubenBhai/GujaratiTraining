const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Seguridad
// Cambia esto por el link real de tu GitHub Pages si quieres bloquearlo aún más en el futuro
app.use(cors()); 
app.use(express.json({ limit: '10mb' })); // Permitir archivos de audio base64 medianos

// 1. INICIALIZACIÓN DE GEMINI API
// Render inyectará de forma invisible la KEY que guardaste en el panel
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 2. LISTA DE ACCESO CONTROLADO (Agrega o cambia tus amigos aquí)
const USUARIOS_AUTORIZADOS = {
    "ruben": "bhai2026",
    "invitado1": "gujarati_top",
    "invitado2": "ahmedabad"
};

// RUTA DE PRUEBA: Para verificar que el servidor esté vivo
app.get('/', (req, res) => {
    res.send('🎭 El Servidor del Teatro de Gujarati está activo y listo, Bhai.');
});

// ENDPOINT DE LOGIN: Valida usuarios sin exponer claves en el celular
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ acceso: false, mensaje: "Faltan datos de ingreso." });
    }

    const usuarioClave = username.toLowerCase().trim();
    if (USUARIOS_AUTORIZADOS[usuarioClave] && USUARIOS_AUTORIZADOS[usuarioClave] === password) {
        return res.json({ acceso: true, mensaje: "¡Acceso concedido!" });
    } else {
        return res.status(401).json({ acceso: false, mensaje: "Usuario o contraseña incorrectos." });
    }
});

// ENDPOINT DE IA: Recibe el audio del Android y lo manda a evaluar a Gemini
app.post('/api/evaluar-audio', async (req, res) => {
    const { audioBase64, fraseObjetivo } = req.body;

    if (!audioBase64 || !fraseObjetivo) {
        return res.status(400).json({ error: "Datos multimedia incompletos o corruptos." });
    }

    const promptPedagogico = `
        Eres un tutor nativo de Gujarati y experto en fonética. Escucha el audio adjunto.
        El alumno está intentando pronunciar exactamente esta frase: "${fraseObjetivo}".
        Compara su voz con el estándar nativo y devuélveme ESTRICTAMENTE un objeto JSON con esta estructura:
        {
          "nota": (un número entero del 1 al 10 según su precisión),
          "transcripcion": (lo que lograste entender textualanente de su pronunciación),
          "consejo": (un tip corto, empático y práctico en español para mejorar su acento)
        }
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: [
                promptPedagogico,
                {
                    inlineData: {
                        mimeType: "audio/mp4", // Formato nativo y ultra liviano del grabador del Android
                        data: audioBase64
                    }
                }
            ],
            config: { responseMimeType: "application/json" }
        });

        // Devolvemos la respuesta estructurada de la IA directamente al celular del alumno
        res.json(JSON.parse(response.text));

    } catch (error) {
        console.error("Error en el motor de IA:", error);
        res.status(500).json({ error: "Error interno procesando la voz en el servidor." });
    }
});

// Encender el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo con éxito en el puerto ${PORT}`);
});
