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
        version: '2.0.0',
        // Colores principales
        colors: {
            primary: 0x5865F2, // Discord Blurple
            success: 0x2ECC71, // Verde
            warning: 0xF39C12, // Naranja
            error: 0xE74C3C,   // Rojo
            info: 0x3498DB     // Azul
        },
        // Colores por rareza
        rarity: {
            'Común': { emoji: '⚪', color: 0x95A5A6, sellPrice: 10 },
            'Raro': { emoji: '🔵', color: 0x3498DB, sellPrice: 25 },
            'Épico': { emoji: '🟣', color: 0x9B59B6, sellPrice: 50 },
            'Legendario': { emoji: '🟡', color: 0xF1C40F, sellPrice: 100 }
        }
    },
    channels: {
        admin: process.env.ADMIN_CHANNEL_ID || '1438587692097998878',
        game: process.env.GAME_CHANNEL_ID || '1438587851154653374'
    },
    economy: {
        startingMoney: 100,
        dailyReward: 50,
        maxGiftAmount: 1000,
        maxDuelBet: 500
    },
    cooldowns: {
        default: 5000, // 5 segundos
        daily: 86400000 // 24 horas
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
    constructor(defaultTTL = 600) {
        this.cache = new Map();
        this.defaultTTL = defaultTTL * 1000; // Convertir a milisegundos
        this.timers = new Map();
    }
    
    set(key, value, ttl = this.defaultTTL) {
        // Eliminar timer existente si hay
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }
        
        // Establecer nuevo valor
        this.cache.set(key, value);
        
        // Configurar timer para expiración
        if (ttl > 0) {
            const timer = setTimeout(() => {
                this.cache.delete(key);
                this.timers.delete(key);
            }, ttl);
            this.timers.set(key, timer);
        }
    }
    
    get(key) {
        return this.cache.get(key);
    }
    
    has(key) {
        return this.cache.has(key);
    }
    
    delete(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        return this.cache.delete(key);
    }
    
    clear() {
        this.cache.clear();
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }
}

const userCache = new Cache(600); // 10 minutos
const cardCache = new Cache(3600); // 1 hora
const shopCache = new Cache(1800); // 30 minutos

// ========================================
// SISTEMA DE COOLDOWNS
// ========================================
const cooldowns = new Map();

function checkCooldown(userId, commandName, cooldownTime) {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    const expirationTime = cooldowns.get(key) + cooldownTime;
    
    if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        return Math.ceil(timeLeft);
    }
    
    cooldowns.set(key, now);
    return null;
}

// ========================================
// CONEXIÓN Y PREPARACIÓN DE LA BASE DE DATOS (SQLite)
// ========================================
const db = new sqlite3.Database('./database.sqlite', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        logger.error('Error al conectar con la base de datos SQLite:', err.message);
    } else {
        logger.info('Conectado exitosamente a la base de datos SQLite.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    // Tablas existentes
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY, 
        username TEXT NOT NULL, 
        money INTEGER NOT NULL DEFAULT ${config.economy.startingMoney}, 
        last_daily TEXT, 
        duels_won INTEGER DEFAULT 0, 
        duels_lost INTEGER DEFAULT 0,
        multiplier INTEGER DEFAULT 1
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        name TEXT UNIQUE NOT NULL, 
        rarity TEXT NOT NULL CHECK(rarity IN ('Común', 'Raro', 'Épico', 'Legendario')), 
        description TEXT, 
        image_url TEXT NOT NULL, 
        price INTEGER NOT NULL DEFAULT 0,
        attack INTEGER DEFAULT 10,
        defense INTEGER DEFAULT 10
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS user_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        user_id TEXT NOT NULL, 
        card_id INTEGER NOT NULL, 
        FOREIGN KEY (user_id) REFERENCES users(user_id), 
        FOREIGN KEY (card_id) REFERENCES cards(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS card_drops (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        card_id INTEGER NOT NULL, 
        claimed_by TEXT DEFAULT NULL, 
        claimed_at INTEGER DEFAULT NULL, 
        FOREIGN KEY (card_id) REFERENCES cards(id)
    )`);

    // Nuevas tablas para las funcionalidades avanzadas
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        user_id TEXT, 
        type TEXT, 
        amount INTEGER, 
        reason TEXT, 
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        initiator_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        initiator_card_id INTEGER,
        recipient_card_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, cancelled
        created_at INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        price INTEGER NOT NULL,
        description TEXT,
        common_chance INTEGER DEFAULT 60,
        rare_chance INTEGER DEFAULT 30,
        epic_chance INTEGER DEFAULT 9,
        legendary_chance INTEGER DEFAULT 1,
        cards_count INTEGER DEFAULT 3
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pack_contents (
        pack_id INTEGER,
        card_id INTEGER,
        FOREIGN KEY (pack_id) REFERENCES packs(id),
        FOREIGN KEY (card_id) REFERENCES cards(id)
    )`);

    logger.info('Tablas de la base de datos verificadas/creadas.');
    
    // Poblar paquetes si no existen
    db.get('SELECT * FROM packs WHERE id = 1', [], (err, pack) => {
        if (!pack) {
            db.run('INSERT INTO packs (name, price, description) VALUES (?, ?, ?)', 
                ['Paquete Básico', 150, 'Un paquete con 3 cartas aleatorias. ¡Garantizado al menos una Rara!']);
        }
    });
}

// ========================================
// FUNCIONES AUXILIARES
// ========================================
function ensureUserExists(userId, username) {
    return new Promise((resolve, reject) => {
        // Primero verificar en caché
        if (userCache.has(userId)) {
            return resolve();
        }
        
        db.get('SELECT user_id FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err);
            if (row) {
                userCache.set(userId, row);
                return resolve();
            }
            
            // Si no existe, lo creamos
            db.run('INSERT INTO users (user_id, username) VALUES (?, ?)', [userId, username], (err) => {
                if (err) return reject(err);
                logger.info(`Nuevo usuario registrado: ${username} (${userId})`);
                userCache.set(userId, { user_id: userId, username: username });
                resolve();
            });
        });
    });
}

function getUserData(userId) {
    return new Promise((resolve, reject) => {
        // Primero verificar en caché
        if (userCache.has(userId)) {
            return resolve(userCache.get(userId));
        }
        
        db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err);
            if (row) {
                userCache.set(userId, row);
            }
            resolve(row);
        });
    });
}

function updateUserData(userId, fields) {
    return new Promise((resolve, reject) => {
        const setClause = Object.keys(fields).map(key => `${key} = ?`).join(', ');
        const values = Object.values(fields);
        values.push(userId);
        
        db.run(`UPDATE users SET ${setClause} WHERE user_id = ?`, values, function(err) {
            if (err) return reject(err);
            
            // Actualizar caché
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
        // Primero verificar en caché
        if (cardCache.has(cardId)) {
            return resolve(cardCache.get(cardId));
        }
        
        db.get('SELECT * FROM cards WHERE id = ?', [cardId], (err, row) => {
            if (err) return reject(err);
            if (row) {
                cardCache.set(cardId, row);
            }
            resolve(row);
        });
    });
}

function getAllCards() {
    return new Promise((resolve, reject) => {
        // Si la caché tiene todas las cartas, devolverlas
        if (cardCache.size > 0) {
            return resolve(Array.from(cardCache.values()));
        }
        
        db.all('SELECT * FROM cards', [], (err, rows) => {
            if (err) return reject(err);
            
            // Almacenar en caché
            rows.forEach(card => {
                cardCache.set(card.id, card);
            });
            
            resolve(rows);
        });
    });
}

function getShopCards() {
    return new Promise((resolve, reject) => {
        // Primero verificar en caché
        if (shopCache.has('cards')) {
            return resolve(shopCache.get('cards'));
        }
        
        db.all('SELECT * FROM cards WHERE price > 0 ORDER BY price ASC, rarity DESC', [], (err, rows) => {
            if (err) return reject(err);
            shopCache.set('cards', rows);
            resolve(rows);
        });
    });
}

function addTransaction(userId, type, amount, reason) {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, ?, ?, ?)', 
            [userId, type, amount, reason], function(err) {
            if (err) return reject(err);
            resolve(this.lastID);
        });
    });
}

function getRarityData(rarity) {
    return config.bot.rarity[rarity] || { emoji: '❓', color: 0x000000, sellPrice: 5 };
}

// ========================================
// SISTEMA DE EMBEDS CON BRANDING
// ========================================
function createEmbed(options = {}) {
    const {
        title,
        description,
        color = config.bot.colors.primary,
        thumbnail,
        image,
        fields,
        footer,
        author
    } = options;

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTimestamp();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (image) embed.setImage(image);
    if (fields) embed.addFields(fields);
    if (footer) embed.setFooter({ text: footer, iconURL: `https://i.imgur.com/pBFAaJ3.png` });
    else embed.setFooter({ text: `${config.bot.name} v${config.bot.version}`, iconURL: `https://i.imgur.com/pBFAaJ3.png` });
    if (author) embed.setAuthor(author);

    return embed;
}

// ========================================
// INICIALIZACIÓN DEL CLIENTE DE DISCORD
// ========================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ========================================
// CARGADOR DE COMANDOS
// ========================================
const commands = new Map();

function registerCommand(command) {
    commands.set(command.data.name, command);
    logger.info(`Comando registrado: ${command.data.name}`);
}

// ========================================
// DEFINICIÓN DE COMANDOS
// ========================================

// --- COMANDOS DE CARTAS ---
const dropCommand = {
    data: new SlashCommandBuilder()
        .setName('drop')
        .setDescription('Lanza una carta aleatoria al canal'),
    cooldown: 15000, // 15 segundos
    category: 'cards',
    async execute(interaction, client) {
        await interaction.deferReply();

        const allCards = await getAllCards();
        if (allCards.length === 0) {
            return interaction.editReply({ 
                embeds: [createEmbed({ 
                    description: '❌ No hay cartas en el sistema. Pide a un admin que añada algunas.', 
                    color: config.bot.colors.error 
                })] 
            });
        }

        const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
        const rarityData = getRarityData(randomCard.rarity);

        const dropEmbed = createEmbed({
            author: { name: '🎉 ¡NUEVA CARTA EN DROP! 🎉', iconURL: client.user.displayAvatarURL() },
            title: `**${randomCard.name}**`,
            description: randomCard.description,
            image: randomCard.image_url,
            color: rarityData.color,
            fields: [
                { name: `🆔 Código de Colección`, value: `#${randomCard.id}`, inline: true },
                { name: `⭐ Rareza`, value: `${rarityData.emoji} ${randomCard.rarity}`, inline: true },
                { name: `⚔️ Ataque / 🛡️ Defensa`, value: `${randomCard.attack} / ${randomCard.defense}`, inline: true }
            ],
            footer: '¡Sé el primero en reclamarla con /claim!'
        });

        await interaction.editReply({ embeds: [dropEmbed] });

        const stmt = db.prepare('INSERT INTO card_drops (card_id) VALUES (?)');
        stmt.run([randomCard.id], (err) => {
            if (err) logger.error("Error al guardar drop en BD:", err);
        });
        stmt.finalize();
    }
};

const claimCommand = {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Reclama la carta que está en drop'),
    cooldown: 5000, // 5 segundos
    category: 'cards',
    async execute(interaction, client) {
        const stmt = db.prepare(`SELECT cd.*, c.name, c.rarity, c.description, c.image_url FROM card_drops cd JOIN cards c ON cd.card_id = c.id WHERE cd.claimed_by IS NULL LIMIT 1`);
        stmt.get([], async (err, drop) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al buscar el drop actual.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!drop) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: '❌ No hay ninguna carta para reclamar. ¡Usa `/drop` para lanzar una!', 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            // Actualizar el drop como reclamado
            const updateStmt = db.prepare('UPDATE card_drops SET claimed_by = ?, claimed_at = ? WHERE id = ?');
            updateStmt.run([interaction.user.id, Date.now(), drop.id], function(err) {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al reclamar la carta.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                // Añadir la carta al inventario del usuario
                const insertStmt = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                insertStmt.run([interaction.user.id, drop.card_id], (err) => {
                    if (err) { 
                        logger.error(err); 
                        return interaction.reply({ 
                            embeds: [createEmbed({ 
                                description: '❌ Error al añadir la carta a tu inventario.', 
                                color: config.bot.colors.error 
                            })], 
                            ephemeral: true 
                        }); 
                    }
                    
                    const rarityData = getRarityData(drop.rarity);
                    const claimEmbed = createEmbed({
                        title: '🎊 ¡CARTA RECLAMADA! 🎊',
                        description: `¡Felicidades **${interaction.user.username}**! Has conseguido la carta **${drop.name}**.`,
                        thumbnail: drop.image_url,
                        color: rarityData.color,
                        fields: [
                            { name: 'Rareza', value: `${rarityData.emoji} ${drop.rarity}`, inline: true }, 
                            { name: 'Descripción', value: drop.description, inline: false }
                        ],
                        footer: 'Añadida a tu inventario. Usa /inventory para verla.'
                    });
                    
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
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('Muestra tu inventario de cartas'),
    cooldown: 5000, // 5 segundos
    category: 'cards',
    async execute(interaction, client) {
        const stmt = db.prepare(`SELECT c.id, c.name, c.rarity, c.image_url, COUNT(c.id) as count FROM user_inventory ui JOIN cards c ON ui.card_id = c.id WHERE ui.user_id = ? GROUP BY c.id ORDER BY c.rarity DESC, c.name ASC`);
        stmt.all([interaction.user.id], (err, rows) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al cargar tu inventario.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (rows.length === 0) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: 'Tu inventario está vacío. ¡Usa `/claim` para conseguir cartas!', 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });

            const inventoryEmbed = createEmbed({
                title: `📦 Inventario de ${interaction.user.username}`,
                description: `Aquí están tus cartas (${rows.length} tipos distintos):`,
                color: config.bot.colors.success,
                thumbnail: interaction.user.displayAvatarURL()
            });

            rows.forEach(card => {
                const rarityData = getRarityData(card.rarity);
                inventoryEmbed.addFields({ 
                    name: `${rarityData.emoji} ${card.name} x${card.count}`, 
                    value: `ID: #${card.id}`, 
                    inline: true 
                });
            });
            
            interaction.reply({ embeds: [inventoryEmbed] });
        });
        stmt.finalize();
    }
};

const collectionCommand = {
    data: new SlashCommandBuilder()
        .setName('collection')
        .setDescription('Muestra todas las cartas disponibles en el juego'),
    cooldown: 10000, // 10 segundos
    category: 'cards',
    async execute(interaction, client) {
        const allCards = await getAllCards();
        
        if (allCards.length === 0) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: 'No hay cartas en el sistema.', 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        const collectionEmbed = createEmbed({
            title: '🗂️ Colección Global de Cartas',
            description: `Todas las cartas (${allCards.length} en total):`,
            color: config.bot.colors.info
        });
        
        allCards.forEach(card => {
            const rarityData = getRarityData(card.rarity);
            collectionEmbed.addFields({ 
                name: `${rarityData.emoji} ${card.name}`, 
                value: `ID: #${card.id} | 💰 Precio: ${card.price}`, 
                inline: true 
            });
        });
        
        interaction.reply({ embeds: [collectionEmbed] });
    }
};

const cardinfoCommand = {
    data: new SlashCommandBuilder()
        .setName('cardinfo')
        .setDescription('Muestra información de una carta específica')
        .addStringOption(o => o.setName('nombre').setDescription('Nombre exacto de la carta').setRequired(true)),
    cooldown: 5000, // 5 segundos
    category: 'cards',
    async execute(interaction, client) {
        const cardName = interaction.options.getString('nombre');
        const stmt = db.prepare('SELECT * FROM cards WHERE name = ?');
        stmt.get([cardName], (err, card) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al buscar la carta.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!card) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ No se encontró ninguna carta llamada "${cardName}".`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            const countStmt = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND card_id = ?');
            countStmt.get([interaction.user.id, card.id], (err, userCard) => {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al verificar tus copias.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                const rarityData = getRarityData(card.rarity);
                const infoEmbed = createEmbed({
                    title: `${rarityData.emoji} ${card.name}`,
                    description: card.description,
                    image: card.image_url,
                    color: rarityData.color,
                    fields: [
                        { name: '🆔 Código de Colección', value: `#${card.id}`, inline: true }, 
                        { name: '⭐ Rareza', value: `${rarityData.emoji} ${card.rarity}`, inline: true }, 
                        { name: '📊 En tu poder', value: `${userCard.count} copia(s)`, inline: true }, 
                        { name: '💰 Precio en Tienda', value: `${card.price} monedas`, inline: true },
                        { name: '⚔️ Ataque', value: `${card.attack}`, inline: true },
                        { name: '🛡️ Defensa', value: `${card.defense}`, inline: true }
                    ]
                });
                
                interaction.reply({ embeds: [infoEmbed] });
            });
            countStmt.finalize();
        });
        stmt.finalize();
    }
};

const sellCommand = {
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Vende una carta de tu inventario')
        .addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta a vender').setRequired(true)),
    cooldown: 5000, // 5 segundos
    category: 'cards',
    async execute(interaction, client) {
        const cardName = interaction.options.getString('nombre');
        const cardStmt = db.prepare('SELECT * FROM cards WHERE name = ?');
        cardStmt.get([cardName], async (err, card) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al buscar la carta.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!card) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ No se encontró ninguna carta llamada "${cardName}".`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            const invStmt = db.prepare('SELECT id FROM user_inventory WHERE user_id = ? AND card_id = ? LIMIT 1');
            invStmt.get([interaction.user.id, card.id], async (err, invCard) => {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al verificar tu inventario.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                if (!invCard) return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: `❌ No tienes ninguna carta "${cardName}" para vender.`, 
                        color: config.bot.colors.warning 
                    })], 
                    ephemeral: true 
                });

                const rarityData = getRarityData(card.rarity);
                
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    const delStmt = db.prepare('DELETE FROM user_inventory WHERE id = ?');
                    delStmt.run([invCard.id]);
                    
                    const addMoneyStmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?');
                    addMoneyStmt.run([rarityData.sellPrice, interaction.user.id]);
                    
                    // Registrar transacción
                    const transStmt = db.prepare('INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, ?, ?, ?)');
                    transStmt.run([interaction.user.id, 'sell', rarityData.sellPrice, `Venta de carta: ${card.name}`]);
                    
                    db.run('COMMIT', (err) => {
                        if (err) { 
                            logger.error(err); 
                            db.run('ROLLBACK'); 
                            return interaction.reply({ 
                                embeds: [createEmbed({ 
                                    description: '❌ Error al vender la carta.', 
                                    color: config.bot.colors.error 
                                })], 
                                ephemeral: true 
                            }); 
                        }
                        
                        // Invalidar caché del usuario
                        userCache.delete(interaction.user.id);
                        
                        const embed = createEmbed({
                            title: '💰 Carta Vendida',
                            description: `Has vendido **${card.name}** por **${rarityData.sellPrice} monedas**.`,
                            color: config.bot.colors.success,
                            thumbnail: card.image_url
                        });
                        
                        interaction.reply({ embeds: [embed] });
                    });
                    delStmt.finalize(); 
                    addMoneyStmt.finalize();
                    transStmt.finalize();
                });
            });
            invStmt.finalize();
        });
        cardStmt.finalize();
    }
};

// --- COMANDOS DE TIENDA Y ECONOMÍA ---
const shopCommand = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Muestra la tienda de cartas'),
    cooldown: 10000, // 10 segundos
    category: 'economy',
    async execute(interaction, client) {
        const shopCards = await getShopCards();
        
        if (shopCards.length === 0) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: 'La tienda está vacía. Pide a un admin que ponga cartas a la venta.', 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        const shopEmbed = createEmbed({
            title: '🛒 Tienda de Cartas',
            description: 'Usa `/buy` para comprar una carta.',
            color: config.bot.colors.info
        });
        
        shopCards.forEach(card => {
            const rarityData = getRarityData(card.rarity);
            shopEmbed.addFields({ 
                name: `${rarityData.emoji} ${card.name}`, 
                value: `💰 ${card.price}`, 
                inline: true 
            });
        });
        
        interaction.reply({ embeds: [shopEmbed] });
    }
};

const buyCommand = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Compra una carta específica de la tienda')
        .addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta a comprar').setRequired(true)),
    cooldown: 5000, // 5 segundos
    category: 'economy',
    async execute(interaction, client) {
        const cardName = interaction.options.getString('nombre');
        const cardStmt = db.prepare('SELECT * FROM cards WHERE name = ? AND price > 0');
        cardStmt.get([cardName], async (err, card) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al buscar la carta.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!card) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ "${cardName}" no está disponible en la tienda.`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            const userData = await getUserData(interaction.user.id);
            if (userData.money < card.price) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ No tienes suficiente dinero. Te faltan ${card.price - userData.money} monedas.`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const removeMoneyStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?');
                removeMoneyStmt.run([card.price, interaction.user.id]);
                
                const addCardStmt = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                addCardStmt.run([interaction.user.id, card.id]);
                
                // Registrar transacción
                const transStmt = db.prepare('INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, ?, ?, ?)');
                transStmt.run([interaction.user.id, 'buy', -card.price, `Compra de carta: ${card.name}`]);
                
                db.run('COMMIT', (err) => {
                    if (err) { 
                        logger.error(err); 
                        db.run('ROLLBACK'); 
                        return interaction.reply({ 
                            embeds: [createEmbed({ 
                                description: '❌ Error al realizar la compra.', 
                                color: config.bot.colors.error 
                            })], 
                            ephemeral: true 
                        }); 
                    }
                    
                    // Invalidar caché del usuario
                    userCache.delete(interaction.user.id);
                    
                    const rarityData = getRarityData(card.rarity);
                    const embed = createEmbed({
                        title: '🛍️ Compra Realizada',
                        description: `Has comprado **${card.name}** por **${card.price} monedas**.`,
                        color: config.bot.colors.success,
                        thumbnail: card.image_url
                    });
                    
                    interaction.reply({ embeds: [embed] });
                });
                removeMoneyStmt.finalize(); 
                addCardStmt.finalize();
                transStmt.finalize();
            });
        });
        cardStmt.finalize();
    }
};

const balanceCommand = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Consulta tu saldo de monedas'),
    cooldown: 5000, // 5 segundos
    category: 'economy',
    async execute(interaction, client) {
        const userData = await getUserData(interaction.user.id);
        
        const balanceEmbed = createEmbed({
            title: `💰 Saldo de ${interaction.user.username}`,
            description: `Tienes un total de **${userData.money} monedas**.`,
            color: config.bot.colors.info,
            thumbnail: interaction.user.displayAvatarURL()
        });
        
        interaction.reply({ embeds: [balanceEmbed] });
    }
};

const dailyCommand = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Reclama tu recompensa diaria de 50 monedas'),
    cooldown: config.cooldowns.daily, // 24 horas
    category: 'economy',
    async execute(interaction, client) {
        const userData = await getUserData(interaction.user.id);
        const today = new Date().toISOString().slice(0, 10); // Formato YYYY-MM-DD
        
        if (userData.last_daily === today) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: '❌ Ya has reclamado tu recompensa diaria hoy. ¡Vuelve mañana!', 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });

        const dailyAmount = config.economy.dailyReward * userData.multiplier;
        
        await updateUserData(interaction.user.id, { 
            money: userData.money + dailyAmount, 
            last_daily: today 
        });
        
        // Registrar transacción
        await addTransaction(interaction.user.id, 'daily', dailyAmount, 'Recompensa diaria');
        
        const dailyEmbed = createEmbed({
            title: '🎁 Recompensa Diaria Recibida',
            description: `Has recibido **${dailyAmount} monedas** por tu actividad diaria.\n¡Vuelve mañana para reclamar más!`,
            color: config.bot.colors.success,
            thumbnail: interaction.user.displayAvatarURL()
        });
        
        interaction.reply({ embeds: [dailyEmbed] });
    }
};

const giftCommand = {
    data: new SlashCommandBuilder()
        .setName('gift')
        .setDescription('Envía monedas a otro usuario')
        .addUserOption(o => o.setName('usuario').setDescription('Usuario que recibirá las monedas').setRequired(true))
        .addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a enviar').setRequired(true).setMinValue(1)),
    cooldown: 10000, // 10 segundos
    category: 'economy',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario');
        const amount = interaction.options.getInteger('cantidad');
        
        if (targetUser.id === interaction.user.id) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: '❌ No puedes regalarte monedas a ti mismo.', 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        if (amount > config.economy.maxGiftAmount) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: `❌ No puedes regalar más de ${config.economy.maxGiftAmount} monedas en una sola transacción.`, 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        await ensureUserExists(targetUser.id, targetUser.username);
        const userData = await getUserData(interaction.user.id);
        
        if (userData.money < amount) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: `❌ No tienes suficiente dinero. Tu saldo es de ${userData.money} monedas.`, 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const removeStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?');
            removeStmt.run([amount, interaction.user.id]);
            
            const addStmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?');
            addStmt.run([amount, targetUser.id]);
            
            // Registrar transacciones
            const transStmt = db.prepare('INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, ?, ?, ?)');
            transStmt.run([interaction.user.id, 'gift', -amount, `Regalo a ${targetUser.username}`]);
            transStmt.run([targetUser.id, 'gift', amount, `Regalo de ${interaction.user.username}`]);
            
            db.run('COMMIT', (err) => {
                if (err) { 
                    logger.error(err); 
                    db.run('ROLLBACK'); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ La transferencia falló. Por favor, inténtalo de nuevo.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                // Invalidar caché de ambos usuarios
                userCache.delete(interaction.user.id);
                userCache.delete(targetUser.id);
                
                const giftEmbed = createEmbed({
                    title: '💸 Transferencia Exitosa',
                    description: `**${interaction.user.username}** le ha regalado **${amount} monedas** a **${targetUser.username}**.`,
                    color: config.bot.colors.success,
                    thumbnail: interaction.user.displayAvatarURL()
                });
                
                interaction.reply({ embeds: [giftEmbed] });
            });
            removeStmt.finalize(); 
            addStmt.finalize();
            transStmt.finalize();
        });
    }
};

// --- COMANDOS DE PAQUETES ---
const createpackCommand = {
    data: new SlashCommandBuilder()
        .setName('createpack')
        .setDescription('Crea un nuevo paquete de cartas (Solo Admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('nombre').setDescription('Nombre del paquete').setRequired(true))
        .addIntegerOption(o => o.setName('precio').setDescription('Precio del paquete').setRequired(true))
        .addStringOption(o => o.setName('descripcion').setDescription('Descripción del paquete').setRequired(false))
        .addIntegerOption(o => o.setName('cartas').setDescription('Número de cartas en el paquete').setRequired(false))
        .addIntegerOption(o => o.setName('comun').setDescription('Probabilidad de carta común (%)').setRequired(false))
        .addIntegerOption(o => o.setName('raro').setDescription('Probabilidad de carta rara (%)').setRequired(false))
        .addIntegerOption(o => o.setName('epico').setDescription('Probabilidad de carta épica (%)').setRequired(false))
        .addIntegerOption(o => o.setName('legendario').setDescription('Probabilidad de carta legendaria (%)').setRequired(false)),
    cooldown: 5000, // 5 segundos
    category: 'admin',
    async execute(interaction, client) {
        const name = interaction.options.getString('nombre');
        const price = interaction.options.getInteger('precio');
        const description = interaction.options.getString('descripcion') || 'Un paquete de cartas';
        const cardsCount = interaction.options.getInteger('cartas') || 3;
        
        // Probabilidades predeterminadas si no se especifican
        let commonChance = 60;
        let rareChance = 30;
        let epicChance = 9;
        let legendaryChance = 1;
        
        if (interaction.options.getInteger('comun') !== null) commonChance = interaction.options.getInteger('comun');
        if (interaction.options.getInteger('raro') !== null) rareChance = interaction.options.getInteger('raro');
        if (interaction.options.getInteger('epico') !== null) epicChance = interaction.options.getInteger('epico');
        if (interaction.options.getInteger('legendario') !== null) legendaryChance = interaction.options.getInteger('legendario');
        
        // Verificar que las probabilidades sumen 100
        const totalChance = commonChance + rareChance + epicChance + legendaryChance;
        if (totalChance !== 100) {
            return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ Las probabilidades deben sumar 100%. Actualmente suman ${totalChance}%.`, 
                    color: config.bot.colors.error 
                })], 
                ephemeral: true 
            });
        }
        
        const stmt = db.prepare('INSERT INTO packs (name, price, description, cards_count, common_chance, rare_chance, epic_chance, legendary_chance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        stmt.run([name, price, description, cardsCount, commonChance, rareChance, epicChance, legendaryChance], function(err) {
            if (err) { 
                if (err.message.includes('UNIQUE constraint failed')) {
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: `❌ Ya existe un paquete llamado "${name}".`, 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    });
                }
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al crear el paquete.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                });
            }
            
            const embed = createEmbed({
                title: '✅ Paquete Creado',
                description: `El paquete **${name}** ha sido creado con éxito.`,
                color: config.bot.colors.success,
                fields: [
                    { name: 'Precio', value: `${price} monedas`, inline: true },
                    { name: 'Cartas', value: `${cardsCount}`, inline: true },
                    { name: 'Descripción', value: description, inline: false },
                    { name: 'Probabilidades', value: `Común: ${commonChance}%\nRaro: ${rareChance}%\nÉpico: ${epicChance}%\nLegendario: ${legendaryChance}%`, inline: false }
                ]
            });
            
            interaction.reply({ embeds: [embed] });
        });
        stmt.finalize();
    }
};

const buypackCommand = {
    data: new SlashCommandBuilder()
        .setName('buypack')
        .setDescription('Compra un paquete de cartas aleatorias')
        .addStringOption(o => o.setName('nombre').setDescription('Nombre del paquete').setRequired(true)),
    cooldown: 10000, // 10 segundos
    category: 'economy',
    async execute(interaction, client) {
        const packName = interaction.options.getString('nombre');
        
        db.get('SELECT * FROM packs WHERE name = ?', [packName], async (err, pack) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al buscar el paquete.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!pack) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ No se encontró ningún paquete llamado "${packName}".`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            const userData = await getUserData(interaction.user.id);
            if (userData.money < pack.price) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ No tienes suficiente dinero. Te faltan ${pack.price - userData.money} monedas.`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            await interaction.deferReply();
            
            // Generar cartas aleatorias según las probabilidades del paquete
            const allCards = await getAllCards();
            const cardsByRarity = {
                'Común': allCards.filter(card => card.rarity === 'Común'),
                'Raro': allCards.filter(card => card.rarity === 'Raro'),
                'Épico': allCards.filter(card => card.rarity === 'Épico'),
                'Legendario': allCards.filter(card => card.rarity === 'Legendario')
            };
            
            const packCards = [];
            for (let i = 0; i < pack.cards_count; i++) {
                const random = Math.random() * 100;
                let selectedCard;
                
                if (random < pack.legendary_chance && cardsByRarity['Legendario'].length > 0) {
                    selectedCard = cardsByRarity['Legendario'][Math.floor(Math.random() * cardsByRarity['Legendario'].length)];
                } else if (random < pack.legendary_chance + pack.epic_chance && cardsByRarity['Épico'].length > 0) {
                    selectedCard = cardsByRarity['Épico'][Math.floor(Math.random() * cardsByRarity['Épico'].length)];
                } else if (random < pack.legendary_chance + pack.epic_chance + pack.rare_chance && cardsByRarity['Raro'].length > 0) {
                    selectedCard = cardsByRarity['Raro'][Math.floor(Math.random() * cardsByRarity['Raro'].length)];
                } else {
                    selectedCard = cardsByRarity['Común'][Math.floor(Math.random() * cardsByRarity['Común'].length)];
                }
                
                if (selectedCard) {
                    packCards.push(selectedCard);
                }
            }
            
            // Actualizar el dinero del usuario
            await updateUserData(interaction.user.id, { 
                money: userData.money - pack.price 
            });
            
            // Registrar transacción
            await addTransaction(interaction.user.id, 'buypack', -pack.price, `Compra de paquete: ${packName}`);
            
            // Añadir las cartas al inventario del usuario
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const addCardStmt = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                
                packCards.forEach(card => {
                    addCardStmt.run([interaction.user.id, card.id]);
                });
                
                db.run('COMMIT', (err) => {
                    if (err) { 
                        logger.error(err); 
                        db.run('ROLLBACK'); 
                        return interaction.editReply({ 
                            embeds: [createEmbed({ 
                                description: '❌ Error al añadir las cartas a tu inventario.', 
                                color: config.bot.colors.error 
                            })] 
                        }); 
                    }
                    
                    // Invalidar caché del usuario
                    userCache.delete(interaction.user.id);
                    
                    // Crear embed con las cartas obtenidas
                    const packEmbed = createEmbed({
                        title: `🎁 ¡Abriste un ${packName}!`,
                        description: `Has obtenido ${packCards.length} cartas:`,
                        color: config.bot.colors.success,
                        thumbnail: interaction.user.displayAvatarURL()
                    });
                    
                    packCards.forEach(card => {
                        const rarityData = getRarityData(card.rarity);
                        packEmbed.addFields({ 
                            name: `${rarityData.emoji} ${card.name}`, 
                            value: `ID: #${card.id}`, 
                            inline: true 
                        });
                    });
                    
                    interaction.editReply({ embeds: [packEmbed] });
                });
                addCardStmt.finalize();
            });
        });
    }
};

const listpacksCommand = {
    data: new SlashCommandBuilder()
        .setName('listpacks')
        .setDescription('Muestra todos los paquetes disponibles'),
    cooldown: 10000, // 10 segundos
    category: 'economy',
    async execute(interaction, client) {
        db.all('SELECT * FROM packs', [], (err, rows) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al cargar los paquetes.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (rows.length === 0) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: 'No hay paquetes disponibles. Pide a un admin que cree algunos.', 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            const packsEmbed = createEmbed({
                title: '📦 Paquetes Disponibles',
                description: 'Usa `/buypack` para comprar un paquete.',
                color: config.bot.colors.info
            });
            
            rows.forEach(pack => {
                packsEmbed.addFields({ 
                    name: `${pack.name} - ${pack.price} monedas`, 
                    value: `${pack.description}\nCartas: ${pack.cards_count}\nProbabilidades: Común ${pack.common_chance}%, Raro ${pack.rare_chance}%, Épico ${pack.epic_chance}%, Legendario ${pack.legendary_chance}%`, 
                    inline: false 
                });
            });
            
            interaction.reply({ embeds: [packsEmbed] });
        });
    }
};

// --- COMANDOS SOCIALES Y DE ESTADO ---
const profileCommand = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Muestra tu perfil de jugador'),
    cooldown: 10000, // 10 segundos
    category: 'social',
    async execute(interaction, client) {
        const userData = await getUserData(interaction.user.id);
        
        const invStmt = db.prepare('SELECT COUNT(*) as total_cards FROM user_inventory WHERE user_id = ?');
        invStmt.get([interaction.user.id], (err, invData) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al cargar tu inventario.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            const totalDuels = userData.duels_won + userData.duels_lost;
            const winRate = totalDuels > 0 ? ((userData.duels_won / totalDuels) * 100).toFixed(1) : 0;
            
            const embed = createEmbed({
                title: `📜 Perfil de ${interaction.user.username}`,
                thumbnail: interaction.user.displayAvatarURL(),
                color: config.bot.colors.info,
                fields: [
                    { name: '💰 Dinero', value: `${userData.money} monedas`, inline: true },
                    { name: '📦 Cartas Totales', value: `${invData.total_cards}`, inline: true },
                    { name: '⚔️ Duelos', value: `Ganados: ${userData.duels_won} | Perdidos: ${userData.duels_lost}`, inline: false },
                    { name: '📈 Tasa de Victoria', value: `${winRate}%`, inline: true },
                    { name: '✨ Multiplicador', value: `x${userData.multiplier}`, inline: true }
                ]
            });
            
            interaction.reply({ embeds: [embed] });
        });
        invStmt.finalize();
    }
};

const leaderboardCommand = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Muestra las tablas de clasificación')
        .addStringOption(o => o.setName('tipo').setDescription('Tipo de clasificación').setRequired(true).setChoices(
            { name: '💰 Dinero', value: 'money' }, 
            { name: '📦 Cartas', value: 'cards' },
            { name: '⚔️ Duelos', value: 'duels' }
        )),
    cooldown: 15000, // 15 segundos
    category: 'social',
    async execute(interaction, client) {
        const type = interaction.options.getString('tipo');
        let query, title, emoji;
        
        if (type === 'money') { 
            query = 'SELECT username, money FROM users ORDER BY money DESC LIMIT 10'; 
            title = 'Tabla de Riqueza'; 
            emoji = '💰'; 
        }
        else if (type === 'cards') { 
            query = 'SELECT u.username, COUNT(ui.id) as total_cards FROM users u LEFT JOIN user_inventory ui ON u.user_id = ui.user_id GROUP BY u.user_id ORDER BY total_cards DESC LIMIT 10'; 
            title = 'Tabla de Coleccionistas'; 
            emoji = '📦'; 
        }
        else { 
            query = 'SELECT username, duels_won FROM users ORDER BY duels_won DESC LIMIT 10'; 
            title = 'Tabla de Duelistas'; 
            emoji = '⚔️'; 
        }
        
        db.all(query, [], (err, rows) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al cargar la tabla de clasificación.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            const embed = createEmbed({
                title: `${emoji} ${title}`,
                color: config.bot.colors.info
            });
            
            if (rows.length === 0) { 
                embed.setDescription('No hay datos para mostrar.'); 
            }
            else {
                const description = rows.map((row, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                    const value = type === 'money' ? row.money : type === 'cards' ? row.total_cards : row.duels_won;
                    return `${medal} **${row.username}** - ${value}`;
                }).join('\n');
                embed.setDescription(description);
            }
            
            interaction.reply({ embeds: [embed] });
        });
    }
};

// --- COMANDOS DE DUELOS ---
const duelCommand = {
    data: new SlashCommandBuilder()
        .setName('duel')
        .setDescription('Reta a un usuario a un duelo de cartas')
        .addUserOption(o => o.setName('usuario').setDescription('Usuario a retar').setRequired(true))
        .addIntegerOption(o => o.setName('apuesta').setDescription('Cantidad de monedas a apostar').setRequired(true).setMinValue(10)),
    cooldown: 30000, // 30 segundos
    category: 'game',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario');
        const betAmount = interaction.options.getInteger('apuesta');
        
        if (targetUser.id === interaction.user.id) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: '❌ No puedes retarte a ti mismo.', 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        if (betAmount > config.economy.maxDuelBet) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: `❌ La apuesta máxima es de ${config.economy.maxDuelBet} monedas.`, 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        const userData = await getUserData(interaction.user.id);
        if (userData.money < betAmount) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: `❌ No tienes suficiente dinero para apostar ${betAmount}.`, 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        // Obtener una carta aleatoria del usuario
        db.get('SELECT c.* FROM user_inventory ui JOIN cards c ON ui.card_id = c.id WHERE ui.user_id = ? ORDER BY RANDOM() LIMIT 1', [interaction.user.id], async (err, userCard) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al obtener tu carta.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!userCard) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: '❌ No tienes cartas para participar en un duelo. Obtén algunas con /claim.', 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            // Obtener una carta aleatoria del rival
            db.get('SELECT c.* FROM user_inventory ui JOIN cards c ON ui.card_id = c.id WHERE ui.user_id = ? ORDER BY RANDOM() LIMIT 1', [targetUser.id], async (err, targetCard) => {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al obtener la carta del rival.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                if (!targetCard) return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: `❌ ${targetUser.username} no tiene cartas para participar en un duelo.`, 
                        color: config.bot.colors.warning 
                    })], 
                    ephemeral: true 
                });
                
                const embed = createEmbed({
                    title: '⚔️ ¡Desafío de Duelo! ⚔️',
                    description: `**${interaction.user.username}** ha retado a **${targetUser.username}** a un duelo por **${betAmount} monedas**.\n\n${targetUser.username}, ¿aceptas el reto?`,
                    color: config.bot.colors.error,
                    fields: [
                        {
                            name: `Carta de ${interaction.user.username}`,
                            value: `${getRarityData(userCard.rarity).emoji} ${userCard.name} (ATK: ${userCard.attack} / DEF: ${userCard.defense})`,
                            inline: false
                        },
                        {
                            name: `Carta de ${targetUser.username}`,
                            value: `${getRarityData(targetCard.rarity).emoji} ${targetCard.name} (ATK: ${targetCard.attack} / DEF: ${targetCard.defense})`,
                            inline: false
                        }
                    ]
                });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`duel_accept_${interaction.user.id}_${targetUser.id}_${betAmount}_${userCard.id}_${targetCard.id}`).setLabel('Aceptar Duelo').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`duel_decline_${interaction.user.id}_${targetUser.id}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger)
                );
                
                const msg = await interaction.reply({ 
                    content: `${targetUser}`, 
                    embeds: [embed], 
                    components: [row], 
                    fetchReply: true 
                });
                
                // Crear un colector para los botones
                const collector = msg.createMessageComponentCollector({ 
                    componentType: ComponentType.Button, 
                    time: 60000 // 60 segundos
                });
                
                collector.on('collect', async i => {
                    if (i.user.id !== targetUser.id) {
                        await i.reply({ content: 'No puedes responder a este desafío.', ephemeral: true });
                        return;
                    }
                    
                    collector.stop();
                    
                    if (i.customId.startsWith('duel_accept')) {
                        const [, , , , , userCardId, targetCardId] = i.customId.split('_');
                        
                        // Obtener datos actualizados de las cartas
                        const userCardData = await getCardData(parseInt(userCardId));
                        const targetCardData = await getCardData(parseInt(targetCardId));
                        
                        // Calcular poder de las cartas (ataque + defensa + bono por rareza)
                        const rarityBonus = {
                            'Común': 0,
                            'Raro': 5,
                            'Épico': 10,
                            'Legendario': 20
                        };
                        
                        const userPower = userCardData.attack + userCardData.defense + rarityBonus[userCardData.rarity];
                        const targetPower = targetCardData.attack + targetCardData.defense + rarityBonus[targetCardData.rarity];
                        
                        // Determinar ganador con un poco de aleatoriedad
                        const userWinChance = userPower / (userPower + targetPower);
                        const random = Math.random();
                        const winner = random < userWinChance ? interaction.user : targetUser;
                        const loser = winner.id === interaction.user.id ? targetUser : interaction.user;
                        const winAmount = betAmount * 2; // El ganador se lleva el doble
                        
                        db.serialize(() => {
                            db.run('BEGIN TRANSACTION');
                            const updateWinnerStmt = db.prepare('UPDATE users SET money = money + ?, duels_won = duels_won + 1 WHERE user_id = ?');
                            updateWinnerStmt.run([betAmount, winner.id]);
                            
                            const updateLoserStmt = db.prepare('UPDATE users SET money = money - ?, duels_lost = duels_lost + 1 WHERE user_id = ?');
                            updateLoserStmt.run([betAmount, loser.id]);
                            
                            // Registrar transacciones
                            const transStmt = db.prepare('INSERT INTO transactions (user_id, type, amount, reason) VALUES (?, ?, ?, ?)');
                            transStmt.run([winner.id, 'duel_win', betAmount, `Duelo contra ${loser.username}`]);
                            transStmt.run([loser.id, 'duel_lose', -betAmount, `Duelo contra ${winner.username}`]);
                            
                            db.run('COMMIT', (err) => {
                                if (err) { 
                                    logger.error(err); 
                                    db.run('ROLLBACK'); 
                                    return i.update({ 
                                        content: 'Ocurrió un error durante el duelo.', 
                                        components: [] 
                                    }); 
                                }
                                
                                // Invalidar caché de ambos usuarios
                                userCache.delete(interaction.user.id);
                                userCache.delete(targetUser.id);
                                
                                const resultEmbed = createEmbed({
                                    title: '🏆 ¡Duelo Terminado!',
                                    description: `**${winner.username}** ha ganado el duelo y se lleva **${winAmount} monedas**.\nMejor suerte la próxima vez, **${loser.username}**.`,
                                    color: winner.id === interaction.user.id ? config.bot.colors.success : config.bot.colors.error,
                                    fields: [
                                        {
                                            name: `Carta de ${interaction.user.username}`,
                                            value: `${getRarityData(userCardData.rarity).emoji} ${userCardData.name} (Poder: ${userPower})`,
                                            inline: true
                                        },
                                        {
                                            name: `Carta de ${targetUser.username}`,
                                            value: `${getRarityData(targetCardData.rarity).emoji} ${targetCardData.name} (Poder: ${targetPower})`,
                                            inline: true
                                        }
                                    ]
                                });
                                
                                i.update({ embeds: [resultEmbed], components: [] });
                            });
                            updateWinnerStmt.finalize(); 
                            updateLoserStmt.finalize();
                            transStmt.finalize();
                        });
                    } else {
                        await i.update({ 
                            content: `${targetUser.username} ha rechazado el duelo.`, 
                            embeds: [], 
                            components: [] 
                        });
                    }
                });
                
                collector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.editReply({ 
                            content: 'El desafío de duelo expiró.', 
                            embeds: [], 
                            components: [] 
                        });
                    }
                });
            });
        });
    }
};

// --- COMANDOS DE TRADE ---
const tradeCommand = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Inicia un intercambio de cartas')
        .addUserOption(o => o.setName('usuario').setDescription('Usuario con quien intercambiar').setRequired(true))
        .addStringOption(o => o.setName('carta').setDescription('Tu carta a ofrecer').setRequired(true)),
    cooldown: 30000, // 30 segundos
    category: 'game',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario');
        const cardName = interaction.options.getString('carta');
        
        if (targetUser.id === interaction.user.id) return interaction.reply({ 
            embeds: [createEmbed({ 
                description: '❌ No puedes intercambiar contigo mismo.', 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
        
        // Verificar que la carta existe y que el usuario la tiene
        db.get('SELECT c.* FROM cards c JOIN user_inventory ui ON c.id = ui.card_id WHERE ui.user_id = ? AND c.name = ?', [interaction.user.id, cardName], async (err, card) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al verificar tu carta.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!card) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ No tienes ninguna carta llamada "${cardName}".`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            // Crear el trade en la base de datos
            db.run('INSERT INTO trades (initiator_id, recipient_id, initiator_card_id, status, created_at) VALUES (?, ?, ?, ?, ?)', 
                [interaction.user.id, targetUser.id, card.id, 'pending', Date.now()], function(err) {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al crear el intercambio.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                const rarityData = getRarityData(card.rarity);
                const embed = createEmbed({
                    title: '🤝 Propuesta de Intercambio',
                    description: `**${interaction.user.username}** quiere intercambiar con **${targetUser.username}**.\n\n${targetUser.username}, ¿qué carta ofreces a cambio?`,
                    color: config.bot.colors.info,
                    fields: [
                        {
                            name: `Carta de ${interaction.user.username}`,
                            value: `${rarityData.emoji} ${card.name}`,
                            inline: false
                        }
                    ]
                });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`trade_accept_${this.lastID}`).setLabel('Aceptar Intercambio').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`trade_decline_${this.lastID}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger)
                );
                
                interaction.reply({ 
                    content: `${targetUser}`, 
                    embeds: [embed], 
                    components: [row], 
                    fetchReply: true 
                }).then(msg => {
                    // Crear un colector para los botones
                    const collector = msg.createMessageComponentCollector({ 
                        componentType: ComponentType.Button, 
                        time: 300000 // 5 minutos
                    });
                    
                    collector.on('collect', async i => {
                        if (i.user.id !== targetUser.id) {
                            await i.reply({ content: 'No puedes responder a este intercambio.', ephemeral: true });
                            return;
                        }
                        
                        collector.stop();
                        
                        if (i.customId.startsWith('trade_accept')) {
                            const tradeId = i.customId.split('_')[2];
                            
                            // Mostrar un modal para que el usuario seleccione su carta
                            // Esto es más complejo y requeriría implementar modales
                            // Por ahora, mostraremos un mensaje pidiendo que use el comando /tradeoffer
                            await i.update({ 
                                content: `Para aceptar este intercambio, ${targetUser.username} debe usar el comando:\n\`/tradeoffer usuario:${interaction.user.username} carta:[nombre de tu carta] trade_id:${tradeId}\``, 
                                embeds: [], 
                                components: [] 
                            });
                        } else {
                            // Rechazar el trade
                            db.run('UPDATE trades SET status = ? WHERE id = ?', ['cancelled', tradeId]);
                            
                            await i.update({ 
                                content: `${targetUser.username} ha rechazado el intercambio.`, 
                                embeds: [], 
                                components: [] 
                            });
                        }
                    });
                    
                    collector.on('end', collected => {
                        if (collected.size === 0) {
                            // Marcar el trade como expirado
                            db.run('UPDATE trades SET status = ? WHERE id = ?', ['expired', this.lastID]);
                            
                            interaction.editReply({ 
                                content: 'La propuesta de intercambio expiró.', 
                                embeds: [], 
                                components: [] 
                            });
                        }
                    });
                });
            });
        });
    }
};

const tradeofferCommand = {
    data: new SlashCommandBuilder()
        .setName('tradeoffer')
        .setDescription('Ofrece una carta para un intercambio existente')
        .addUserOption(o => o.setName('usuario').setDescription('Usuario que inició el intercambio').setRequired(true))
        .addStringOption(o => o.setName('carta').setDescription('Tu carta a ofrecer').setRequired(true))
        .addIntegerOption(o => o.setName('trade_id').setDescription('ID del intercambio').setRequired(true)),
    cooldown: 30000, // 30 segundos
    category: 'game',
    async execute(interaction, client) {
        const initiatorUser = interaction.options.getUser('usuario');
        const cardName = interaction.options.getString('carta');
        const tradeId = interaction.options.getInteger('trade_id');
        
        // Verificar que el trade existe y está pendiente
        db.get('SELECT * FROM trades WHERE id = ? AND recipient_id = ? AND status = ?', [tradeId, interaction.user.id, 'pending'], async (err, trade) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al verificar el intercambio.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (!trade) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: '❌ No se encontró ningún intercambio pendiente con ese ID.', 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            // Verificar que la carta existe y que el usuario la tiene
            db.get('SELECT c.* FROM cards c JOIN user_inventory ui ON c.id = ui.card_id WHERE ui.user_id = ? AND c.name = ?', [interaction.user.id, cardName], async (err, card) => {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al verificar tu carta.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                if (!card) return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: `❌ No tienes ninguna carta llamada "${cardName}".`, 
                        color: config.bot.colors.warning 
                    })], 
                    ephemeral: true 
                });
                
                // Obtener la carta del iniciador
                const initiatorCard = await getCardData(trade.initiator_card_id);
                
                // Actualizar el trade con la carta del receptor
                db.run('UPDATE trades SET recipient_card_id = ? WHERE id = ?', [card.id, tradeId], (err) => {
                    if (err) { 
                        logger.error(err); 
                        return interaction.reply({ 
                            embeds: [createEmbed({ 
                                description: '❌ Error al actualizar el intercambio.', 
                                color: config.bot.colors.error 
                            })], 
                            ephemeral: true 
                        }); 
                    }
                    
                    const initiatorRarity = getRarityData(initiatorCard.rarity);
                    const recipientRarity = getRarityData(card.rarity);
                    
                    const embed = createEmbed({
                        title: '🤝 Propuesta de Intercambio Completa',
                        description: `Ambas partes han ofrecido sus cartas. ¿Confirman el intercambio?`,
                        color: config.bot.colors.info,
                        fields: [
                            {
                                name: `Carta de ${initiatorUser.username}`,
                                value: `${initiatorRarity.emoji} ${initiatorCard.name}`,
                                inline: true
                            },
                            {
                                name: `Carta de ${interaction.user.username}`,
                                value: `${recipientRarity.emoji} ${card.name}`,
                                inline: true
                            }
                        ]
                    });
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`trade_confirm_${tradeId}`).setLabel('Confirmar Intercambio').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`trade_cancel_${tradeId}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
                    );
                    
                    interaction.reply({ 
                        content: `${initiatorUser} ${interaction.user}`, 
                        embeds: [embed], 
                        components: [row], 
                        fetchReply: true 
                    }).then(msg => {
                        // Crear un colector para los botones
                        const collector = msg.createMessageComponentCollector({ 
                            componentType: ComponentType.Button, 
                            time: 300000 // 5 minutos
                        });
                        
                        collector.on('collect', async i => {
                            if (i.user.id !== initiatorUser.id && i.user.id !== interaction.user.id) {
                                await i.reply({ content: 'No puedes participar en este intercambio.', ephemeral: true });
                                return;
                            }
                            
                            if (i.customId.startsWith('trade_confirm')) {
                                // Ambos usuarios deben confirmar
                                // Esto es una simplificación, en un sistema real necesitarías rastrear quién ha confirmado
                                collector.stop();
                                
                                // Realizar el intercambio
                                db.serialize(() => {
                                    db.run('BEGIN TRANSACTION');
                                    
                                    // Eliminar las cartas de los inventarios
                                    const delInitiatorCard = db.prepare('DELETE FROM user_inventory WHERE user_id = ? AND card_id = ? LIMIT 1');
                                    delInitiatorCard.run([initiatorUser.id, initiatorCard.id]);
                                    
                                    const delRecipientCard = db.prepare('DELETE FROM user_inventory WHERE user_id = ? AND card_id = ? LIMIT 1');
                                    delRecipientCard.run([interaction.user.id, card.id]);
                                    
                                    // Añadir las cartas a los inventarios
                                    const addInitiatorCard = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                                    addInitiatorCard.run([initiatorUser.id, card.id]);
                                    
                                    const addRecipientCard = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                                    addRecipientCard.run([interaction.user.id, initiatorCard.id]);
                                    
                                    // Marcar el trade como completado
                                    db.run('UPDATE trades SET status = ? WHERE id = ?', ['completed', tradeId]);
                                    
                                    db.run('COMMIT', (err) => {
                                        if (err) { 
                                            logger.error(err); 
                                            db.run('ROLLBACK'); 
                                            return i.update({ 
                                                content: 'Ocurrió un error durante el intercambio.', 
                                                components: [] 
                                            }); 
                                        }
                                        
                                        // Invalidar caché de ambos usuarios
                                        userCache.delete(initiatorUser.id);
                                        userCache.delete(interaction.user.id);
                                        
                                        const resultEmbed = createEmbed({
                                            title: '✅ ¡Intercambio Completado!',
                                            description: `**${initiatorUser.username}** y **${interaction.user.username}** han intercambiado sus cartas con éxito.`,
                                            color: config.bot.colors.success,
                                            fields: [
                                                {
                                                    name: `Carta de ${initiatorUser.username}`,
                                                    value: `${initiatorRarity.emoji} ${initiatorCard.name}`,
                                                    inline: true
                                                },
                                                {
                                                    name: `Carta de ${interaction.user.username}`,
                                                    value: `${recipientRarity.emoji} ${card.name}`,
                                                    inline: true
                                                }
                                            ]
                                        });
                                        
                                        i.update({ embeds: [resultEmbed], components: [] });
                                    });
                                    delInitiatorCard.finalize();
                                    delRecipientCard.finalize();
                                    addInitiatorCard.finalize();
                                    addRecipientCard.finalize();
                                });
                            } else if (i.customId.startsWith('trade_cancel')) {
                                collector.stop();
                                
                                // Cancelar el trade
                                db.run('UPDATE trades SET status = ? WHERE id = ?', ['cancelled', tradeId]);
                                
                                await i.update({ 
                                    content: 'El intercambio ha sido cancelado.', 
                                    embeds: [], 
                                    components: [] 
                                });
                            }
                        });
                        
                        collector.on('end', collected => {
                            if (collected.size === 0) {
                                // Marcar el trade como expirado
                                db.run('UPDATE trades SET status = ? WHERE id = ?', ['expired', tradeId]);
                                
                                interaction.editReply({ 
                                    content: 'La propuesta de intercambio expiró.', 
                                    embeds: [], 
                                    components: [] 
                                });
                            }
                        });
                    });
                });
            });
        });
    }
};

// --- COMANDOS DE ADMINISTRACIÓN ---
const addcardCommand = {
    data: new SlashCommandBuilder()
        .setName('addcard')
        .setDescription('Añade una nueva carta al sistema (Solo Admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta').setRequired(true))
        .addStringOption(o => o.setName('rareza').setDescription('Rareza').setRequired(true).setChoices(
            { name: 'Común', value: 'Común' }, 
            { name: 'Raro', value: 'Raro' }, 
            { name: 'Épico', value: 'Épico' }, 
            { name: 'Legendario', value: 'Legendario' }
        ))
        .addStringOption(o => o.setName('descripcion').setDescription('Descripción').setRequired(true))
        .addStringOption(o => o.setName('imagen').setDescription('URL de la imagen o GIF').setRequired(true))
        .addIntegerOption(o => o.setName('precio').setDescription('Precio en la tienda').setRequired(false))
        .addIntegerOption(o => o.setName('ataque').setDescription('Estadística de ataque').setRequired(false))
        .addIntegerOption(o => o.setName('defensa').setDescription('Estadística de defensa').setRequired(false)),
    cooldown: 5000, // 5 segundos
    category: 'admin',
    async execute(interaction, client) {
        const name = interaction.options.getString('nombre');
        const rarity = interaction.options.getString('rareza');
        const description = interaction.options.getString('descripcion');
        const image_url = interaction.options.getString('imagen');
        const price = interaction.options.getInteger('precio') ?? getRarityData(rarity).sellPrice * 3; // Precio por defecto
        const attack = interaction.options.getInteger('ataque') ?? 10; // Valor por defecto
        const defense = interaction.options.getInteger('defensa') ?? 10; // Valor por defecto
        
        const stmt = db.prepare('INSERT INTO cards (name, rarity, description, image_url, price, attack, defense) VALUES (?, ?, ?, ?, ?, ?, ?)');
        stmt.run([name, rarity, description, image_url, price, attack, defense], function(err) {
            if (err) { 
                if (err.message.includes('UNIQUE constraint failed')) {
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: `❌ Ya existe una carta llamada "${name}".`, 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    });
                }
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al guardar la carta.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                });
            }
            
            // Invalidar caché de cartas
            cardCache.clear();
            shopCache.clear();
            
            const rarityData = getRarityData(rarity);
            const embed = createEmbed({
                title: '✅ Carta Añadida',
                description: `La carta **${name}** ha sido registrada.`,
                thumbnail: image_url,
                color: rarityData.color,
                fields: [
                    { name: 'Rareza', value: `${rarityData.emoji} ${rarity}`, inline: true }, 
                    { name: 'Precio', value: `💰 ${price}`, inline: true },
                    { name: 'Ataque / Defensa', value: `${attack} / ${defense}`, inline: true },
                    { name: 'Descripción', value: description, inline: false }
                ]
            });
            
            interaction.reply({ embeds: [embed] });
        });
        stmt.finalize();
    }
};

const addmoneyCommand = {
    data: new SlashCommandBuilder()
        .setName('addmoney')
        .setDescription('Añade monedas a un usuario (Solo Admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(o => o.setName('usuario').setDescription('Usuario a modificar').setRequired(true))
        .addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a añadir').setRequired(true).setMinValue(1)),
    cooldown: 5000, // 5 segundos
    category: 'admin',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario');
        const amount = interaction.options.getInteger('cantidad');
        
        await ensureUserExists(targetUser.id, targetUser.username);
        
        const stmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?');
        stmt.run([amount, targetUser.id], (err) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al añadir dinero.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            // Invalidar caché del usuario
            userCache.delete(targetUser.id);
            
            // Registrar transacción
            addTransaction(targetUser.id, 'admin_add', amount, `Añadido por admin: ${interaction.user.username}`);
            
            interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `✅ Se han añadido **${amount}** monedas a **${targetUser.username}**.`, 
                    color: config.bot.colors.success 
                })] 
            });
        });
        stmt.finalize();
    }
};

const removemoneyCommand = {
    data: new SlashCommandBuilder()
        .setName('removemoney')
        .setDescription('Quita monedas a un usuario (Solo Admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(o => o.setName('usuario').setDescription('Usuario a modificar').setRequired(true))
        .addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a quitar').setRequired(true).setMinValue(1)),
    cooldown: 5000, // 5 segundos
    category: 'admin',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario');
        const amount = interaction.options.getInteger('cantidad');
        
        const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?');
        stmt.get([targetUser.id], (err, row) => {
            if (err) { 
                logger.error(err); 
                return interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: '❌ Error al verificar saldo del usuario.', 
                        color: config.bot.colors.error 
                    })], 
                    ephemeral: true 
                }); 
            }
            
            if (row.money < amount) return interaction.reply({ 
                embeds: [createEmbed({ 
                    description: `❌ El usuario solo tiene ${row.money} monedas. No se pueden quitar ${amount}.`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
            
            const updateStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?');
            updateStmt.run([amount, targetUser.id], (err) => {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al quitar dinero.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                // Invalidar caché del usuario
                userCache.delete(targetUser.id);
                
                // Registrar transacción
                addTransaction(targetUser.id, 'admin_remove', -amount, `Quitado por admin: ${interaction.user.username}`);
                
                interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: `✅ Se han quitado **${amount}** monedas a **${targetUser.username}**.`, 
                        color: config.bot.colors.success 
                    })] 
                });
            });
            updateStmt.finalize();
        });
        stmt.finalize();
    }
};

const resetuserCommand = {
    data: new SlashCommandBuilder()
        .setName('resetuser')
        .setDescription('Borra todos los datos de un usuario (Solo Admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(o => o.setName('usuario').setDescription('Usuario a resetear').setRequired(true)),
    cooldown: 5000, // 5 segundos
    category: 'admin',
    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('usuario');
        
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const deleteStmt = db.prepare('DELETE FROM user_inventory WHERE user_id = ?');
            deleteStmt.run([targetUser.id]);
            
            const updateStmt = db.prepare('UPDATE users SET money = ?, last_daily = NULL, duels_won = 0, duels_lost = 0, multiplier = 1 WHERE user_id = ?');
            updateStmt.run([config.economy.startingMoney, targetUser.id], (err) => {
                if (err) { 
                    logger.error(err); 
                    return interaction.reply({ 
                        embeds: [createEmbed({ 
                            description: '❌ Error al resetear al usuario.', 
                            color: config.bot.colors.error 
                        })], 
                        ephemeral: true 
                    }); 
                }
                
                // Invalidar caché del usuario
                userCache.delete(targetUser.id);
                
                interaction.reply({ 
                    embeds: [createEmbed({ 
                        description: `✅ Todos los datos de **${targetUser.username}** han sido eliminados. Su saldo ahora es de ${config.economy.startingMoney} monedas.`, 
                        color: config.bot.colors.success 
                    })] 
                });
            });
            deleteStmt.finalize();
            updateStmt.finalize();
        });
    }
};

const massdropCommand = {
    data: new SlashCommandBuilder()
        .setName('massdrop')
        .setDescription('Lanza 5 cartas aleatorias a la vez (Solo Admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    cooldown: 30000, // 30 segundos
    category: 'admin',
    async execute(interaction, client) {
        await interaction.deferReply();
        
        const allCards = await getAllCards();
        if (allCards.length === 0) {
            return interaction.editReply({ 
                embeds: [createEmbed({ 
                    description: '❌ No hay cartas en el sistema para hacer drops.', 
                    color: config.bot.colors.error 
                })] 
            });
        }
        
        for (let i = 0; i < 5; i++) {
            const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
            const rarityData = getRarityData(randomCard.rarity);
            
            const dropEmbed = createEmbed({
                author: { name: '🎉 ¡NUEVA CARTA EN DROP! 🎉', iconURL: client.user.displayAvatarURL() },
                title: `**${randomCard.name}**`,
                description: randomCard.description,
                image: randomCard.image_url,
                color: rarityData.color,
                fields: [
                    { name: `🆔 Código de Colección`, value: `#${randomCard.id}`, inline: true },
                    { name: `⭐ Rareza`, value: `${rarityData.emoji} ${randomCard.rarity}`, inline: true },
                    { name: `⚔️ Ataque / 🛡️ Defensa`, value: `${randomCard.attack} / ${randomCard.defense}`, inline: true }
                ],
                footer: '¡Sé el primero en reclamarla con /claim!'
            });
            
            await interaction.channel.send({ embeds: [dropEmbed] });
            
            const stmt = db.prepare('INSERT INTO card_drops (card_id) VALUES (?)');
            stmt.run([randomCard.id], (err) => {
                if(err) logger.error("Error al guardar drop en BD:", err);
            });
            stmt.finalize();
        }
        
        await interaction.editReply({ 
            embeds: [createEmbed({ 
                description: '✅ ¡5 cartas han sido lanzadas al canal!', 
                color: config.bot.colors.success 
            })] 
        });
    }
};

// ========================================
// REGISTRO DE COMANDOS
// ========================================
registerCommand(dropCommand);
registerCommand(claimCommand);
registerCommand(inventoryCommand);
registerCommand(collectionCommand);
registerCommand(cardinfoCommand);
registerCommand(sellCommand);
registerCommand(shopCommand);
registerCommand(buyCommand);
registerCommand(balanceCommand);
registerCommand(dailyCommand);
registerCommand(giftCommand);
registerCommand(createpackCommand);
registerCommand(buypackCommand);
registerCommand(listpacksCommand);
registerCommand(profileCommand);
registerCommand(leaderboardCommand);
registerCommand(duelCommand);
registerCommand(tradeCommand);
registerCommand(tradeofferCommand);
registerCommand(addcardCommand);
registerCommand(addmoneyCommand);
registerCommand(removemoneyCommand);
registerCommand(resetuserCommand);
registerCommand(massdropCommand);

// ========================================
// EVENTOS DEL BOT
// ========================================
client.once('ready', async () => {
    logger.info(`Bot conectado como ${client.user.tag}!`);
    
    // Precargar cartas en caché
    await getAllCards();
    
    // Registrar comandos slash
    try {
        const commandData = Array.from(commands.values()).map(cmd => cmd.data);
        await client.application.commands.set(commandData);
        logger.info('Comandos slash registrados globalmente.');
    } catch (error) { 
        logger.error('Error al registrar comandos:', error); 
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isButton()) return;
    
    const { commandName, user } = interaction;
    
    // Manejo de botones
    if (interaction.isButton()) {
        // Los botones se manejan dentro de los comandos correspondientes
        return;
    }
    
    // Verificar si el usuario existe
    try {
        await ensureUserExists(user.id, user.username);
    } catch (error) {
        logger.error('Error al verificar usuario en BD:', error);
        return interaction.reply({ 
            embeds: [createEmbed({ 
                description: 'Ocurrió un error crítico al verificar tu usuario. Contacta a un admin.', 
                color: config.bot.colors.error 
            })], 
            ephemeral: true 
        });
    }
    
    // Verificar restricciones de canal
    const command = commands.get(commandName);
    if (!command) return;
    
    const { category } = command;
    const isGameChannel = interaction.channelId === GAME_CHANNEL_ID;
    const isAdminChannel = interaction.channelId === ADMIN_CHANNEL_ID;
    
    if (category === 'admin' && !isAdminChannel) {
        return interaction.reply({ 
            embeds: [createEmbed({ 
                description: `❌ Este comando solo puede usarse en el canal de administración.`, 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
    }
    
    if ((category === 'cards' || category === 'economy' || category === 'social' || category === 'game') && !isGameChannel) {
        return interaction.reply({ 
            embeds: [createEmbed({ 
                description: `❌ Este comando solo puede usarse en el canal de juego.`, 
                color: config.bot.colors.warning 
            })], 
            ephemeral: true 
        });
    }
    
    // Verificar cooldowns
    const { cooldown } = command;
    if (cooldown) {
        const hasCooldown = checkCooldown(user.id, commandName, cooldown);
        if (hasCooldown) {
            return interaction.reply({ 
                embeds: [createEmbed({ 
                    title: '¡Calma!', 
                    description: `Debes esperar ${hasCooldown} segundos para volver a usar este comando.`, 
                    color: config.bot.colors.warning 
                })], 
                ephemeral: true 
            });
        }
    }
    
    // Ejecutar comando
    try {
        await command.execute(interaction, client);
        logger.info(`Comando ejecutado: /${commandName} por ${user.tag}`);
    } catch (error) {
        logger.error(`Error al ejecutar el comando /${commandName}:`, error);
        const errorMessage = interaction.replied || interaction.deferred
            ? 'Hubo un error al procesar tu comando.'
            : { 
                embeds: [createEmbed({ 
                    title: 'Error', 
                    description: 'Hubo un error al procesar tu comando.', 
                    color: config.bot.colors.error 
                })], 
                ephemeral: true 
            };
        
        await interaction[interaction.replied || interaction.deferred ? 'editReply' : 'reply'](errorMessage);
    }
});

// ========================================
// INICIO DE SESIÓN DEL BOT
// ========================================
client.login(process.env.DISCORD_TOKEN).catch(err => { 
    logger.error('Error al iniciar sesión: Asegúrate de que DISCORD_TOKEN está configurado correctamente.'); 
    logger.error(err); 
});
