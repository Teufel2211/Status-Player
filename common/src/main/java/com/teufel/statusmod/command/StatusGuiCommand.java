package com.teufel.statusmod.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.gui.PlayerHeadMenu;
import com.teufel.statusmod.gui.PlayerHeadMenu.HeadContainer;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.util.BedrockUtil;
import com.teufel.statusmod.util.PermissionUtil;
import com.teufel.statusmod.util.StatusTextUtil;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.MenuProvider;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemLore;
import net.minecraft.world.item.component.ResolvableProfile;

import com.mojang.authlib.GameProfile;

import java.lang.reflect.Method;
import java.util.Optional;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class StatusGuiCommand {
    private static final int HEADS_PER_PAGE = 54;

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("status")
            .requires(ctx -> !StatusMod.isRemoteDisabled())
            .then(Commands.literal("gui")
                .executes(ctx -> {
                    if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genugend Rechte.")); return 0; }
                    ServerPlayer player = ctx.getSource().getPlayer();
                    if (player == null) { ctx.getSource().sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return 0; }
                    openStatusGui(ctx.getSource(), player, 1, null);
                    return 1;
                })
                .then(Commands.argument("page", IntegerArgumentType.integer(1)).suggests((ctx, builder) -> net.minecraft.commands.SharedSuggestionProvider.suggest(new String[]{"1","2","3"}, builder))
                    .executes(ctx -> {
                        if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genugend Rechte.")); return 0; }
                        ServerPlayer player = ctx.getSource().getPlayer();
                        if (player == null) { ctx.getSource().sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return 0; }
                        int page = IntegerArgumentType.getInteger(ctx, "page");
                        openStatusGui(ctx.getSource(), player, page, null);
                        return 1;
                    })
                    .then(Commands.argument("search", StringArgumentType.word())
                        .executes(ctx -> {
                            if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genugend Rechte.")); return 0; }
                            ServerPlayer player = ctx.getSource().getPlayer();
                            if (player == null) { ctx.getSource().sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return 0; }
                            int page = IntegerArgumentType.getInteger(ctx, "page");
                            String query = StringArgumentType.getString(ctx, "search");
                            openStatusGui(ctx.getSource(), player, page, query);
                            return 1;
                        })
                    )
                )
            )
        );
    }

    private static void openStatusGui(CommandSourceStack source, ServerPlayer player, int page, String searchQuery) {
        MinecraftServer server = getServer(source);
        if (server == null) { source.sendFailure(Component.literal("Server nicht gefunden.")); return; }

        PlayerHeadMenu.HeadContainer container = PlayerHeadMenu.createContainer(HEADS_PER_PAGE);

        Map<String, ServerPlayer> onlineMap = new HashMap<>();
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            onlineMap.put(p.getUUID().toString(), p);
        }

        List<Map.Entry<String, PlayerSettings>> allEntries = new ArrayList<>(StatusMod.getStorage().getAllSnapshot().entrySet());

        for (Map.Entry<String, ServerPlayer> entry : onlineMap.entrySet()) {
            boolean alreadyIn = allEntries.stream().anyMatch(e -> e.getKey().equals(entry.getKey()));
            if (!alreadyIn) {
                PlayerSettings ps = StatusMod.getStorage().forPlayer(entry.getKey());
                allEntries.add(new java.util.AbstractMap.SimpleEntry<>(entry.getKey(), ps));
            }
        }

        if (searchQuery != null && !searchQuery.isEmpty()) {
            String lowerQuery = searchQuery.toLowerCase();
            allEntries.removeIf(e -> {
                String name = resolveName(e.getKey(), e.getValue(), onlineMap);
                return !name.toLowerCase().contains(lowerQuery);
            });
        }

        int totalPages = Math.max(1, (int) Math.ceil((double) allEntries.size() / HEADS_PER_PAGE));
        if (page > totalPages) page = totalPages;
        int startIdx = (page - 1) * HEADS_PER_PAGE;
        int endIdx = Math.min(startIdx + HEADS_PER_PAGE, allEntries.size());

        int slot = 0;
        for (int i = startIdx; i < endIdx; i++) {
            Map.Entry<String, PlayerSettings> entry = allEntries.get(i);
            String uuid = entry.getKey();
            PlayerSettings ps = entry.getValue();
            ServerPlayer online = onlineMap.get(uuid);
            String name = resolveName(uuid, ps, onlineMap);
            container.setItem(slot, createPlayerHead(name, ps, online, uuid));
            container.setSlotUuid(slot, uuid);
            slot++;
        }

        final int fPage = page;
        final int fTotal = totalPages;
        final int fCount = allEntries.size();
        final Player fPlayer = player;
        final CommandSourceStack fSource = source;
        MenuProvider provider = new MenuProvider() {
            @Override
            public Component getDisplayName() {
                String label = "Status Players (Seite " + fPage + "/" + fTotal + ")";
                if (searchQuery != null && !searchQuery.isEmpty()) label += " [" + searchQuery + "]";
                return Component.literal(label);
            }
            @Override
            public AbstractContainerMenu createMenu(int syncId, Inventory playerInv, Player p) {
                return createClickableMenu(syncId, playerInv, container, fPlayer, fSource);
            }
        };

        player.openMenu(provider);
    }

    private static AbstractContainerMenu createClickableMenu(int syncId, Inventory playerInv, HeadContainer container, Player viewer, CommandSourceStack cmdSource) {
        try {
            Class<?> clazz = Class.forName("com.teufel.statusmod.gui.ClickablePlayerHeadMenu");
            return (AbstractContainerMenu) clazz.getConstructor(int.class, Inventory.class, HeadContainer.class, Player.class, CommandSourceStack.class)
                .newInstance(syncId, playerInv, container, viewer, cmdSource);
        } catch (Throwable e) {
            PlayerHeadMenu menu = new PlayerHeadMenu(syncId, playerInv, container);
            return menu;
        }
    }


    private static String resolveName(String uuid, PlayerSettings ps, Map<String, ServerPlayer> onlineMap) {
        ServerPlayer online = onlineMap.get(uuid);
        if (online != null) return online.getScoreboardName();
        if (ps != null && ps.lastKnownName != null && !ps.lastKnownName.isEmpty()) return ps.lastKnownName;
        return uuid.substring(0, 8);
    }

    private static ItemStack createPlayerHead(String name, PlayerSettings settings, ServerPlayer onlinePlayer, String uuidStr) {
        boolean isOnline = onlinePlayer != null;
        UUID uuid = null;
        try {
            uuid = java.util.UUID.fromString(uuidStr);
        } catch (Exception ignored) {}

        GameProfile gameProfile = null;
        if (isOnline) {
            try {
                gameProfile = onlinePlayer.getGameProfile();
            } catch (Throwable ignored) {}
        }
        if (gameProfile == null && uuid != null) {
            gameProfile = new GameProfile(uuid, name);
        }

        // Direct component path works on all targets (1.21.11 + 26.x, all
        // loaders): Mojang names compile everywhere, Loom remaps them for
        // intermediary/SRG runtimes. Legacy NBT is only a safety net.
        try {
            return createPlayerHeadModern(name, settings, isOnline, gameProfile);
        } catch (Throwable t) {
            // fall through to legacy
        }

        return createPlayerHeadLegacy(name, settings, isOnline, gameProfile);
    }

    private static ItemStack createPlayerHeadModern(String name, PlayerSettings settings, boolean online, GameProfile profile) {
        ItemStack stack = new ItemStack(Items.PLAYER_HEAD);

        if (profile != null) {
            stack.set(DataComponents.PROFILE, ResolvableProfile.createResolved(profile));
        }

        String statusText = settings != null ? settings.status : "";
        String colorKey = settings != null ? settings.color : "reset";

        MutableComponent displayName = Component.literal(name).withStyle(ChatFormatting.WHITE);
        stack.set(DataComponents.CUSTOM_NAME, displayName);

        List<Component> loreLines = new ArrayList<>();
        if (statusText != null && !statusText.isEmpty()) {
            String bracketed = StatusTextUtil.wrapBrackets(statusText, settings != null ? settings.brackets : 0);
            TextColor statusColor = resolveColor(colorKey);
            MutableComponent statusLine = Component.literal(bracketed);
            if (statusColor != null) {
                statusLine.withStyle(Style.EMPTY.withColor(statusColor));
            } else {
                statusLine.withStyle(Style.EMPTY.withColor(TextColor.fromRgb(0xFFFFFF)));
            }
            loreLines.add(statusLine);
        } else {
            loreLines.add(Component.literal("- Kein Status -").withStyle(ChatFormatting.GRAY));
        }
        MutableComponent onlineLine = Component.literal(online ? "Online" : "Offline");
        onlineLine.withStyle(Style.EMPTY.withColor(online ? TextColor.fromRgb(0x55FF55) : TextColor.fromRgb(0xAAAAAA)));
        loreLines.add(onlineLine);
        if (isBedrockProfile(profile)) {
            loreLines.add(Component.literal("Bedrock-Spieler").withStyle(ChatFormatting.GOLD));
        }
        loreLines.add(Component.literal("Linksklick: Status \u00E4ndern").withStyle(ChatFormatting.GRAY));
        loreLines.add(Component.literal("Shift-Klick: Farbe \u00E4ndern").withStyle(ChatFormatting.GRAY));

        stack.set(DataComponents.LORE, new ItemLore(loreLines));

        return stack;
    }

    private static ItemStack createPlayerHeadLegacy(String name, PlayerSettings settings, boolean online, GameProfile profile) {
        ItemStack stack = new ItemStack(Items.PLAYER_HEAD);

        setSkullOwnerNbt(stack, profile);

        String statusText = settings != null ? settings.status : "";
        String colorKey = settings != null ? settings.color : "reset";

        // Set display name via NBT
        MutableComponent displayName = Component.literal(name).withStyle(ChatFormatting.WHITE);
        String nameJson = componentToJson(displayName);
        if (nameJson != null) {
            CompoundTag tag = getOrCreateTag(stack);
            CompoundTag display = getCompoundTag(tag, "display");
            display.putString("Name", nameJson);
            tag.put("display", display);
        }

        // Lore via NBT
        List<Component> loreLines = new ArrayList<>();
        if (statusText != null && !statusText.isEmpty()) {
            String bracketed = StatusTextUtil.wrapBrackets(statusText, settings != null ? settings.brackets : 0);
            TextColor statusColor = resolveColor(colorKey);
            MutableComponent statusLine = Component.literal(bracketed);
            if (statusColor != null) {
                statusLine.withStyle(Style.EMPTY.withColor(statusColor));
            } else {
                statusLine.withStyle(Style.EMPTY.withColor(TextColor.fromRgb(0xFFFFFF)));
            }
            loreLines.add(statusLine);
        } else {
            loreLines.add(Component.literal("- Kein Status -").withStyle(ChatFormatting.GRAY));
        }
        MutableComponent onlineLine = Component.literal(online ? "Online" : "Offline");
        onlineLine.withStyle(Style.EMPTY.withColor(online ? TextColor.fromRgb(0x55FF55) : TextColor.fromRgb(0xAAAAAA)));
        loreLines.add(onlineLine);
        if (isBedrockProfile(profile)) {
            loreLines.add(Component.literal("Bedrock-Spieler").withStyle(ChatFormatting.GOLD));
        }
        loreLines.add(Component.literal("Linksklick: Status \u00E4ndern").withStyle(ChatFormatting.GRAY));
        loreLines.add(Component.literal("Shift-Klick: Farbe \u00E4ndern").withStyle(ChatFormatting.GRAY));

        setLoreNbt(stack, loreLines);
        return stack;
    }

    private static void setSkullOwnerNbt(ItemStack stack, GameProfile profile) {
        if (profile == null) return;
        try {
            CompoundTag tag = getOrCreateTag(stack);
            CompoundTag skullOwner = new CompoundTag();
            Object id = findMethod(profile.getClass(), "getId").invoke(profile);
            if (id != null) {
                skullOwner.putString("Id", id.toString());
            }
            Object profileName = findMethod(profile.getClass(), "getName").invoke(profile);
            if (profileName != null) {
                skullOwner.putString("Name", profileName.toString());
            }
            tag.put("SkullOwner", skullOwner);
        } catch (Throwable ignored) {}
    }

    private static void setLoreNbt(ItemStack stack, List<Component> lines) {
        try {
            CompoundTag tag = getOrCreateTag(stack);
            CompoundTag display = getCompoundTag(tag, "display");
            ListTag lore = new ListTag();
            for (Component line : lines) {
                String json = componentToJson(line);
                if (json != null) lore.add(StringTag.valueOf(json));
            }
            display.put("Lore", lore);
            tag.put("display", display);
        } catch (Throwable ignored) {}
    }

    private static CompoundTag getOrCreateTag(ItemStack stack) {
        try {
            Method m = findMethod(stack.getClass(), "getOrCreateTag");
            return (CompoundTag) m.invoke(stack);
        } catch (Throwable e) {
            return new CompoundTag();
        }
    }

    private static CompoundTag getCompoundTag(CompoundTag tag, String key) {
        try {
            Object result = tag.getCompound(key);
            if (result instanceof CompoundTag ct) return ct;
            if (result instanceof Optional<?> opt && opt.isPresent()) return (CompoundTag) opt.get();
        } catch (Throwable ignored) {}
        return new CompoundTag();
    }

    private static String componentToJson(Component component) {
        try {
            Class<?> serializerClass = Class.forName("net.minecraft.network.chat.Component$Serializer");
            Method toJson = serializerClass.getMethod("toJson", Component.class);
            Object result = toJson.invoke(null, component);
            return result instanceof String ? (String) result : null;
        } catch (Throwable e) {
            return component.getString();
        }
    }

    private static MinecraftServer getServer(CommandSourceStack src) {
        try {
            Method m = findMethod(src.getClass(), "getServer");
            return m != null ? (MinecraftServer) m.invoke(src) : null;
        } catch (Throwable e) {
            return null;
        }
    }

    private static Method findMethod(Class<?> clazz, String name, Class<?>... paramTypes) {
        Class<?> c = clazz;
        while (c != null) {
            try {
                return c.getDeclaredMethod(name, paramTypes);
            } catch (NoSuchMethodException e) {
                c = c.getSuperclass();
            }
        }
        return null;
    }

    private static final Map<String, Integer> FALLBACK_COLORS = new HashMap<>();
    static {
        FALLBACK_COLORS.put("DARK_RED", 0xAA0000);
        FALLBACK_COLORS.put("RED", 0xFF5555);
        FALLBACK_COLORS.put("GOLD", 0xFFAA00);
        FALLBACK_COLORS.put("YELLOW", 0xFFFF55);
        FALLBACK_COLORS.put("DARK_GREEN", 0x00AA00);
        FALLBACK_COLORS.put("GREEN", 0x55FF55);
        FALLBACK_COLORS.put("AQUA", 0x55FFFF);
        FALLBACK_COLORS.put("DARK_AQUA", 0x00AAAA);
        FALLBACK_COLORS.put("DARK_BLUE", 0x0000AA);
        FALLBACK_COLORS.put("BLUE", 0x5555FF);
        FALLBACK_COLORS.put("LIGHT_PURPLE", 0xFF55FF);
        FALLBACK_COLORS.put("DARK_PURPLE", 0xAA00AA);
        FALLBACK_COLORS.put("WHITE", 0xFFFFFF);
        FALLBACK_COLORS.put("GRAY", 0xAAAAAA);
        FALLBACK_COLORS.put("DARK_GRAY", 0x555555);
        FALLBACK_COLORS.put("BLACK", 0x000000);
        FALLBACK_COLORS.put("RESET", -1);
    }

    private static TextColor resolveColor(String colorKey) {
        if (colorKey == null || colorKey.isEmpty()) return null;

        if (colorKey.equalsIgnoreCase("rainbow") || colorKey.equalsIgnoreCase("animated")) {
            return TextColor.fromRgb(0xFF5555);
        }

        if (colorKey.startsWith("#")) {
            try {
                String hex = colorKey.substring(1);
                if (hex.length() == 3) {
                    char r = hex.charAt(0), g = hex.charAt(1), b = hex.charAt(2);
                    hex = "" + r + r + g + g + b + b;
                }
                return TextColor.fromRgb(Integer.parseInt(hex, 16));
            } catch (Exception ignored) {}
        }

        String upper = colorKey.trim().toUpperCase();
        try {
            ChatFormatting formatting = ChatFormatting.valueOf(upper);
            try {
                java.lang.reflect.Method getColor = findMethod(formatting.getClass(), "getColor");
                if (getColor != null) {
                    Object result = getColor.invoke(formatting);
                    if (result instanceof Integer color && color >= 0) {
                        return TextColor.fromRgb(color);
                    }
                }
            } catch (Throwable ignored) {}
            Integer fallback = FALLBACK_COLORS.get(upper);
            if (fallback != null && fallback >= 0) {
                return TextColor.fromRgb(fallback);
            }
        } catch (Exception ignored) {}

        return null;
    }

    private static boolean isBedrockProfile(GameProfile profile) {
        // Absichtlich per Reflection (wie der Rest der Datei): versions-tolerant.
        try {
            if (profile == null) {
                return false;
            }
            java.lang.reflect.Method getId = profile.getClass().getMethod("getId");
            Object id = getId.invoke(profile);
            if (!(id instanceof java.util.UUID uuid)) {
                return false;
            }
            return BedrockUtil.isBedrockPlayer(uuid);
        } catch (Throwable ignored) {
            return false;
        }
    }
}
