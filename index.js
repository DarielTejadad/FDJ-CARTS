// ========================================
// IMPORTACIONES Y CONFIGURACIÓN INICIAL
// ========================================
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
require('dotenv').config();

// --- CONFIGURACIÓN DEL BOT ---
const config = {
    bot: {
        name: 'FDJ Cards',
        version: '3.0.0',
        colors: {
            primary: 0x5865F2, success: 0x2ECC71, warning: 0xF39C12, error: 0xE74C3C, info: 0x3498DB
        },
        rarity: {
            'Común': { emoji: '⚪', color: 0x95A5A6, sellPrice: 10, enchantCost: 50 },
            'Raro': { emoji: '🔵', color: 0x3498DB, sellPrice: 25, enchantCost: 100 },
            'Épico': { emoji: '🟣', color: 0x9B59B6, sellPrice: 50, enchantCost: 200 },
            'Legendario': { emoji: '🟡', color: 0xF1C40F, sellPrice: 100, enchantCost: 500 }
        }
    },
    channels: {
        admin: process.env.ADMIN_CHANNEL_ID || '1438587692097998878',
        game: process.env.GAME_CHANNEL_ID || '1438587851154653374',
        announcements: process.env.ANNOUNCEMENTS_CHANNEL_ID
    },
    economy: {
        startingMoney: 100, dailyReward: 50, maxGiftAmount: 1000, maxDuelBet: 500,
        loanInterest: 1.1, workReward: 25, workCooldown: 3600000
    },
    cooldowns: {
        default: 5000, daily: 86400000, work: 3600000
    },
    events: {
        doubleDrops: false, doubleDaily: false, legendaryDrops: false, doubleMoney: false
    }
};

// --- IDs DE CANALES ---
const ADMIN_CHANNEL_ID = config.channels.admin;
const GAME_CHANNEL_ID = config.channels.game;

// ========================================
// SISTEMA DE LOGGING
// ========================================
const logger = {
    info: (message) => console.log(`[INFO] ${new Date().toISOString()}: ${message}`),
    warn: (message) => console.warn(`[WARN] ${new Date().toISOString()}: ${message}`),
    error: (message) => console.error(`[ERROR] ${new Date().toISOString()}: ${message}`),
    debug: (message) => console.log(`[DEBUG] ${new Date().toISOString()}: ${message}`)
};

// ========================================
// SISTEMA DE CACHÉ
// ========================================
class Cache {
    constructor(defaultTTL = 600) { this.cache = new Map(); this.timers = new Map(); this.defaultTTL = defaultTTL * 1000; }
    set(key, value, ttl = this.defaultTTL) { if (this.timers.has(key)) clearTimeout(this.timers.get(key)); this.cache.set(key, value); if (ttl > 0) { const timer = setTimeout(() => { this.cache.delete(key); this.timers.delete(key); }, ttl); this.timers.set(key, timer); } }
    get(key) { return this.cache.get(key); }
    has(key) { return this.cache.has(key); }
    delete(key) { if (this.timers.has(key)) { clearTimeout(this.timers.get(key)); this.timers.delete(key); } return this.cache.delete(key); }
    clear() { this.cache.clear(); this.timers.forEach(timer => clearTimeout(timer)); this.timers.clear(); }
}
const userCache = new Cache(600);
const cardCache = new Cache(3600);
const shopCache = new Cache(1800);
const achievementCache = new Cache(7200);

// ========================================
// SISTEMA DE COOLDOWNS
// ========================================
const cooldowns = new Map();
function checkCooldown(userId, commandName, cooldownTime) {
    const key = `${userId}-${commandName}`; const now = Date.now(); const expirationTime = cooldowns.get(key) + cooldownTime;
    if (now < expirationTime) { const timeLeft = (expirationTime - now) / 1000; return Math.ceil(timeLeft); }
    cooldowns.set(key, now); return null;
}

// ========================================
// CONEXIÓN Y PREPARACIÓN DE LA BASE DE DATOS (SQLite)
// ========================================
const db = new sqlite3.Database('./database.sqlite', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) { logger.error('Error al conectar con la base de datos SQLite:', err.message); } else { logger.info('Conectado exitosamente a la base de datos SQLite.'); initializeDatabase(); }
});

function initializeDatabase() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, money INTEGER NOT NULL DEFAULT ${config.economy.startingMoney}, last_daily TEXT, duels_won INTEGER DEFAULT 0, duels_lost INTEGER DEFAULT 0, multiplier INTEGER DEFAULT 1, work_count INTEGER DEFAULT 0, banned INTEGER DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, rarity TEXT NOT NULL CHECK(rarity IN ('Común', 'Raro', 'Épico', 'Legendario')), description TEXT, image_url TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, attack INTEGER DEFAULT 10, defense INTEGER DEFAULT 10)`,
        `CREATE TABLE IF NOT EXISTS user_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, card_id INTEGER NOT NULL, is_favorite INTEGER DEFAULT 0, enchant_level INTEGER DEFAULT 0, FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (card_id) REFERENCES cards(id))`,
        `CREATE TABLE IF NOT EXISTS card_drops (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, claimed_by TEXT DEFAULT NULL, claimed_at INTEGER DEFAULT NULL, FOREIGN KEY (card_id) REFERENCES cards(id))`,
        `CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, type TEXT, amount INTEGER, reason TEXT, timestamp INTEGER DEFAULT (strftime('%s', 'now')))`,
        // --- TABLAS CORREGIDAS ---
        `CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, initiator_id TEXT NOT NULL, recipient_id TEXT NOT NULL, initiator_card_id INTEGER, recipient_card_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS packs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, price INTEGER NOT NULL, description TEXT, common_chance INTEGER DEFAULT 60, rare_chance INTEGER DEFAULT 30, epic_chance INTEGER DEFAULT 9, legendary_chance INTEGER DEFAULT 1, cards_count INTEGER DEFAULT 3)`,
        `CREATE TABLE IF NOT EXISTS pack_contents (pack_id INTEGER, card_id INTEGER, FOREIGN KEY (pack_id) REFERENCES packs(id), FOREIGN KEY (card_id) REFERENCES cards(id))`,
        // --- NUEVAS TABLAS ---
        `CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, bio TEXT, banner_url TEXT, favorite_card_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (favorite_card_id) REFERENCES cards(id))`,
        `CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT, reward_money INTEGER, reward_item TEXT, condition_type TEXT, condition_value INTEGER)`,
        `CREATE TABLE IF NOT EXISTS user_achievements (user_id TEXT, achievement_id INTEGER, unlocked_at INTEGER DEFAULT (strftime('%s', 'now')), PRIMARY KEY (user_id, achievement_id), FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (achievement_id) REFERENCES achievements(id))`,
        `CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, amount INTEGER, interest_rate REAL, due_date INTEGER, is_paid INTEGER DEFAULT 0, FOREIGN KEY (user_id) REFERENCES users(user_id))`,
        `CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, amount INTEGER, predicted_rarity, result TEXT, timestamp INTEGER DEFAULT (strftime('%s', 'now')), FOREIGN KEY (user_id) REFERENCES users(user_id))`
    ];
    
    let tablesCreated = 0;
    tables.forEach(sql => {
        db.run(sql, (err) => {
            if (err) {
                logger.error(`Error al crear tabla: ${err.message}`);
            } else {
                tablesCreated++;
                if (tablesCreated === tables.length) {
                    logger.info('Todas las tablas han sido verificadas/creadas.');
                    populateAchievements();
                }
            }
        });
    });
}

function populateAchievements() {
    // CORRECCIÓN: Usar db.all en lugar de db.get
    db.all('SELECT * FROM achievements', [], (err, rows) => {
        if (err) {
            return logger.error('Error al verificar logros existentes:', err.message);
        }
        if (!rows || rows.length === 0) {
            const achievementsToInsert = [
                ['Primera Carta', 'Reclama tu primera carta en un drop.', 50, null, 'claim', 1],
                ['Coleccionista Novato', 'Posee 10 cartas diferentes.', 200, null, 'inventory', 10],
                ['Duelista Iniciado', 'Gana tu primer duelo.', 100, null, 'duel_won', 1],
                ['Millonario', 'Alcanza 1000 monedas.', 500, null, 'money', 1000],
                ['Trabajador', 'Usa el comando /work 10 veces.', 300, null, 'work', 10],
                ['Encantador', 'Encanta una carta por primera vez.', 150, null, 'enchant', 1]
            ];
            const stmt = db.prepare('INSERT INTO achievements (name, description, reward_money, condition_type, condition_value) VALUES (?, ?, ?, ?, ?)');
            achievementsToInsert.forEach(a => stmt.run(a));
            stmt.finalize();
            logger.info('Logros precargados.');
        } else {
            logger.info(`${rows.length} logros ya existen en la base de datos.`);
        }
    });
}

// ========================================
// FUNCIONES AUXILIARES
// ========================================
function ensureUserExists(userId, username) {
    return new Promise((resolve, reject) => {
        if (userCache.has(userId)) return resolve();
        db.get('SELECT user_id FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err);
            if (row) { userCache.set(userId, row); return resolve(); }
            db.run('INSERT INTO users (user_id, username) VALUES (?, ?)', [userId, username], (err) => {
                if (err) return reject(err);
                logger.info(`Nuevo usuario registrado: ${username} (${userId})`);
                userCache.set(userId, { user_id: userId, username: username });
                resolve();
            });
        });
    });
}

// ... (El resto de las funciones auxiliares como getUserData, updateUserData, etc., permanecen igual)
// Para mantener la respuesta manejable, no las repito aquí, pero son las mismas que en la versión anterior.

// ========================================
// SISTEMA DE EMBEDS CON BRANDING
// ========================================
function createEmbed(options = {}) {
    const { title, description, color = config.bot.colors.primary, thumbnail, image, fields, footer, author } = options;
    const embed = new EmbedBuilder().setColor(color).setTimestamp();
    if (title) embed.setTitle(title); if (description) embed.setDescription(description);
    if (thumbnail) embed.setThumbnail(thumbnail); if (image) embed.setImage(image);
    if (fields) embed.addFields(fields);
    if (footer) embed.setFooter({ text: footer, iconURL: `https://i.imgur.com/pBFAaJ3.png` });
    else embed.setFooter({ text: `${config.bot.name} v${config.bot.version} | ¡El mejor bot de cartas!`, iconURL: `https://i.imgur.com/pBFAaJ3.png` });
    if (author) embed.setAuthor(author);
    return embed;
}

// ========================================
// INICIALIZACIÓN DEL CLIENTE DE DISCORD
// ========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ========================================
// CARGADOR DE COMANDOS
// ========================================
const commands = new Map();
function registerCommand(command) { commands.set(command.data.name, command); logger.info(`Comando registrado: ${command.data.name}`); }

// ========================================
// DEFINICIÓN DE COMANDOS (EXPANDIDO)
// ========================================

// ... (Aquí irían todos los comandos que ya definimos: profileCommand, setbioCommand, etc.)
// Para mantener el ejemplo manejable, no los repito aquí, pero son los mismos.

// --- REGISTRO DE TODOS LOS COMANDOS ---
// registerCommand(profileCommand); registerCommand(setbioCommand); ...
// ... (Registrar todos los comandos aquí)

// ========================================
// EVENTOS DEL BOT
// ========================================
client.once('ready', async () => {
    logger.info(`Bot conectado como ${client.user.tag}!`);
    // La precarga de cartas y logros ahora se maneja en la inicialización de la DB
    const commandData = Array.from(commands.values()).map(cmd => cmd.data);
    await client.application.commands.set(commandData);
    logger.info('Comandos slash registrados globalmente.');
});

client.on('interactionCreate', async interaction => {
    // ... (La lógica de interacción permanece igual)
});

// ========================================
// INICIO DE SESIÓN DEL BOT
// ========================================
client.login(process.env.DISCORD_TOKEN).catch(err => { logger.error('Error al iniciar sesión: Asegúrate de que DISCORD_TOKEN está configurado correctamente.'); logger.error(err); });
