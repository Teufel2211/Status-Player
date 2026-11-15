package com.teufel.statusmod.gui;

import com.teufel.statusmod.command.StatusCommand;
import com.teufel.statusmod.util.DurationUtil;
import com.mojang.datafixers.util.Pair;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ClientboundSetEquipmentPacket;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerListener;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemLore;

import java.util.ArrayList;
import java.util.List;

/**
 * Beginner-friendly self-status menu (3 rows). Top two rows: clickable presets
 * (built-in + own customs). Bottom row: current-status display + exactly two
 * buttons: next preset (applies immediately) and clear status.
 * Same click mechanics as ClickablePlayerHeadMenu (slotChanged + restore),
 * so it works on 1.21.11 and 26.x (and Bedrock via Geyser inventories).
 */
public class SelfStatusMenu extends AbstractContainerMenu {
    private static final long ACTION_DEBOUNCE_MS = 400L;
    public static final int SIZE = 27;
    public static final int PRESET_SLOTS = 18;
    public static final int SLOT_DISPLAY = 19;
    public static final int SLOT_NEXT = 21;
    public static final int SLOT_CLEAR = 23;

    public static final class Entry {
        public final String key;
        public final String label;
        public final String color;
        public Entry(String key, String label, String color) {
            this.key = key;
            this.label = label == null ? "" : label;
            this.color = color == null ? "reset" : color;
        }
    }

    /**
     * Maps our color keys to wool registry paths. Resolved via BuiltInRegistries
     * with direct Mojang references (compiles on 1.21.11 and 26.x, remapped by
     * Loom for intermediary/SRG runtimes). Old string reflection on Items fields
     * returned PAPER on Fabric/Quilt 1.21.11 (intermediary names).
     */
    private static final String[][] WOOL_VARIANTS = {
        {"black", "black_wool"},
        {"dark_blue", "blue_wool"},
        {"dark_green", "green_wool"},
        {"dark_aqua", "cyan_wool"},
        {"dark_red", "red_wool"},
        {"dark_purple", "purple_wool"},
        {"gold", "orange_wool"},
        {"gray", "light_gray_wool"},
        {"dark_gray", "gray_wool"},
        {"blue", "blue_wool"},
        {"green", "lime_wool"},
        {"aqua", "light_blue_wool"},
        {"red", "red_wool"},
        {"light_purple", "magenta_wool"},
        {"yellow", "yellow_wool"},
        {"white", "white_wool"},
    };

    private static Item woolFor(String colorKey) {
        String key = colorKey == null ? "white" : colorKey.toLowerCase();
        String path = "white_wool";
        for (String[] v : WOOL_VARIANTS) {
            if (v[0].equals(key)) {
                path = v[1];
                break;
            }
        }
        try {
            Item item = BuiltInRegistries.ITEM.getValue(
                net.minecraft.resources.Identifier.fromNamespaceAndPath("minecraft", path));
            if (item != null && item != Items.AIR) return item;
        } catch (Throwable ignored) {}
        return Items.PAPER;
    }

    private final Player viewer;
    private final CommandSourceStack cmdSource;
    private final List<Entry> entries;
    private final SimpleContainer container;
    private final ItemStack[] saved;
    private final java.util.Set<String> menuNames = new java.util.HashSet<>();
    private long lastActionAtMs;

    public SelfStatusMenu(int syncId, Inventory playerInventory, Player viewer,
                          CommandSourceStack cmdSource, List<Entry> entries) {
        super(MenuType.GENERIC_9x3, syncId);
        this.viewer = viewer;
        this.cmdSource = cmdSource;
        this.entries = entries == null ? new ArrayList<>() : entries;
        this.container = new SimpleContainer(SIZE);
        this.saved = new ItemStack[SIZE];
        for (int i = 0; i < SIZE; i++) saved[i] = ItemStack.EMPTY;

        fillContainer();

        for (int i = 0; i < SIZE; i++) {
            final int idx = i;
            addSlot(new Slot(container, idx, 8 + (idx % 9) * 18, 18 + (idx / 9) * 18) {
                @Override
                public boolean mayPickup(Player player) {
                    return true;
                }

                @Override
                public boolean mayPlace(ItemStack stack) {
                    return false;
                }
            });
        }

        for (int row = 0; row < 3; row++) {
            for (int col = 0; col < 9; col++) {
                addSlot(new Slot(playerInventory, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
            }
        }
        for (int col = 0; col < 9; col++) {
            addSlot(new Slot(playerInventory, col, 8 + col * 18, 142));
        }

        // Comparison-based click detection: any menu slot that no longer matches
        // its definition was touched (click, drag, throw, number keys, creative
        // set). The previous initialized/wasPopulated gate stayed disarmed with
        // an empty player inventory (no slotIndex >= SIZE event ever arrives),
        // leaving the menu unprotected. Init fill transitions EMPTY -> defined,
        // which matches, so it never triggers an action.
        addSlotListener(new ContainerListener() {
            @Override
            public void slotChanged(AbstractContainerMenu menu, int slotIndex, ItemStack stack) {
                if (slotIndex < 0 || slotIndex >= SIZE) return;
                ItemStack savedStack = saved[slotIndex];
                if (savedStack.isEmpty()) {
                    // Gap slot: must stay empty; foreign items bounce to cursor.
                    if (stack.isEmpty()) return;
                    container.setItem(slotIndex, ItemStack.EMPTY);
                    clearCursor(menu, stack.copy());
                    purgeMenuItems();
                    resync(menu);
                    logGui("gap-bounce", slotIndex, savedStack);
                    return;
                }
                if (matchesDefinition(stack, savedStack)) return;

                boolean emptied = stack.isEmpty();
                boolean polluted = !emptied && stack.getItem() != savedStack.getItem();
                container.setItem(slotIndex, savedStack.copy());
                clearCursor(menu, polluted ? stack.copy() : ItemStack.EMPTY);
                purgeMenuItems();
                resync(menu);
                logGui(polluted ? "polluted" : "emptied", slotIndex, savedStack);
                if (polluted) return;
                handleSlotAction(slotIndex);
            }

            @Override
            public void dataChanged(AbstractContainerMenu menu, int dataId, int value) {}
        });
    }

    private void fillContainer() {
        for (int i = 0; i < Math.min(entries.size(), PRESET_SLOTS); i++) {
            Entry e = entries.get(i);
            menuNames.add(e.label);
            Item wool = woolFor(e.color);
            List<Component> lore = new ArrayList<>();
            lore.add(Component.literal("Klicken zum Setzen").withStyle(ChatFormatting.GRAY));
            container.setItem(i, makeItem(wool, e.label, ChatFormatting.WHITE, lore));
        }
        container.setItem(SLOT_DISPLAY, buildDisplayItem());
        fillGlass(SLOT_DISPLAY);
        menuNames.add("\u25B6 Weiter");
        menuNames.add("\u2716 Status l\u00F6schen");
        menuNames.add("Dein Status");
        menuNames.add(" ");
        container.setItem(SLOT_NEXT, makeItem(Items.ARROW, "\u25B6 Weiter",
            ChatFormatting.GREEN, hintLore("N\u00E4chstes Preset setzen")));
        container.setItem(SLOT_CLEAR, makeItem(Items.BARRIER, "\u2716 Status l\u00F6schen",
            ChatFormatting.RED, hintLore("Status entfernen")));
        for (int i = 0; i < SIZE; i++) {
            saved[i] = container.getItem(i).copy();
        }
    }

    private void fillGlass(int except1) {
        for (int i = PRESET_SLOTS; i < SIZE; i++) {
            if (i == except1 || i == SLOT_DISPLAY || i == SLOT_NEXT || i == SLOT_CLEAR) continue;
            if (container.getItem(i).isEmpty()) {
                // Plain GLASS_PANE exists on all versions (colored variants were
                // consolidated into ColorCollections on 26.x).
                container.setItem(i, makeItem(Items.GLASS_PANE, " ", ChatFormatting.GRAY, new ArrayList<>()));
            }
        }
        for (int i = 0; i < SIZE; i++) {
            if (saved[i].isEmpty()) saved[i] = container.getItem(i).copy();
        }
    }

    private static List<Component> hintLore(String text) {
        List<Component> lore = new ArrayList<>();
        lore.add(Component.literal(text).withStyle(ChatFormatting.GRAY));
        return lore;
    }

    private ItemStack buildDisplayItem() {
        String current = StatusCommand.getOwnStatusText(cmdSource);
        List<Component> lore = new ArrayList<>();
        if (current == null || current.isEmpty()) {
            lore.add(Component.literal("Aktuell: kein Status").withStyle(ChatFormatting.GRAY));
        } else {
            MutableComponent line = Component.literal(current);
            TextColor c = StatusCommand.getOwnStatusColor(cmdSource);
            line.withStyle(Style.EMPTY.withColor(c != null ? c : TextColor.fromRgb(0xFFFFFF)));
            lore.add(line);
        }
        lore.add(Component.literal("Wird nach jeder Aktion aktualisiert.").withStyle(ChatFormatting.DARK_GRAY));
        long expiresAt = StatusCommand.getOwnStatusExpiresAt(cmdSource);
        String remaining = DurationUtil.formatRemaining(expiresAt);
        if (!remaining.isEmpty()) {
            lore.add(Component.literal("Läuft ab in: " + remaining).withStyle(ChatFormatting.GOLD));
        }
        return makeItem(Items.PAPER, "Dein Status", ChatFormatting.YELLOW, lore);
    }

    private void refreshDisplay() {
        try {
            ItemStack display = buildDisplayItem();
            saved[SLOT_DISPLAY] = display.copy();
            container.setItem(SLOT_DISPLAY, display);
        } catch (Throwable e) {
            System.err.println("[StatusMod] GUI refresh failed: " + e.getMessage());
        }
    }

    private void handleSlotAction(int slotIndex) {
        try {
            long now = System.currentTimeMillis();
            if (now - lastActionAtMs < ACTION_DEBOUNCE_MS) return;
            lastActionAtMs = now;

            if (slotIndex >= 0 && slotIndex < Math.min(entries.size(), PRESET_SLOTS)) {
                StatusCommand.guiApplyPreset(cmdSource, entries.get(slotIndex).key);
            } else if (slotIndex == SLOT_NEXT) {
                StatusCommand.guiCyclePreset(cmdSource);
            } else if (slotIndex == SLOT_CLEAR) {
                StatusCommand.guiClearStatus(cmdSource);
            } else {
                return;
            }
            refreshDisplay();
            purgeMenuItems();
        } catch (Throwable e) {
            System.err.println("[StatusMod] GUI action failed: " + e.getMessage());
        }
    }

    /**
     * Removes menu items that escaped into the player inventory (number-key
     * swap, drag, double-click). Matches exact item + custom name, so real
     * player items are never touched.
     */
    private void purgeMenuItems() {
        try {
            if (!(viewer instanceof ServerPlayer sp)) return;
            // Container-Schnittstelle statt Felder (versionsstabil): deckt
            // Hauptinventar + Hotbar ab, ggf. auch Ruestung/Offhand.
            net.minecraft.world.entity.player.Inventory inv = sp.getInventory();
            int n = inv.getContainerSize();
            for (int i = 0; i < n; i++) {
                ItemStack stack;
                try {
                    stack = inv.getItem(i);
                } catch (Throwable ignored) {
                    continue;
                }
                if (stack.isEmpty()) continue;
                try {
                    if (isMenuItem(stack)) inv.setItem(i, ItemStack.EMPTY);
                } catch (Throwable ignored) {}
            }
            // Offhand explizit (F-Tausch), falls nicht im Containerbereich.
            try {
                ItemStack off = sp.getOffhandItem();
                if (!off.isEmpty() && isMenuItem(off)) {
                    sp.setItemSlot(EquipmentSlot.OFFHAND, ItemStack.EMPTY);
                }
            } catch (Throwable ignored) {}
            // Offhand hat keinen Slot in diesem Menü: broadcastChanges()
            // synct sie nie. Ohne explizites Paket bleibt ein per F getauschtes
            // (serverseitig geloschtes) Item clientseitig als Ghost sichtbar.
            syncOffhand();
            // Gedroppte Menü-Items (Q-Taste) als Entities einsammeln.
            // Einmal sofort, einmal verzögert: Die Entity spawnt möglicherweise
            // erst NACH dem Slot-Event (clicked()), der erste Sweep liefe ins Leere.
            purgeEntities(sp);
            scheduleEntitySweep();
        } catch (Throwable ignored) {}
    }

    /**
     * Pushes the server-side offhand to the client (see purgeMenuItems: the
     * offhand has no slot in this menu and is never synced otherwise).
     */
    /**
     * Authoritative full resync (slots + cursor) after a handled interaction.
     * Server state is always correct (restore from immutable saved[]), but with
     * rapid clicks the client's predictions can diverge permanently (ghost
     * slots, stale cursor). One full packet forces convergence. Send-only, so
     * it is safe to call from inside the slot listener.
     */
    @Override
    public void broadcastChanges() {
        try {
            reconcileMenu();
        } catch (Throwable t) {
            System.err.println("[StatusMod] GUI reconcile failed: " + t.getMessage());
        }
        super.broadcastChanges();
    }

    /**
     * Per-tick invariant enforcement, runs before vanilla change detection.
     * Held-key spam (e.g. holding F) can land slot-EMPTY on two consecutive
     * broadcasts: the second sees no change versus its snapshot, fires no
     * slotChanged event, and the item sits silently in the offhand while the
     * menu slot stays empty. Reconciling every tick closes that hole: maximum
     * divergence is one tick, silent states self-heal. Actions fire here (the
     * slot listener can no longer see a surviving mismatch, so it stays a
     * dormant backup and never double-fires).
     */
    private void reconcileMenu() {
        boolean fixed = false;
        for (int i = 0; i < SIZE; i++) {
            ItemStack live;
            try {
                live = container.getItem(i);
            } catch (Throwable t) {
                continue;
            }
            ItemStack def = saved[i];
            if (def.isEmpty()) {
                if (live.isEmpty()) continue;
                container.setItem(i, ItemStack.EMPTY);
                clearCursor(this, live.copy());
                fixed = true;
                logGui("gap-bounce", i, def);
                continue;
            }
            if (matchesDefinition(live, def)) continue;
            boolean polluted = !live.isEmpty() && live.getItem() != def.getItem();
            container.setItem(i, def.copy());
            clearCursor(this, polluted ? live.copy() : ItemStack.EMPTY);
            fixed = true;
            logGui(polluted ? "polluted" : "emptied", i, def);
            if (!polluted) handleSlotAction(i);
        }
        if (fixed) {
            purgeMenuItems();
            resync(this);
        }
    }
    private static void resync(AbstractContainerMenu menu) {
        try {
            if (menu != null) menu.sendAllDataToRemote();
        } catch (Throwable ignored) {}
    }

    /**
     * One-line server-truth log per handled menu interaction (goes to
     * latest.log). Proves what the server restored/cleared, so client display
     * issues can be distinguished from server state loss.
     */
    private void logGui(String event, int slotIndex, ItemStack savedStack) {
        try {
            String off = "?";
            String cur = "?";
            if (viewer instanceof ServerPlayer sp) {
                try {
                    ItemStack o = sp.getOffhandItem();
                    off = o.isEmpty() ? "empty" : o.getHoverName().getString();
                } catch (Throwable ignored) {}
                try {
                    ItemStack c = getCarried();
                    cur = c.isEmpty() ? "empty" : c.getHoverName().getString();
                } catch (Throwable ignored) {}
            }
            String res;
            try {
                res = savedStack.isEmpty() ? "empty" : savedStack.getHoverName().getString();
            } catch (Throwable t) {
                res = "?";
            }
            System.out.println("[StatusMod-GUI] build=" + com.teufel.statusmod.StatusMod.BUILD
                + " slot=" + slotIndex + " event=" + event + " restored=" + res
                + " offhand=" + off + " carried=" + cur);
        } catch (Throwable ignored) {}
    }

    private void syncOffhand() {
        try {
            if (viewer instanceof ServerPlayer sp) {
                sp.connection.send(new ClientboundSetEquipmentPacket(sp.getId(),
                    java.util.List.of(Pair.of(EquipmentSlot.OFFHAND, sp.getOffhandItem().copy()))));
            }
        } catch (Throwable ignored) {}
    }

    private void scheduleEntitySweep() {        try {
            net.minecraft.server.MinecraftServer server = cmdSource.getServer();
            if (server == null) return;
            server.execute(() -> {
                try {
                    if (viewer instanceof ServerPlayer sp2) {
                        purgeEntities(sp2);
                    }
                } catch (Throwable ignored) {}
            });
        } catch (Throwable ignored) {}
    }

    private void purgeEntities(ServerPlayer sp) {
        try {
            net.minecraft.world.phys.AABB area = sp.getBoundingBox().inflate(8.0D);
            for (net.minecraft.world.entity.item.ItemEntity entity
                    : sp.level().getEntitiesOfClass(net.minecraft.world.entity.item.ItemEntity.class, area)) {
                try {
                    if (!entity.isRemoved() && isMenuItem(entity.getItem())) {
                        entity.discard();
                    }
                } catch (Throwable ignored) {}
            }
        } catch (Throwable ignored) {}
    }

    /**
     * Clears the cursor reliably on all versions: setCarried alone is flaky
     * on 26.x, so the cursor is additionally forced via packet.
     */
    private void clearCursor(AbstractContainerMenu menu, ItemStack fallback) {
        try {
            if (menu != null) {
                try {
                    menu.setCarried(fallback == null ? ItemStack.EMPTY : fallback);
                } catch (Throwable ignored) {}
            }
        } catch (Throwable ignored) {}
        try {
            if (viewer instanceof ServerPlayer sp) {
                ItemStack cur = fallback == null ? ItemStack.EMPTY : fallback;
                sp.connection.send(new net.minecraft.network.protocol.game.ClientboundSetCursorItemPacket(cur));
            }
        } catch (Throwable ignored) {}
    }

    /**
     * True when a slot still holds its menu definition (item + count + display
     * name). Direct calls only, so it works on intermediary runtimes too.
     */
    private static boolean matchesDefinition(ItemStack stack, ItemStack def) {
        if (stack.isEmpty() || def.isEmpty()) return stack.isEmpty() && def.isEmpty();
        if (stack.getItem() != def.getItem()) return false;
        if (stack.getCount() != def.getCount()) return false;
        try {
            String a = stack.getHoverName().getString();
            String b = def.getHoverName().getString();
            if (!a.equals(b)) return false;
        } catch (Throwable ignored) {}
        return true;
    }

    private boolean isMenuItem(ItemStack stack) {        String n;
        try {
            n = stack.getHoverName().getString();
        } catch (Throwable t) {
            return false;
        }
        if (n == null || !menuNames.contains(n)) return false;
        for (ItemStack s : saved) {
            if (!s.isEmpty() && s.getItem() == stack.getItem()) return true;
        }
        return false;
    }

    private static ItemStack makeItem(Item item, String name, ChatFormatting nameColor, List<Component> lore) {
        ItemStack stack = new ItemStack(item);
        // Direct Mojang references (no Class.forName: intermediary runtimes like
        // Fabric/Quilt 1.21.11 have no Mojang class/field names at runtime).
        try {
            stack.set(DataComponents.CUSTOM_NAME, Component.literal(name).withStyle(nameColor));
        } catch (Throwable ignored) {}
        try {
            if (lore != null && !lore.isEmpty()) {
                stack.set(DataComponents.LORE, new ItemLore(new ArrayList<>(lore)));
            }
        } catch (Throwable ignored) {}
        return stack;
    }

    @Override
    public boolean stillValid(Player player) {
        return true;
    }

    @Override
    public ItemStack quickMoveStack(Player player, int index) {
        try {
            if (index >= 0 && index < SIZE) {
                long now = System.currentTimeMillis();
                if (now - lastActionAtMs < ACTION_DEBOUNCE_MS) return ItemStack.EMPTY;
                lastActionAtMs = now;
                if (index < Math.min(entries.size(), PRESET_SLOTS)) {
                    StatusCommand.guiApplyPreset(cmdSource, entries.get(index).key);
                } else if (index == SLOT_NEXT) {
                    StatusCommand.guiCyclePreset(cmdSource);
                } else if (index == SLOT_CLEAR) {
                    StatusCommand.guiClearStatus(cmdSource);
                } else {
                    return ItemStack.EMPTY;
                }
                refreshDisplay();
                purgeMenuItems();
                resync(this);
                logGui("shift", index, saved[index]);
            } else {
                // Eigene Slots: Shift wird geblockt (Vanilla würde bewegen).
                // Ohne Resync behaelt der Client seine falsche Vorhersage.
                resync(this);
            }
        } catch (Throwable e) {
            System.err.println("[StatusMod] GUI shift-click failed: " + e.getMessage());
        }
        return ItemStack.EMPTY;
    }

    @Override
    public void removed(Player player) {
        try {
            // Take-and-close: cursor loot + escaped menu items must not survive
            // closing the menu (ESC) — otherwise taking items "works".
            clearCursor(this, ItemStack.EMPTY);
            purgeMenuItems();
            // Drop-and-close (Q, dann sofort ESC): Entity-Sweep, sonst bleibt
            // das gedroppte Menü-Item liegen und kann aufgesammelt werden.
            if (viewer instanceof ServerPlayer sp) purgeEntities(sp);
        } catch (Throwable ignored) {}
        super.removed(player);
    }
}
