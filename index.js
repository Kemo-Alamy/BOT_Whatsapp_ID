const TelegramBot = require('node-telegram-bot-api');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

// ===================== الإعدادات =====================
const TELEGRAM_TOKEN = '8602061556:AAHbEZSeHEq2eREjQqBfceuqgVPvmxHsYqE';
const OWNER_NAME = 'Kemo King';
// ====================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let whatsappClient = null;
let isConnected = false;
let connectedUsers = new Set();
let waitingForPhone = new Map(); // chatId => userId

// ===================== ملف الترحيب =====================
function getWelcomeFile() {
  const extensions = ['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.avi'];
  for (const ext of extensions) {
    const filePath = path.join(__dirname, `welcome${ext}`);
    if (fs.existsSync(filePath)) return { path: filePath, ext };
  }
  return null;
}

// ===================== /start =====================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const welcomeText = `
👑 *أهلاً وسهلاً بيك!*

🤖 أنا بوت ربط الواتساب بالتيليجرام
📋 اكتب /menu عشان تشوف الأوامر

━━━━━━━━━━━━━━━
👤 *Owner:* ${OWNER_NAME}
━━━━━━━━━━━━━━━
`;

  try {
    const welcomeFile = getWelcomeFile();
    if (welcomeFile) {
      const isVideo = ['.mp4', '.mov', '.avi'].includes(welcomeFile.ext);
      if (isVideo) {
        await bot.sendVideo(chatId, welcomeFile.path, { caption: welcomeText, parse_mode: 'Markdown' });
      } else {
        await bot.sendPhoto(chatId, welcomeFile.path, { caption: welcomeText, parse_mode: 'Markdown' });
      }
    } else {
      await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error('Error in /start:', err.message);
  }
});

// ===================== /menu =====================
bot.onText(/\/menu/, async (msg) => {
  const chatId = msg.chat.id;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🟢 Connect - اتصال', callback_data: 'connect' }],
      [{ text: '🔴 Disconnect - قطع الاتصال', callback_data: 'disconnect' }]
    ]
  };

  await bot.sendMessage(chatId, `
📋 *القائمة الرئيسية*

اختار من الأزرار اللي تحت:

━━━━━━━━━━━━━━━
👤 *Owner:* ${OWNER_NAME}
━━━━━━━━━━━━━━━
`, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

// ===================== الأزرار =====================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await bot.answerCallbackQuery(query.id);

  // ---- Connect ----
  if (query.data === 'connect') {
    if (isConnected) {
      await bot.sendMessage(chatId, '⚠️ *الواتساب متصل بالفعل!*\nاضغط Disconnect الأول.', { parse_mode: 'Markdown' });
      return;
    }

    await bot.sendMessage(chatId, `
📱 *ادخل رقم واتساب بتاعك:*

اكتب الرقم مع كود الدولة بدون + أو مسافات

مثال: \`201012345678\`
`, { parse_mode: 'Markdown' });

    waitingForPhone.set(chatId, userId);
  }

  // ---- Disconnect ----
  if (query.data === 'disconnect') {
    if (whatsappClient && isConnected) {
      await whatsappClient.destroy();
      whatsappClient = null;
      isConnected = false;
      connectedUsers.delete(userId);
      waitingForPhone.delete(chatId);
      await bot.sendMessage(chatId, '🔴 *تم قطع الاتصال بالواتساب.*', { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, 'ℹ️ الواتساب مش متصل أصلاً.', { parse_mode: 'Markdown' });
    }
  }
});

// ===================== استقبال رقم الهاتف =====================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;
  if (!waitingForPhone.has(chatId)) return;

  const userId = waitingForPhone.get(chatId);
  waitingForPhone.delete(chatId);

  const phone = text.trim().replace(/[^0-9]/g, '');
  if (phone.length < 10) {
    await bot.sendMessage(chatId, '❌ *رقم غلط!* ادخل الرقم صح مع كود الدولة.\n\nمثال: `201012345678`', { parse_mode: 'Markdown' });
    return;
  }

  await bot.sendMessage(chatId, '⏳ *جاري إرسال طلب الربط لسيرفرات واتساب...*', { parse_mode: 'Markdown' });
  await startWhatsApp(chatId, userId, phone);
});

// ===================== تشغيل WhatsApp =====================
async function startWhatsApp(chatId, userId, phoneNumber) {
  try {
    whatsappClient = new Client({
      authStrategy: new LocalAuth({ clientId: `user_${userId}` }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      }
    });

    // أول ما يجي QR نطلب Pairing Code بدله
    whatsappClient.on('qr', async () => {
      try {
        // طلب كود الربط من سيرفرات واتساب
        const code = await whatsappClient.requestPairingCode(phoneNumber);

        // بعت الكود مع زرار نسخ
        await bot.sendMessage(chatId, `
🔗 *تم إرسال الطلب لواتساب بنجاح!*

📋 *كود الربط بتاعك:*
\`${code}\`

━━━━━━━━━━━━━━━
📱 *طريقة الاستخدام:*
1️⃣ افتح واتساب على تليفونك
2️⃣ الإعدادات ← الأجهزة المرتبطة
3️⃣ ربط جهاز ← ربط برقم الهاتف
4️⃣ ادخل الكود اللي فوق
━━━━━━━━━━━━━━━
⏰ _الكود صالح لمدة دقيقتين فقط_
`, { parse_mode: 'Markdown' });

      } catch (err) {
        console.error('Pairing code error:', err.message);
        await bot.sendMessage(chatId, `❌ *فشل طلب الكود:* ${err.message}\n\nجرب تاني من /menu`, { parse_mode: 'Markdown' });
      }
    });

    // لما يتصل بنجاح
    whatsappClient.on('ready', async () => {
      isConnected = true;
      connectedUsers.add(userId);
      console.log('✅ WhatsApp Connected!');

      await bot.sendMessage(chatId, '✅ *تم الاتصال بالواتساب بنجاح!*\n\nدلوقتي أي رسالة في مجموعاتك هتوصلك هنا.', { parse_mode: 'Markdown' });

      // جلب كل الجروبات
      try {
        const chats = await whatsappClient.getChats();
        const groups = chats.filter(c => c.isGroup);

        if (groups.length === 0) {
          await bot.sendMessage(chatId, 'ℹ️ مفيش مجموعات في الواتساب ده.', { parse_mode: 'Markdown' });
          return;
        }

        let groupsList = `📋 *مجموعاتك على الواتساب (${groups.length} جروب):*\n\n`;
        groups.forEach((g, i) => {
          groupsList += `${i + 1}. 👥 *${g.name}*\n   🆔 \`${g.id._serialized}\`\n\n`;
        });

        // لو الرسالة كبيرة، قسمها
        const chunks = groupsList.match(/[\s\S]{1,4000}/g) || [];
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        }

      } catch (err) {
        console.error('Error fetching groups:', err.message);
      }
    });

    // لما تيجي رسالة في جروب
    whatsappClient.on('message', async (message) => {
      try {
        const chat = await message.getChat();
        if (!chat.isGroup) return;

        const groupName = chat.name;
        const groupId = chat.id._serialized;

        for (const uid of connectedUsers) {
          await bot.sendMessage(uid, `
📨 *رسالة جديدة في جروب*

👥 *اسم الجروب:* ${groupName}
🆔 *الأيدي:* \`${groupId}\`

━━━━━━━━━━━━━━━
✅ _تم سحبه عن طريق Kemo_
`, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error('Message error:', err.message);
      }
    });

    // لو انقطع
    whatsappClient.on('disconnected', async (reason) => {
      isConnected = false;
      console.log('WhatsApp Disconnected:', reason);
      for (const uid of connectedUsers) {
        await bot.sendMessage(uid, `⚠️ *انقطع اتصال الواتساب*\nالسبب: ${reason}\n\nاضغط /menu عشان تتصل تاني.`, { parse_mode: 'Markdown' });
      }
      connectedUsers.clear();
      whatsappClient = null;
      isConnected = false;
    });

    await whatsappClient.initialize();

  } catch (err) {
    console.error('WhatsApp init error:', err.message);
    await bot.sendMessage(chatId, `❌ *حصل خطأ:* ${err.message}`, { parse_mode: 'Markdown' });
  }
}

// ===================== تشغيل البوت =====================
console.log('🤖 Bot is running...');
console.log(`👤 Owner: ${OWNER_NAME}`);
