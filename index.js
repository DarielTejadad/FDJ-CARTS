// ========================================
// IMPORTACIONES Y CONFIGURACIÓN INICIAL
// ========================================
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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
    db.run(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, money INTEGER NOT NULL DEFAULT 100, last_daily TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, rarity TEXT NOT NULL CHECK(rarity IN ('Común', 'Raro', 'Épico', 'Legendario')), description TEXT, image_url TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS user_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, card_id INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(user_id), FOREIGN KEY (card_id) REFERENCES cards(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS card_drops (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, claimed_by TEXT DEFAULT NULL, claimed_at INTEGER DEFAULT NULL, FOREIGN KEY (card_id) REFERENCES cards(id))`);
    console.log('📊 Tablas de la base de datos verificadas/creadas.');
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
        'Común': { emoji: '⚪', color: 0x95A5A6 },      // Gris Suave
        'Raro': { emoji: '🔵', color: 0x3498DB },       // Azul Brillante
        'Épico': { emoji: '🟣', color: 0x9B59B6 },      // Púrpura
        'Legendario': { emoji: '🟡', color: 0xF1C40F }   // Dorado
    };
    return rarityMap[rarity] || { emoji: '❓', color: 0x000000 };
}

// ========================================
// EVENTO: BOT LISTO
// ========================================
client.once('ready', async () => {
    console.log(`🚀 ¡Bot conectado como ${client.user.tag}!`);
    const commands = [
        new SlashCommandBuilder().setName('addcard').setDescription('Añade una nueva carta al sistema (Solo Admins)').addStringOption(o => o.setName('nombre').setDescription('Nombre de la carta').setRequired(true)).addStringOption(o => o.setName('rareza').setDescription('Rareza').setRequired(true).setChoices({ name: 'Común', value: 'Común' }, { name: 'Raro', value: 'Raro' }, { name: 'Épico', value: 'Épico' }, { name: 'Legendario', value: 'Legendario' })).addStringOption(o => o.setName('descripcion').setDescription('Descripción').setRequired(true)).addStringOption(o => o.setName('imagen').setDescription('URL de la imagen o GIF').setRequired(true)),
        new SlashCommandBuilder().setName('drop').setDescription('Lanza una carta aleatoria al canal'),
        new SlashCommandBuilder().setName('claim').setDescription('Reclama la carta que está en drop'),
        new SlashCommandBuilder().setName('inventory').setDescription('Muestra tu inventario de cartas'),
        new SlashCommandBuilder().setName('cardinfo').setDescription('Muestra información de una carta específica').addStringOption(o => o.setName('nombre').setDescription('Nombre exacto de la carta').setRequired(true)),
        new SlashCommandBuilder().setName('balance').setDescription('Consulta tu saldo de monedas'),
        new SlashCommandBuilder().setName('daily').setDescription('Reclama tu recompensa diaria de 50 monedas'),
        new SlashCommandBuilder().setName('gift').setDescription('Envía monedas a otro usuario').addUserOption(o => o.setName('usuario').setDescription('Usuario que recibirá las monedas').setRequired(true)).addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a enviar').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder().setName('addmoney').setDescription('Añade monedas a un usuario (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('usuario').setDescription('Usuario a modificar').setRequired(true)).addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a añadir').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder().setName('removemoney').setDescription('Quita monedas a un usuario (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('usuario').setDescription('Usuario a modificar').setRequired(true)).addIntegerOption(o => o.setName('cantidad').setDescription('Cantidad a quitar').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder().setName('resetuser').setDescription('Borra todos los datos de un usuario (Solo Admins)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName('usuario').setDescription('Usuario a resetear').setRequired(true)),
    ];
    try {
        await client.application.commands.set(commands);
        console.log('📝 Comandos slash registrados globalmente.');
    } catch (error) { console.error('❌ Error al registrar comandos:', error); }
});

// ========================================
// EVENTO: MANEJO DE INTERACCIONES (COMANDOS)
// ========================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const { commandName, channelId, user } = interaction;
    const isGameChannel = channelId === GAME_CHANNEL_ID;
    const isAdminChannel = channelId === ADMIN_CHANNEL_ID;

    try { await ensureUserExists(user.id, user.username); } catch (error) {
        console.error('Error al verificar usuario en BD:', error);
        return interaction.reply({ content: 'Ocurrió un error crítico al verificar tu usuario. Contacta a un admin.', ephemeral: true });
    }

    const adminCommands = ['addcard', 'addmoney', 'removemoney', 'resetuser'];
    const gameCommands = ['drop', 'claim', 'inventory', 'cardinfo', 'balance', 'daily', 'gift'];
    if (adminCommands.includes(commandName) && !isAdminChannel) return interaction.reply({ content: `❌ Este comando solo puede usarse en el canal de administración.`, ephemeral: true });
    if (gameCommands.includes(commandName) && !isGameChannel) return interaction.reply({ content: `❌ Este comando solo puede usarse en el canal de juego.`, ephemeral: true });

    try {
        switch (commandName) {
            // =================== COMANDOS DE CARTAS ===================
            case 'addcard': {
                const name = interaction.options.getString('nombre');
                const rarity = interaction.options.getString('rareza');
                const description = interaction.options.getString('descripcion');
                const image_url = interaction.options.getString('imagen');
                const stmt = db.prepare('INSERT INTO cards (name, rarity, description, image_url) VALUES (?, ?, ?, ?)');
                stmt.run([name, rarity, description, image_url], function(err) {
                    if (err) { if (err.message.includes('UNIQUE constraint failed')) return interaction.reply({ content: `❌ Ya existe una carta llamada "${name}".`, ephemeral: true }); return interaction.reply({ content: '❌ Error al guardar la carta.', ephemeral: true }); }
                    const { emoji, color } = getRarityData(rarity);
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Carta Añadida al Sistema')
                        .setDescription(`La carta **${name}** ha sido registrada.`)
                        .setThumbnail(image_url)
                        .setColor(color)
                        .addFields({ name: 'Rareza', value: `${emoji} ${rarity}`, inline: true }, { name: 'Descripción', value: description, inline: false })
                        .setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                    interaction.reply({ embeds: [embed] });
                });
                stmt.finalize();
                break;
            }

            case 'drop': {
                await interaction.deferReply(); // Permite más tiempo para la respuesta
                db.get('SELECT * FROM card_drops WHERE claimed_by IS NULL', [], async (err, drop) => {
                    if (err) { console.error(err); return interaction.editReply({ content: '❌ Error al buscar drops activos.' }); }
                    if (drop) return interaction.editReply({ content: '❌ Ya hay una carta en drop. ¡Usa `/claim` para reclamarla!' });
                    db.get('SELECT * FROM cards ORDER BY RANDOM() LIMIT 1', [], async (err, card) => {
                        if (err) { console.error(err); return interaction.editReply({ content: '❌ Error al obtener una carta aleatoria.' }); }
                        if (!card) return interaction.editReply({ content: '❌ No hay cartas en el sistema. Pide a un admin que añada algunas.' });
                        
                        const { emoji, color } = getRarityData(card.rarity);
                        const dropEmbed = new EmbedBuilder()
                            .setAuthor({ name: '🎉 ¡NUEVA CARTA EN DROP! 🎉', iconURL: client.user.displayAvatarURL() })
                            .setTitle(`**${card.name}**`)
                            .setDescription(card.description)
                            .setImage(card.image_url)
                            .setColor(color)
                            .addFields(
                                { name: `🆔 Código de Colección`, value: `#${card.id}`, inline: true },
                                { name: `⭐ Rareza`, value: `${emoji} ${card.rarity}`, inline: true }
                            )
                            .setFooter({ text: '¡Sé el primero en reclamarla con /claim!', iconURL: client.user.displayAvatarURL() })
                            .setTimestamp();
                        
                        await interaction.editReply({ embeds: [dropEmbed] });
                        const stmt = db.prepare('INSERT INTO card_drops (card_id) VALUES (?)');
                        stmt.run([card.id], (err) => { if(err) console.error("Error al guardar drop:", err); });
                        stmt.finalize();
                    });
                });
                break;
            }

            case 'claim': {
                const stmt = db.prepare(`SELECT cd.*, c.name, c.rarity, c.description, c.image_url FROM card_drops cd JOIN cards c ON cd.card_id = c.id WHERE cd.claimed_by IS NULL LIMIT 1`);
                stmt.get([], async (err, drop) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al buscar el drop actual.', ephemeral: true }); }
                    if (!drop) return interaction.reply({ content: '❌ No hay ninguna carta para reclamar. ¡Usa `/drop` para lanzar una!', ephemeral: true });
                    
                    const updateStmt = db.prepare('UPDATE card_drops SET claimed_by = ?, claimed_at = ? WHERE id = ?');
                    updateStmt.run([user.id, Date.now(), drop.id], function(err) {
                        if (err) { console.error(err); return interaction.reply({ content: '❌ Error al reclamar la carta.', ephemeral: true }); }
                        
                        const insertStmt = db.prepare('INSERT INTO user_inventory (user_id, card_id) VALUES (?, ?)');
                        insertStmt.run([user.id, drop.card_id], (err) => {
                            if (err) { console.error(err); return interaction.reply({ content: '❌ Error al añadir la carta a tu inventario.', ephemeral: true }); }
                            
                            const { emoji, color } = getRarityData(drop.rarity);
                            const claimEmbed = new EmbedBuilder()
                                .setTitle('🎊 ¡CARTA RECLAMADA! 🎊')
                                .setDescription(`¡Felicidades **${user.username}**! Has conseguido la carta **${drop.name}**.`)
                                .setThumbnail(drop.image_url)
                                .setColor(color)
                                .addFields({ name: 'Rareza', value: `${emoji} ${drop.rarity}`, inline: true }, { name: 'Descripción', value: drop.description, inline: false })
                                .setFooter({ text: 'Añadida a tu inventario. Usa /inventory para verla.', iconURL: client.user.displayAvatarURL() });
                            
                            interaction.reply({ embeds: [claimEmbed] });
                        });
                        insertStmt.finalize();
                    });
                    updateStmt.finalize();
                });
                stmt.finalize();
                break;
            }

            case 'inventory': {
                const stmt = db.prepare(`SELECT c.id, c.name, c.rarity, c.image_url, COUNT(c.id) as count FROM user_inventory ui JOIN cards c ON ui.card_id = c.id WHERE ui.user_id = ? GROUP BY c.id ORDER BY c.rarity DESC, c.name ASC`);
                stmt.all([user.id], (err, rows) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al cargar tu inventario.', ephemeral: true }); }
                    if (rows.length === 0) return interaction.reply({ content: 'Tu inventario está vacío. ¡Usa `/claim` para conseguir cartas!', ephemeral: true });

                    const inventoryEmbed = new EmbedBuilder()
                        .setTitle(`📦 Inventario de ${user.username}`)
                        .setDescription(`Aquí están tus cartas (${rows.length} tipos distintos):`)
                        .setColor(0x2ECC71) // Verde esmeralda
                        .setThumbnail(user.displayAvatarURL())
                        .setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });

                    rows.forEach(card => {
                        const { emoji } = getRarityData(card.rarity);
                        inventoryEmbed.addFields({ name: `${emoji} ${card.name} x${card.count}`, value: `ID: #${card.id}`, inline: true });
                    });
                    interaction.reply({ embeds: [inventoryEmbed] });
                });
                stmt.finalize();
                break;
            }

            case 'cardinfo': {
                const cardName = interaction.options.getString('nombre');
                const stmt = db.prepare('SELECT * FROM cards WHERE name = ?');
                stmt.get([cardName], (err, card) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al buscar la carta.', ephemeral: true }); }
                    if (!card) return interaction.reply({ content: `❌ No se encontró ninguna carta llamada "${cardName}".`, ephemeral: true });
                    
                    const countStmt = db.prepare('SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND card_id = ?');
                    countStmt.get([user.id, card.id], (err, userCard) => {
                        if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tus copias.', ephemeral: true }); }
                        const { emoji, color } = getRarityData(card.rarity);
                        const infoEmbed = new EmbedBuilder()
                            .setTitle(`${emoji} ${card.name}`)
                            .setDescription(card.description)
                            .setImage(card.image_url)
                            .setColor(color)
                            .addFields(
                                { name: '🆔 Código de Colección', value: `#${card.id}`, inline: true },
                                { name: '⭐ Rareza', value: `${emoji} ${card.rarity}`, inline: true },
                                { name: '📊 En tu poder', value: `${userCard.count} copia(s)`, inline: true }
                            )
                            .setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                        interaction.reply({ embeds: [infoEmbed] });
                    });
                    countStmt.finalize();
                });
                stmt.finalize();
                break;
            }

            // =================== COMANDOS DE ECONOMÍA ===================
            case 'balance': {
                const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?');
                stmt.get([user.id], (err, row) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al obtener tu saldo.', ephemeral: true }); }
                    const balanceEmbed = new EmbedBuilder()
                        .setTitle(`💰 Saldo de ${user.username}`)
                        .setDescription(`Tienes un total de **${row.money} monedas**.`)
                        .setColor(0xF1C40F) // Dorado
                        .setThumbnail(user.displayAvatarURL())
                        .setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                    interaction.reply({ embeds: [balanceEmbed] });
                });
                stmt.finalize();
                break;
            }

            case 'daily': {
                const today = new Date().toISOString().slice(0, 10);
                const stmt = db.prepare('SELECT last_daily FROM users WHERE user_id = ?');
                stmt.get([user.id], (err, row) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tu recompensa diaria.', ephemeral: true }); }
                    if (row && row.last_daily === today) return interaction.reply({ content: '❌ Ya has reclamado tu recompensa diaria hoy. ¡Vuelve mañana!', ephemeral: true });

                    const updateStmt = db.prepare('UPDATE users SET money = money + 50, last_daily = ? WHERE user_id = ?');
                    updateStmt.run([today, user.id], (err) => {
                        if (err) { console.error(err); return interaction.reply({ content: '❌ Error al añadir tus monedas.', ephemeral: true }); }
                        const dailyEmbed = new EmbedBuilder()
                            .setTitle('🎁 Recompensa Diaria Recibida')
                            .setDescription('Has recibido **50 monedas** por tu actividad diaria.\n¡Vuelve mañana para reclamar más!')
                            .setColor(0x2ECC71) // Verde
                            .setThumbnail(user.displayAvatarURL())
                            .setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() })
                            .setTimestamp();
                        interaction.reply({ embeds: [dailyEmbed] });
                    });
                    updateStmt.finalize();
                });
                stmt.finalize();
                break;
            }

            case 'gift': {
                const targetUser = interaction.options.getUser('usuario');
                const amount = interaction.options.getInteger('cantidad');
                if (targetUser.id === user.id) return interaction.reply({ content: '❌ No puedes regalarte monedas a ti mismo.', ephemeral: true });
                await ensureUserExists(targetUser.id, targetUser.username);

                const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?');
                stmt.get([user.id], (err, senderRow) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar tu saldo.', ephemeral: true }); }
                    if (senderRow.money < amount) return interaction.reply({ content: `❌ No tienes suficiente dinero. Tu saldo es de ${senderRow.money} monedas.`, ephemeral: true });

                    db.serialize(() => {
                        db.run('BEGIN TRANSACTION');
                        const removeStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?');
                        removeStmt.run([amount, user.id]);
                        const addStmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?');
                        addStmt.run([amount, targetUser.id]);
                        db.run('COMMIT', (err) => {
                            if (err) { console.error(err); db.run('ROLLBACK'); return interaction.reply({ content: '❌ La transferencia falló. Por favor, inténtalo de nuevo.', ephemeral: true }); }
                            const giftEmbed = new EmbedBuilder()
                                .setTitle('💸 Transferencia Exitosa')
                                .setDescription(`**${user.username}** le ha regalado **${amount} monedas** a **${targetUser.username}**.`)
                                .setColor(0x3498DB) // Azul
                                .setThumbnail(user.displayAvatarURL())
                                .setFooter({ text: 'FDJ Cards Bot', iconURL: client.user.displayAvatarURL() });
                            interaction.reply({ embeds: [giftEmbed] });
                        });
                        removeStmt.finalize(); addStmt.finalize();
                    });
                });
                stmt.finalize();
                break;
            }

            // =================== COMANDOS DE ADMINISTRACIÓN ===================
            case 'addmoney': {
                const targetUser = interaction.options.getUser('usuario'); const amount = interaction.options.getInteger('cantidad');
                await ensureUserExists(targetUser.id, targetUser.username);
                const stmt = db.prepare('UPDATE users SET money = money + ? WHERE user_id = ?');
                stmt.run([amount, targetUser.id], (err) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al añadir dinero.', ephemeral: true }); }
                    interaction.reply(`✅ Se han añadido **${amount}** monedas a **${targetUser.username}**.`);
                });
                stmt.finalize(); break;
            }

            case 'removemoney': {
                const targetUser = interaction.options.getUser('usuario'); const amount = interaction.options.getInteger('cantidad');
                const stmt = db.prepare('SELECT money FROM users WHERE user_id = ?');
                stmt.get([targetUser.id], (err, row) => {
                    if (err) { console.error(err); return interaction.reply({ content: '❌ Error al verificar saldo del usuario.', ephemeral: true }); }
                    if (row.money < amount) return interaction.reply({ content: `❌ El usuario solo tiene ${row.money} monedas. No se pueden quitar ${amount}.`, ephemeral: true });
                    const updateStmt = db.prepare('UPDATE users SET money = money - ? WHERE user_id = ?');
                    updateStmt.run([amount, targetUser.id], (err) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al quitar dinero.', ephemeral: true }); } interaction.reply(`✅ Se han quitado **${amount}** monedas a **${targetUser.username}**.`); });
                    updateStmt.finalize();
                });
                stmt.finalize(); break;
            }

            case 'resetuser': {
                const targetUser = interaction.options.getUser('usuario');
                db.serialize(() => {
                    const deleteStmt = db.prepare('DELETE FROM user_inventory WHERE user_id = ?');
                    deleteStmt.run([targetUser.id]);
                    const updateStmt = db.prepare('UPDATE users SET money = 100, last_daily = NULL WHERE user_id = ?');
                    updateStmt.run([targetUser.id], (err) => { if (err) { console.error(err); return interaction.reply({ content: '❌ Error al resetear al usuario.', ephemeral: true }); } interaction.reply(`✅ Todos los datos de **${targetUser.username}** han sido eliminados. Su saldo ahora es de 100 monedas.`); });
                    deleteStmt.finalize(); updateStmt.finalize();
                });
                break;
            }
        }
    } catch (error) { console.error(`Error inesperado en el comando ${commandName}:`, error); if (!interaction.replied) { interaction.reply({ content: '❌ Ocurrió un error inesperado al ejecutar el comando.', ephemeral: true }); } }
});

// ========================================
// INICIO DE SESIÓN DEL BOT
// ========================================
client.login(process.env.DISCORD_TOKEN).catch(err => { console.error('❌ Error al iniciar sesión: Asegúrate de que DISCORD_TOKEN está configurado correctamente en Railway.'); console.error(err); });
