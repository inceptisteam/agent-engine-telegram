import express from "express";
import bodyParser from "body-parser";
import { MongoClient } from "mongodb";
import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

// Agregar estas constantes al inicio del archivo
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutos de inactividad
const REGISTRATION_STEPS = {
  NONE: 0,
  ASK_NAME: 1,
  ASK_EMAIL: 2,
  COMPLETED: 3
};

const ITERATOR = {
    USER: 'user',
    BOT: 'bot',
    SYSTEM: 'system'
}

// Variable para almacenar la configuración (inicialmente vacía)
let CLIENTS_CONFIG = [];
let clientConfigMap = new Map();

// Función para cargar la configuración desde variables de entorno
function loadClientsConfig() {
  console.log("🔄 Cargando configuración de clientes...");

  // Definir la configuración de clientes
  const config = [
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
      "PROPERTIES":{"tone":"Profesional and conciso","language":"Español"}
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

  // Filtrar clientes que tienen token definido
  CLIENTS_CONFIG = config.filter(client => client.token && client.token !== 'token_del_bot_clienteX');

  // Actualizar el mapa de configuración
  clientConfigMap = new Map(CLIENTS_CONFIG.map(config => [config.name, config]));

  console.log(`✅ Configuración cargada. ${CLIENTS_CONFIG.length} clientes activos.`);
}

// Cargar configuración inicial
loadClientsConfig();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Función mejorada para configurar webhooks
async function setupTelegramWebhook(clientConfig) {
  try {
    const webhookUrl = `${process.env.BASE_WEBHOOK_URL}/webhook/${clientConfig.name}`;

    console.log(`🔧 Configurando webhook para ${clientConfig.name}: ${webhookUrl}`);

    const response = await fetch(
      `https://api.telegram.org/bot${clientConfig.token}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          max_connections: 40,
          allowed_updates: ["message", "callback_query"]
        })
      }
    );

    const result = await response.json();

    if (result.ok) {
      console.log(`✅ Webhook configurado correctamente para ${clientConfig.name}`);
      console.log(`   URL: ${webhookUrl}`);
      return true;
    } else {
      console.error(`❌ Error al configurar webhook para ${clientConfig.name}:`, result.description);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error al configurar webhook para ${clientConfig.name}:`, error.message);
    return false;
  }
}

// Función para enviar mensajes a Telegram
async function sendTelegramMessage(token, chatId, text) {
  try {
    // Validar que el texto no esté vacío
    if (!text || text.trim() === '') {
      console.error('❌ Error: Intentando enviar mensaje vacío a Telegram');
      text = "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.";
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML"
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error(`❌ Error al enviar mensaje a Telegram:`, result.description);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`❌ Error en sendTelegramMessage:`, error.message);
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

// Verificación de variables de entorno
function checkEnvironmentVariables() {
  const requiredVars = [
    'MONGO_URI',
    'MONGO_DB',
    'OPENAI_API_KEY',
    'BASE_WEBHOOK_URL'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ Variables de entorno faltantes:', missingVars);
    throw new Error(`Faltan variables de entorno: ${missingVars.join(', ')}`);
  }

  console.log('✅ Todas las variables de entorno requeridas están presentes');
}

// --- Inicialización del Servidor ---
async function startServer() {
  let mongoClient;
  try {
    // Verificar variables de entorno
    checkEnvironmentVariables();

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

    // Función para obtener la colección de conversaciones
    function getConversationsCollection(clientId) {
      return mongoClient.db(mongoDb).collection(`${clientId}_conversations`);
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


    // Función para manejar el proceso de registro (corregida)
    async function handleRegistrationProcess(clientConfig, collection, conversationsCollection, chatId, userName, userMessage, userSession) {
    try {
        let reply = "";
        let registrationStep = userSession?.registrationStep ?? REGISTRATION_STEPS.NONE;
        let updateData = {};

        console.log(`📝 Proceso de registro - Paso: ${registrationStep}, Sesión existente: ${!!userSession}`);

        switch (registrationStep) {
        case REGISTRATION_STEPS.NONE:
            // Iniciar proceso de registro
            reply = `¡Hola! Soy tu asistente virtual. Para personalizar tu experiencia, ¿podrías decirme tu nombre completo?`;
            updateData = {
            chatId,
            userName: userName, // nombre de Telegram como valor inicial
            registrationStep: REGISTRATION_STEPS.ASK_NAME,
            lastActivity: new Date()
            };
            break;

        case REGISTRATION_STEPS.ASK_NAME:
            // Guardar nombre y pedir email
            reply = `Mucho gusto, ${userMessage}. Ahora, ¿podrías proporcionarme tu correo electrónico?`;
            updateData = {
            userName: userMessage,
            registrationStep: REGISTRATION_STEPS.ASK_EMAIL,
            lastActivity: new Date()
            };
            break;

        case REGISTRATION_STEPS.ASK_EMAIL:
            // Validar formato de email simple
            const emailRegex = /\S+@\S+\.\S+/;
            if (!emailRegex.test(userMessage)) {
            reply = "Por favor, ingresa un correo electrónico válido.";
            updateData = { lastActivity: new Date() };
            } else {
            // Registro completado
            const finalUserName = userSession.userName || userName;
            const greeting = clientConfig.GREETING.replace('${userName}', finalUserName);
            reply = `${greeting}\n\n¡Gracias! Tu registro está completo. ¿En qué puedo ayudarte hoy?`;
            updateData = {
                userEmail: userMessage,
                registrationStep: REGISTRATION_STEPS.COMPLETED,
                registeredAt: new Date(),
                lastActivity: new Date()
            };
            }
            break;

        default:
            reply = `¡Hola! Soy tu asistente virtual. Para comenzar, ¿podrías decirme tu nombre completo?`;
            updateData = {
            chatId,
            userName: userName,
            registrationStep: REGISTRATION_STEPS.ASK_NAME,
            lastActivity: new Date()
            };
            break;
        }

        // Validar que reply no esté vacío
        if (!reply || reply.trim() === '') {
            console.error('❌ Error: Respuesta vacía generada en el proceso de registro');
            reply = "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.";
        }

        // Guardar mensaje del usuario en la conversación
        await conversationsCollection.insertOne({
        chatId,
        message: userMessage,
        sender: ITERATOR.USER,
        timestamp: new Date(),
        registrationStep: registrationStep
        });

        // Guardar respuesta del bot en la conversación
        await conversationsCollection.insertOne({
        chatId,
        message: reply,
        sender: ITERATOR.BOT,
        timestamp: new Date(),
        registrationStep: registrationStep
        });

        // Actualizar o insertar la sesión del usuario
        if (userSession) {
        await collection.updateOne({ chatId }, { $set: updateData });
        } else {
        // Crear nueva sesión si no existe
        await collection.insertOne({
            chatId,
            ...updateData,
            createdAt: new Date()
        });
        }

        // Enviar respuesta usando la función mejorada
        await sendTelegramMessage(clientConfig.token, chatId, reply);

    } catch (error) {
        console.error("❌ Error en el proceso de registro:", error);
        // Intentar enviar un mensaje de error
        try {
        await sendTelegramMessage(clientConfig.token, chatId, "❌ Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.");
        } catch (e) {
        console.error("Error al enviar mensaje de error:", e);
        }
        throw error;
    }
    }

    // Endpoint de salud
    app.get("/health", (req, res) => {
      res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        clients: CLIENTS_CONFIG.length,
        message: "Servidor funcionando correctamente"
      });
    });

    // Endpoint para probar la conexión a MongoDB
    app.get("/health/mongo", async (req, res) => {
      try {
        const adminDb = mongoClient.db().admin();
        const status = await adminDb.ping();
        res.json({
          status: "OK",
          mongo: status.ok === 1 ? "Conectado" : "Error"
        });
      } catch (error) {
        res.status(500).json({
          status: "Error",
          mongo: "Desconectado",
          error: error.message
        });
      }
    });

    // Endpoint para verificar el estado de los webhooks
    app.get("/admin/webhook-status", async (req, res) => {
      try {
        const statuses = await Promise.all(
          CLIENTS_CONFIG.map(async (clientConfig) => {
            try {
              const response = await fetch(
                `https://api.telegram.org/bot${clientConfig.token}/getWebhookInfo`
              );
              const result = await response.json();
              return {
                client: clientConfig.name,
                status: result.ok ? "Activo" : "Error",
                url: result.ok ? result.result.url : 'N/A',
                details: result
              };
            } catch (error) {
              return {
                client: clientConfig.name,
                status: 'Error',
                error: error.message
              };
            }
          })
        );

        res.json(statuses);
      } catch (error) {
        console.error("❌ Error al obtener estado de webhooks:", error);
        res.status(500).json({ error: "Error interno" });
      }
    });

    // --- Webhook de Telegram para cada cliente ---
    app.post("/webhook/:clientId", async (req, res) => {
      const clientId = req.params.clientId;
      const clientConfig = clientConfigMap.get(clientId);

      console.log(`📨 Webhook recibido para cliente: ${clientId}`);

      // Validación de cliente y token
      if (!clientConfig || !clientConfig.token) {
        console.error(`❌ Cliente no autorizado o no válido: ${clientId}`);
        return res.status(401).send("Cliente no autorizado o no válido.");
      }

      const update = req.body;
      console.log(`📦 Update recibido:`, JSON.stringify(update, null, 2));

      // Responder inmediatamente a Telegram para evitar timeouts
      res.sendStatus(200);

      if (!update.message || !update.message.text) {
        console.log(`ℹ️  Update sin mensaje de texto, puede ser una actualización de otro tipo`);
        return;
      }

      try {
        const collection = getCollection(clientId);
        const conversationsCollection = getConversationsCollection(clientId);
        const chatId = update.message.chat.id;
        const userName = update.message.from.first_name;
        const userMessage = update.message.text;
        const now = new Date();

        console.log(`💬 Mensaje de ${userName} (${chatId}): ${userMessage}`);

        // Consultar la sesión del usuario
        let userSession = await collection.findOne({ chatId });

        // Verificar si la sesión ha expirado por inactividad
        if (userSession && userSession.lastActivity) {
          const lastActivity = new Date(userSession.lastActivity);
          const timeDiff = now - lastActivity;

          let dataJson = {
              "now": now,
              "lastActivity": lastActivity,
              "timeDiff (ms)": timeDiff,
              "SESSION_TIMEOUT (ms)": SESSION_TIMEOUT
          };
          console.dir(`⏱️  Verificando timeout de sesión para usuario ${chatId}`);
          console.dir(dataJson);


          if (timeDiff > SESSION_TIMEOUT) {
            // Reiniciar sesión expirada
            userSession = null;
            await collection.updateOne(
              { chatId },
              { $set: { registrationStep: REGISTRATION_STEPS.NONE } }
            );

            // Registrar mensaje de timeout
            await conversationsCollection.insertOne({
              chatId,
              message: "Sesión reiniciada por inactividad",
              sender: ITERATOR.SYSTEM,
              timestamp: now
            });
          }
        }

        if (!userSession || userSession.registrationStep !== REGISTRATION_STEPS.COMPLETED) {
        // Si no hay sesión, crear un objeto básico para el proceso de registro
        const sessionForRegistration = userSession || {
            registrationStep: REGISTRATION_STEPS.NONE,
            userName: userName
        };

        await handleRegistrationProcess(clientConfig, collection, conversationsCollection, chatId, userName, userMessage, sessionForRegistration);
        return;
        }


        // Guardar mensaje del usuario en la conversación
        await conversationsCollection.insertOne({
          chatId,
          message: userMessage,
          sender: ITERATOR.USER,
          timestamp: now,
          lastActivity: now,
          userName: userSession.userName,
          userEmail: userSession.userEmail
        });

        // Procesar mensaje normal (usuario ya registrado)
        const prompt = `
        ${clientConfig.PREAMBLE}
        ${clientConfig.INSTRUCTIONS}
        ${clientConfig.PRODUCTS_AND_SERVICES}

        El usuario ${userSession.userName} (${userSession.userEmail}) dice: "${userMessage}".
        Responde al usuario.
        `;

        console.log(`🤖 Enviando prompt a OpenAI: ${prompt.substring(0, 100)}...`);

        let reply;
        try {
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 500,
            temperature: 0.7,
          });

          reply = completion.choices[0].message.content;
          console.log(`✅ Respuesta de OpenAI recibida: ${reply.substring(0, 100)}...`);
        } catch (openaiError) {
          console.error("❌ Error de OpenAI:", openaiError);
          reply = "Lo siento, estoy teniendo dificultades para procesar tu solicitud. Por favor, intenta nuevamente.";
        }

        // Validar que reply no esté vacío
        if (!reply || reply.trim() === '') {
          console.error('❌ Error: Respuesta vacía de OpenAI');
          reply = "Lo siento, no pude generar una respuesta. Por favor, intenta nuevamente.";
        }

        // Guardar respuesta del bot en la conversación
        await conversationsCollection.insertOne({
          chatId,
          message: reply,
          sender: ITERATOR.BOT,
          timestamp: new Date(),
          userName: userSession.userName,
          userEmail: userSession.userEmail
        });

        // Actualizar última actividad
        await collection.updateOne(
          { chatId },
          { $set: { lastActivity: now } }
        );

        // Responder vía Telegram API usando la función mejorada
        await sendTelegramMessage(clientConfig.token, chatId, reply);

      } catch (error) {
        console.error("❌ Error en el webhook:", error);
        // Intentar enviar un mensaje de error
        try {
          const chatId = update.message.chat.id;
          await sendTelegramMessage(clientConfig.token, chatId, "❌ Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.");
        } catch (e) {
          console.error("Error al enviar mensaje de error:", e);
        }
      }
    });

    // Endpoint para refrescar la configuración de clientes
    app.post("/admin/refresh-config", async (req, res) => {
      try {
        console.log("🔄 Solicitando refresco de configuración...");

        // Cargar nueva configuración
        loadClientsConfig();

        // Reconfigurar webhooks para todos los clientes
        console.log("🔄 Reconfigurando webhooks de Telegram...");
        const webhookResults = await Promise.all(
          CLIENTS_CONFIG.map(async (clientConfig) => {
            return await setupTelegramWebhook(clientConfig);
          })
        );

        const successCount = webhookResults.filter(result => result).length;

        res.json({
          success: true,
          message: `Configuración refrescada. ${successCount} de ${CLIENTS_CONFIG.length} webhooks configurados correctamente.`,
          clients: CLIENTS_CONFIG.map(config => config.name)
        });
      } catch (error) {
        console.error("❌ Error al refrescar configuración:", error);
        res.status(500).json({ error: "Error interno al refrescar configuración" });
      }
    });

    // Endpoint para probar OpenAI
    app.post("/admin/test-openai", async (req, res) => {
      try {
        const { message } = req.body;

        if (!message) {
          return res.status(400).json({ error: "El mensaje es requerido" });
        }

        const completion = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [{ role: "user", content: message }],
          max_tokens: 150,
        });

        const reply = completion.choices[0].message.content;

        res.json({
          success: true,
          message: message,
          response: reply
        });
      } catch (error) {
        console.error("❌ Error al probar OpenAI:", error);
        res.status(500).json({ error: "Error al conectar con OpenAI: " + error.message });
      }
    });

    // Endpoint para obtener el historial de conversación de un usuario
    app.get("/admin/conversation/:clientId/:chatId", async (req, res) => {
      try {
        const { clientId, chatId } = req.params;
        const conversationsCollection = getConversationsCollection(clientId);

        const conversation = await conversationsCollection
          .find({ chatId: parseInt(chatId) })
          .sort({ timestamp: 1 })
          .toArray();

        res.json(conversation);
      } catch (error) {
        console.error("❌ Error al obtener conversación:", error);
        res.status(500).json({ error: "Error interno al obtener conversación" });
      }
    });

    // Endpoint para listar agentes activos
    app.get("/admin/agents", (req, res) => {
      res.json(CLIENTS_CONFIG.map(config => ({
        name: config.name,
        webhookUrl: `${process.env.BASE_WEBHOOK_URL}/webhook/${config.name}`,
        status: "active",
        hasToken: !!config.token
      })));
    });

    app.listen(3000, () => {
      console.log("🚀 Servidor escuchando en http://localhost:3000");
      console.log("🤖 Agentes activos:");
      CLIENTS_CONFIG.forEach(config => {
        console.log(`   - ${config.name}: ${process.env.BASE_WEBHOOK_URL}/webhook/${config.name}`);
      });
      console.log("🌐 Endpoints de salud:");
      console.log("   - http://localhost:3000/health");
      console.log("   - http://localhost:3000/health/mongo");
      console.log("   - http://localhost:3000/admin/webhook-status");
      console.log("   - http://localhost:3000/admin/agents");
      console.log("   - http://localhost:3000/admin/test-openai (POST)");
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
