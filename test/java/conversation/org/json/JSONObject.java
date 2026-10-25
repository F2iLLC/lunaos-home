package org.json;
// Minimal in-memory JSON adapter for fault-testing the production Android client.
public class JSONObject {
    private final java.util.Map<String,Object> values = new java.util.HashMap<>();
    public JSONObject put(String key, Object value) { values.put(key, value); return this; }
    public boolean getBoolean(String key) { return (Boolean)values.get(key); }
    public boolean optBoolean(String key, boolean fallback) { return values.containsKey(key) ? getBoolean(key) : fallback; }
    public String getString(String key) { return (String)values.get(key); }
    public String optString(String key) { return values.containsKey(key) ? getString(key) : ""; }
    public int getInt(String key) { return (Integer)values.get(key); }
    public JSONObject getJSONObject(String key) { return (JSONObject)values.get(key); }
}
