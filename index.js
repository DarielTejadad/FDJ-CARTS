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
        colors: { primary: 0x5865F2, success: 0x2ECC71, warning: 0xF39C12, error: 0xE74C3C, info: 0x3498DB },
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
    economy: { startingMoney: 100, dailyReward: 50, maxGiftAmount: 1000, maxDuelBet: 500, loanInterest: 1.1, workReward: 25, workCooldown: 3600000 },
    cooldowns: { default: 5000, daily: 86400000, work: 3600000 },
    events: { doubleDrops: false, doubleDaily: false, legendaryDrops: false, doubleMoney: false }
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
        `CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, initiator_id TEXT NOT NULL, recipient_id TEXT NOT NULL, initiator_card_id INTEGER, recipient_card_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS packs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, price INTEGER NOT NULL, description TEXT, common_chance INTEGER DEFAULT 60, rare_chance INTEGER DEFAULT 30, epic_chance INTEGER DEFAULT 9, legendary_chance INTEGER DEFAULT 1, cards_count INTEGER DEFAULT 3)`,
        `CREATE TABLE IF NOT EXISTS pack_contents (pack_id INTEGER, card_id INTEGER, FOREIGN KEY (pack_id) REFERENCES packs(id), FOREIGN KEY (card_id) REFERENCES cards(id))`,
        `CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, bio TEXT, banner_url TEXT, favorite_card_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (favorite_card_id) REFERENCES cards(id))`,
        `CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT, reward_money INTEGER, reward_item TEXT, condition_type TEXT, condition_value INTEGER)`,
        `CREATE TABLE IF NOT EXISTS user_achievements (user_id TEXT, achievement_id INTEGER, unlocked_at INTEGER DEFAULT (strftime('%s', 'now')), PRIMARY KEY (user_id, achievement_id), FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (achievement_id) REFERENCES achievements(id))`,
        `CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, amount INTEGER, interest_rate REAL, due_date INTEGER, is_paid INTEGER DEFAULT 0, FOREIGN KEY (user_id) REFERENCES users(user_id))`,
        `CREATE TABLE IF NOT EXISTS bets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, amount INTEGER, predicted_rarity, result TEXT, timestamp INTEGER DEFAULT (strftime('%s', 'now')), FOREIGN KEY (user_id) REFERENCES users(user_id))`
    ];
    let tablesCreated = 0;
    tables.forEach(sql => {
        db.run(sql, (err) => {
            if (err) { logger.error(`Error al crear tabla: ${err.message}`); }
            else {
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
    db.all('SELECT * FROM achievements', [], (err, rows) => {
        if (err) { logger.error('Error al verificar logros existentes:', err.message); return; }
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
            achievementsToInsert.forEach(a => stmt.run(a, (err) => { if (err) logger.error(`Error al insertar logro: ${err.message}`); }));
            stmt.finalize();
            logger.info('Logros precargados.');
        } else {
            logger.info(`${rows.length} logros ya existen en la base de datos.`);
        }
    });
}

// ========================================
// FUNCIONES AUXILIARES (COMPLETAS Y CORREGIDAS)
// ========================================
function ensureUserExists(userId, username) {
    return new Promise((resolve, reject) => {
        if (userCache.has(userId)) return resolve();
        db.get('SELECT user_id FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) { logger.error(`Error en ensureUserExists: ${err.message}`); return reject(err); }
            if (row) { userCache.set(userId, row); return resolve(); }
            db.run('INSERT INTO users (user_id, username) VALUES (?, ?)', [userId, username], (err) => {
                if (err) { logger.error(`Error en ensureUserExists (INSERT): ${err.message}`); return reject(err); }
                logger.info(`Nuevo usuario registrado: ${username} (${userId})`);
                userCache.set(userId, { user_id: userId, username: username });
                resolve();
            });
        });
    });
}

function getUserData(userId) {
    return new Promise((resolve, reject) => {
        if (userCache.has(userId)) return resolve(userCache.get(userId));
        db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) { logger.error(`Error en getUserData: ${err.message}`); return reject(err); }
            if (row) userCache.set(userId, row);
            resolve(row);
        });
    });
}

function updateUserData(userId, fields) {
    return new Promise((resolve, reject) => {
        const setClause = Object.keys(fields).map(key => `${key} = ?`).join(', ');
        const values = Object.values(fields); values.push(userId);
        const sql = `UPDATE users SET ${setClause} WHERE user_id = ?`;
        db.run(sql, values, function(err) {
            if (err) { logger.error(`Error en updateUserData: ${err.message}`); return reject(err); }
            if (userCache.has(userId)) {
                const userData = userCache.get(userId);
                Object.assign(userData, fields);
                userCache.set(userId, userData);
            }
            resolve();
        });
    });
}

function getCardData(cardId) {
    return new Promise((resolve, reject) => {
        if (cardCache.has(cardId)) return resolve(cardCache.get(cardId));
        db.get('SELECT * FROM cards WHERE id = ?', [cardId], (err, row) => {
            if (err) { logger.error(`Error en getCardData: ${err.message}`); return reject(err); }
            if (row) cardCache.set(cardId, row);
            resolve(row);
        });
    });
}

function getAllCards() {
    return new Promise((resolve, reject) => {
        if (cardCache.size > 0) return resolve(Array.from(cardCache.values()));
        db.all('SELECT * FROM cards', [], (err, rows) => {
            if (err) { logger.error(`Error en getAllCards: ${err.message}`); return reject(err); }
            rows.forEach(card => cardCache.set(card.id, card));
            resolve(rows);
        });
    });
}

function getShopCards() {
    return new Promise((resolve, reject) => {
        if (shopCache.has('cards')) return resolve(shopCache.get('cards'));
        db.all('SELECT * FROM cards WHERE price > 0 ORDER BY price ASC, rarity DESC', [], (err, rows) => {
            if (err) { logger.error(`Error en getShopCards: ${err.message}`); return reject(err); }
            shopCache.set('cards', rows);
            resolve(rows);
        });
    });
}

function addTransaction(userId, type, amount, reason) {
    return new Promise((resolve, reject) => {
        const sql = 'INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, ?, ?, ?)';
        db.run(sql, [userId, type, amount, reason], function(err) {
            if (err) { logger.error(`Error en addTransaction: ${err.message}`); return reject(err); }
            resolve(this.lastID);
        });
    });
}

function getRarityData(rarity) {
    return config.bot.rarity[rarity] || { emoji: '❓', color: 0x000000, sellPrice: 5, enchantCost: 100 };
}

function checkAchievements(userId, conditionType, currentValue) {
    const sql = 'SELECT * FROM achievements WHERE condition_type = ? AND condition_value <= ?';
    db.all(sql, [conditionType, currentValue], (err, achievements) => {
        if (err) { logger.error(`Error en checkAchievements (SELECT): ${err.message}`); return; }
        achievements.forEach(achievement => {
            const sqlCheck = 'SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ?';
            db.get(sqlCheck, [userId, achievement.id], (err, row) => {
                if (err) { logger.error(`Error en checkAchievements (CHECK): ${err.message}`); return; }
                if (!row) {
                    const sqlUnlock = 'INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)';
                    db.run(sqlUnlock, [userId, achievement.id]);
                    const sqlReward = 'UPDATE users SET money = money + ? WHERE user_id = ?';
                    db.run(sqlReward, [achievement.reward_money, userId]);
                    userCache.delete(userId);
                    logger.info(`Logro desbloqueado para ${userId}: ${achievement.name}`);
                }
            });
        });
    });
}

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
// DEFINICIÓN DE COMANDOS (COMPLETOS)
// ========================================
// COMANDOS DE USUARIO "WOW"
const profileCommand = {
    data: new SlashCommandBuilder().setName('profile').setDescription('Muestra tu perfil de jugador personalizado').addUserOption(o => o.setName('usuario').setDescription('Ver el perfil de otro usuario').setRequired(false)),
    cooldown: 10000, category: 'social',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        const userData = await getUserData(targetUser.id);
        const invStmt = db.prepare('SELECT COUNT(*) as total_cards FROM user_inventory WHERE user_id = ?');
        invStmt.get([targetUser.id], async (err, invData) => {
            if (err) { logger.error(`Error en profileCommand (inv): ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al cargar el inventario.', color: config.bot.colors.error })], ephemeral: true }); }
            const totalDuels = userData.duels_won + userData.duels_lost; const winRate = totalDuels > 0 ? ((userData.duels_won / totalDuels) * 100).toFixed(1) : 0;
            const profileStmt = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?');
            profileStmt.get([targetUser.id], (err, profile) => {
                const profileEmbed = createEmbed({
                    title: `📜 Perfil de ${targetUser.username}`, description: profile?.bio || `*Este usuario no ha establecido una biografía aún.*`,
                    color: config.bot.colors.info, thumbnail: targetUser.displayAvatarURL(), image: profile?.banner_url || null,
                    fields: [
                        { name: '💰 Dinero', value: `${userData.money} monedas`, inline: true },
                        { name: '📦 Cartas Totales', value: `${invData.total_cards}`, inline: true },
                        { name: '⚔️ Duelos', value: `Ganados: ${userData.duels_won} | Perdidos: ${userData.duels_lost}`, inline: false },
                        { name: '📈 Tasa de Victoria', value: `${winRate}%`, inline: true },
                        { name: '🛠️ Trabajos Realizados', value: `${userData.work_count}`, inline: true }
                    ]
                });
                interaction.reply({ embeds: [profileEmbed] });
            });
            profileStmt.finalize();
        });
        invStmt.finalize();
    }
};

const setbioCommand = {
    data: new SlashCommandBuilder().setName('setbio').setDescription('Establece la biografía de tu perfil').addStringOption(o => o.setName('texto').setDescription('Tu nueva biografía').setRequired(true)),
    cooldown: 30000, category: 'social',
    async execute(interaction, client) {
        const bio = interaction.options.getString('texto');
        if (bio.length > 200) return interaction.reply({ embeds: [createEmbed({ description: '❌ La biografía no puede exceder los 200 caracteres.', color: config.bot.colors.error })], ephemeral: true });
        const sql = 'INSERT OR REPLACE INTO user_profiles (user_id, bio) VALUES (?, ?)';
        db.run(sql, [interaction.user.id, bio], (err) => {
            if (err) { logger.error(`Error en setbioCommand: ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al guardar tu biografía.', color: config.bot.colors.error })], ephemeral: true }); }
            interaction.reply({ embeds: [createEmbed({ description: '✅ Tu biografía ha sido actualizada.', color: config.bot.colors.success })] });
        });
    }
};

const achievementsCommand = {
    data: new SlashCommandBuilder().setName('achievements').setDescription('Muestra tus logros desbloqueados y los pendientes'),
    cooldown: 15000, category: 'social',
    async execute(interaction, client) {
        const sql = `SELECT a.*, CASE WHEN ua.user_id IS NOT NULL THEN '✅' ELSE '🔒' END as status FROM achievements a LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?`;
        db.all(sql, [interaction.user.id], (err, rows) => {
            if (err) { logger.error(`Error en achievementsCommand: ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al cargar los logros.', color: config.bot.colors.error })], ephemeral: true }); }
            const unlocked = rows.filter(r => r.status === '✅'); const locked = rows.filter(r => r.status === '🔒');
            const embed = createEmbed({ title: '🏆 Tus Logros', description: `Has desbloqueado **${unlocked.length}** de **${rows.length}** logros.`, color: config.bot.colors.primary });
            if (unlocked.length > 0) embed.addFields({ name: '✅ Desbloqueados', value: unlocked.map(a => `**${a.name}** - ${a.description}`).join('\n') || 'Ninguno', inline: false });
            if (locked.length > 0) embed.addFields({ name: '🔒 Por Desbloquear', value: locked.map(a => `**${a.name}** - ${a.description}`).join('\n') || 'Ninguno', inline: false });
            interaction.reply({ embeds: [embed] });
        });
    }
};

const workCommand = {
    data: new SlashCommandBuilder().setName('work').setDescription('Trabaja para ganar monedas'),
    cooldown: config.cooldowns.work, category: 'economy',
    async execute(interaction, client) {
        const userData = await getUserData(interaction.user.id);
        const workReward = config.economy.workReward * userData.multiplier;
        await updateUserData(interaction.user.id, { money: userData.money + workReward, work_count: userData.work_count + 1 });
        await addTransaction(interaction.user.id, 'work', workReward, 'Recompensa de trabajo');
        checkAchievements(interaction.user.id, 'work', userData.work_count + 1);
        const workPhrases = ["Has trabajado como minero de cristales y encontrado gemas valiosas.", "Has hecho una entrega especial para el gremio de mercaderes.", "Has ayudado a reparar la muralla de la ciudad.", "Has forjado espadas para la guardia real."];
        const embed = createEmbed({ title: '💼 Trabajo Realizado', description: `${workPhrases[Math.floor(Math.random() * workPhrases.length)]}\nHas ganado **${workReward} monedas**.`, color: config.bot.colors.success });
        interaction.reply({ embeds: [embed] });
    }
};

const enchantCommand = {
    data: new SlashCommandBuilder().setName('enchant').setDescription('Mejora las estadísticas de una carta').addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta a encantar').setRequired(true)),
    cooldown: 30000, category: 'game',
    async execute(interaction, client) {
        const cardName = interaction.options.getString('nombre'); const userData = await getUserData(interaction.user.id);
        const sql = `SELECT ui.id, ui.enchant_level, c.* FROM user_inventory ui JOIN cards c ON ui.card_id = c.id WHERE ui.user_id = ? AND c.name = ?`;
        db.get(sql, [interaction.user.id, cardName], async (err, invCard) => {
            if (err) { logger.error(`Error en enchantCommand (SELECT): ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al buscar la carta.', color: config.bot.colors.error })], ephemeral: true }); }
            if (!invCard) return interaction.reply({ embeds: [createEmbed({ description: `❌ No tienes ninguna carta llamada "${cardName}".`, color: config.bot.colors.warning })], ephemeral: true });
            const rarityData = getRarityData(invCard.rarity); const cost = rarityData.enchantCost * (invCard.enchant_level + 1);
            if (userData.money < cost) return interaction.reply({ embeds: [createEmbed({ description: `❌ No tienes suficiente dinero. Necesitas ${cost} monedas para encantar esta carta.`, color: config.bot.colors.warning })], ephemeral: true });
            const newAttack = invCard.attack + 5; const newDefense = invCard.defense + 5;
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const updateMoneyStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?');
                updateMoneyStmt.run([cost, interaction.user.id]);
                const updateCardStmt = db.prepare('UPDATE user_inventory SET enchant_level = ?, attack = ?, defense = ? WHERE id = ?');
                updateCardStmt.run([invCard.enchant_level + 1, newAttack, newDefense, invCard.id]);
                db.run('COMMIT', (err) => {
                    if (err) { db.run('ROLLBACK'); logger.error(`Error en enchantCommand (TRANSACTION): ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al encantar la carta.', color: config.bot.colors.error })], ephemeral: true }); }
                    userCache.delete(interaction.user.id); checkAchievements(interaction.user.id, 'enchant', 1);
                    const embed = createEmbed({ title: '✨ Carta Encantada', description: `**${invCard.name}** ha sido encantada al nivel **${invCard.enchant_level + 1}**.\n\nNuevas estadísticas:\n⚔️ Ataque: ${newAttack}\n🛡️ Defensa: ${newDefense}`, thumbnail: invCard.image_url, color: rarityData.color });
                    interaction.reply({ embeds: [embed] });
                });
                updateMoneyStmt.finalize(); updateCardStmt.finalize();
            });
        });
    }
};

// COMANDOS DE ADMINISTRACIÓN AVANZADOS
const announceCommand = {
    data: new SlashCommandBuilder().setName('announce').setDescription('Envía un anuncio a un canal').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(o => o.setName('canal').setDescription('Canal donde enviar el anuncio').setRequired(true))
        .addStringOption(o => o.setName('titulo').setDescription('Título del anuncio').setRequired(true))
        .addStringOption(o => o.setName('descripcion').setDescription('Descripción del anuncio').setRequired(true)),
    cooldown: 10000, category: 'admin',
    async execute(interaction, client) {
        const channel = interaction.options.getChannel('canal'); const title = interaction.options.getString('titulo'); const description = interaction.options.getString('descripcion');
        const embed = createEmbed({ title: `📢 ${title}`, description: description, color: config.bot.colors.info });
        await channel.send({ embeds: [embed] });
        interaction.reply({ embeds: [createEmbed({ description: '✅ Anuncio enviado.', color: config.bot.colors.success })], ephemeral: true });
    }
};

const givecardCommand = {
    data: new SlashCommandBuilder().setName('givecard').setDescription('Da una carta a un usuario').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(o => o.setName('usuario').setDescription('Usuario que recibirá la carta').setRequired(true))
        .addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta a dar').setRequired(true)),
    cooldown: 5000, category: 'admin',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario'); const cardName = interaction.options.getString('nombre');
        const sql = 'SELECT * FROM cards WHERE name = ?';
        db.get(sql, [cardName], (err, card) => {
            if (err || !card) return interaction.reply({ embeds: [createEmbed({ description: '❌ Carta no encontrada.', color: config.bot.colors.error })], ephemeral: true });
            const sqlInsert = 'INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)';
            db.run(sqlInsert, [targetUser.id, card.id], (err) => {
                if (err) { logger.error(`Error en givecardCommand: ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al dar la carta.', color: config.bot.colors.error })], ephemeral: true }); }
                interaction.reply({ embeds: [createEmbed({ description: `✅ Le has dado **${cardName}** a **${targetUser.username}**.`, color: config.bot.colors.success })] });
            });
        });
    }
};

// COMANDOS DE CARTAS (BÁSICOS PERO NECESARIOS)
const dropCommand = {
    data: new SlashCommandBuilder().setName('drop').setDescription('Lanza una carta aleatoria al canal'),
    cooldown: 15000, category: 'cards',
    async execute(interaction, client) {
        await interaction.deferReply();
        const allCards = await getAllCards();
        if (allCards.length === 0) return interaction.editReply({ embeds: [createEmbed({ description: '❌ No hay cartas en el sistema. Pide a un admin que añada algunas.', color: config.bot.colors.error })] });
        const randomCard = allCards[Math.floor(Math.random() * allCards.length)]; const rarityData = getRarityData(randomCard.rarity);
        const dropEmbed = createEmbed({ author: { name: '🎉 ¡NUEVA CARTA EN DROP! 🎉', iconURL: client.user.displayAvatarURL() }, title: `**${randomCard.name}**`, description: randomCard.description, image: randomCard.image_url, color: rarityData.color, fields: [{ name: `🆔 Código de Colección`, value: `#${randomCard.id}`, inline: true }, { name: `⭐ Rareza`, value: `${rarityData.emoji} ${randomCard.rarity}`, inline: true }], footer: '¡Sé el primero en reclamarla con /claim!' });
        await interaction.editReply({ embeds: [dropEmbed] });
        const stmt = db.prepare('INSERT INTO card_drops (card_id) VALUES (?)');
        stmt.run([randomCard.id], (err) => { if(err) logger.error("Error al guardar drop en BD:", err); });
        stmt.finalize();
    }
};

const claimCommand = {
    data: new SlashCommandBuilder().setName('claim').setDescription('Reclama la carta que está en drop'),
    cooldown: 5000, category: 'cards',
    async execute(interaction, client) {
        const sql = `SELECT cd.*, c.name, c.rarity, c.description, c.image_url FROM card_drops cd JOIN cards c ON cd.card_id = c.id WHERE cd.claimed_by IS NULL LIMIT 1`;
        const stmt = db.prepare(sql);
        stmt.get([], async (err, drop) => {
            if (err) { logger.error(`Error en claimCommand (SELECT): ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al buscar el drop actual.', color: config.bot.colors.error })], ephemeral: true }); }
            if (!drop) return interaction.reply({ embeds: [createEmbed({ description: '❌ No hay ninguna carta para reclamar. ¡Usa `/drop` para lanzar una!', color: config.bot.colors.warning })], ephemeral: true });
            const updateStmt = db.prepare('UPDATE card_drops SET claimed_by = ?, claimed_at = ? WHERE id = ?');
            updateStmt.run([interaction.user.id, Date.now(), drop.id], function(err) {
                if (err) { logger.error(`Error en claimCommand (UPDATE): ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al reclamar la carta.', color: config.bot.colors.error })], ephemeral: true }); }
                const insertStmt = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                insertStmt.run([interaction.user.id, drop.card_id], (err) => {
                    if (err) { logger.error(`Error en claimCommand (INSERT): ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al añadir la carta a tu inventario.', color: config.bot.colors.error })], ephemeral: true }); }
                    const rarityData = getRarityData(drop.rarity);
                    const claimEmbed = createEmbed({ title: '🎊 ¡CARTA RECLAMADA! 🎊', description: `¡Felicidades **${interaction.user.username}**! Has conseguido la carta **${drop.name}**.`, thumbnail: drop.image_url, color: rarityData.color, fields: [{ name: 'Rareza', value: `${rarityData.emoji} ${drop.rarity}`, inline: true }, { name: 'Descripción', value: drop.description, inline: false }], footer: 'Añadida a tu inventario. Usa /inventory para verla.' });
                    interaction.reply({ embeds: [claimEmbed] });
                });
                insertStmt.finalize();
            });
            updateStmt.finalize();
        });
        stmt.finalize();
    }
};

const inventoryCommand = {
    data: new SlashCommandBuilder().setName('inventory').setDescription('Muestra tu inventario de cartas'),
    cooldown: 5000, category: 'cards',
    async execute(interaction, client) {
        const sql = `SELECT c.id, c.name, c.rarity, c.image_url, COUNT(c.id) as count FROM user_inventory ui JOIN cards c ON ui.card_id = c.id WHERE ui.user_id = ? GROUP BY c.id ORDER BY c.rarity DESC, c.name ASC`;
        const stmt = db.prepare(sql);
        stmt.all([interaction.user.id], (err, rows) => {
            if (err) { logger.error(`Error en inventoryCommand: ${err.message}`); return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al cargar tu inventario.', color: config.bot.colors.error })], ephemeral: true }); }
            if (rows.length === 0) return interaction.reply({ embeds: [createEmbed({ description: 'Tu inventario está vacío. ¡Usa `/claim` para conseguir cartas!', color: config.bot.colors.warning })], ephemeral: true });
            const inventoryEmbed = createEmbed({ title: `📦 Inventario de ${interaction.user.username}`, description: `Aquí están tus cartas (${rows.length} tipos distintos):`, color: config.bot.colors.success, thumbnail: interaction.user.displayAvatarURL() });
            rows.forEach(card => { const rarityData = getRarityData(card.rarity); inventoryEmbed.addFields({ name: `${rarityData.emoji} ${card.name} x${card.count}`, value: `ID: #${card.id}`, inline: true }); });
            interaction.reply({ embeds: [inventoryEmbed] });
        });
        stmt.finalize();
    }
};

const addcardCommand = {
    data: new SlashCommandBuilder().setName('addcard').setDescription('Añade una nueva carta al sistema (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta').setRequired(true))
        .addStringOption(o => o.setName('rareza').setDescription('Rareza').setRequired(true).setChoices({ name: 'Común', value: 'Común' }, { name: 'Raro', value: 'Raro' }, { name: 'Épico', value: 'Épico' }, { name: 'Legendario', value: 'Legendario' }))
        .addStringOption(o => o.setName('descripcion').setDescription('Descripción').setRequired(true))
        .addStringOption(o => o.setName('imagen').setDescription('URL de la imagen o GIF').setRequired(true)),
    cooldown: 5000, category: 'admin',
    async execute(interaction, client) {
        const name = interaction.options.getString('nombre'); const rarity = interaction.options.getString('rareza'); const description = interaction.options.getString('descripcion'); const image_url = interaction.options.getString('imagen');
        const price = getRarityData(rarity).sellPrice * 3; const attack = 10; const defense = 10;
        const sql = 'INSERT INTO cards (name, rarity, description, image_url, price, attack, defense) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const stmt = db.prepare(sql);
        stmt.run([name, rarity, description, image_url, price, attack, defense], function(err) {
            if (err) { if (err.message.includes('UNIQUE constraint failed')) { return interaction.reply({ embeds: [createEmbed({ description: `❌ Ya existe una carta llamada "${name}".`, color: config.bot.colors.error })], ephemeral: true }); } return interaction.reply({ embeds: [createEmbed({ description: '❌ Error al guardar la carta.', color: config.bot.colors.error })], ephemeral: true }); }
            cardCache.clear(); shopCache.clear();
            const rarityData = getRarityData(rarity);
            const embed = createEmbed({ title: '✅ Carta Añadida', description: `La carta **${name}** ha sido registrada.`, thumbnail: image_url, color: rarityData.color, fields: [{ name: 'Rareza', value: `${rarityData.emoji} ${rarity}`, inline: true }, { name: 'Precio', value: `💰 ${price}`, inline: true }, { name: 'Ataque / Defensa', value: `${attack} / ${defense}`, inline: true }, { name: 'Descripción', value: description, inline: false }] });
            interaction.reply({ embeds: [embed] });
        });
        stmt.finalize();
    }
};

// ... (Se pueden añadir más comandos aquí siguiendo la misma estructura)

// --- REGISTRO DE TODOS LOS COMANDOS ---
registerCommand(profileCommand); registerCommand(setbioCommand); registerCommand(achievementsCommand);
registerCommand(workCommand); registerCommand(enchantCommand);
registerCommand(announceCommand); registerCommand(givecardCommand);
registerCommand(dropCommand); registerCommand(claimCommand); registerCommand(inventoryCommand); registerCommand(addcardCommand);

// ========================================
// EVENTOS DEL BOT
// ========================================
client.once('ready', async () => {
    logger.info(`Bot conectado como ${client.user.tag}!`);
    try { await getAllCards(); } catch (err) { logger.error(`Fallo crítico al precargar cartas: ${err.message}`); return; }
    const commandData = Array.from(commands.values()).map(cmd => cmd.data);
    await client.application.commands.set(commandData);
    logger.info('Comandos slash registrados globalmente.');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const { commandName, user } = interaction;
    try { await ensureUserExists(user.id, user.username); } catch (error) { logger.error('Error al verificar usuario en BD:', error); return interaction.reply({ embeds: [createEmbed({ description: 'Ocurrió un error crítico al verificar tu usuario. Contacta a un admin.', color: config.bot.colors.error })], ephemeral: true }); }
    const command = commands.get(commandName); if (!command) return;
    const { category } = command; const isGameChannel = interaction.channelId === GAME_CHANNEL_ID; const isAdminChannel = interaction.channelId === ADMIN_CHANNEL_ID;
    if (category === 'admin' && !isAdminChannel) return interaction.reply({ embeds: [createEmbed({ description: `❌ Este comando solo puede usarse en el canal de administración.`, color: config.bot.colors.warning })], ephemeral: true });
    if ((category === 'cards' || category === 'economy' || category === 'social' || category === 'game') && !isGameChannel) return interaction.reply({ embeds: [createEmbed({ description: `❌ Este comando solo puede usarse en el canal de juego.`, color: config.bot.colors.warning })], ephemeral: true });
    const { cooldown } = command; if (cooldown) { const hasCooldown = checkCooldown(user.id, commandName, cooldown); if (hasCooldown) { return interaction.reply({ embeds: [createEmbed({ title: '¡Calma!', description: `Debes esperar ${hasCooldown} segundos para volver a usar este comando.`, color: config.bot.colors.warning })], ephemeral: true }); } }
    try { await command.execute(interaction, client); logger.info(`Comando ejecutado: /${commandName} por ${user.tag}`); }
    catch (error) { logger.error(`Error al ejecutar el comando /${commandName}:`, error); const errorMessage = interaction.replied || interaction.deferred ? 'Hubo un error al procesar tu comando.' : { embeds: [createEmbed({ title: 'Error', description: 'Hubo un error al procesar tu comando.', color: config.bot.colors.error })], ephemeral: true }; await interaction[interaction.replied || interaction.deferred ? 'editReply' : 'reply'](errorMessage); }
});

// ========================================
// INICIO DE SESIÓN DEL BOT
// ========================================
client.login(process.env.DISCORD_TOKEN).catch(err => { logger.error('Error al iniciar sesión: Asegúrate de que DISCORD_TOKEN está configurado correctamente.'); logger.error(err); });
