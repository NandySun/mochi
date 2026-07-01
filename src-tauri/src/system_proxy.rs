//! Windows system proxy detection.
//!
//! Reads the system-wide proxy setting from the Windows registry
//! (the same source that HanaAgent's `"mode": "system"` reads).
//! Falls back to environment variables when the registry setting is disabled.

use std::env;

/// Try to detect a proxy URL from the Windows system proxy setting,
/// falling back to the standard `HTTP_PROXY` / `HTTPS_PROXY` env vars.
///
/// Returns `None` when no proxy is configured.
pub fn system_proxy_url() -> Option<String> {
    // Priority 1: environment variables (standard convention, works cross-platform)
    if let Ok(url) = env::var("HTTPS_PROXY").or_else(|_| env::var("https_proxy")) {
        if !url.is_empty() {
            return Some(url);
        }
    }
    if let Ok(url) = env::var("HTTP_PROXY").or_else(|_| env::var("http_proxy")) {
        if !url.is_empty() {
            return Some(url);
        }
    }

    // Priority 2: Windows system proxy (registry)
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let key = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
        if let Ok(settings) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(key) {
            let enabled: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
            if enabled == 1 {
                if let Ok(server) = settings.get_value::<String, _>("ProxyServer") {
                    if !server.is_empty() {
                        // The registry value can be "host:port" or "http=host:port;https=host2:port2"
                        if !server.contains('=') {
                            return Some(format!("http://{}", server));
                        }
                        // Parse per-protocol format: "http=127.0.0.1:7890;https=127.0.0.1:7890"
                        for part in server.split(';') {
                            if let Some((proto, addr)) = part.split_once('=') {
                                if proto.trim().eq_ignore_ascii_case("https") {
                                    return Some(format!("https://{}", addr.trim()));
                                }
                            }
                        }
                        // Fallback: first http entry
                        for part in server.split(';') {
                            if let Some((proto, addr)) = part.split_once('=') {
                                if proto.trim().eq_ignore_ascii_case("http") {
                                    return Some(format!("http://{}", addr.trim()));
                                }
                            }
                        }
                        // Last resort: use the raw value
                        return Some(format!("http://{}", server));
                    }
                }
            }
        }
    }

    None
}
