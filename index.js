// Importación de módulos necesarios
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { token } = require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// IDs de canales importantes
const ADMIN_CHANNEL_ID = '1438587692097998878';
const GAME_CHANNEL_ID = '1438587851154653374';

// Inicialización del cliente de Discord
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
        console.log('Conectado a la base de datos SQLite.');
        // Crear tablas si no existen
        db.run(`CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT,
            money INTEGER DEFAULT 100
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            rarity TEXT,
            description TEXT,
            image_url TEXT
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS user_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            card_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (user_id),
            FOREIGN KEY (card_id) REFERENCES cards (id)
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS drops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER,
            claimed_by TEXT DEFAULT NULL,
            FOREIGN KEY (card_id) REFERENCES cards (id)
        )`);
        
        console.log('Tablas verificadas/creadas correctamente.');
    }
});

// Evento cuando el bot está listo
client.once('ready', async () => {
    console.log(`¡Bot conectado como ${client.user.tag}!`);
    
    // Registrar comandos slash
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
                        .setDescription('Rareza de la carta (común, raro, épico, legendario)')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('descripcion')
                        .setDescription('Descripción de la carta')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('imagen')
                        .setDescription('URL de la imagen de la carta')
                        .setRequired(true)),
            
            new SlashCommandBuilder()
                .setName('drop')
                .setDescription('Lanza una carta aleatoria para que alguien la reclame'),
            
            new SlashCommandBuilder()
                .setName('claim')
                .setDescription('Reclama la carta lanzada actualmente'),
            
            new SlashCommandBuilder()
                .setName('inventory')
                .setDescription('Muestra todas las cartas que tienes'),
            
            new SlashCommandBuilder()
                .setName('cardinfo')
                .setDescription('Muestra información sobre una carta específica')
                .addStringOption(option => 
                    option.setName('nombre')
                        .setDescription('Nombre de la carta')
                        .setRequired(true)),
            
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
                        .setRequired(true))
        ];
        
        await client.application.commands.set(commands);
        console.log('Comandos slash registrados correctamente.');
    } catch (error) {
        console.error('Error al registrar comandos:', error);
    }
});

// Función para verificar si un usuario existe en la base de datos
function ensureUserExists(userId, username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                reject(err);
            } else if (!row) {
                // Si el usuario no existe, crearlo
                db.run('INSERT INTO users (user_id, username) VALUES (?, ?)', [userId, username], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(true);
                    }
                });
            } else {
                resolve(true);
            }
        });
    });
}

// Función para obtener la rareza con formato
function getRarityEmoji(rarity) {
    switch (rarity.toLowerCase()) {
        case 'común': return '⚪';
        case 'raro': return '🔵';
        case 'épico': return '🟣';
        case 'legendario': return '🟡';
        default: return '⚪';
    }
}

// Función para obtener el color según la rareza
function getRarityColor(rarity) {
    switch (rarity.toLowerCase()) {
        case 'común': return 0x808080; // Gris
        case 'raro': return 0x0000FF; // Azul
        case 'épico': return 0x800080; // Púrpura
        case 'legendario': return 0xFFD700; // Dorado
        default: return 0x808080; // Gris por defecto
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
        return interaction.reply({ content: 'Ha ocurrido un error al verificar tu cuenta. Por favor, inténtalo de nuevo más tarde.', ephemeral: true });
    }
    
    // Comandos de administración (solo en canal de admin)
    if (commandName === 'addcard' || commandName === 'addmoney' || commandName === 'removemoney' || commandName === 'resetuser') {
        if (channelId !== ADMIN_CHANNEL_ID) {
            return interaction.reply({ content: 'Este comando solo se puede usar en el canal de administración.', ephemeral: true });
        }
        
        // Verificar permisos de administrador
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'No tienes permisos para usar este comando.', ephemeral: true });
        }
    }
    
    // Comandos de juego (solo en canal de juego)
    if (commandName === 'drop' || commandName === 'claim' || commandName === 'inventory' || 
        commandName === 'cardinfo' || commandName === 'balance' || commandName === 'daily' || commandName === 'gift') {
        if (channelId !== GAME_CHANNEL_ID) {
            return interaction.reply({ content: 'Este comando solo se puede usar en el canal de juego.', ephemeral: true });
        }
    }
    
    // Manejo de comandos
    switch (commandName) {
        // Comandos de cartas
        case 'addcard': {
            const name = interaction.options.getString('nombre');
            const rarity = interaction.options.getString('rareza');
            const description = interaction.options.getString('descripcion');
            const image_url = interaction.options.getString('imagen');
            
            // Verificar que la rareza sea válida
            const validRarities = ['común', 'raro', 'épico', 'legendario'];
            if (!validRarities.includes(rarity.toLowerCase())) {
                return interaction.reply({ content: 'La rareza debe ser una de: común, raro, épico, legendario.', ephemeral: true });
            }
            
            // Insertar la nueva carta en la base de datos
            db.run('INSERT INTO cards (name, rarity, description, image_url) VALUES (?, ?, ?, ?)', 
                [name, rarity, description, image_url], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return interaction.reply({ content: `Ya existe una carta con el nombre "${name}".`, ephemeral: true });
                    }
                    console.error('Error al agregar carta:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al agregar la carta.', ephemeral: true });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('¡Nueva Carta Agregada!')
                    .setDescription(`Se ha agregado la carta "${name}" al sistema.`)
                    .addFields(
                        { name: 'Rareza', value: `${getRarityEmoji(rarity)} ${rarity}`, inline: true },
                        { name: 'Descripción', value: description, inline: false }
                    )
                    .setImage(image_url)
                    .setColor(getRarityColor(rarity))
                    .setTimestamp();
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'drop': {
            // Verificar si ya hay un drop activo
            db.get('SELECT * FROM drops WHERE claimed_by IS NULL', [], (err, row) => {
                if (err) {
                    console.error('Error al verificar drops:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al verificar si hay drops activos.', ephemeral: true });
                }
                
                if (row) {
                    return interaction.reply({ content: 'Ya hay una carta en drop. Usa `/claim` para reclamarla primero.', ephemeral: true });
                }
                
                // Obtener una carta aleatoria
                db.get('SELECT * FROM cards ORDER BY RANDOM() LIMIT 1', [], (err, card) => {
                    if (err) {
                        console.error('Error al obtener carta aleatoria:', err);
                        return interaction.reply({ content: 'Ha ocurrido un error al obtener una carta aleatoria.', ephemeral: true });
                    }
                    
                    if (!card) {
                        return interaction.reply({ content: 'No hay cartas disponibles para hacer drop. Pide a un administrador que agregue algunas con `/addcard`.', ephemeral: true });
                    }
                    
                    // Crear el drop
                    db.run('INSERT INTO drops (card_id) VALUES (?)', [card.id], function(err) {
                        if (err) {
                            console.error('Error al crear drop:', err);
                            return interaction.reply({ content: 'Ha ocurrido un error al crear el drop.', ephemeral: true });
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle('¡Nueva Carta en Drop!')
                            .setDescription('¡Una nueva carta ha aparecido! Usa `/claim` para reclamarla.')
                            .addFields(
                                { name: 'Nombre', value: card.name, inline: true },
                                { name: 'Rareza', value: `${getRarityEmoji(card.rarity)} ${card.rarity}`, inline: true }
                            )
                            .setImage(card.image_url)
                            .setColor(getRarityColor(card.rarity))
                            .setTimestamp();
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
        
        case 'claim': {
            // Verificar si hay un drop activo
            db.get('SELECT d.*, c.name, c.rarity, c.description, c.image_url FROM drops d JOIN cards c ON d.card_id = c.id WHERE d.claimed_by IS NULL', [], (err, drop) => {
                if (err) {
                    console.error('Error al verificar drops:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al verificar si hay drops activos.', ephemeral: true });
                }
                
                if (!drop) {
                    return interaction.reply({ content: 'No hay ninguna carta en drop actualmente. Usa `/drop` para lanzar una nueva.', ephemeral: true });
                }
                
                // Verificar si el usuario ya ha reclamado este drop
                if (drop.claimed_by === user.id) {
                    return interaction.reply({ content: 'Ya has reclamado esta carta.', ephemeral: true });
                }
                
                // Marcar el drop como reclamado por el usuario
                db.run('UPDATE drops SET claimed_by = ? WHERE id = ?', [user.id, drop.id], function(err) {
                    if (err) {
                        console.error('Error al reclamar carta:', err);
                        return interaction.reply({ content: 'Ha ocurrido un error al reclamar la carta.', ephemeral: true });
                    }
                    
                    // Añadir la carta al inventario del usuario
                    db.run('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)', [user.id, drop.card_id], function(err) {
                        if (err) {
                            console.error('Error al añadir carta al inventario:', err);
                            return interaction.reply({ content: 'Ha ocurrido un error al añadir la carta a tu inventario.', ephemeral: true });
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle('¡Carta Reclamada!')
                            .setDescription(`Has reclamado la carta "${drop.name}" con éxito.`)
                            .addFields(
                                { name: 'Rareza', value: `${getRarityEmoji(drop.rarity)} ${drop.rarity}`, inline: true },
                                { name: 'Descripción', value: drop.description, inline: false }
                            )
                            .setImage(drop.image_url)
                            .setColor(getRarityColor(drop.rarity))
                            .setTimestamp();
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
        
        case 'inventory': {
            // Obtener todas las cartas del usuario
            db.all(`SELECT c.id, c.name, c.rarity, c.description, c.image_url 
                    FROM user_cards uc 
                    JOIN cards c ON uc.card_id = c.id 
                    WHERE uc.user_id = ?`, [user.id], (err, rows) => {
                if (err) {
                    console.error('Error al obtener inventario:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al obtener tu inventario.', ephemeral: true });
                }
                
                if (rows.length === 0) {
                    return interaction.reply({ content: 'No tienes ninguna carta en tu inventario. Usa `/claim` para obtener cartas de los drops.', ephemeral: true });
                }
                
                // Agrupar cartas por nombre y contar cuántas tiene de cada una
                const cardCounts = {};
                rows.forEach(card => {
                    if (!cardCounts[card.name]) {
                        cardCounts[card.name] = {
                            count: 0,
                            rarity: card.rarity,
                            description: card.description,
                            image_url: card.image_url
                        };
                    }
                    cardCounts[card.name].count++;
                });
                
                // Crear embed con el inventario
                const embed = new EmbedBuilder()
                    .setTitle(`Inventario de ${user.username}`)
                    .setDescription('Aquí están todas las cartas que tienes:')
                    .setColor(0x00AE86)
                    .setTimestamp();
                
                // Añadir cada carta como un campo
                Object.entries(cardCounts).forEach(([name, data]) => {
                    embed.addFields({
                        name: `${getRarityEmoji(data.rarity)} ${name} x${data.count}`,
                        value: data.description,
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
            db.get('SELECT * FROM cards WHERE name = ?', [cardName], (err, card) => {
                if (err) {
                    console.error('Error al buscar carta:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al buscar la carta.', ephemeral: true });
                }
                
                if (!card) {
                    return interaction.reply({ content: `No se encontró ninguna carta con el nombre "${cardName}".`, ephemeral: true });
                }
                
                // Verificar cuántas copias tiene el usuario
                db.get('SELECT COUNT(*) as count FROM user_cards WHERE user_id = ? AND card_id = ?', [user.id, card.id], (err, result) => {
                    if (err) {
                        console.error('Error al verificar copias de carta:', err);
                        return interaction.reply({ content: 'Ha ocurrido un error al verificar cuántas copias tienes de esta carta.', ephemeral: true });
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle(card.name)
                        .setDescription(card.description)
                        .addFields(
                            { name: 'Rareza', value: `${getRarityEmoji(card.rarity)} ${card.rarity}`, inline: true },
                            { name: 'Tienes', value: `${result.count} copia(s)`, inline: true }
                        )
                        .setImage(card.image_url)
                        .setColor(getRarityColor(card.rarity))
                        .setTimestamp();
                    
                    return interaction.reply({ embeds: [embed] });
                });
            });
            break;
        }
        
        // Comandos de economía
        case 'balance': {
            db.get('SELECT money FROM users WHERE user_id = ?', [user.id], (err, row) => {
                if (err) {
                    console.error('Error al obtener saldo:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al obtener tu saldo.', ephemeral: true });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(`Saldo de ${user.username}`)
                    .setDescription(`Tienes **${row.money}** monedas.`)
                    .setColor(0xFFD700) // Dorado
                    .setThumbnail(user.displayAvatarURL())
                    .setTimestamp();
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'daily': {
            // Verificar si el usuario ya ha reclamado su recompensa diaria hoy
            const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
            
            // Crear tabla de daily rewards si no existe
            db.run(`CREATE TABLE IF NOT EXISTS daily_rewards (
                user_id TEXT PRIMARY KEY,
                last_claim TEXT
            )`, (err) => {
                if (err) {
                    console.error('Error al crear tabla daily_rewards:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al verificar tu recompensa diaria.', ephemeral: true });
                }
                
                // Verificar cuándo fue la última reclamación del usuario
                db.get('SELECT last_claim FROM daily_rewards WHERE user_id = ?', [user.id], (err, row) => {
                    if (err) {
                        console.error('Error al verificar última reclamación:', err);
                        return interaction.reply({ content: 'Ha ocurrido un error al verificar tu recompensa diaria.', ephemeral: true });
                    }
                    
                    if (row && row.last_claim === today) {
                        return interaction.reply({ content: 'Ya has reclamado tu recompensa diaria hoy. Vuelve mañana.', ephemeral: true });
                    }
                    
                    // Añadir 50 monedas al usuario
                    db.run('UPDATE users SET money = money + 50 WHERE user_id = ?', [user.id], function(err) {
                        if (err) {
                            console.error('Error al añadir monedas diarias:', err);
                            return interaction.reply({ content: 'Ha ocurrido un error al añadir tus monedas diarias.', ephemeral: true });
                        }
                        
                        // Actualizar o insertar la fecha de última reclamación
                        if (row) {
                            db.run('UPDATE daily_rewards SET last_claim = ? WHERE user_id = ?', [today, user.id], (err) => {
                                if (err) {
                                    console.error('Error al actualizar última reclamación:', err);
                                }
                            });
                        } else {
                            db.run('INSERT INTO daily_rewards (user_id, last_claim) VALUES (?, ?)', [user.id, today], (err) => {
                                if (err) {
                                    console.error('Error al insertar última reclamación:', err);
                                }
                            });
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle('¡Recompensa Diaria Reclamada!')
                            .setDescription('Has recibido **50 monedas** por tu recompensa diaria.')
                            .setColor(0x00FF00) // Verde
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
            
            // Verificar que no se esté enviando dinero a sí mismo
            if (targetUser.id === user.id) {
                return interaction.reply({ content: 'No puedes enviarte dinero a ti mismo.', ephemeral: true });
            }
            
            // Asegurarse de que el usuario receptor existe en la base de datos
            try {
                await ensureUserExists(targetUser.id, targetUser.username);
            } catch (error) {
                console.error('Error al verificar usuario receptor:', error);
                return interaction.reply({ content: 'Ha ocurrido un error al verificar la cuenta del receptor. Por favor, inténtalo de nuevo más tarde.', ephemeral: true });
            }
            
            // Verificar que el usuario tiene suficiente dinero
            db.get('SELECT money FROM users WHERE user_id = ?', [user.id], (err, row) => {
                if (err) {
                    console.error('Error al verificar saldo:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al verificar tu saldo.', ephemeral: true });
                }
                
                if (row.money < amount) {
                    return interaction.reply({ content: `No tienes suficiente dinero. Tu saldo actual es de ${row.money} monedas.`, ephemeral: true });
                }
                
                // Realizar la transferencia
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    
                    // Quitar dinero al remitente
                    db.run('UPDATE users SET money = money - ? WHERE user_id = ?', [amount, user.id], function(err) {
                        if (err) {
                            console.error('Error al quitar dinero:', err);
                            db.run('ROLLBACK');
                            return interaction.reply({ content: 'Ha ocurrido un error al realizar la transferencia.', ephemeral: true });
                        }
                    });
                    
                    // Añadir dinero al receptor
                    db.run('UPDATE users SET money = money + ? WHERE user_id = ?', [amount, targetUser.id], function(err) {
                        if (err) {
                            console.error('Error al añadir dinero:', err);
                            db.run('ROLLBACK');
                            return interaction.reply({ content: 'Ha ocurrido un error al realizar la transferencia.', ephemeral: true });
                        }
                    });
                    
                    db.run('COMMIT', (err) => {
                        if (err) {
                            console.error('Error al confirmar transacción:', err);
                            return interaction.reply({ content: 'Ha ocurrido un error al confirmar la transferencia.', ephemeral: true });
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle('Transferencia Realizada')
                            .setDescription(`Has enviado **${amount} monedas** a ${targetUser.username}.`)
                            .setColor(0x00AE86)
                            .setThumbnail(user.displayAvatarURL())
                            .setTimestamp();
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
        
        // Comandos de administración
        case 'addmoney': {
            const targetUser = interaction.options.getUser('usuario');
            const amount = interaction.options.getInteger('cantidad');
            
            // Asegurarse de que el usuario existe en la base de datos
            try {
                await ensureUserExists(targetUser.id, targetUser.username);
            } catch (error) {
                console.error('Error al verificar usuario:', error);
                return interaction.reply({ content: 'Ha ocurrido un error al verificar la cuenta del usuario. Por favor, inténtalo de nuevo más tarde.', ephemeral: true });
            }
            
            // Añadir dinero al usuario
            db.run('UPDATE users SET money = money + ? WHERE user_id = ?', [amount, targetUser.id], function(err) {
                if (err) {
                    console.error('Error al añadir dinero:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al añadir dinero al usuario.', ephemeral: true });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('Dinero Añadido')
                    .setDescription(`Se han añadido **${amount} monedas** a ${targetUser.username}.`)
                    .setColor(0x00FF00) // Verde
                    .setTimestamp();
                
                return interaction.reply({ embeds: [embed] });
            });
            break;
        }
        
        case 'removemoney': {
            const targetUser = interaction.options.getUser('usuario');
            const amount = interaction.options.getInteger('cantidad');
            
            // Verificar saldo actual del usuario
            db.get('SELECT money FROM users WHERE user_id = ?', [targetUser.id], (err, row) => {
                if (err) {
                    console.error('Error al verificar saldo:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al verificar el saldo del usuario.', ephemeral: true });
                }
                
                if (!row) {
                    return interaction.reply({ content: 'El usuario especificado no existe en la base de datos.', ephemeral: true });
                }
                
                if (row.money < amount) {
                    return interaction.reply({ content: `El usuario solo tiene ${row.money} monedas. No se pueden quitar ${amount}.`, ephemeral: true });
                }
                
                // Quitar dinero al usuario
                db.run('UPDATE users SET money = money - ? WHERE user_id = ?', [amount, targetUser.id], function(err) {
                    if (err) {
                        console.error('Error al quitar dinero:', err);
                        return interaction.reply({ content: 'Ha ocurrido un error al quitar dinero al usuario.', ephemeral: true });
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle('Dinero Quitado')
                        .setDescription(`Se han quitado **${amount} monedas** a ${targetUser.username}.`)
                        .setColor(0xFF0000) // Rojo
                        .setTimestamp();
                    
                    return interaction.reply({ embeds: [embed] });
                });
            });
            break;
        }
        
        case 'resetuser': {
            const targetUser = interaction.options.getUser('usuario');
            
            // Eliminar todas las cartas del usuario
            db.run('DELETE FROM user_cards WHERE user_id = ?', [targetUser.id], function(err) {
                if (err) {
                    console.error('Error al eliminar cartas del usuario:', err);
                    return interaction.reply({ content: 'Ha ocurrido un error al eliminar las cartas del usuario.', ephemeral: true });
                }
                
                // Resetear el dinero del usuario a 100
                db.run('UPDATE users SET money = 100 WHERE user_id = ?', [targetUser.id], function(err) {
                    if (err) {
                        console.error('Error al resetear dinero del usuario:', err);
                        return interaction.reply({ content: 'Ha ocurrido un error al resetear el dinero del usuario.', ephemeral: true });
                    }
                    
                    // Eliminar el registro de recompensa diaria si existe
                    db.run('DELETE FROM daily_rewards WHERE user_id = ?', [targetUser.id], function(err) {
                        if (err) {
                            console.error('Error al eliminar registro de recompensa diaria:', err);
                        }
                        
                        const embed = new EmbedBuilder()
                            .setTitle('Usuario Reseteado')
                            .setDescription(`Se han eliminado todos los datos de ${targetUser.username}. Su saldo ha sido restablecido a 100 monedas.`)
                            .setColor(0xFF0000) // Rojo
                            .setTimestamp();
                        
                        return interaction.reply({ embeds: [embed] });
                    });
                });
            });
            break;
        }
    }
});

// Iniciar sesión en Discord con el token del bot
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Error al iniciar sesión:', err);
});
