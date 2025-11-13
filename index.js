// Importación de módulos necesarios
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fs = require('fs');

// Configuración de variables de entorno
dotenv.config();

// IDs de canales importantes (reemplaza con los IDs reales)
const ADMIN_CHANNEL_ID = '1438587692097998878';
const GAME_CHANNEL_ID = '1438587851154653374';

// Configuración del cliente de Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Conexión a la base de datos SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('✅ Conectado a la base de datos SQLite.');
        initializeDatabase();
    }
});

// Inicialización de la base de datos
function initializeDatabase() {
    // Tabla de usuarios
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        money INTEGER DEFAULT 100,
        total_cards INTEGER DEFAULT 0,
        last_daily TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabla de cartas
    db.run(`CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        rarity TEXT CHECK(rarity IN ('Común', 'Raro', 'Épico', 'Legendario', 'Mítico')),
        series TEXT,
        description TEXT,
        image_url TEXT,
        gif_url TEXT,
        attack INTEGER DEFAULT 0,
        defense INTEGER DEFAULT 0,
        special_ability TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabla de cartas de usuarios
    db.run(`CREATE TABLE IF NOT EXISTS user_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        card_id INTEGER,
        card_code TEXT UNIQUE,
        obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id),
        FOREIGN KEY (card_id) REFERENCES cards (id)
    )`);

    // Tabla de drops activos
    db.run(`CREATE TABLE IF NOT EXISTS active_drops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER,
        card_code TEXT UNIQUE,
        dropped_by TEXT,
        dropped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        claimed_by TEXT DEFAULT NULL,
        claimed_at DATETIME DEFAULT NULL,
        expires_at DATETIME,
        FOREIGN KEY (card_id) REFERENCES cards (id)
    )`);

    // Tabla de series
    db.run(`CREATE TABLE IF NOT EXISTS series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT,
        color TEXT DEFAULT '#FFFFFF'
    )`);

    console.log('✅ Tablas de la base de datos verificadas/creadas correctamente.');
}

// Evento cuando el bot está listo
client.once('ready', async () => {
    console.log(`🚀 Bot conectado como ${client.user.tag}!`);
    console.log(`📊 Sirviendo en ${client.guilds.cache.size} servidores`);
    
    // Registrar comandos slash
    await registerSlashCommands();
});

// Función para registrar comandos slash
async function registerSlashCommands() {
    try {
        const commands = [
            // Comandos de cartas
            new SlashCommandBuilder()
                .setName('addcard')
                .setDescription('Agrega una nueva carta al sistema (Solo admin)')
                .addStringOption(option => 
                    option.setName('nombre')
                        .setDescription('Nombre de la carta')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('rareza')
                        .setDescription('Rareza de la carta')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Común', value: 'Común' },
                            { name: 'Raro', value: 'Raro' },
                            { name: 'Épico', value: 'Épico' },
                            { name: 'Legendario', value: 'Legendario' },
                            { name: 'Mítico', value: 'Mítico' }
                        ))
                .addStringOption(option => 
                    option.setName('serie')
                        .setDescription('Serie o colección de la carta')
                        .setRequired(false))
                .addStringOption(option => 
                    option.setName('descripcion')
                        .setDescription('Descripción de la carta')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('imagen')
                        .setDescription('URL de la imagen de la carta')
                        .setRequired(false))
                .addStringOption(option => 
                    option.setName('gif')
                        .setDescription('URL del GIF animado de la carta')
                        .setRequired(false))
                .addIntegerOption(option => 
                    option.setName('ataque')
                        .setDescription('Puntos de ataque')
                        .setRequired(false)
                        .setMinValue(0))
                .addIntegerOption(option => 
                    option.setName('defensa')
                        .setDescription('Puntos de defensa')
                        .setRequired(false)
                        .setMinValue(0))
                .addStringOption(option => 
                    option.setName('habilidad')
                        .setDescription('Habilidad especial de la carta')
                        .setRequired(false)),
            
            new SlashCommandBuilder()
                .setName('drop')
                .setDescription('Lanza una carta aleatoria para que alguien la reclame')
                .addStringOption(option => 
                    option.setName('mensaje')
                        .setDescription('Mensaje personalizado para el drop')
                        .setRequired(false)),
            
            new SlashCommandBuilder()
                .setName('claim')
                .setDescription('Reclama la carta lanzada actualmente'),
            
            new SlashCommandBuilder()
                .setName('inventory')
                .setDescription('Muestra todas las cartas que tienes')
                .addStringOption(option => 
                    option.setName('filtro')
                        .setDescription('Filtrar por rareza o serie')
                        .setRequired(false)),
            
            new SlashCommandBuilder()
                .setName('cardinfo')
                .setDescription('Muestra información detallada de una carta')
                .addStringOption(option => 
                    option.setName('nombre')
                        .setDescription('Nombre de la carta')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('collection')
                .setDescription('Muestra tu progreso de colección'),
            
            // Comandos de economía
            new SlashCommandBuilder()
                .setName('balance')
                .setDescription('Muestra tu saldo actual de monedas'),
            
            new SlashCommandBuilder()
                .setName('daily')
                .setDescription('Reclama tu recompensa diaria de monedas'),
            
            new SlashCommandBuilder()
                .setName('gift')
                .setDescription('Envía monedas a otro usuario')
                .addUserOption(option => 
                    option.setName('usuario')
                        .setDescription('Usuario al que enviar monedas')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('cantidad')
                        .setDescription('Cantidad de monedas a enviar')
                        .setRequired(true)
                        .setMinValue(1)),
            
            new SlashCommandBuilder()
                .setName('shop')
                .setDescription('Abre la tienda de cartas'),
            
            // Comandos de administración
            new SlashCommandBuilder()
                .setName('addmoney')
                .setDescription('Añade monedas a un usuario (Solo admin)')
                .addUserOption(option => 
                    option.setName('usuario')
                        .setDescription('Usuario al que añadir monedas')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('cantidad')
                        .setDescription('Cantidad de monedas a añadir')
                        .setRequired(true)
                        .setMinValue(1)),
            
            new SlashCommandBuilder()
                .setName('removemoney')
                .setDescription('Quita monedas a un usuario (Solo admin)')
                .addUserOption(option => 
                    option.setName('usuario')
                        .setDescription('Usuario al que quitar monedas')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('cantidad')
                        .setDescription('Cantidad de monedas a quitar')
                        .setRequired(true)
                        .setMinValue(1)),
            
            new SlashCommandBuilder()
                .setName('resetuser')
                .setDescription('Elimina todos los datos de un usuario (Solo admin)')
                .addUserOption(option => 
                    option.setName('usuario')
                        .setDescription('Usuario a resetear')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('stats')
                .setDescription('Muestra estadísticas del servidor')
        ];
        
        await client.application.commands.set(commands);
        console.log('✅ Comandos slash registrados correctamente.');
    } catch (error) {
        console.error('❌ Error al registrar comandos:', error);
    }
}

// Función para verificar si un usuario existe en la base de datos
function ensureUserExists(userId, username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                reject(err);
            } else if (!row) {
                db.run('INSERT INTO users (user_id, username) VALUES (?, ?)', [userId, username], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(true);
                    }
                });
            } else {
                // Actualizar nombre de usuario si ha cambiado
                if (row.username !== username) {
                    db.run('UPDATE users SET username = ? WHERE user_id = ?', [username, userId]);
                }
                resolve(true);
            }
        });
    });
}

// Función para obtener emoji y color según la rareza
function getRarityData(rarity) {
    const rarityMap = {
        'Común': { emoji: '⚪', color: 0x808080, weight: 50 },
        'Raro': { emoji: '🔵', color: 0x0000FF, weight: 30 },
        'Épico': { emoji: '🟣', color: 0x800080, weight: 15 },
        'Legendario': { emoji: '🟡', color: 0xFFD700, weight: 4 },
        'Mítico': { emoji: '🔴', color: 0xFF4500, weight: 1 }
    };
    return rarityMap[rarity] || rarityMap['Común'];
}

// Función para generar un código único para cada carta
function generateCardCode() {
    return `FDJ-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

// Función para verificar si una URL es válida
async function isValidUrl(url) {
    try {
        const response = await axios.head(url, { timeout: 5000 });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

// Evento para manejar interacciones de comandos slash
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    const { commandName, channelId, user } = interaction;
    
    // Asegurarse de que el usuario existe en la base de datos
    try {
        await ensureUserExists(user.id, user.username);
    } catch (error) {
        console.error('Error al verificar usuario:', error);
        return interaction.reply({ 
            content: '❌ Ha ocurrido un error al verificar tu cuenta. Por favor, inténtalo de nuevo más tarde.', 
            ephemeral: true 
        });
    }
    
    // Verificar restricciones de canal
    const adminCommands = ['addcard', 'addmoney', 'removemoney', 'resetuser'];
    const gameCommands = ['drop', 'claim', 'inventory', 'cardinfo', 'collection', 'balance', 'daily', 'gift', 'shop'];
    
    if (adminCommands.includes(commandName) && channelId !== ADMIN_CHANNEL_ID) {
        return interaction.reply({ 
            content: '❌ Este comando solo se puede usar en el canal de administración.', 
            ephemeral: true 
        });
    }
    
    if (gameCommands.includes(commandName) && channelId !== GAME_CHANNEL_ID) {
        return interaction.reply({ 
            content: '❌ Este comando solo se puede usar en el canal de juego.', 
            ephemeral: true 
        });
    }
    
    // Verificar permisos de administrador
    if (adminCommands.includes(commandName) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ 
            content: '❌ No tienes permisos para usar este comando.', 
            ephemeral: true 
        });
    }
    
    // Manejo de comandos
    switch (commandName) {
        case 'addcard': {
            const name = interaction.options.getString('nombre');
            const rarity = interaction.options.getString('rareza');
            const series = interaction.options.getString('serie') || 'Base';
            const description = interaction.options.getString('descripcion');
            const image_url = interaction.options.getString('imagen');
            const gif_url = interaction.options.getString('gif');
            const attack = interaction.options.getInteger('ataque') || 0;
            const defense = interaction.options.getInteger('defensa') || 0;
            const special_ability = interaction.options.getString('habilidad') || 'Ninguna';
            
            // Verificar que al menos haya una imagen o GIF
            if (!image_url && !gif_url) {
                return interaction.reply({ 
                    content: '❌ Debes proporcionar al menos una imagen o un GIF para la carta.', 
                    ephemeral: true 
                });
            }
            
            // Verificar URLs si se proporcionan
            if (image_url && !(await isValidUrl(image_url))) {
                return interaction.reply({ 
                    content: '❌ La URL de la imagen no es válida o no está accesible.', 
                    ephemeral: true 
                });
            }
            
            if (gif_url && !(await isValidUrl(gif_url))) {
                return interaction.reply({ 
                    content: '❌ La URL del GIF no es válida o no está accesible.', 
                    ephemeral: true 
                });
            }
            
            // Insertar la nueva carta en la base de datos
            db.run('INSERT INTO cards (name, rarity, series, description, image_url, gif_url, attack, defense, special_ability) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', 
                [name, rarity, series, description, image_url, gif_url, attack, defense, special_ability], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return interaction.reply({ 
                            content: `❌ Ya existe una carta con el nombre "${name}".`, 
                            ephemeral: true 
                        });
                    }
                    console.error('Error al agregar carta:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al agregar la carta.', 
                        ephemeral: true 
                    });
                }
                
                const rarityData = getRarityData(rarity);
                const embed = new EmbedBuilder()
                    .setTitle('✨ Nueva Carta Agregada!')
                    .setDescription(`Se ha agregado la carta **${name}** al sistema.`)
                    .setThumbnail(image_url || gif_url)
                    .addFields(
                        { name: '📛 Nombre', value: name, inline: true },
                        { name: `${rarityData.emoji} Rareza`, value: rarity, inline: true },
                        { name: '📚 Serie', value: series, inline: true },
                        { name: '⚔️ Ataque', value: attack.toString(), inline: true },
                        { name: '🛡️ Defensa', value: defense.toString(), inline: true },
                        { name: '✨ Habilidad Especial', value: special_ability, inline: false },
                        { name: '📝 Descripción', value: description, inline: false }
                    )
                    .setColor(rarityData.color)
                    .setImage(gif_url || image_url)
                    .setTimestamp()
                    .setFooter({ text: `ID: ${this.lastID}` });
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'drop': {
            const customMessage = interaction.options.getString('mensaje') || '¡Una nueva carta ha aparecido!';
            
            // Verificar si ya hay un drop activo
            db.get('SELECT * FROM active_drops WHERE claimed_by IS NULL AND expires_at > datetime("now")', [], async (err, row) => {
                if (err) {
                    console.error('Error al verificar drops:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al verificar si hay drops activos.', 
                        ephemeral: true 
                    });
                }
                
                if (row) {
                    const card = await getCardById(row.card_id);
                    const rarityData = getRarityData(card.rarity);
                    return interaction.reply({ 
                        content: `❌ Ya hay una carta en drop: **${card.name}** ${rarityData.emoji}. Usa \`/claim\` para reclamarla primero.`, 
                        ephemeral: true 
                    });
                }
                
                // Obtener una carta aleatoria basada en la rareza
                const card = await getRandomCardByRarity();
                if (!card) {
                    return interaction.reply({ 
                        content: '❌ No hay cartas disponibles para hacer drop. Pide a un administrador que agregue algunas con `/addcard`.', 
                        ephemeral: true 
                    });
                }
                
                const cardCode = generateCardCode();
                const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // Expira en 5 minutos
                
                // Crear el drop
                db.run('INSERT INTO active_drops (card_id, card_code, dropped_by, expires_at) VALUES (?, ?, ?, ?)', 
                    [card.id, cardCode, user.id, expiresAt.toISOString()], function(err) {
                    if (err) {
                        console.error('Error al crear drop:', err);
                        return interaction.reply({ 
                            content: '❌ Ha ocurrido un error al crear el drop.', 
                            ephemeral: true 
                        });
                    }
                    
                    const rarityData = getRarityData(card.rarity);
                    const embed = new EmbedBuilder()
                        .setTitle('🎉 ¡Nueva Carta en Drop!')
                        .setDescription(`${customMessage}\n\nUsa \`/claim\` para reclamarla antes de que expire.`)
                        .setThumbnail(card.image_url || card.gif_url)
                        .addFields(
                            { name: '📛 Nombre', value: card.name, inline: true },
                            { name: `${rarityData.emoji} Rareza`, value: card.rarity, inline: true },
                            { name: '📚 Serie', value: card.series, inline: true },
                            { name: '🆔 Código', value: `\`${cardCode}\``, inline: false },
                            { name: '⏰ Expira en', value: '<t:' + Math.floor(expiresAt.getTime() / 1000) + ':R>', inline: false }
                        )
                        .setColor(rarityData.color)
                        .setImage(card.gif_url || card.image_url)
                        .setTimestamp()
                        .setFooter({ text: `Drop creado por ${user.username}` });
                    
                    return interaction.reply({ embeds: [embed] });
                });
            });
            break;
        }
        
        case 'claim': {
            // Verificar si hay un drop activo
            db.get('SELECT d.*, c.name, c.rarity, c.series, c.description, c.image_url, c.gif_url, c.attack, c.defense, c.special_ability FROM active_drops d JOIN cards c ON d.card_id = c.id WHERE d.claimed_by IS NULL AND d.expires_at > datetime("now")', [], (err, drop) => {
                if (err) {
                    console.error('Error al verificar drops:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al verificar si hay drops activos.', 
                        ephemeral: true 
                    });
                }
                
                if (!drop) {
                    return interaction.reply({ 
                        content: '❌ No hay ninguna carta en drop actualmente. Usa `/drop` para lanzar una nueva.', 
                        ephemeral: true 
                    });
                }
                
                // Marcar el drop como reclamado por el usuario
                db.run('UPDATE active_drops SET claimed_by = ?, claimed_at = datetime("now") WHERE id = ?', [user.id, drop.id], function(err) {
                    if (err) {
                        console.error('Error al reclamar carta:', err);
                        return interaction.reply({ 
                            content: '❌ Ha ocurrido un error al reclamar la carta.', 
                            ephemeral: true 
                        });
                    }
                    
                    const cardCode = generateCardCode();
                    
                    // Añadir la carta al inventario del usuario
                    db.run('INSERT INTO user_cards (user_id, card_id, card_code) VALUES (?, ?, ?)', [user.id, drop.card_id, cardCode], function(err) {
                        if (err) {
                            console.error('Error al añadir carta al inventario:', err);
                            return interaction.reply({ 
                                content: '❌ Ha ocurrido un error al añadir la carta a tu inventario.', 
                                ephemeral: true 
                            });
                        }
                        
                        // Actualizar contador de cartas del usuario
                        db.run('UPDATE users SET total_cards = total_cards + 1 WHERE user_id = ?', [user.id]);
                        
                        const rarityData = getRarityData(drop.rarity);
                        const embed = new EmbedBuilder()
                            .setTitle('🎊 ¡Carta Reclamada con Éxito!')
                            .setDescription(`¡Felicidades! Has reclamado la carta **${drop.name}**`)
                            .setThumbnail(drop.image_url || drop.gif_url)
                            .addFields(
                                { name: '📛 Nombre', value: drop.name, inline: true },
                                { name: `${rarityData.emoji} Rareza`, value: drop.rarity, inline: true },
                                { name: '📚 Serie', value: drop.series, inline: true },
                                { name: '⚔️ Ataque', value: drop.attack.toString(), inline: true },
                                { name: '🛡️ Defensa', value: drop.defense.toString(), inline: true },
                                { name: '✨ Habilidad', value: drop.special_ability, inline: false },
                                { name: '🆔 Código Único', value: `\`${cardCode}\``, inline: false },
                                { name: '📝 Descripción', value: drop.description, inline: false }
                            )
                            .setColor(rarityData.color)
                            .setImage(drop.gif_url || drop.image_url)
                            .setTimestamp()
                            .setFooter({ text: `Reclamado por ${user.username}` });
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
        
        case 'inventory': {
            const filter = interaction.options.getString('filtro');
            let query = `SELECT c.*, uc.card_code, uc.obtained_at 
                        FROM user_cards uc 
                        JOIN cards c ON uc.card_id = c.id 
                        WHERE uc.user_id = ?`;
            const params = [user.id];
            
            if (filter) {
                query += ` AND (c.rarity = ? OR c.series = ?)`;
                params.push(filter, filter);
            }
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('Error al obtener inventario:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al obtener tu inventario.', 
                        ephemeral: true 
                    });
                }
                
                if (rows.length === 0) {
                    return interaction.reply({ 
                        content: '❌ No tienes ninguna carta en tu inventario. Usa `/claim` para obtener cartas de los drops.', 
                        ephemeral: true 
                    });
                }
                
                // Agrupar cartas por nombre
                const cardGroups = {};
                rows.forEach(card => {
                    if (!cardGroups[card.name]) {
                        cardGroups[card.name] = {
                            ...card,
                            count: 0,
                            codes: []
                        };
                    }
                    cardGroups[card.name].count++;
                    cardGroups[card.name].codes.push(card.card_code);
                });
                
                // Crear embed con el inventario
                const embed = new EmbedBuilder()
                    .setTitle(`🎒 Inventario de ${user.username}`)
                    .setDescription(`Tienes **${rows.length}** cartas en total${filter ? ` (filtrado por: ${filter})` : ''}`)
                    .setColor(0x00AE86)
                    .setThumbnail(user.displayAvatarURL())
                    .setTimestamp();
                
                // Añadir cada carta como un campo
                Object.values(cardGroups).forEach(card => {
                    const rarityData = getRarityData(card.rarity);
                    embed.addFields({
                        name: `${rarityData.emoji} ${card.name} x${card.count}`,
                        value: `📚 Serie: ${card.series}\n⚔️ ${card.attack} | 🛡️ ${card.defense}\n🆔 Códigos: ${card.codes.slice(0, 3).join(', ')}${card.codes.length > 3 ? '...' : ''}`,
                        inline: false
                    });
                });
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'cardinfo': {
            const cardName = interaction.options.getString('nombre');
            
            // Buscar la carta en la base de datos
            db.get('SELECT * FROM cards WHERE name = ?', [cardName], async (err, card) => {
                if (err) {
                    console.error('Error al buscar carta:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al buscar la carta.', 
                        ephemeral: true 
                    });
                }
                
                if (!card) {
                    return interaction.reply({ 
                        content: `❌ No se encontró ninguna carta con el nombre "${cardName}".`, 
                        ephemeral: true 
                    });
                }
                
                // Verificar cuántas copias tiene el usuario
                db.get('SELECT COUNT(*) as count FROM user_cards WHERE user_id = ? AND card_id = ?', [user.id, card.id], (err, result) => {
                    if (err) {
                        console.error('Error al verificar copias de carta:', err);
                        return interaction.reply({ 
                            content: '❌ Ha ocurrido un error al verificar cuántas copias tienes de esta carta.', 
                            ephemeral: true 
                        });
                    }
                    
                    const rarityData = getRarityData(card.rarity);
                    const embed = new EmbedBuilder()
                        .setTitle(`${rarityData.emoji} ${card.name}`)
                        .setDescription(card.description)
                        .setThumbnail(card.image_url || card.gif_url)
                        .addFields(
                            { name: '📊 Estadísticas', value: `⚔️ Ataque: ${card.attack}\n🛡️ Defensa: ${card.defense}`, inline: true },
                            { name: '📚 Colección', value: `Serie: ${card.series}\nRareza: ${card.rarity}`, inline: true },
                            { name: '✨ Habilidad Especial', value: card.special_ability, inline: false },
                            { name: '🎯 Tu Colección', value: `Tienes **${result.count}** copia(s) de esta carta`, inline: false }
                        )
                        .setColor(rarityData.color)
                        .setImage(card.gif_url || card.image_url)
                        .setTimestamp()
                        .setFooter({ text: `ID: ${card.id}` });
                    
                    return interaction.reply({ embeds: [embed] });
                });
            });
            break;
        }
        
        case 'collection': {
            // Obtener todas las cartas disponibles
            db.all('SELECT * FROM cards ORDER BY rarity, series, name', [], async (err, allCards) => {
                if (err) {
                    console.error('Error al obtener todas las cartas:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido al obtener la información de las cartas.', 
                        ephemeral: true 
                    });
                }
                
                // Obtener las cartas del usuario
                db.all(`SELECT c.id, c.name, c.rarity, c.series 
                        FROM user_cards uc 
                        JOIN cards c ON uc.card_id = c.id 
                        WHERE uc.user_id = ?`, [user.id], (err, userCards) => {
                    if (err) {
                        console.error('Error al obtener cartas del usuario:', err);
                        return interaction.reply({ 
                            content: '❌ Ha ocurrido un error al obtener tu colección.', 
                            ephemeral: true 
                        });
                    }
                    
                    // Calcular progreso
                    const totalCards = allCards.length;
                    const collectedCards = userCards.length;
                    const progressPercentage = totalCards > 0 ? Math.round((collectedCards / totalCards) * 100) : 0;
                    
                    // Agrupar por rareza
                    const rarityProgress = {};
                    allCards.forEach(card => {
                        if (!rarityProgress[card.rarity]) {
                            rarityProgress[card.rarity] = { total: 0, collected: 0 };
                        }
                        rarityProgress[card.rarity].total++;
                    });
                    
                    userCards.forEach(card => {
                        if (rarityProgress[card.rarity]) {
                            rarityProgress[card.rarity].collected++;
                        }
                    });
                    
                    // Crear embed
                    const embed = new EmbedBuilder()
                        .setTitle(`📚 Colección de ${user.username}`)
                        .setDescription(`Progreso total: **${collectedCards}/${totalCards}** cartas (${progressPercentage}%)`)
                        .setColor(0x00AE86)
                        .setThumbnail(user.displayAvatarURL())
                        .setTimestamp();
                    
                    // Añadir progreso por rareza
                    Object.entries(rarityProgress).forEach(([rarity, data]) => {
                        const rarityData = getRarityData(rarity);
                        const percentage = Math.round((data.collected / data.total) * 100);
                        embed.addFields({
                            name: `${rarityData.emoji} ${rarity}`,
                            value: `${data.collected}/${data.total} (${percentage}%)`,
                            inline: true
                        });
                    });
                    
                    // Añadir faltantes si hay menos de 10
                    const missingCards = allCards.filter(card => 
                        !userCards.some(userCard => userCard.id === card.id)
                    ).slice(0, 10);
                    
                    if (missingCards.length > 0) {
                        embed.addFields({
                            name: '❌ Cartas que te faltan (mostrando 10)',
                            value: missingCards.map(card => {
                                const rarityData = getRarityData(card.rarity);
                                return `${rarityData.emoji} ${card.name}`;
                            }).join('\n'),
                            inline: false
                        });
                    }
                    
                    return interaction.reply({ embeds: [embed] });
                });
            });
            break;
        }
        
        case 'balance': {
            db.get('SELECT money, total_cards FROM users WHERE user_id = ?', [user.id], (err, row) => {
                if (err) {
                    console.error('Error al obtener saldo:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al obtener tu saldo.', 
                        ephemeral: true 
                    });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(`💰 Saldo de ${user.username}`)
                    .setDescription(`Tienes **${row.money}** monedas`)
                    .addFields(
                        { name: '🎒 Cartas Coleccionadas', value: row.total_cards.toString(), inline: true },
                        { name: '💎 Valor de Colección', value: `${row.total_cards * 10} monedas`, inline: true }
                    )
                    .setColor(0xFFD700)
                    .setThumbnail(user.displayAvatarURL())
                    .setTimestamp();
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'daily': {
            const today = new Date().toISOString().split('T')[0];
            
            db.get('SELECT last_daily FROM users WHERE user_id = ?', [user.id], (err, row) => {
                if (err) {
                    console.error('Error al verificar daily:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al verificar tu recompensa diaria.', 
                        ephemeral: true 
                    });
                }
                
                if (row && row.last_daily === today) {
                    return interaction.reply({ 
                        content: '❌ Ya has reclamado tu recompensa diaria hoy. Vuelve mañana.', 
                        ephemeral: true 
                    });
                }
                
                // Calcular recompensa (base 50 + bonus por cartas)
                db.get('SELECT total_cards FROM users WHERE user_id = ?', [user.id], (err, userRow) => {
                    if (err) {
                        console.error('Error al obtener cartas del usuario:', err);
                        return interaction.reply({ 
                            content: '❌ Ha ocurrido un error al calcular tu recompensa.', 
                            ephemeral: true 
                        });
                    }
                    
                    const baseReward = 50;
                    const cardBonus = Math.floor(userRow.total_cards / 5) * 10;
                    const totalReward = baseReward + cardBonus;
                    
                    // Añadir monedas al usuario
                    db.run('UPDATE users SET money = money + ?, last_daily = ? WHERE user_id = ?', 
                        [totalReward, today, user.id], function(err) {
                        if (err) {
                            console.error('Error al añadir monedas diarias:', err);
                            return interaction.reply({ 
                                content: '❌ Ha ocurrido un error al añadir tus monedas diarias.', 
                                ephemeral: true 
                            });
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle('🎁 ¡Recompensa Diaria Reclamada!')
                            .setDescription('Has recibido tu recompensa diaria:')
                            .addFields(
                                { name: '💰 Recompensa Base', value: `${baseReward} monedas`, inline: true },
                                { name: '🎒 Bonus por Cartas', value: `${cardBonus} monedas`, inline: true },
                                { name: '💎 Total Recibido', value: `**${totalReward} monedas**`, inline: false }
                            )
                            .setColor(0x00FF00)
                            .setThumbnail(user.displayAvatarURL())
                            .setTimestamp();
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
        
        case 'gift': {
            const targetUser = interaction.options.getUser('usuario');
            const amount = interaction.options.getInteger('cantidad');
            
            if (targetUser.id === user.id) {
                return interaction.reply({ 
                    content: '❌ No puedes enviarte dinero a ti mismo.', 
                    ephemeral: true 
                });
            }
            
            // Asegurarse de que el usuario receptor existe
            try {
                await ensureUserExists(targetUser.id, targetUser.username);
            } catch (error) {
                console.error('Error al verificar usuario receptor:', error);
                return interaction.reply({ 
                    content: '❌ Ha ocurrido un error al verificar la cuenta del receptor.', 
                    ephemeral: true 
                });
            }
            
            // Verificar saldo
            db.get('SELECT money FROM users WHERE user_id = ?', [user.id], (err, row) => {
                if (err) {
                    console.error('Error al verificar saldo:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al verificar tu saldo.', 
                        ephemeral: true 
                    });
                }
                
                if (row.money < amount) {
                    return interaction.reply({ 
                        content: `❌ No tienes suficiente dinero. Tu saldo actual es de ${row.money} monedas.`, 
                        ephemeral: true 
                    });
                }
                
                // Realizar transferencia
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    
                    db.run('UPDATE users SET money = money - ? WHERE user_id = ?', [amount, user.id]);
                    db.run('UPDATE users SET money = money + ? WHERE user_id = ?', [amount, targetUser.id]);
                    
                    db.run('COMMIT', (err) => {
                        if (err) {
                            console.error('Error en transferencia:', err);
                            return interaction.reply({ 
                                content: '❌ Ha ocurrido un error al realizar la transferencia.', 
                                ephemeral: true 
                            });
                        }
                        
                        const embed = new EmbedBuilder()
                            .title('💸 Transferencia Realizada')
                            .setDescription(`Has enviado **${amount} monedas** a ${targetUser.username}`)
                            .setColor(0x00AE86)
                            .setThumbnail(user.displayAvatarURL())
                            .setTimestamp();
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
        
        case 'shop': {
            const embed = new EmbedBuilder()
                .setTitle('🛍️ Tienda de Cartas FDJ')
                .setDescription('¡Bienvenido a la tienda! Aquí puedes comprar cartas especiales.')
                .addFields(
                    { 
                        name: '🎲 Pack Básico - 100 monedas', 
                        value: '3 cartas aleatorias (Común-Raro)\nUsa `/buy basic`', 
                        inline: false 
                    },
                    { 
                        name: '⭐ Pack Épico - 250 monedas', 
                        value: '5 cartas aleatorias (Raro-Épico)\nUsa `/buy epic`', 
                        inline: false 
                    },
                    { 
                        name: '👑 Pack Legendario - 500 monedas', 
                        value: '3 cartas aleatorias (Épico-Legendario)\nUsa `/buy legendary`', 
                        inline: false 
                    }
                )
                .setColor(0xFFD700)
                .setTimestamp();
            
            return interaction.reply({ embeds: [embed] });
        }
        
        case 'addmoney': {
            const targetUser = interaction.options.getUser('usuario');
            const amount = interaction.options.getInteger('cantidad');
            
            try {
                await ensureUserExists(targetUser.id, targetUser.username);
            } catch (error) {
                console.error('Error al verificar usuario:', error);
                return interaction.reply({ 
                    content: '❌ Ha ocurrido un error al verificar la cuenta del usuario.', 
                    ephemeral: true 
                });
            }
            
            db.run('UPDATE users SET money = money + ? WHERE user_id = ?', [amount, targetUser.id], function(err) {
                if (err) {
                    console.error('Error al añadir dinero:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al añadir dinero al usuario.', 
                        ephemeral: true 
                    });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('💰 Dinero Añadido')
                    .setDescription(`Se han añadido **${amount} monedas** a ${targetUser.username}`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'removemoney': {
            const targetUser = interaction.options.getUser('usuario');
            const amount = interaction.options.getInteger('cantidad');
            
            db.get('SELECT money FROM users WHERE user_id = ?', [targetUser.id], (err, row) => {
                if (err) {
                    console.error('Error al verificar saldo:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al verificar el saldo del usuario.', 
                        ephemeral: true 
                    });
                }
                
                if (!row) {
                    return interaction.reply({ 
                        content: '❌ El usuario especificado no existe en la base de datos.', 
                        ephemeral: true 
                    });
                }
                
                if (row.money < amount) {
                    return interaction.reply({ 
                        content: `❌ El usuario solo tiene ${row.money} monedas. No se pueden quitar ${amount}.`, 
                        ephemeral: true 
                    });
                }
                
                db.run('UPDATE users SET money = money - ? WHERE user_id = ?', [amount, targetUser.id], function(err) {
                    if (err) {
                        console.error('Error al quitar dinero:', err);
                        return interaction.reply({ 
                            content: '❌ Ha ocurrido un error al quitar dinero al usuario.', 
                            ephemeral: true 
                        });
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle('💸 Dinero Quitado')
                        .setDescription(`Se han quitado **${amount} monedas** a ${targetUser.username}`)
                        .setColor(0xFF0000)
                        .setTimestamp();
                    
                    return interaction.reply({ embeds: [embed] });
                });
            });
            break;
        }
        
        case 'resetuser': {
            const targetUser = interaction.options.getUser('usuario');
            
            db.serialize(() => {
                db.run('DELETE FROM user_cards WHERE user_id = ?', [targetUser.id]);
                db.run('UPDATE users SET money = 100, total_cards = 0, last_daily = NULL WHERE user_id = ?', [targetUser.id]);
                
                const embed = new EmbedBuilder()
                    .setTitle('🔄 Usuario Reseteado')
                    .setDescription(`Se han eliminado todos los datos de ${targetUser.username}\nSu saldo ha sido restablecido a 100 monedas`)
                    .setColor(0xFF0000)
                    .setTimestamp();
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'stats': {
            db.get('SELECT COUNT(DISTINCT user_id) as total_users FROM users', [], (err, userStats) => {
                if (err) {
                    console.error('Error al obtener estadísticas:', err);
                    return interaction.reply({ 
                        content: '❌ Ha ocurrido un error al obtener las estadísticas.', 
                        ephemeral: true 
                    });
                }
                
                db.get('SELECT COUNT(*) as total_cards FROM cards', [], (err, cardStats) => {
                    if (err) {
                        console.error('Error al obtener estadísticas de cartas:', err);
                        return interaction.reply({ 
                            content: '❌ Ha ocurrido un error al obtener las estadísticas de cartas.', 
                            ephemeral: true 
                        });
                    }
                    
                    db.get('SELECT COUNT(*) as total_claims FROM active_drops WHERE claimed_by IS NOT NULL', [], (err, claimStats) => {
                        if (err) {
                            console.error('Error al obtener estadísticas de claims:', err);
                            return interaction.reply({ 
                                content: '❌ Ha ocurrido un error al obtener las estadísticas de claims.', 
                                ephemeral: true 
                            });
                        }
                        
                        const embed = new EmbedBuilder()
                            .title('📊 Estadísticas del Servidor')
                            .setDescription('Estadísticas generales del bot FDJ Cards')
                            .addFields(
                                { name: '👥 Usuarios Registrados', value: userStats.total_users.toString(), inline: true },
                                { name: '🎴 Cartas en el Sistema', value: cardStats.total_cards.toString(), inline: true },
                                { name: '🎯 Cartas Reclamadas', value: claimStats.total_claims.toString(), inline: true }
                            )
                            .setColor(0x00AE86)
                            .setTimestamp();
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
    }
});

// Función auxiliar para obtener una carta por ID
function getCardById(cardId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM cards WHERE id = ?', [cardId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Función auxiliar para obtener una carta aleatoria basada en la rareza
function getRandomCardByRarity() {
    return new Promise((resolve, reject) => {
        // Obtener una carta aleatoria con pesos según la rareza
        db.get(`SELECT * FROM cards 
                ORDER BY 
                    CASE rarity 
                        WHEN 'Común' THEN RANDOM() * 50
                        WHEN 'Raro' THEN RANDOM() * 30
                        WHEN 'Épico' THEN RANDOM() * 15
                        WHEN 'Legendario' THEN RANDOM() * 4
                        WHEN 'Mítico' THEN RANDOM() * 1
                    END 
                DESC LIMIT 1`, [], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Iniciar sesión en Discord
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Error al iniciar sesión:', err);
});
