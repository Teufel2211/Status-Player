package com.teufel.statusmod.storage;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class PlayerSettings {
    public int brackets = 0;
    public boolean beforeName = false;
    public String status = "";
    public String color = "reset";
    public String fontStyle = "normal";
    public int statusWords = 1;

    public long lastStatusChangeAtMs = 0L;
    public long statusExpiresAtMs = 0L;
    /** Status/color stashed when a timed status was applied, restored on expiry. */
    public String timedPrevStatus = "";
    public String timedPrevColor = "reset";

    public long lastActivityAtMs = System.currentTimeMillis();
    public boolean autoAfk = false;
    public String preAfkStatus = "";
    public String preAfkColor = "reset";
    public String lastKnownName = "";
    public String avatar = "";

    public List<String> statusHistory = new ArrayList<>();
    public Map<String, String> statusByWorld = new HashMap<>();
    public Map<String, String> colorByWorld = new HashMap<>();
}
