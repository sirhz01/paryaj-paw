// Terminal de la boutique Paryaj Paw (Tauri 2). Client léger : il charge le front-end servi par le
// serveur (caisse et écrans TV). L'adresse du serveur est gardée dans un fichier local ; le menu natif
// permet d'ouvrir la caisse, un écran TV, de changer de serveur ou de passer en plein écran.
use std::fs;
use std::path::PathBuf;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Manager, WebviewWindow};

const PAGE_HOST: &str = "http://tauri.localhost"; // Hôte des pages embarquées sous Windows.

fn server_file(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().expect("dossier de configuration introuvable");
    let _ = fs::create_dir_all(&dir);
    dir.join("server.txt")
}

fn read_server(app: &tauri::AppHandle) -> Option<String> {
    fs::read_to_string(server_file(app))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
fn get_server(app: tauri::AppHandle) -> String {
    read_server(&app).unwrap_or_default()
}

#[tauri::command]
fn save_server(app: tauri::AppHandle, url: String) -> Result<(), String> {
    fs::write(server_file(&app), url.trim()).map_err(|e| e.to_string())
}

/// Ouvre une page du serveur dans la fenêtre, ou l'écran de configuration embarqué si aucun serveur n'est défini.
fn open(window: &WebviewWindow, page: &str) {
    let app = window.app_handle();
    let target = match read_server(app) {
        Some(server) => format!("{server}/{page}"),
        None => format!("{PAGE_HOST}/index.html"),
    };
    if let Ok(url) = target.parse() {
        let _ = window.navigate(url);
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_server, save_server])
        .setup(|app| {
            let item = |id: &str, label: &str, accel: Option<&str>| {
                let mut b = MenuItemBuilder::with_id(id, label);
                if let Some(a) = accel {
                    b = b.accelerator(a);
                }
                b.build(app)
            };

            let boutique = SubmenuBuilder::new(app, "Boutique")
                .item(&item("accueil", "Accueil", Some("CmdOrCtrl+H"))?)
                .item(&item("caisse", "Caisse", Some("CmdOrCtrl+1"))?)
                .separator()
                .item(&item("serveur", "Changer de serveur…", Some("CmdOrCtrl+Shift+S"))?)
                .separator()
                .quit()
                .build()?;

            let tv = SubmenuBuilder::new(app, "Écrans TV")
                .item(&item("roulette", "Roulette", Some("CmdOrCtrl+2"))?)
                .item(&item("keno", "Keno", Some("CmdOrCtrl+3"))?)
                .item(&item("luckysix", "Lucky Six", Some("CmdOrCtrl+4"))?)
                .item(&item("luckyx", "Lucky X", Some("CmdOrCtrl+5"))?)
                .build()?;

            let affichage = SubmenuBuilder::new(app, "Affichage")
                .item(&item("plein-ecran", "Plein écran", Some("F11"))?)
                .item(&item("recharger", "Recharger", Some("CmdOrCtrl+R"))?)
                .build()?;

            let menu = MenuBuilder::new(app).items(&[&boutique, &tv, &affichage]).build()?;
            app.set_menu(menu)?;

            // Au démarrage, ouvrir directement le serveur s'il est déjà configuré.
            if let Some(window) = app.get_webview_window("main") {
                if read_server(app.handle()).is_some() {
                    open(&window, "");
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            match event.id().as_ref() {
                "accueil" => open(&window, ""),
                "caisse" => open(&window, "caisse.html"),
                "roulette" => open(&window, "roulette.html"),
                "keno" => open(&window, "keno.html"),
                "luckysix" => open(&window, "luckysix.html"),
                "luckyx" => open(&window, "luckyx.html"),
                "serveur" => {
                    if let Ok(url) = format!("{PAGE_HOST}/index.html").parse() {
                        let _ = window.navigate(url);
                    }
                }
                "plein-ecran" => {
                    let full = window.is_fullscreen().unwrap_or(false);
                    let _ = window.set_fullscreen(!full);
                }
                "recharger" => {
                    let _ = window.eval("location.reload()");
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("échec du lancement de Paryaj Paw Boutik");
}
