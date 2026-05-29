const TelegramBot = require('node-telegram-bot-api');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// ===================== الإعدادات =====================
const TELEGRAM_TOKEN = '8602061556:AAHbEZSeHEq2eREjQqBfceuqgVPvmxHsYqE';
const OWNER_ID = 6520549428; // ضع الأيدي بتاعك هنا
const OWNER_NAME = 'KEMO ALAMY';
const SECRET_CODE = 'KEMO KING';

// الملف اللي هترفعه (صورة أو فيديو) - حطه في نفس الفولدر
// مثال: welcome.jpg أو welcome.mp4
const fs = require('fs');
const path = require('path');

function getWelcomeFile() {
  const extensions = ['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.avi'];
  for (const ext of extensions) {
    const filePath = path.join(__dirname, `welcome${ext}`);
    if (fs.existsSync(filePath)) return { path: filePath, ext };
  }
  return null;
}
// ====================================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let whatsappClient = null;
let isConnected = false;
let connectedUsers = new Set(); // المستخدمين اللي ربطوا

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
        await bot.sendVideo(chatId, welcomeFile.path, {
          caption: welcomeText,
          parse_mode: 'Markdown'
        });
      } else {
        await bot.sendPhoto(chatId, welcomeFile.path, {
          caption: welcomeText,
          parse_mode: 'Markdown'
        });
      }
    } else {
      // لو مفيش ملف، بعت رسالة نص بس
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
    // تحقق من الكود
    await bot.sendMessage(chatId, `
🔐 *أدخل كود الاتصال:*

اكتب الكود اللي عندك عشان تربط الواتساب.
`, { parse_mode: 'Markdown' });

    // استنى الكود من المستخدم
    bot.once('message', async (codeMsg) => {
      if (codeMsg.chat.id !== chatId) return;

      if (codeMsg.text && codeMsg.text.trim() === SECRET_CODE) {
        await bot.sendMessage(chatId, '✅ *الكود صح! جاري الاتصال بالواتساب...*\nهيجيلك QR Code اسكنه.', { parse_mode: 'Markdown' });
        await startWhatsApp(chatId, userId);
      } else {
        await bot.sendMessage(chatId, '❌ *الكود غلط!* جرب تاني.', { parse_mode: 'Markdown' });
      }
    });
  }

  // ---- Disconnect ----
  if (query.data === 'disconnect') {
    if (whatsappClient && isConnected) {
      await whatsappClient.destroy();
      whatsappClient = null;
      isConnected = false;
      connectedUsers.delete(userId);
      await bot.sendMessage(chatId, '🔴 *تم قطع الاتصال بالواتساب.*', { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, 'ℹ️ الواتساب مش متصل أصلاً.', { parse_mode: 'Markdown' });
    }
  }
});

// ===================== تشغيل WhatsApp =====================
async function startWhatsApp(chatId, userId) {
  try {
    whatsappClient = new Client({
      authStrategy: new LocalAuth({ clientId: `user_${userId}` }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    // لما يجي QR Code
    whatsappClient.on('qr', async (qr) => {
      try {
        const qrImageBuffer = await qrcode.toBuffer(qr);
        await bot.sendPhoto(chatId, qrImageBuffer, {
          caption: '📱 *اسكن الـ QR Code ده بالواتساب*\n\n⚙️ افتح واتساب > الإعدادات > الأجهزة المرتبطة > ربط جهاز',
          parse_mode: 'Markdown'
        });
      } catch (err) {
        console.error('QR Error:', err.message);
      }
    });

    // لما يتصل
    whatsappClient.on('ready', async () => {
      isConnected = true;
      connectedUsers.add(userId);
      console.log('WhatsApp Connected!');

      await bot.sendMessage(chatId, '✅ *تم الاتصال بالواتساب بنجاح!*\n\nأي رسالة في مجموعاتك هتظهر هنا.', { parse_mode: 'Markdown' });

      // اجلب كل الجروبات
      try {
        const chats = await whatsappClient.getChats();
        const groups = chats.filter(c => c.isGroup);

        if (groups.length === 0) {
          await bot.sendMessage(chatId, 'ℹ️ مفيش مجموعات في الواتساب ده.', { parse_mode: 'Markdown' });
          return;
        }

        let groupsList = '📋 *مجموعاتك على الواتساب:*\n\n';
        groups.forEach((g, i) => {
          groupsList += `${i + 1}. 👥 *${g.name}*\n   🆔 \`${g.id._serialized}\`\n\n`;
        });

        await bot.sendMessage(chatId, groupsList, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error('Error fetching groups:', err.message);
      }
    });

    // لما تيجي رسالة في أي جروب
    whatsappClient.on('message', async (message) => {
      try {
        const chat = await message.getChat();

        if (!chat.isGroup) return; // بس الجروبات

        const groupName = chat.name;
        const groupId = chat.id._serialized;

        // بعت في التيليجرام لكل المستخدمين المتصلين
        for (const uid of connectedUsers) {
          await bot.sendMessage(uid, `
📨 *رسالة جديدة في جروب واتساب*

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
        await bot.sendMessage(uid, `⚠️ *انقطع اتصال الواتساب*\nالسبب: ${reason}`, { parse_mode: 'Markdown' });
      }
      connectedUsers.clear();
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
