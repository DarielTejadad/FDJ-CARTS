// ========================================
// SISTEMA DE BIENVENIDA "WOW" (WFDJ Welcome)
// ========================================

// --- ID del canal de bienvenida (¡RECUERDA CAMBIARLO!) ---
const WELCOME_CHANNEL_ID = '1438947796873904170'; // <--- CAMBIA ESTO

// --- Función para crear el embed de bienvenida ---
function createWelcomeEmbed(member) {
    const memberCount = member.guild.memberCount;
    const welcomeGifUrl = 'https://i.imgur.com/your-animated-welcome-gif.gif'; // <--- CAMBIA ESTO por tu GIF

    return new EmbedBuilder()
        .setColor(0x9B59B6) // Un púrpura elegante
        .setAuthor({ 
            name: '¡UN NUEVO CAMPEÓN LLEGA AL REINO!', 
            iconURL: member.guild.iconURL({ dynamic: true }) 
        })
        .setTitle(`¡Bienvenido/a, ${member.user.username}!`)
        .setDescription('Estamos encantados de que te unas a nuestra comunidad. ¡Prepárate para una aventura épica llena de cartas, duelos y amigos!\n\nEres el miembro **#' + memberCount + '** en unirte.')
        .setImage(welcomeGifUrl) // El GIF animado va aquí
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
            { 
                name: '🚀 ¿Por dónde empezar?', 
                value: '¡Es fácil! Reacciona con los botones de abajo para recibir toda la información que necesitas.', 
                inline: false 
            },
            { 
                name: '💡 Consejo Rápido', 
                value: 'Usa `/profile` para ver tu perfil de jugador y `/claim` para conseguir tu primera carta gratis.', 
                inline: false 
            }
        )
        .setFooter({ 
            text: `${config.bot.name} | Bienvenido a la familia`, 
            iconURL: `https://i.imgur.com/pBFAaJ3.png` 
        })
        .setTimestamp();
}

// --- Evento que se dispara cuando un miembro se une ---
client.on('guildMemberAdd', async member => {
    // Buscar el canal de bienvenida
    const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!welcomeChannel) {
        return logger.error(`No se pudo encontrar el canal de bienvenida con ID: ${WELCOME_CHANNEL_ID}`);
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
                .setCustomId('welcome_profile')
                .setLabel('👤 Mi Perfil')
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
                                .setColor(config.bot.colors.warning)
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
                                .setColor(config.bot.colors.info)
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
                    const generalChannel = member.guild.channels.cache.find(ch => ch.name === 'general' || ch.name === '💬-general');
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

                case 'welcome_profile':
                    // Intentar ejecutar el comando /profile para el usuario
                    const profileCommand = commands.get('profile');
                    if (profileCommand) {
                        // Simular una interacción de comando para el usuario
                        const fakeInteraction = {
                            user: member,
                            reply: async (options) => {
                                // Como no podemos responder a la interacción original, enviamos un DM
                                try {
                                    await member.send({ embeds: options.embeds });
                                    await interaction.reply({ content: '¡Te he enviado tu perfil por mensaje privado!', ephemeral: true });
                                } catch (error) {
                                    await interaction.reply({ content: 'No pude enviarte tu perfil por privado. Asegúrate de tener los DMs activados.', ephemeral: true });
                                }
                            },
                            options: {
                                getUser: () => member // Simular que no se eligió ningún otro usuario
                            }
                        };
                        await profileCommand.execute(fakeInteraction, client);
                    }
                    break;
            }
        });

        collector.on('end', collected => {
            // Cuando el colector expire, desactivar los botones
            welcomeMessage.edit({
                components: [] // Eliminar la fila de botones
            }).catch(err => logger.error('Error al editar el mensaje de bienvenida al expirar:', err));
        });

    } catch (error) {
        logger.error(`Error al enviar el mensaje de bienvenida para ${member.user.tag}:`, error);
    }
});
