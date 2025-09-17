import express from "express";
import bodyParser from "body-parser";
import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

// JSON de configuración de los clientes
const CLIENTS_CONFIG = [
  {
    "name": "cliente1",
    "token": process.env.TELEGRAM_TOKEN_CLIENTE1,
    "webhookUrl": process.env.BASE_WEBHOOK_URL+"/webhook/cliente1",
    "GREETING": 'Hola! ${userName}, Soy Naya, tu asistente virtual de Ventas de Servicios',
    "PREAMBLE": "Eres un asistente de ventas virtual que guía al usuario a comprar productos y servicios.",
    "INSTRUCTIONS": "No inventes información. Usa solo los datos proporcionados.",
    "PRODUCTS_AND_SERVICES": "📌 Productos: Computadoras, Servidores, Software, Hosting, IA, Bots."
  },
  {
    "name": "cliente2",
    "token": process.env.TELEGRAM_TOKEN_CLIENTE2,
    "webhookUrl": process.env.BASE_WEBHOOK_URL+"/webhook/cliente2",
    "GREETING": '¡Hola! ${userName}, Soy Leo, tu asesor personalizado',
    "PREAMBLE": "Eres un asistente especializado en servicios de TI para empresas.",
    "INSTRUCTIONS": "Responde solo con información verificada y profesional.",
    "PRODUCTS_AND_SERVICES": "📌 Servicios: Redes, Seguridad, Cloud, Desarrollo de Software.",
    "PROPERTIES":{"tone":"Profesional y conciso","language":"Español"}
  },
  {
  "name": "cliente3",
  "token": process.env.TELEGRAM_TOKEN_CLIENTE3,
  "webhookUrl": process.env.BASE_WEBHOOK_URL+"/webhook/cliente3",
  "GREETING": '¡Hola! ${userName}, 🍕 Soy Marco, tu asesor de pizzas personal.',
  "PREAMBLE": "Eres un asistente especializado en ventas de pizzas y atención al cliente para una pizzería.",
  "INSTRUCTIONS": "Responde siempre con amabilidad, usa un tono cercano y ofrece recomendaciones según el gusto del cliente. Sé breve, claro y directo.",
  "PRODUCTS_AND_SERVICES": "📌 Menú: Pizzas clásicas (muzza, napolitana, fugazzeta), Pizzas especiales (pepperoni, cuatro quesos, hawaiana), Bebidas (gaseosas, cervezas, agua), Promociones 2x1 y combos familiares."
}
];

// Creamos un mapa para un acceso rápido y seguro a la configuración
const clientConfigMap = new Map(
  CLIENTS_CONFIG.map(config => [config.name, config])
);

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Función para configurar webhooks en Telegram
async function setupTelegramWebhook(clientConfig) {
  try {
    const webhookUrl = `${process.env.BASE_WEBHOOK_URL}/webhook/${clientConfig.name}`;

    const response = await fetch(
      `https://api.telegram.org/bot${clientConfig.token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );

    const result = await response.json();

    if (result.ok) {
      console.log(`✅ Webhook configurado correctamente para ${clientConfig.name}`);
      console.log(`   URL: ${webhookUrl}`);
    } else {
      console.error(`❌ Error al configurar webhook para ${clientConfig.name}:`, result.description);
    }

    return result.ok;
  } catch (error) {
    console.error(`❌ Error al configurar webhook para ${clientConfig.name}:`, error.message);
    return false;
  }
}

// Función para eliminar webhooks (opcional, para limpieza)
async function deleteTelegramWebhook(clientConfig) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${clientConfig.token}/deleteWebhook`
    );

    const result = await response.json();

    if (result.ok) {
      console.log(`✅ Webhook eliminado para ${clientConfig.name}`);
    }

    return result.ok;
  } catch (error) {
    console.error(`❌ Error al eliminar webhook para ${clientConfig.name}:`, error.message);
    return false;
  }
}

// --- Inicialización del Servidor ---
async function startServer() {
  let mongoClient;
  try {
    // Conexión a MongoDB
    const mongoUri = process.env.MONGO_URI;
    const mongoDb = process.env.MONGO_DB;
    if (!mongoUri) {
      throw new Error("❌ La variable de entorno MONGO_URI no está definida.");
    }

    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    console.log("✅ Conectado a MongoDB");

    // Función para obtener la colección según el cliente
    function getCollection(clientId) {
      return mongoClient.db(mongoDb).collection(clientId);
    }

    // Configurar webhooks para todos los clientes al iniciar
    console.log("🔄 Configurando webhooks de Telegram...");
    const webhookResults = await Promise.all(
      CLIENTS_CONFIG.map(async (clientConfig) => {
        return await setupTelegramWebhook(clientConfig);
      })
    );

    // Verificar que todos los webhooks se configuraron correctamente
    const allWebhooksConfigured = webhookResults.every(result => result);
    if (!allWebhooksConfigured) {
      console.warn("⚠️  Algunos webhooks no se configuraron correctamente");
    }

    // --- Webhook de Telegram para cada cliente ---
    app.post("/webhook/:clientId", async (req, res) => {
      const clientId = req.params.clientId;
      const clientConfig = clientConfigMap.get(clientId);

      // Validación de cliente y token
      if (!clientConfig || !clientConfig.token) {
        console.error(`❌ Cliente no autorizado o no válido: ${clientId}`);
        return res.status(401).send("Cliente no autorizado o no válido.");
      }

      const update = req.body;
      if (!update.message) {
        return res.sendStatus(200);
      }

      try {
        const collection = getCollection(clientId);
        const chatId = update.message.chat.id;
        const userName = update.message.from.first_name;
        const userMessage = update.message.text;

        // Consultar si ya fue saludado
        const memory = await collection.findOne({ chatId });
        const alreadyGreeted = memory ? memory.alreadyGreeted : false;

        const greeting = alreadyGreeted ? "" : `${clientConfig.GREETING}\n\n`;

        // Prompt para el agente de IA, usando la configuración del JSON
        const prompt = `
        ${clientConfig.PREAMBLE}
        ${clientConfig.INSTRUCTIONS}
        ${clientConfig.PRODUCTS_AND_SERVICES}

        ${greeting}
        El usuario dice: "${userMessage}".
        Responde al usuario.
        `;

        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
        });

        const reply = completion.choices[0].message.content;

        // Guardamos memoria (ya saludado)
       await collection.insertOne({
          chatId,
          userName,
          userMessage,
          timestamp: new Date()
        });

        // Responder vía Telegram API
        await fetch(`https://api.telegram.org/bot${clientConfig.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: reply }),
        });

        res.sendStatus(200);
      } catch (error) {
        console.error("❌ Error en el webhook:", error);
        res.status(500).send("Ocurrió un error interno.");
      }
    });

    // Endpoint para agregar nuevos agentes dinámicamente
    app.post("/admin/add-agent", async (req, res) => {
      try {
        const newAgentConfig = req.body;

        // Validaciones básicas
        if (!newAgentConfig.name || !newAgentConfig.token) {
          return res.status(400).json({ error: "Nombre y token son requeridos" });
        }

        // Verificar que no exista ya
        if (clientConfigMap.has(newAgentConfig.name)) {
          return res.status(400).json({ error: "El agente ya existe" });
        }

        // Agregar a la configuración
        CLIENTS_CONFIG.push(newAgentConfig);
        clientConfigMap.set(newAgentConfig.name, newAgentConfig);

        // Configurar webhook para el nuevo agente
        const webhookSuccess = await setupTelegramWebhook(newAgentConfig);

        if (webhookSuccess) {
          console.log(`✅ Nuevo agente agregado: ${newAgentConfig.name}`);
          res.json({ success: true, message: "Agente agregado correctamente" });
        } else {
          res.status(500).json({ error: "Agente agregado pero falló la configuración del webhook" });
        }
      } catch (error) {
        console.error("❌ Error al agregar agente:", error);
        res.status(500).json({ error: "Error interno al agregar agente" });
      }
    });

    // Endpoint para listar agentes activos
    app.get("/admin/agents", (req, res) => {
      res.json(CLIENTS_CONFIG.map(config => ({
        name: config.name,
        webhookUrl: `${process.env.BASE_WEBHOOK_URL}/webhook/${config.name}`,
        status: "active"
      })));
    });

    app.listen(3000, () => {
      console.log("🚀 Servidor escuchando en http://localhost:3000");
      console.log("🤖 Agentes activos:");
      CLIENTS_CONFIG.forEach(config => {
        console.log(`   - ${config.name}: ${process.env.BASE_WEBHOOK_URL}/webhook/${config.name}`);
      });
    });

  } catch (error) {
    console.error("❌ Falló el inicio de la aplicación:", error);
    if (mongoClient) {
      await mongoClient.close();
    }
    process.exit(1);
  }
}

// Manejo de cierre graceful
process.on('SIGINT', async () => {
  console.log("\n🔄 Cerrando aplicación...");

  // Opcional: Eliminar webhooks al cerrar
  if (process.env.CLEANUP_WEBHOOKS_ON_EXIT === 'true') {
    console.log("🧹 Limpiando webhooks...");
    await Promise.all(
      CLIENTS_CONFIG.map(async (clientConfig) => {
        await deleteTelegramWebhook(clientConfig);
      })
    );
  }

  process.exit(0);
});

startServer();
