// ========================================
// IMPORTACIONES Y CONFIGURACIÓN INICIAL
// ========================================
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
require('dotenv').config();

// --- CONFIGURACIÓN ---
const WELCOME_CHANNEL_ID = '1440017388404736003'; // ID del canal de bienvenidas
const WELCOME_GIF_URL = 'https://i.imgur.com/tQ0yLjF.gif'; // <--- CAMBIA ESTO por tu GIF animado
const BOT_ICON_URL = 'https://i.imgur.com/pBFAaJ3.png'; // <--- Puedes cambiarlo por el icono de tu bot

// ========================================
// INICIALIZACIÓN DEL CLIENTE DE DISCORD
// ========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,       // Necesario para eventos de servidor
        GatewayIntentBits.GuildMembers  // Necesario para saber cuando un miembro se une
    ]
});

// ========================================
// FUNCIÓN PARA CREAR EL EMBED DE BIENVENIDA
// ========================================
function createWelcomeEmbed(member) {
    const memberCount = member.guild.memberCount;

    return new EmbedBuilder()
        .setColor(0x9B59B6) // Un púrpura elegante
        .setAuthor({ 
            name: '¡UN NUEVO CAMPEÓN LLEGA AL REINO!', 
            iconURL: member.guild.iconURL({ dynamic: true }) 
        })
        .setTitle(`¡Bienvenido/a, ${member.user.username}!`)
        .setDescription('Estamos encantados de que te unas a nuestra comunidad. ¡Prepárate para una aventura épica llena de cartas, duelos y amigos!\n\nEres el miembro **#' + memberCount + '** en unirse.')
        .setImage(WELCOME_GIF_URL) // El GIF animado va aquí
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { 
                name: '🚀 ¿Por dónde empezar?', 
                value: '¡Es fácil! Reacciona con los botones de abajo para recibir toda la información que necesitas.', 
                inline: false 
            },
            { 
                name: '💡 Consejo Rápido', 
                value: 'No olvides pasar por el canal de reglas y presentarte en el chat general.', 
                inline: false 
            }
        )
        .setFooter({ 
            text: 'WFDJ | Bienvenido a la familia', 
            iconURL: BOT_ICON_URL 
        })
        .setTimestamp();
}

// ========================================
// EVENTO: BIENVENIDA DE UN NUEVO MIEMBRO
// ========================================
client.on('guildMemberAdd', async member => {
    // Buscar el canal de bienvenida
    const welcomeChannel = client.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!welcomeChannel) {
        console.error(`No se pudo encontrar el canal de bienvenida con ID: ${WELCOME_CHANNEL_ID}`);
        return;
    }

    // Crear los botones interactivos
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('welcome_rules')
                .setLabel('📜 Ver Reglas')
                .setStyle(ButtonStyle.Secondary), // Gris
            new ButtonBuilder()
                .setCustomId('welcome_roles')
                .setLabel('🎨 Obtener Roles')
                .setStyle(ButtonStyle.Secondary), // Gris
            new ButtonBuilder()
                .setCustomId('welcome_start')
                .setLabel('💬 Empezar a Chatear')
                .setStyle(ButtonStyle.Primary), // Azul
            new ButtonBuilder()
                .setCustomId('welcome_info')
                .setLabel('ℹ️ Más Info')
                .setStyle(ButtonStyle.Success) // Verde
        );

    // Enviar el mensaje de bienvenida
    try {
        const welcomeMessage = await welcomeChannel.send({
            content: `¡Hola ${member}! 🎉`, // Mencionar al usuario para que reciba una notificación
            embeds: [createWelcomeEmbed(member)],
            components: [row]
        });

        // Crear un colector para escuchar los clics en los botones
        const collector = welcomeMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000 // El mensaje expirará después de 5 minutos
        });

        collector.on('collect', async interaction => {
            // Asegurarse de que solo el miembro que se unió pueda interactuar
            if (interaction.user.id !== member.id) {
                return interaction.reply({ content: 'Este menú es solo para el nuevo miembro.', ephemeral: true });
            }

            // Responder según el botón presionado
            switch (interaction.customId) {
                case 'welcome_rules':
                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('📜 Reglas del Servidor')
                                .setColor(0xF39C12) // Naranja
                                .setDescription('Por favor, lee y sigue estas reglas para mantener un ambiente agradable para todos:')
                                .addFields(
                                    { name: '1. Sé respetuoso', value: 'No se toleran insultos, acoso ni discriminación.' },
                                    { name: '2. Sin spam', value: 'No hagas flood de mensajes, imágenes o menciones.' },
                                    { name: '3. Canales adecuados', value: 'Publica el contenido en los canales correspondientes.' },
                                    { name: '4. Sigue las instrucciones del Staff', value: 'Las decisiones del equipo de moderación son finales.' }
                                )
                                .setFooter({ text: 'El incumplimiento de las reglas puede llevar a una sanción.' })
                        ],
                        ephemeral: true // Solo visible para el usuario
                    });
                    break;

                case 'welcome_roles':
                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('🎨 Roles de Autogestión')
                                .setColor(0x3498DB) // Azul
                                .setDescription('¡Personaliza tu perfil y tu experiencia en el servidor!')
                                .addFields(
                                    { name: '🎮 Rol de Gamer', value: 'Reacciona con 🎮 en el canal #roles para obtenerlo.' },
                                    { name: '📢 Rol de Anuncios', value: 'Reacciona con 📢 en el canal #roles para recibir notificaciones.' },
                                    { name: '🎨 Rol de Artista', value: 'Muestra tu arte y obtén un rol especial. Contacta con un admin.' }
                                )
                                .setFooter({ text: '¡Más roles se añadirán pronto!' })
                        ],
                        ephemeral: true
                    });
                    break;

                case 'welcome_start':
                    const generalChannel = member.guild.channels.cache.find(ch => ch.name === 'general' || ch.name === '💬-general' || ch.name === '🗣️-general');
                    if (generalChannel) {
                        await interaction.reply({
                            content: `¡Genial! Puedes empezar a conversar en ${generalChannel}. ¡Te esperamos allí!`,
                            ephemeral: true
                        });
                    } else {
                        await interaction.reply({
                            content: '¡Genial! Busca el canal principal de chat para unirte a la conversación.',
                            ephemeral: true
                        });
                    }
                    break;

                case 'welcome_info':
                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('ℹ️ ¿Qué puedes hacer aquí?')
                                .setColor(0x2ECC71) // Verde
                                .setDescription('Nuestro servidor está lleno de actividades y gente increíble.')
                                .addFields(
                                    { name: '🎮 Juegos y Eventos', value: 'Participa en eventos de cartas, torneos y minijuegos.' },
                                    { name: '💬 Chat Activo', value: 'Habla con otros miembros, comparte tus intereses y haz amigos.' },
                                    { name: '📚 Soporte y Ayuda', value: '¿Tienes una duda? El staff está aquí para ayudarte.' }
                                )
                                .setFooter({ text: '¡Explora y diviértete!' })
                        ],
                        ephemeral: true
                    });
                    break;
            }
        });

        collector.on('end', collected => {
            // Cuando el colector expire, desactivar los botones
            welcomeMessage.edit({
                components: [] // Eliminar la fila de botones
            }).catch(err => console.error('Error al editar el mensaje de bienvenida al expirar:', err));
        });

    } catch (error) {
        console.error(`Error al enviar el mensaje de bienvenida para ${member.user.tag}:`, error);
    }
});

// ========================================
// EVENTO: BOT LISTO
// ========================================
client.once('ready', () => {
    console.log(`✅ Bot de bienvenida "WFDJ Welcome" conectado como ${client.user.tag}!`);
    console.log(`👂 Escuchando nuevos miembros en el canal: ${WELCOME_CHANNEL_ID}`);
});

// ========================================
// INICIO DE SESIÓN DEL BOT
// ========================================
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Error al iniciar sesión: Asegúrate de que DISCORD_TOKEN está configurado correctamente en el archivo .env.');
    console.error(err);
});
