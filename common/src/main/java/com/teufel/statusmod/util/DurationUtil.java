package com.teufel.statusmod.util;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses compact Minecraft-style durations ("30m", "2h", "1d", "1d12h")
 * and formats remaining times for chat/tooltips.
 */
public final class DurationUtil {
    private static final Pattern PART = Pattern.compile("(\\d+)([smhdw])");
    private static final Pattern FULL = Pattern.compile("^(?:\\d+[smhdw])+$");

    /** Hard cap so a typo cannot create a decade-long status. */
    public static final long MAX_DURATION_MS = 365L * 24L * 60L * 60L * 1000L;

    private DurationUtil() {}

    /** @return duration in milliseconds, or -1 if the input is not a valid duration. */
    public static long parseMillis(String input) {
        if (input == null) return -1L;
        String s = input.trim().toLowerCase(Locale.ROOT);
        if (s.isEmpty() || !FULL.matcher(s).matches()) return -1L;
        long total = 0L;
        Matcher m = PART.matcher(s);
        while (m.find()) {
            long value;
            try {
                value = Long.parseLong(m.group(1));
            } catch (NumberFormatException e) {
                return -1L;
            }
            long mult = switch (m.group(2)) {
                case "s" -> 1_000L;
                case "m" -> 60_000L;
                case "h" -> 3_600_000L;
                case "d" -> 86_400_000L;
                case "w" -> 604_800_000L;
                default -> 0L;
            };
            if (mult <= 0L || value <= 0L) return -1L;
            if (value > MAX_DURATION_MS / mult) return -1L;
            total += value * mult;
            if (total > MAX_DURATION_MS) return -1L;
        }
        return total > 0L ? total : -1L;
    }

    /** Formats e.g. 5400000 as "1h 30m", 90000 as "1m 30s". */
    public static String formatDuration(long millis) {
        if (millis <= 0L) return "0s";
        long totalSeconds = Math.max(1L, (millis + 999L) / 1000L);
        long days = totalSeconds / 86_400L;
        long hours = (totalSeconds % 86_400L) / 3_600L;
        long minutes = (totalSeconds % 3_600L) / 60L;
        long seconds = totalSeconds % 60L;
        StringBuilder sb = new StringBuilder();
        if (days > 0L) sb.append(days).append("d ");
        if (hours > 0L) sb.append(hours).append("h ");
        if (minutes > 0L && days == 0L) sb.append(minutes).append("m ");
        if (seconds > 0L && days == 0L && hours == 0L) sb.append(seconds).append("s");
        String out = sb.toString().trim();
        return out.isEmpty() ? "0s" : out;
    }

    /** Formats a timestamp as remaining time ("noch 12m"), or "" when already expired. */
    public static String formatRemaining(long untilMs) {
        long remaining = untilMs - System.currentTimeMillis();
        return remaining > 0L ? formatDuration(remaining) : "";
    }
}
