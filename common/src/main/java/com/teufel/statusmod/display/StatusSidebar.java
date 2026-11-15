package com.teufel.statusmod.display;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.util.StatusTextUtil;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.scores.DisplaySlot;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.ScoreAccess;
import net.minecraft.world.scores.ScoreHolder;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.criteria.ObjectiveCriteria;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Optional sidebar scoreboard (config: sidebarListEnabled, default OFF,
 * toggleable ingame via /status sidebar). Shows one line per online player:
 * name plus colored status, like the Java tab list. Unlike the pause-menu
 * player list, the sidebar IS translated by Geyser, so Bedrock sees it too.
 * Note: the sidebar is global (vanilla has no per-player sidebars).
 */
public final class StatusSidebar {
    private static final String OBJECTIVE_ID = "statusmod";
    private static final int MAX_ENTRY_LENGTH = 40;
    private static final Map<String, String> lastEntries = new HashMap<>();

    private static final Map<String, String> SECTION_BY_COLOR = new HashMap<>();
    static {
        SECTION_BY_COLOR.put("black", "0");
        SECTION_BY_COLOR.put("dark_blue", "1");
        SECTION_BY_COLOR.put("dark_green", "2");
        SECTION_BY_COLOR.put("dark_aqua", "3");
        SECTION_BY_COLOR.put("dark_red", "4");
        SECTION_BY_COLOR.put("dark_purple", "5");
        SECTION_BY_COLOR.put("gold", "6");
        SECTION_BY_COLOR.put("gray", "7");
        SECTION_BY_COLOR.put("dark_gray", "8");
        SECTION_BY_COLOR.put("blue", "9");
        SECTION_BY_COLOR.put("green", "a");
        SECTION_BY_COLOR.put("aqua", "b");
        SECTION_BY_COLOR.put("red", "c");
        SECTION_BY_COLOR.put("light_purple", "d");
        SECTION_BY_COLOR.put("yellow", "e");
        SECTION_BY_COLOR.put("white", "f");
    }

    private StatusSidebar() {}

    public static void sync(MinecraftServer server) {
        if (server == null) return;
        boolean enabled = StatusMod.getConfig() != null && StatusMod.getConfig().sidebarListEnabled;
        try {
            Scoreboard scoreboard = server.getScoreboard();
            if (!enabled) {
                hide(scoreboard);
                return;
            }
            Objective objective = scoreboard.getObjective(OBJECTIVE_ID);
            if (objective == null) {
                objective = scoreboard.addObjective(OBJECTIVE_ID, ObjectiveCriteria.DUMMY,
                    Component.literal("Status"),
                    ObjectiveCriteria.RenderType.INTEGER, false,
                    net.minecraft.network.chat.numbers.BlankFormat.INSTANCE);
            }
            scoreboard.setDisplayObjective(DisplaySlot.SIDEBAR, objective);

            List<ServerPlayer> online = new ArrayList<>(server.getPlayerList().getPlayers());
            online.sort((a, b) -> a.getScoreboardName().compareToIgnoreCase(b.getScoreboardName()));
            Map<String, String> wanted = new HashMap<>();
            for (ServerPlayer p : online) {
                wanted.put(p.getUUID().toString(), buildEntry(p));
            }
            for (Map.Entry<String, String> e : new ArrayList<>(lastEntries.entrySet())) {
                String current = wanted.get(e.getKey());
                if (current == null || !current.equals(e.getValue())) {
                    try {
                        scoreboard.resetAllPlayerScores(ScoreHolder.forNameOnly(e.getValue()));
                    } catch (Throwable ignored) {}
                    lastEntries.remove(e.getKey());
                }
            }
            int score = online.size();
            for (ServerPlayer p : online) {
                String uuid = p.getUUID().toString();
                String entry = wanted.get(uuid);
                if (entry == null) continue;
                if (!entry.equals(lastEntries.get(uuid))) {
                    lastEntries.put(uuid, entry);
                }
                try {
                    ScoreAccess access = scoreboard.getOrCreatePlayerScore(ScoreHolder.forNameOnly(entry), objective);
                    access.set(score);
                    try {
                        access.numberFormatOverride(net.minecraft.network.chat.numbers.BlankFormat.INSTANCE);
                    } catch (Throwable ignored) {}
                } catch (Throwable ignored) {}
                score--;
            }
        } catch (Throwable e) {
            System.err.println("[StatusMod] Sidebar sync failed: " + e.getMessage());
        }
    }

    /** Blendet die Status-Sidebar aus (Kill-Switch). */
    public static void hide(MinecraftServer server) {
        if (server == null) return;
        try {
            hide(server.getScoreboard());
        } catch (Throwable ignored) {}
    }

    private static void hide(Scoreboard scoreboard) {
        try {
            Objective objective = scoreboard.getObjective(OBJECTIVE_ID);
            if (objective != null) {
                scoreboard.setDisplayObjective(DisplaySlot.SIDEBAR, null);
            }
        } catch (Throwable ignored) {}
        if (!lastEntries.isEmpty()) {
            for (String entry : new ArrayList<>(lastEntries.values())) {
                try {
                    scoreboard.resetAllPlayerScores(ScoreHolder.forNameOnly(entry));
                } catch (Throwable ignored) {}
            }
            lastEntries.clear();
        }
    }

    private static String buildEntry(ServerPlayer p) {
        String name = p.getScoreboardName();
        String entry = name;
        try {
            if (StatusMod.storage != null) {
                PlayerSettings s = StatusMod.storage.forPlayer(p.getUUID().toString());
                String st = StatusTextUtil.resolveStatusForPlayer(s, p);
                if (st != null && !st.isEmpty()) {
                    String ck = StatusTextUtil.resolveColorForPlayer(s, p);
                    String code = SECTION_BY_COLOR.getOrDefault(ck == null ? "" : ck.toLowerCase(java.util.Locale.ROOT), "");
                    String brackets = "";
                    String close = "";
                    if (s != null && s.brackets == 1) {
                        brackets = "[]";
                    } else if (s != null && s.brackets == 2) {
                        brackets = "<>";
                    }
                    StringBuilder sb = new StringBuilder(name).append(' ');
                    if (!brackets.isEmpty()) sb.append('§').append('f').append(brackets.charAt(0));
                    if (!code.isEmpty()) sb.append('§').append(code);
                    sb.append(st);
                    if (!brackets.isEmpty()) sb.append('§').append('f').append(brackets.charAt(1));
                    sb.append('§').append('r');
                    entry = sb.toString();
                }
            }
        } catch (Throwable ignored) {}
        // Codepoint-sicher kuerzen (keine halben Emojis) und nicht mitten in
        // einer §X-Farbsequenz schneiden (kein hängendes §).
        if (entry.codePointCount(0, entry.length()) > MAX_ENTRY_LENGTH) {
            int cut = entry.offsetByCodePoints(0, MAX_ENTRY_LENGTH);
            if (cut > 0 && entry.charAt(cut - 1) == '§') cut--;
            entry = entry.substring(0, cut);
        }
        return entry;
    }
}
