// ========================================
// IMPORTACIONES Y CONFIGURACIÓN INICIAL
// ========================================
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// --- IDs DE CANALES (CAMBIA ESTOS POR LOS TUYOS) ---
const ADMIN_CHANNEL_ID = '1438587692097998878';
const GAME_CHANNEL_ID = '1438587851154653374';

// ========================================
// INICIALIZACIÓN DEL CLIENTE DE DISCORD
// ========================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ========================================
// CONEXIÓN Y PREPARACIÓN DE LA BASE DE DATOS (SQLite)
// ========================================
const db = new sqlite3.Database('./database.sqlite', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos SQLite:', err.message);
    } else {
        console.log('✅ Conectado exitosamente a la base de datos SQLite.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    // Tablas existentes
    db.run(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, money INTEGER NOT NULL DEFAULT 100, last_daily TEXT, duels_won INTEGER DEFAULT 0, duels_lost INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, rarity TEXT NOT NULL CHECK(rarity IN ('Común', 'Raro', 'Épico', 'Legendario')), description TEXT, image_url TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS user_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, card_id INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (card_id) REFERENCES cards(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS card_drops (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, claimed_by TEXT DEFAULT NULL, claimed_at INTEGER DEFAULT NULL, FOREIGN KEY (card_id) REFERENCES cards(id))`);

    // Nuevas tablas para las nuevas funcionalidades
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
        description TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pack_contents (
        pack_id INTEGER,
        card_id INTEGER,
        FOREIGN KEY (pack_id) REFERENCES packs(id),
        FOREIGN KEY (card_id) REFERENCES cards(id)
    )`);

    console.log('📊 Tablas de la base de datos verificadas/creadas.');
    // Poblar paquetes si no existen (ejemplo)
    db.get('SELECT * FROM packs WHERE id = 1', [], (err, pack) => {
        if (!pack) {
            db.run('INSERT INTO packs (name, price, description) VALUES (?, ?, ?)', ['Paquete Básico', 150, 'Un paquete con 3 cartas aleatorias. ¡Garantizado al menos una Rara!']);
        }
    });
}

// ========================================
// FUNCIONES AUXILIARES
// ========================================
function ensureUserExists(userId, username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT user_id FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) return reject(err);
            if (row) return resolve();
            db.run('INSERT INTO users (user_id, username) VALUES (?, ?)', [userId, username], (err) => {
                if (err) return reject(err);
                console.log(`👤 Nuevo usuario registrado: ${username} (${userId})`);
                resolve();
            });
        });
    });
}

function getRarityData(rarity) {
    const rarityMap = {
        'Común': { emoji: '⚪', color: 0x95A5A6, sellPrice: 10 }, // Gris Suave
        'Raro': { emoji: '🔵', color: 0x3498DB, sellPrice: 25 }, // Azul Brillante
        'Épico': { emoji: '🟣', color: 0x9B59B6, sellPrice: 50 }, // Púrpura
        'Legendario': { emoji: '🟡', color: 0xF1C40F, sellPrice: 100 } // Dorado
    };
    return rarityMap[rarity] || { emoji: '❓', color: 0x000000, sellPrice: 5 };
}

// ========================================
// EVENTO: BOT LISTO
// ========================================
client.once('ready', async () => {
    console.log(`🚀 ¡Bot conectado como ${client.user.tag}!`);
    const commands = [
        // --- COMANDOS DE CARTAS (ANTIGUOS Y NUEVOS) ---
        new SlashCommandBuilder().setName('addcard').setDescription('Añade una nueva carta al sistema (Solo Admins)').addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta').setRequired(true)).addStringOption(o => o.setName('rareza').setDescription('Rareza').setRequired(true).setChoices({ name: 'Común', value: 'Común' }, { name: 'Raro', value: 'Raro' }, { name: 'Épico', value: 'Épico' }, { name: 'Legendario', value: 'Legendario' })).addStringOption(o => o.setName('descripcion').setDescription('Descripción').setRequired(true)).addStringOption(o => o.setName('imagen').setDescription('URL de la imagen o GIF').setRequired(true)).addIntegerOption(o => o.setName('precio').setDescription('Precio en la tienda').setRequired(false)),
        new SlashCommandBuilder().setName('drop').setDescription('Lanza una carta aleatoria al canal'),
        new SlashCommandBuilder().setName('claim').setDescription('Reclama la carta que está en drop'),
        new SlashCommandBuilder().setName('inventory').setDescription('Muestra tu inventario de cartas'),
        new SlashCommandBuilder().setName('collection').setDescription('Muestra todas las cartas disponibles en el juego'),
        new SlashCommandBuilder().setName('cardinfo').setDescription('Muestra información de una carta específica').addStringOption(o => o.setName('nombre').setDescription('Nombre exacto de la carta').setRequired(true)),
        new SlashCommandBuilder().setName('sell').setDescription('Vende una carta de tu inventario').addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta a vender').setRequired(true)),
        
        // --- COMANDOS DE TIENDA Y ECONOMÍA ---
        new SlashCommandBuilder().setName('shop').setDescription('Muestra la tienda de cartas'),
        new SlashCommandBuilder().setName('buy').setDescription('Compra una carta específica de la tienda').addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta a comprar').setRequired(true)),
        new SlashCommandBuilder().setName('buypack').setDescription('Compra un paquete de cartas aleatorias').addStringOption(o => o.setName('nombre').setDescription('Nombre del paquete').setRequired(true).setAutocomplete(true)),
        new SlashCommandBuilder().setName('balance').setDescription('Consulta tu saldo de monedas'),
        new SlashCommandBuilder().setName('daily').setDescription('Reclama tu recompensa diaria de 50 monedas'),
        new SlashCommandBuilder().setName('gift').setDescription('Envía monedas a otro usuario').addUserOption(o => o.setName('usuario').setDescription('Usuario que recibirá las monedas').setRequired(true)).addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a enviar').setRequired(true).setMinValue(1)),

        // --- COMANDOS SOCIALES Y DE ESTADO ---
        new SlashCommandBuilder().setName('profile').setDescription('Muestra tu perfil de jugador'),
        new SlashCommandBuilder().setName('leaderboard').setDescription('Muestra las tablas de clasificación').addStringOption(o => o.setName('tipo').setDescription('Tipo de clasificación').setRequired(true).setChoices({ name: '💰 Dinero', value: 'money' }, { name: '📦 Cartas', value: 'cards' })),
        new SlashCommandBuilder().setName('trade').setDescription('Inicia un intercambio de cartas').addUserOption(o => o.setName('usuario').setDescription('Usuario con quien intercambiar').setRequired(true)).addStringOption(o => o.setName('carta').setDescription('Tu carta a ofrecer').setRequired(true)),

        // --- COMANDOS DE DUELOS ---
        new SlashCommandBuilder().setName('duel').setDescription('Reta a un usuario a un duelo de cartas').addUserOption(o => o.setName('usuario').setDescription('Usuario a retar').setRequired(true)).addIntegerOption(o => o.setName('apuesta').setDescription('Cantidad de monedas a apostar').setRequired(true).setMinValue(10)),

        // --- COMANDOS DE ADMINISTRACIÓN ---
        new SlashCommandBuilder().setName('addmoney').setDescription('Añade monedas a un usuario (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('usuario').setDescription('Usuario a modificar').setRequired(true)).addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a añadir').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder().setName('removemoney').setDescription('Quita monedas a un usuario (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('usuario').setDescription('Usuario a modificar').setRequired(true)).addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a quitar').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder().setName('resetuser').setDescription('Borra todos los datos de un usuario (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('usuario').setDescription('Usuario a resetear').setRequired(true)),
        new SlashCommandBuilder().setName('massdrop').setDescription('Lanza 5 cartas aleatorias a la vez (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    ];
    try {
        await client.application.commands.set(commands);
        console.log('📝 Comandos slash registrados globalmente.');
    } catch (error) { console.error('❌ Error al registrar comandos:', error); }
});

// ========================================
// EVENTO: MANEJO DE INTERACCIONES (COMANDOS Y BOTONES)
// ========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isButton()) return;
    const { commandName, channelId, user, customId } = interaction;
    const isGameChannel = channelId === GAME_CHANNEL_ID;
    const isAdminChannel = channelId === ADMIN_CHANNEL_ID;

    try { await ensureUserExists(user.id, user.username); } catch (error) {
        console.error('Error al verificar usuario en BD:', error);
        return interaction.reply({ content: 'Ocurrió un error crítico al verificar tu usuario. Contacta a un admin.', ephemeral: true });
    }

    // --- RESTRICCIONES DE CANAL ---
    const adminCommands = ['addcard', 'addmoney', 'removemoney', 'resetuser', 'massdrop'];
    const gameCommands = ['drop', 'claim', 'inventory', 'collection', 'cardinfo', 'sell', 'shop', 'buy', 'buypack', 'balance', 'daily', 'gift', 'profile', 'leaderboard', 'trade', 'duel'];
    if (adminCommands.includes(commandName) && !isAdminChannel) return interaction.reply({ content: `❌ Este comando solo puede usarse en el canal de administración.`, ephemeral: true });
    if (gameCommands.includes(commandName) && !isGameChannel) return interaction.reply({ content: `❌ Este comando solo puede usarse en el canal de juego.`, ephemeral: true });

    // --- MANEJO DE BOTONES (PARA TRADES) ---
    if (interaction.isButton()) {
        if (customId.startsWith('trade_accept_')) {
            const tradeId = customId.split('_')[2];
            // Lógica para aceptar el trade
            // ... (esto es complejo, lo implementaré en el comando trade)
        }
        if (customId.startsWith('trade_cancel_')) {
            const tradeId = customId.split('_')[2];
            // Lógica para cancelar el trade
            // ...
        }
    }

    // --- MANEJO DE COMANDOS ---
    try {
        switch (commandName) {
            // =================== COMANDOS DE CARTAS ===================
            case 'addcard': {
                const name = interaction.options.getString('nombre');
                const rarity = interaction.options.getString('rareza');
                const description = interaction.options.getString('descripcion');
                const image_url = interaction.options.getString('imagen');
                const price = interaction.options.getInteger('precio') ?? getRarityData(rarity).sellPrice * 3; // Precio por defecto
                const stmt = db.prepare('INSERT INTO cards (name, rarity, description, image_url, price) VALUES (?, ?, ?, ?, ?)');
                stmt.run([name, rarity, description, image_url, price], function(err) {
                    if (err) { if (err.message.includes('UNIQUE constraint failed')) return interaction.reply({ content: `❌ Ya existe una carta llamada "${name}".`, ephemeral: true }); return interaction.reply({ content: '❌ Error al guardar la carta.', ephemeral: true }); }
                    const { emoji, color } = getRarityData(rarity);
                    const embed = new EmbedBuilder().setTitle('✅ Carta Añadida').setDescription(`**${name}** ha sido registrada.`).setThumbnail(image_url).setColor(color).addFields({ name: 'Rareza', value: `${emoji} ${rarity}`, inline: true }, { name: 'Precio', value: `💰 ${price}`, inline: true }).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                    interaction.reply({ embeds: [embed] });
                });
                stmt.finalize(); break;
            }
            case 'drop': { /* (Sin cambios, ya era bueno) */ await interaction.deferReply(); db.get('SELECT * FROM card_drops WHERE claimed_by IS NULL', [], async (err, drop) => { if (err) { console.error(err); return interaction.editReply({ content: '❌ Error al buscar drops activos.' }); } if (drop) return interaction.editReply({ content: '❌ Ya hay una carta en drop. ¡Usa `/claim` para reclamarla!' }); db.get('SELECT * FROM cards ORDER BY RANDOM() LIMIT 1', [], async (err, card) => { if (err) { console.error(err); return interaction.editReply({ content: '❌ Error al obtener una carta aleatoria.' }); } if (!card) return interaction.editReply({ content: '❌ No hay cartas en el sistema. Pide a un admin que añada algunas.' }); const { emoji, color } = getRarityData(card.rarity); const dropEmbed = new EmbedBuilder().setAuthor({ name: '🎉 ¡NUEVA CARTA EN DROP! 🎉', iconURL: client.user.displayAvatarURL() }).setTitle(`**${card.name}**`).setDescription(card.description).setImage(card.image_url).setColor(color).addFields({ name: `🆔 Código de Colección`, value: `#${card.id}`, inline: true }, { name: `⭐ Rareza`, value: `${emoji} ${card.rarity}`, inline: true }).setFooter({ text: '¡Sé el primero en reclamarla con /claim!', iconURL: client.user.displayAvatarURL() }).setTimestamp(); await interaction.editReply({ embeds: [dropEmbed] }); const stmt = db.prepare('INSERT INTO card_drops (card_id) VALUES (?)'); stmt.run([card.id], (err) => { if(err) console.error("Error al guardar drop:", err); }); stmt.finalize(); }); }); break; }
            case 'claim': { /* (Sin cambios, ya era bueno) */ const stmt = db.prepare(`SELECT cd.*, c.name, c.rarity, c.description, c.image_url FROM card_drops cd JOIN cards c ON cd.card_id = c.id WHERE cd.claimed_by IS NULL LIMIT 1`); stmt.get([], async (err, drop) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al buscar el drop actual.', ephemeral: true }); } if (!drop) return interaction.reply({ content: '❌ No hay ninguna carta para reclamar. ¡Usa `/drop` para lanzar una!', ephemeral: true }); const updateStmt = db.prepare('UPDATE card_drops SET claimed_by = ?, claimed_at = ? WHERE id = ?'); updateStmt.run([user.id, Date.now(), drop.id], function(err) { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al reclamar la carta.', ephemeral: true }); } const insertStmt = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)'); insertStmt.run([user.id, drop.card_id], (err) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al añadir la carta a tu inventario.', ephemeral: true }); } const { emoji, color } = getRarityData(drop.rarity); const claimEmbed = new EmbedBuilder().setTitle('🎊 ¡CARTA RECLAMADA! 🎊').setDescription(`¡Felicidades **${user.username}**! Has conseguido la carta **${drop.name}**.`).setThumbnail(drop.image_url).setColor(color).addFields({ name: 'Rareza', value: `${emoji} ${drop.rarity}`, inline: true }, { name: 'Descripción', value: drop.description, inline: false }).setFooter({ text: 'Añadida a tu inventario. Usa /inventory para verla.', iconURL: client.user.displayAvatarURL() }); interaction.reply({ embeds: [claimEmbed] }); }); insertStmt.finalize(); }); updateStmt.finalize(); }); stmt.finalize(); break; }
            case 'inventory': { /* (Sin cambios, ya era bueno) */ const stmt = db.prepare(`SELECT c.id, c.name, c.rarity, c.image_url, COUNT(c.id) as count FROM user_inventory ui JOIN cards c ON ui.card_id = c.id WHERE ui.user_id = ? GROUP BY c.id ORDER BY c.rarity DESC, c.name ASC`); stmt.all([user.id], (err, rows) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al cargar tu inventario.', ephemeral: true }); } if (rows.length === 0) return interaction.reply({ content: 'Tu inventario está vacío. ¡Usa `/claim` para conseguir cartas!', ephemeral: true }); const inventoryEmbed = new EmbedBuilder().setTitle(`📦 Inventario de ${user.username}`).setDescription(`Aquí están tus cartas (${rows.length} tipos distintos):`).setColor(0x2ECC71).setThumbnail(user.displayAvatarURL()).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() }); rows.forEach(card => { const { emoji } = getRarityData(card.rarity); inventoryEmbed.addFields({ name: `${emoji} ${card.name} x${card.count}`, value: `ID: #${card.id}`, inline: true }); }); interaction.reply({ embeds: [inventoryEmbed] }); }); stmt.finalize(); break; }
            case 'collection': {
                const stmt = db.prepare('SELECT * FROM cards ORDER BY rarity DESC, name ASC');
                stmt.all([], (err, rows) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al cargar la colección.', ephemeral: true }); }
                    if (rows.length === 0) return interaction.reply({ content: 'No hay cartas en el sistema.', ephemeral: true });
                    const collectionEmbed = new EmbedBuilder().setTitle('🗂️ Colección Global de Cartas').setDescription(`Todas las cartas (${rows.length} en total):`).setColor(0x34495E).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                    rows.forEach(card => {
                        const { emoji } = getRarityData(card.rarity);
                        collectionEmbed.addFields({ name: `${emoji} ${card.name}`, value: `ID: #${card.id} | 💰 Precio: ${card.price}`, inline: true });
                    });
                    interaction.reply({ embeds: [collectionEmbed] });
                });
                stmt.finalize(); break;
            }
            case 'cardinfo': { /* (Sin cambios, ya era bueno) */ const cardName = interaction.options.getString('nombre'); const stmt = db.prepare('SELECT * FROM cards WHERE name = ?'); stmt.get([cardName], (err, card) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al buscar la carta.', ephemeral: true }); } if (!card) return interaction.reply({ content: `❌ No se encontró ninguna carta llamada "${cardName}".`, ephemeral: true }); const countStmt = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND card_id = ?'); countStmt.get([user.id, card.id], (err, userCard) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tus copias.', ephemeral: true }); } const { emoji, color } = getRarityData(card.rarity); const infoEmbed = new EmbedBuilder().setTitle(`${emoji} ${card.name}`).setDescription(card.description).setImage(card.image_url).setColor(color).addFields({ name: '🆔 Código de Colección', value: `#${card.id}`, inline: true }, { name: '⭐ Rareza', value: `${emoji} ${card.rarity}`, inline: true }, { name: '📊 En tu poder', value: `${userCard.count} copia(s)`, inline: true }, { name: '💰 Precio en Tienda', value: `${card.price} monedas`, inline: true }).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() }); interaction.reply({ embeds: [infoEmbed] }); }); countStmt.finalize(); }); stmt.finalize(); break; }
            case 'sell': {
                const cardName = interaction.options.getString('nombre');
                const cardStmt = db.prepare('SELECT * FROM cards WHERE name = ?');
                cardStmt.get([cardName], (err, card) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al buscar la carta.', ephemeral: true }); }
                    if (!card) return interaction.reply({ content: `❌ No se encontró ninguna carta llamada "${cardName}".`, ephemeral: true });
                    
                    const invStmt = db.prepare('SELECT id FROM user_inventory WHERE user_id = ? AND card_id = ? LIMIT 1');
                    invStmt.get([user.id, card.id], (err, invCard) => {
                        if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tu inventario.', ephemeral: true }); }
                        if (!invCard) return interaction.reply({ content: `❌ No tienes ninguna carta "${cardName}" para vender.`, ephemeral: true });

                        const { sellPrice } = getRarityData(card.rarity);
                        db.serialize(() => {
                            db.run('BEGIN TRANSACTION');
                            const delStmt = db.prepare('DELETE FROM user_inventory WHERE id = ?');
                            delStmt.run([invCard.id]);
                            const addMoneyStmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?');
                            addMoneyStmt.run([sellPrice, user.id]);
                            db.run('COMMIT', (err) => {
                                if (err) { console.error(err); db.run('ROLLBACK'); return interaction.reply({ content: '❌ Error al vender la carta.', ephemeral: true }); }
                                const embed = new EmbedBuilder().setTitle('💰 Carta Vendida').setDescription(`Has vendido **${card.name}** por **${sellPrice} monedas**.`).setColor(0xF1C40F).setThumbnail(card.image_url).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                                interaction.reply({ embeds: [embed] });
                            });
                            delStmt.finalize(); addMoneyStmt.finalize();
                        });
                    });
                    invStmt.finalize();
                });
                cardStmt.finalize(); break;
            }

            // =================== COMANDOS DE TIENDA Y ECONOMÍA ===================
            case 'shop': {
                const stmt = db.prepare('SELECT * FROM cards WHERE price > 0 ORDER BY price ASC, rarity DESC');
                stmt.all([], (err, rows) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al cargar la tienda.', ephemeral: true }); }
                    if (rows.length === 0) return interaction.reply({ content: 'La tienda está vacía. Pide a un admin que ponga cartas a la venta.', ephemeral: true });
                    const shopEmbed = new EmbedBuilder().setTitle('🛒 Tienda de Cartas').setDescription('Usa `/buy` para comprar una carta.').setColor(0xE67E22).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                    rows.forEach(card => {
                        const { emoji } = getRarityData(card.rarity);
                        shopEmbed.addFields({ name: `${emoji} ${card.name}`, value: `💰 ${card.price}`, inline: true });
                    });
                    interaction.reply({ embeds: [shopEmbed] });
                });
                stmt.finalize(); break;
            }
            case 'buy': {
                const cardName = interaction.options.getString('nombre');
                const cardStmt = db.prepare('SELECT * FROM cards WHERE name = ? AND price > 0');
                cardStmt.get([cardName], async (err, card) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al buscar la carta.', ephemeral: true }); }
                    if (!card) return interaction.reply({ content: `❌ "${cardName}" no está disponible en la tienda.`, ephemeral: true });
                    
                    const userStmt = db.prepare('SELECT money FROM users WHERE user_id = ?');
                    userStmt.get([user.id], (err, userData) => {
                        if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tu saldo.', ephemeral: true }); }
                        if (userData.money < card.price) return interaction.reply({ content: `❌ No tienes suficiente dinero. Te faltan ${card.price - userData.money} monedas.`, ephemeral: true });

                        db.serialize(() => {
                            db.run('BEGIN TRANSACTION');
                            const removeMoneyStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?');
                            removeMoneyStmt.run([card.price, user.id]);
                            const addCardStmt = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                            addCardStmt.run([user.id, card.id]);
                            db.run('COMMIT', (err) => {
                                if (err) { console.error(err); db.run('ROLLBACK'); return interaction.reply({ content: '❌ Error al realizar la compra.', ephemeral: true }); }
                                const { emoji } = getRarityData(card.rarity);
                                const embed = new EmbedBuilder().setTitle('🛍️ Compra Realizada').setDescription(`Has comprado **${card.name}** por **${card.price} monedas**.`).setColor(0x2ECC71).setThumbnail(card.image_url).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                                interaction.reply({ embeds: [embed] });
                            });
                            removeMoneyStmt.finalize(); addCardStmt.finalize();
                        });
                    });
                    userStmt.finalize();
                });
                cardStmt.finalize(); break;
            }
            case 'buypack': {
                const packName = interaction.options.getString('nombre');
                // Lógica para comprar paquetes (compleja, requiere definir paquetes y su contenido)
                // Por ahora, un mensaje de que está en desarrollo
                interaction.reply({ content: '🚧 ¡Función de paquetes en desarrollo! Próximamente podrás comprar cajas con sorpresas.', ephemeral: true });
                break;
            }
            case 'balance': { /* (Sin cambios, ya era bueno) */ const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?'); stmt.get([user.id], (err, row) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al obtener tu saldo.', ephemeral: true }); } const balanceEmbed = new EmbedBuilder().setTitle(`💰 Saldo de ${user.username}`).setDescription(`Tienes un total de **${row.money} monedas**.`).setColor(0xF1C40F).setThumbnail(user.displayAvatarURL()).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() }); interaction.reply({ embeds: [balanceEmbed] }); }); stmt.finalize(); break; }
            case 'daily': { /* (Sin cambios, ya era bueno) */ const today = new Date().toISOString().slice(0, 10); const stmt = db.prepare('SELECT last_daily FROM users WHERE user_id = ?'); stmt.get([user.id], (err, row) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tu recompensa diaria.', ephemeral: true }); } if (row && row.last_daily === today) return interaction.reply({ content: '❌ Ya has reclamado tu recompensa diaria hoy. ¡Vuelve mañana!', ephemeral: true }); const updateStmt = db.prepare('UPDATE users SET money = money + 50, last_daily = ? WHERE user_id = ?'); updateStmt.run([today, user.id], (err) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al añadir tus monedas.', ephemeral: true }); } const dailyEmbed = new EmbedBuilder().setTitle('🎁 Recompensa Diaria Recibida').setDescription('Has recibido **50 monedas** por tu actividad diaria.\n¡Vuelve mañana para reclamar más!').setColor(0x2ECC71).setThumbnail(user.displayAvatarURL()).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() }).setTimestamp(); interaction.reply({ embeds: [dailyEmbed] }); }); updateStmt.finalize(); }); stmt.finalize(); break; }
            case 'gift': { /* (Sin cambios, ya era bueno) */ const targetUser = interaction.options.getUser('usuario'); const amount = interaction.options.getInteger('cantidad'); if (targetUser.id === user.id) return interaction.reply({ content: '❌ No puedes regalarte monedas a ti mismo.', ephemeral: true }); await ensureUserExists(targetUser.id, targetUser.username); const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?'); stmt.get([user.id], (err, senderRow) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tu saldo.', ephemeral: true }); } if (senderRow.money < amount) return interaction.reply({ content: `❌ No tienes suficiente dinero. Tu saldo es de ${senderRow.money} monedas.`, ephemeral: true }); db.serialize(() => { db.run('BEGIN TRANSACTION'); const removeStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?'); removeStmt.run([amount, user.id]); const addStmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?'); addStmt.run([amount, targetUser.id]); db.run('COMMIT', (err) => { if (err) { console.error(err); db.run('ROLLBACK'); return interaction.reply({ content: '❌ La transferencia falló. Por favor, inténtalo de nuevo.', ephemeral: true }); } const giftEmbed = new EmbedBuilder().setTitle('💸 Transferencia Exitosa').setDescription(`**${user.username}** le ha regalado **${amount} monedas** a **${targetUser.username}**.`).setColor(0x3498DB).setThumbnail(user.displayAvatarURL()).setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() }); interaction.reply({ embeds: [giftEmbed] }); }); removeStmt.finalize(); addStmt.finalize(); }); }); stmt.finalize(); break; }

            // =================== COMANDOS SOCIALES Y DE ESTADO ===================
            case 'profile': {
                const userStmt = db.prepare('SELECT money, duels_won, duels_lost FROM users WHERE user_id = ?');
                userStmt.get([user.id], (err, userData) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al cargar tu perfil.', ephemeral: true }); }
                    const invStmt = db.prepare('SELECT COUNT(*) as total_cards FROM user_inventory WHERE user_id = ?');
                    invStmt.get([user.id], (err, invData) => {
                        if (err) { console.error(err); return interaction.reply({ content: '❌ Error al cargar tu inventario.', ephemeral: true }); }
                        const totalDuels = userData.duels_won + userData.duels_lost;
                        const winRate = totalDuels > 0 ? ((userData.duels_won / totalDuels) * 100).toFixed(1) : 0;
                        const embed = new EmbedBuilder()
                            .setTitle(`📜 Perfil de ${user.username}`)
                            .setThumbnail(user.displayAvatarURL())
                            .setColor(0x9B59B6)
                            .addFields(
                                { name: '💰 Dinero', value: `${userData.money} monedas`, inline: true },
                                { name: '📦 Cartas Totales', value: `${invData.total_cards}`, inline: true },
                                { name: '⚔️ Duelos', value: `Ganados: ${userData.duels_won} | Perdidos: ${userData.duels_lost}`, inline: false },
                                { name: '📈 Tasa de Victoria', value: `${winRate}%`, inline: true }
                            )
                            .setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                        interaction.reply({ embeds: [embed] });
                    });
                    invStmt.finalize();
                });
                userStmt.finalize(); break;
            }
            case 'leaderboard': {
                const type = interaction.options.getString('tipo');
                let query, title, emoji;
                if (type === 'money') { query = 'SELECT username, money FROM users ORDER BY money DESC LIMIT 10'; title = 'Tabla de Riqueza'; emoji = '💰'; }
                else { query = 'SELECT u.username, COUNT(ui.id) as total_cards FROM users u LEFT JOIN user_inventory ui ON u.user_id = ui.user_id GROUP BY u.user_id ORDER BY total_cards DESC LIMIT 10'; title = 'Tabla de Coleccionistas'; emoji = '📦'; }
                
                db.all(query, [], (err, rows) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al cargar la tabla de clasificación.', ephemeral: true }); }
                    const embed = new EmbedBuilder().setTitle(`${emoji} ${title}`).setColor(0xF39C12);
                    if (rows.length === 0) { embed.setDescription('No hay datos para mostrar.'); }
                    else {
                        const description = rows.map((row, index) => {
                            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                            const value = type === 'money' ? row.money : row.total_cards;
                            return `${medal} **${row.username}** - ${value}`;
                        }).join('\n');
                        embed.setDescription(description);
                    }
                    embed.setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                    interaction.reply({ embeds: [embed] });
                });
                break;
            }
            case 'trade': {
                const targetUser = interaction.options.getUser('usuario');
                const cardName = interaction.options.getString('carta');
                if (targetUser.id === user.id) return interaction.reply({ content: '❌ No puedes intercambiar contigo mismo.', ephemeral: true });
                
                // Lógica de trade compleja (verificar si la carta existe, si el usuario la tiene, etc.)
                // Por ahora, un mensaje de desarrollo
                interaction.reply({ content: '🚧 ¡Función de intercambios en desarrollo! Próximamente podrás hacer trades seguros.', ephemeral: true });
                break;
            }

            // =================== COMANDOS DE DUELOS ===================
            case 'duel': {
                const targetUser = interaction.options.getUser('usuario');
                const betAmount = interaction.options.getInteger('apuesta');
                if (targetUser.id === user.id) return interaction.reply({ content: '❌ No puedes retarte a ti mismo.', ephemeral: true });
                
                const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?');
                stmt.get([user.id], (err, userData) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tu saldo.', ephemeral: true }); }
                    if (userData.money < betAmount) return interaction.reply({ content: `❌ No tienes suficiente dinero para apostar ${betAmount}.`, ephemeral: true });

                    const embed = new EmbedBuilder()
                        .setTitle('⚔️ ¡Desafío de Duelo! ⚔️')
                        .setDescription(`**${user.username}** ha retado a **${targetUser.username}** a un duelo por **${betAmount} monedas**.\n\n${targetUser.username}, ¿aceptas el reto?`)
                        .setColor(0xE74C3C);
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`duel_accept_${user.id}_${targetUser.id}_${betAmount}`).setLabel('Aceptar Duelo').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`duel_decline_${user.id}_${targetUser.id}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger)
                    );
                    
                    interaction.reply({ content: `${targetUser}`, embeds: [embed], components: [row], fetchReply: true }).then(msg => {
                        // Crear un colector para los botones
                        const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 }); // 60 segundos

                        collector.on('collect', async i => {
                            if (i.user.id !== targetUser.id) {
                                await i.reply({ content: 'No puedes responder a este desafío.', ephemeral: true });
                                return;
                            }

                            collector.stop();
                            if (i.customId.startsWith('duel_accept')) {
                                // Lógica del duelo
                                const winner = Math.random() < 0.5 ? user : targetUser;
                                const winnerId = winner.id;
                                const loserId = winner.id === user.id ? targetUser.id : user.id;
                                const winAmount = betAmount * 2; // El ganador se lleva el doble

                                db.serialize(() => {
                                    db.run('BEGIN TRANSACTION');
                                    const updateWinnerStmt = db.prepare('UPDATE users SET money = money + ?, duels_won = duels_won + 1 WHERE user_id = ?');
                                    updateWinnerStmt.run([betAmount, winnerId]);
                                    const updateLoserStmt = db.prepare('UPDATE users SET money = money - ?, duels_lost = duels_lost + 1 WHERE user_id = ?');
                                    updateLoserStmt.run([betAmount, loserId]);
                                    db.run('COMMIT', (err) => {
                                        if (err) { console.error(err); db.run('ROLLBACK'); return i.update({ content: 'Ocurrió un error durante el duelo.', components: [] }); }
                                        
                                        const resultEmbed = new EmbedBuilder()
                                            .setTitle('🏆 ¡Duelo Terminado!')
                                            .setDescription(`**${winner.username}** ha ganado el duelo y se lleva **${winAmount} monedas**.\nMejor suerte la próxima vez, **${loserId === user.id ? user.username : targetUser.username}**.`)
                                            .setColor(winner.id === user.id ? 0x2ECC71 : 0xE74C3C);
                                        i.update({ embeds: [resultEmbed], components: [] });
                                    });
                                    updateWinnerStmt.finalize(); updateLoserStmt.finalize();
                                });
                            } else {
                                await i.update({ content: `${targetUser.username} ha rechazado el duelo.`, embeds: [], components: [] });
                            }
                        });

                        collector.on('end', collected => {
                            if (collected.size === 0) {
                                interaction.editReply({ content: 'El desafío de duelo expiró.', embeds: [], components: [] });
                            }
                        });
                    });
                });
                stmt.finalize(); break;
            }

            // =================== COMANDOS DE ADMINISTRACIÓN ===================
            case 'addmoney': { /* (Sin cambios, ya era bueno) */ const targetUser = interaction.options.getUser('usuario'); const amount = interaction.options.getInteger('cantidad'); await ensureUserExists(targetUser.id, targetUser.username); const stmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?'); stmt.run([amount, targetUser.id], (err) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al añadir dinero.', ephemeral: true }); } interaction.reply(`✅ Se han añadido **${amount}** monedas a **${targetUser.username}**.`); }); stmt.finalize(); break; }
            case 'removemoney': { /* (Sin cambios, ya era bueno) */ const targetUser = interaction.options.getUser('usuario'); const amount = interaction.options.getInteger('cantidad'); const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?'); stmt.get([targetUser.id], (err, row) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar saldo del usuario.', ephemeral: true }); } if (row.money < amount) return interaction.reply({ content: `❌ El usuario solo tiene ${row.money} monedas. No se pueden quitar ${amount}.`, ephemeral: true }); const updateStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?'); updateStmt.run([amount, targetUser.id], (err) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al quitar dinero.', ephemeral: true }); } interaction.reply(`✅ Se han quitado **${amount}** monedas a **${targetUser.username}**.`); }); updateStmt.finalize(); }); stmt.finalize(); break; }
            case 'resetuser': { /* (Sin cambios, ya era bueno) */ const targetUser = interaction.options.getUser('usuario'); db.serialize(() => { const deleteStmt = db.prepare('DELETE FROM user_inventory WHERE user_id = ?'); deleteStmt.run([targetUser.id]); const updateStmt = db.prepare('UPDATE users SET money = 100, last_daily = NULL, duels_won = 0, duels_lost = 0 WHERE user_id = ?'); updateStmt.run([targetUser.id], (err) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al resetear al usuario.', ephemeral: true }); } interaction.reply(`✅ Todos los datos de **${targetUser.username}** han sido eliminados. Su saldo ahora es de 100 monedas.`); }); deleteStmt.finalize(); updateStmt.finalize(); }); break; }
            case 'massdrop': {
                await interaction.deferReply();
                for (let i = 0; i < 5; i++) {
                    db.get('SELECT * FROM cards ORDER BY RANDOM() LIMIT 1', [], async (err, card) => {
                        if (err || !card) return;
                        const { emoji, color } = getRarityData(card.rarity);
                        const dropEmbed = new EmbedBuilder().setAuthor({ name: '🎉 ¡NUEVA CARTA EN DROP! 🎉', iconURL: client.user.displayAvatarURL() }).setTitle(`**${card.name}**`).setDescription(card.description).setImage(card.image_url).setColor(color).addFields({ name: `🆔 Código de Colección`, value: `#${card.id}`, inline: true }, { name: `⭐ Rareza`, value: `${emoji} ${card.rarity}`, inline: true }).setFooter({ text: '¡Sé el primero en reclamarla con /claim!', iconURL: client.user.displayAvatarURL() }).setTimestamp();
                        await interaction.channel.send({ embeds: [dropEmbed] });
                        const stmt = db.prepare('INSERT INTO card_drops (card_id) VALUES (?)');
                        stmt.run([card.id], (err) => { if(err) console.error("Error al guardar drop:", err); });
                        stmt.finalize();
                    });
                }
                await interaction.editReply('✅ ¡5 cartas han sido lanzadas al canal!');
                break;
            }
        }
    } catch (error) { console.error(`Error inesperado en el comando ${commandName}:`, error); if (!interaction.replied) { interaction.reply({ content: '❌ Ocurrió un error inesperado al ejecutar el comando.', ephemeral: true }); } }
});

// ========================================
// INICIO DE SESIÓN DEL BOT
// ========================================
client.login(process.env.DISCORD_TOKEN).catch(err => { console.error('❌ Error al iniciar sesión: Asegúrate de que DISCORD_TOKEN está configurado correctamente en Railway.'); console.error(err); });
