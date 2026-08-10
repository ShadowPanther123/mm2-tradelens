mod commands;
mod database;
mod error;
mod state;

use tauri::Manager;

use crate::state::AppState;

/// Initialise the SQLite database inside the app data directory and return the
/// managed application state.
fn init_state(app: &tauri::App) -> Result<AppState, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let db_path = dir.join("tradelens.sqlite");
    let conn = database::open(&db_path)?;
    Ok(AppState::new(conn))
}

/// Bring the main overlay window to the foreground (used when a second launch
/// is folded into the already-running instance).
#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single instance: with autostart enabled the overlay may already be
    // running on login. A second launch (e.g. double-clicking the icon) should
    // simply surface the existing window instead of spawning a competing
    // process that would clash on the global hotkey. Must be registered first.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app);
        }));
    }

    // Global hotkey: Ctrl+Shift+M brings the overlay forward and toggles it.
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

        let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);
        let toggle_for_handler = toggle;

        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle_for_handler && event.state() == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            // Toggle the overlay: hide it if it is already
                            // showing and focused, otherwise bring it forward.
                            let showing = win.is_visible().unwrap_or(false);
                            let focused = win.is_focused().unwrap_or(false);
                            if showing && focused {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                                let _ = tauri::Emitter::emit(app, "toggle-overlay", ());
                            }
                        }
                    }
                })
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let app_state = init_state(app)?;
            #[cfg(desktop)]
            let always_on_top = app_state
                .with_db(|conn| Ok(database::settings::get(conn)?.always_on_top))
                .unwrap_or(true);
            app.manage(app_state);

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);
                // Registering the hotkey must never be fatal: another app (or a
                // lingering instance) may already own Ctrl+Shift+M. If it can't
                // be claimed the overlay still opens and stays usable via the
                // window itself — we just log the miss.
                if let Err(err) = app.global_shortcut().register(toggle) {
                    eprintln!("could not register global hotkey Ctrl+Shift+M: {err}");
                }

                // Launch automatically on login so the overlay is always ready
                // in the background; the user only needs the hotkey after this.
                let autostart = app.autolaunch();
                let _ = autostart.enable();

                // Keep the app alive in the background. Closing the window (the
                // title-bar ✕) must HIDE it, not quit the process — otherwise
                // there is nothing left running to receive Ctrl+Shift+M and the
                // hotkey appears "broken". The user quits explicitly from the
                // tray icon instead.
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_always_on_top(always_on_top);
                    let win_for_close = win.clone();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = win_for_close.hide();
                        }
                    });
                }

                // System tray so it is obvious the overlay is running in the
                // background: left-click (or "Show overlay") brings it forward,
                // "Quit" fully exits.
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show_item = MenuItem::with_id(app, "show", "Show overlay", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                let mut tray = TrayIconBuilder::new()
                    .tooltip("MM2 TradeLens — press Ctrl+Shift+M")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                    });
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.build(app)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::favorites::list_favorites,
            commands::favorites::add_favorite,
            commands::favorites::remove_favorite,
            commands::favorites::is_favorite,
            commands::history::list_history,
            commands::history::add_history_record,
            commands::history::remove_history_record,
            commands::snapshot::get_snapshot,
            commands::snapshot::get_snapshot_meta,
            commands::snapshot::read_external_snapshot,
            commands::snapshot::save_snapshot,
            commands::value_history::record_value_history,
            commands::value_history::get_value_history,
            commands::system::app_info,
            commands::system::set_overlay_size,
            commands::system::set_always_on_top,
            commands::system::clear_all_data,
            commands::system::reset_database,
            commands::system::focus_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MM2 TradeLens");
}
